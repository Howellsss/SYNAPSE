// Connect a Google account so a team member can send email from their Gmail.
//
//   POST { action: "start", workspace_id, return_path? }  -> { url }   (needs the user's JWT)
//   GET  ?code=...&state=...                             -> Google redirects here; we store the
//                                                           encrypted refresh token and send the
//                                                           browser back to SYNAPSE
//   POST { action: "disconnect", account_id }            -> revokes the token and removes it
//
// Deployed with verify_jwt = false because Google's redirect carries no Supabase JWT;
// the POST actions check the JWT themselves.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY, APP_URL
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
];
const STATE_TTL_SECONDS = 10 * 60;

// ---------- crypto helpers (keep in sync with send-email) ----------
function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64url(bytes: Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return b64decode(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
function rawKey(): Uint8Array {
  const k = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? "";
  const bytes = b64decode(k.trim());
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return bytes;
}
async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey(), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return "v1:" + b64encode(out);
}
async function decrypt(enc: string): Promise<string> {
  if (!enc.startsWith("v1:")) throw new Error("Unknown token format");
  const data = b64decode(enc.slice(3));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: data.slice(0, 12) },
    await aesKey(),
    data.slice(12),
  );
  return new TextDecoder().decode(pt);
}
// The state key is derived from the encryption key so there is one less secret to manage.
async function hmacKey(): Promise<CryptoKey> {
  const material = new Uint8Array([...new TextEncoder().encode("synapse-oauth-state:"), ...rawKey()]);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body)));
  return `${body}.${b64url(sig)}`;
}
async function verifyState(state: string): Promise<Record<string, unknown> | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64urlDecode(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
// -------------------------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

function redirectUri(): string {
  return `${env("SUPABASE_URL")}/functions/v1/gmail-oauth`;
}

// Only allow returning to a path inside SYNAPSE.
function safeReturnPath(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.length > 300) {
    return "/settings?tab=email";
  }
  return p;
}

function backToApp(returnPath: string, params: Record<string, string>) {
  const appUrl = env("APP_URL").replace(/\/+$/, "");
  const sep = returnPath.includes("?") ? "&" : "?";
  const qs = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: { Location: `${appUrl}/#${returnPath}${sep}${qs}` },
  });
}

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return { user: null, client: null };
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return { user: null, client: null };
  return { user: data.user, client };
}

function admin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function handleStart(req: Request, body: Record<string, unknown>) {
  const { user, client } = await getUser(req);
  if (!user || !client) return json({ error: "Please sign in again." }, 401);

  const workspaceId = String(body.workspace_id ?? "");
  if (!workspaceId) return json({ error: "workspace_id is required" }, 400);
  const { data: isMember } = await client.rpc("is_workspace_member", { check_workspace_id: workspaceId });
  if (!isMember) return json({ error: "You are not a member of this workspace." }, 403);

  const state = await signState({
    uid: user.id,
    ws: workspaceId,
    rp: safeReturnPath(body.return_path),
    n: b64url(crypto.getRandomValues(new Uint8Array(12))),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  });

  const params = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (user.email) params.set("login_hint", user.email);
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
}

async function handleCallback(url: URL) {
  const stateParam = url.searchParams.get("state") ?? "";
  const state = stateParam ? await verifyState(stateParam) : null;
  const returnPath = safeReturnPath(state?.rp);
  if (!state) return backToApp(returnPath, { gmail: "error", reason: "expired" });

  const googleError = url.searchParams.get("error");
  if (googleError) {
    return backToApp(returnPath, { gmail: "error", reason: googleError === "access_denied" ? "denied" : "google" });
  }
  const code = url.searchParams.get("code");
  if (!code) return backToApp(returnPath, { gmail: "error", reason: "google" });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    console.error("token exchange failed", tokens.error, tokens.error_description);
    return backToApp(returnPath, { gmail: "error", reason: "exchange" });
  }

  const granted = String(tokens.scope ?? "").split(" ");
  if (!granted.includes("https://www.googleapis.com/auth/gmail.send")) {
    return backToApp(returnPath, { gmail: "error", reason: "scope" });
  }

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const info = await infoRes.json();
  if (!infoRes.ok || !info.email || info.email_verified === false) {
    return backToApp(returnPath, { gmail: "error", reason: "profile" });
  }
  const email = String(info.email).toLowerCase();

  const db = admin();
  const { data: account, error: upsertError } = await db
    .from("email_accounts")
    .upsert(
      {
        workspace_id: state.ws,
        user_id: state.uid,
        provider: "google",
        email,
        display_name: info.name ?? null,
        status: "active",
        last_error: null,
        scopes: granted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id,provider,email" },
    )
    .select("id")
    .single();
  if (upsertError || !account) {
    console.error("account upsert failed", upsertError?.message);
    return backToApp(returnPath, { gmail: "error", reason: "save" });
  }

  const secretRow: Record<string, unknown> = {
    account_id: account.id,
    access_token_enc: await encrypt(tokens.access_token),
    access_token_expires_at: new Date(Date.now() + (Number(tokens.expires_in ?? 3600) - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) {
    secretRow.refresh_token_enc = await encrypt(tokens.refresh_token);
  } else {
    // Google only omits the refresh token if one was already issued; keep ours if we have it.
    const { data: existing } = await db
      .from("email_account_secrets")
      .select("account_id")
      .eq("account_id", account.id)
      .maybeSingle();
    if (!existing) return backToApp(returnPath, { gmail: "error", reason: "no_refresh" });
  }
  const { error: secretError } = tokens.refresh_token
    ? await db.from("email_account_secrets").upsert(secretRow, { onConflict: "account_id" })
    : await db.from("email_account_secrets").update(secretRow).eq("account_id", account.id);
  if (secretError) {
    console.error("secret save failed", secretError.message);
    return backToApp(returnPath, { gmail: "error", reason: "save" });
  }

  return backToApp(returnPath, { gmail: "connected", email });
}

async function handleDisconnect(req: Request, body: Record<string, unknown>) {
  const { user } = await getUser(req);
  if (!user) return json({ error: "Please sign in again." }, 401);
  const accountId = String(body.account_id ?? "");

  const db = admin();
  const { data: account } = await db
    .from("email_accounts")
    .select("id, user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account || account.user_id !== user.id) return json({ error: "Account not found." }, 404);

  const { data: secret } = await db
    .from("email_account_secrets")
    .select("refresh_token_enc")
    .eq("account_id", accountId)
    .maybeSingle();
  if (secret?.refresh_token_enc) {
    try {
      const token = await decrypt(secret.refresh_token_enc);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch (e) {
      // Still remove it on our side even if Google could not be reached.
      console.error("revoke failed", (e as Error).message);
    }
  }

  const { error } = await db.from("email_accounts").delete().eq("id", accountId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    if (req.method === "GET") return await handleCallback(url);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    if (body.action === "start") return await handleStart(req, body);
    if (body.action === "disconnect") return await handleDisconnect(req, body);
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
