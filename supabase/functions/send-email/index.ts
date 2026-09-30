// Send an email from a team member's connected Gmail account and record it on the contact.
//
//   POST (with the user's JWT)
//   { account_id, contact_id?, to, cc?, bcc?, subject, text, html?, from_name? }
//   -> { message }   the saved messages row (status "sent" or "failed")
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_RECIPIENTS = 50;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

// ---------- crypto helpers (keep in sync with gmail-oauth) ----------
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
// Any reasonably long secret works: a 32-byte base64 key is used as-is, anything else is hashed into one.
async function rawKey(): Promise<Uint8Array> {
  const k = (Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? "").trim().replace(/^["']|["']$/g, "");
  if (k.length < 16) throw new Error("TOKEN_ENCRYPTION_KEY is missing or too short (use 16+ characters)");
  try {
    const bytes = b64decode(k);
    if (bytes.length === 32) return bytes;
  } catch { /* not base64: hash it below */ }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k)));
}
async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await rawKey(), "AES-GCM", false, ["encrypt", "decrypt"]);
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
// -------------------------------------------------------------------

// ---------- MIME ----------
const utf8 = (s: string) => new TextEncoder().encode(s);

// Header values must never contain line breaks (header injection).
function clean(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}
function encodeWord(s: string): string {
  const v = clean(s);
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64encode(utf8(v))}?=`;
}
function formatAddress(email: string, name?: string | null): string {
  const n = name ? clean(name) : "";
  if (!n) return email;
  const display = /^[\x20-\x7e]*$/.test(n) ? `"${n.replace(/["\\]/g, "\\$&")}"` : encodeWord(n);
  return `${display} <${email}>`;
}
function wrap76(s: string): string {
  return s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}
function buildMime(opts: {
  from: string;
  fromName?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html?: string | null;
}): string {
  const boundary = `synapse_${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const headers = [
    `From: ${formatAddress(opts.from, opts.fromName)}`,
    `To: ${opts.to.join(", ")}`,
    ...(opts.cc.length ? [`Cc: ${opts.cc.join(", ")}`] : []),
    ...(opts.bcc.length ? [`Bcc: ${opts.bcc.join(", ")}`] : []),
    `Subject: ${encodeWord(opts.subject)}`,
    "MIME-Version: 1.0",
  ];
  const textPart = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64encode(utf8(opts.text))),
  ].join("\r\n");
  if (!opts.html) return [...headers, textPart].join("\r\n");

  const htmlPart = [
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64encode(utf8(opts.html))),
  ].join("\r\n");
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    textPart,
    `--${boundary}`,
    htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
// --------------------------

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

function addressList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
  return list.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
}

class ReconnectNeeded extends Error {}

async function accessTokenFor(db: SupabaseClient, accountId: string): Promise<string> {
  const { data: secret } = await db
    .from("email_account_secrets")
    .select("refresh_token_enc, access_token_enc, access_token_expires_at")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!secret) throw new ReconnectNeeded("This Gmail account needs to be reconnected.");

  if (secret.access_token_enc && secret.access_token_expires_at && new Date(secret.access_token_expires_at) > new Date()) {
    return decrypt(secret.access_token_enc);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: await decrypt(secret.refresh_token_enc),
      grant_type: "refresh_token",
    }),
  });
  const tokens = await res.json();
  if (!res.ok || !tokens.access_token) {
    if (tokens.error === "invalid_grant") {
      throw new ReconnectNeeded("Google access was removed or expired. Reconnect this Gmail account in Settings → Email.");
    }
    throw new Error(`Google token refresh failed: ${tokens.error_description ?? tokens.error ?? res.status}`);
  }
  await db
    .from("email_account_secrets")
    .update({
      access_token_enc: await encrypt(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + (Number(tokens.expires_in ?? 3600) - 60) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId);
  return tokens.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "Please sign in again." }, 401);

    const body = await req.json().catch(() => ({}));
    const to = addressList(body.to);
    const cc = addressList(body.cc);
    const bcc = addressList(body.bcc);
    const subject = String(body.subject ?? "").slice(0, 998);
    const text = String(body.text ?? "");
    const html = body.html ? String(body.html) : null;

    if (to.length !== 1) return json({ error: "Choose one recipient." }, 400);
    if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) return json({ error: "Too many recipients." }, 400);
    const bad = [...to, ...cc, ...bcc].find((a) => !EMAIL_RE.test(a));
    if (bad) return json({ error: `"${bad}" is not a valid email address.` }, 400);
    if (!subject.trim()) return json({ error: "Add a subject." }, 400);
    if (!text.trim() && !html) return json({ error: "Write a message." }, 400);
    if (utf8(text).length + (html ? utf8(html).length : 0) > MAX_BODY_BYTES) {
      return json({ error: "The message is too large." }, 400);
    }

    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // Only the person who connected the mailbox can send from it.
    const { data: account } = await db
      .from("email_accounts")
      .select("id, workspace_id, user_id, email, display_name, status")
      .eq("id", String(body.account_id ?? ""))
      .maybeSingle();
    if (!account || account.user_id !== user.id) return json({ error: "That Gmail account is not connected." }, 404);
    if (account.status === "revoked") {
      return json({ error: "Reconnect this Gmail account in Settings → Email before sending." }, 409);
    }
    const { data: isMember } = await userClient.rpc("is_workspace_member", { check_workspace_id: account.workspace_id });
    if (!isMember) return json({ error: "You are no longer a member of this workspace." }, 403);

    let contactId: string | null = null;
    if (body.contact_id) {
      const { data: contact } = await db
        .from("contacts")
        .select("id, workspace_id")
        .eq("id", String(body.contact_id))
        .maybeSingle();
      if (!contact || contact.workspace_id !== account.workspace_id) return json({ error: "Contact not found." }, 404);
      contactId = contact.id;
    }

    const fromName = body.from_name ? clean(String(body.from_name)).slice(0, 100) : account.display_name;
    const record = {
      workspace_id: account.workspace_id,
      contact_id: contactId,
      channel: "email",
      direction: "outbound",
      subject,
      body: text,
      body_html: html,
      from_email: account.email,
      from_name: fromName,
      to_address: to[0],
      cc,
      bcc,
      email_account_id: account.id,
    };

    let status: "sent" | "failed" = "sent";
    let providerId: string | null = null;
    let errorText: string | null = null;
    try {
      const accessToken = await accessTokenFor(db, account.id);
      const mime = buildMime({ from: account.email, fromName, to, cc, bcc, subject, text, html });
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: b64url(utf8(mime)) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = out?.error?.message ?? `Gmail returned ${res.status}`;
        if (res.status === 401) throw new ReconnectNeeded(msg);
        throw new Error(msg);
      }
      providerId = out.id ?? null;
      if (account.status !== "active") {
        await db.from("email_accounts").update({ status: "active", last_error: null }).eq("id", account.id);
      }
    } catch (e) {
      status = "failed";
      errorText = (e as Error).message;
      if (e instanceof ReconnectNeeded) {
        await db
          .from("email_accounts")
          .update({ status: "revoked", last_error: errorText, updated_at: new Date().toISOString() })
          .eq("id", account.id);
      }
    }

    const { data: message, error: insertError } = await db
      .from("messages")
      .insert({
        ...record,
        status,
        provider_message_id: providerId,
        error: errorText,
        sent_at: status === "sent" ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (insertError) console.error("message insert failed", insertError.message);

    if (status === "failed") return json({ error: errorText, message }, 502);
    return json({ message });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
