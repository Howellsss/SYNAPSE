// Incoming webhooks for Conversations: Zapier, Airtable, Modal or anything that can send an HTTP
// POST puts a message into a channel. Each channel's webhook has its own secret link:
//
//   POST https://<project>.supabase.co/functions/v1/chat-webhook/<token>
//   POST https://<project>.supabase.co/functions/v1/chat-webhook?token=<token>
//
// Body (any of):
//   JSON   { "text": "New lead: Jane", "username": "Zapier", "title": "optional heading" }
//          (also "message", "content" or "body" for the text; "name", "sender" or "from" for who)
//          JSON without a text field is shown as "field: value" lines.
//   form   text=New+lead&username=Airtable
//   text   the raw text
//
// -> 200 { ok: true, id }   401 unknown/revoked link   429 more than 30 posts a minute

export interface Hook { id: string; channelId: string; name: string; archived: boolean }

export interface Deps {
  findWebhook(token: string): Promise<Hook | null>;
  countRecent(webhookId: string, sinceIso: string): Promise<number>;
  insertMessage(m: { channelId: string; webhookId: string; body: string; senderName: string; meta: Record<string, unknown> }): Promise<string | null>;
  touch(webhookId: string): Promise<void>;
  now?: () => number;
}

export const MAX_TEXT = 8000;
export const MAX_BYTES = 64 * 1024;
export const PER_MINUTE = 30;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** The secret token from /chat-webhook/<token> or ?token=<token>. */
export function tokenFrom(url: string): string | null {
  const u = new URL(url);
  const fromQuery = u.searchParams.get("token");
  const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  const t = (fromQuery ?? (last !== "chat-webhook" ? last : "")).trim();
  return /^[a-f0-9]{32,128}$/i.test(t) ? t.toLowerCase() : null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) { const v = str(o[k]); if (v) return v; }
  return "";
};

/** Turn whatever was posted into the message text, who it's from, and the fields (for JSON). */
export function readPayload(raw: string, contentType: string): { text: string; sender: string; fields: Record<string, unknown> | null } {
  const type = contentType.toLowerCase();
  let obj: Record<string, unknown> | null = null;
  if (type.includes("application/x-www-form-urlencoded")) {
    obj = Object.fromEntries(new URLSearchParams(raw));
  } else if (type.includes("json") || /^\s*[{[]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { items: parsed };
    } catch { obj = null; }
  }
  if (!obj) return { text: clip(raw.trim(), MAX_TEXT), sender: "", fields: null };

  const sender = clip(pick(obj, ["username", "name", "sender", "from", "source"]), 80);
  const title = pick(obj, ["title", "subject", "heading"]);
  let text = pick(obj, ["text", "message", "content", "body", "description"]);
  if (!text) {
    // No text field: show the fields, one per line.
    const skip = new Set(["username", "name", "sender", "from", "source", "title", "subject", "heading"]);
    text = Object.entries(obj)
      .filter(([k]) => !skip.has(k))
      .slice(0, 30)
      .map(([k, v]) => `${k}: ${clip(typeof v === "object" && v !== null ? JSON.stringify(v) : str(v), 300)}`)
      .join("\n");
  }
  const full = title ? `**${title}**${text ? `\n${text}` : ""}` : text;
  return { text: clip(full.trim(), MAX_TEXT), sender, fields: obj };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Send a POST request." });
  const token = tokenFrom(req.url);
  if (!token) return json(401, { error: "This webhook link is missing its token." });

  const hook = await deps.findWebhook(token);
  if (!hook) return json(401, { error: "This webhook link isn't valid (it may have been removed)." });
  if (hook.archived) return json(410, { error: "This channel is archived." });

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BYTES) return json(413, { error: "Too large: send at most 64 KB." });
  const { text, sender, fields } = readPayload(raw, req.headers.get("content-type") ?? "");
  if (!text) return json(400, { error: 'Nothing to post: send { "text": "…" }.' });

  const now = deps.now?.() ?? Date.now();
  const recent = await deps.countRecent(hook.id, new Date(now - 60_000).toISOString());
  if (recent >= PER_MINUTE) return json(429, { error: `Slow down: at most ${PER_MINUTE} posts a minute per link.` });

  const id = await deps.insertMessage({
    channelId: hook.channelId,
    webhookId: hook.id,
    body: text,
    senderName: sender || hook.name,
    // The posted fields too (when small enough), so they can be shown in full later.
    meta: { via: hook.name, ...(fields && JSON.stringify(fields).length <= 16000 ? { fields } : {}) },
  }).catch(() => null);
  if (!id) return json(500, { error: "Couldn't post the message. Try again." });
  await deps.touch(hook.id).catch(() => {});
  return json(200, { ok: true, id });
}
