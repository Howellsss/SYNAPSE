// Replies to emails SYNAPSE sent from a connected Gmail account come back into SYNAPSE: every
// scheduler run checks a few of the recently sent threads (needs the gmail.readonly permission,
// granted when the account is connected or reconnected) and saves new replies as inbound messages
// on the same contact.

export const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const THREADS_PER_RUN = 40;
export const LOOKBACK_DAYS = 30;

export interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] }
export interface GmailMessage { id: string; threadId: string; internalDate?: string; labelIds?: string[]; payload?: GmailPart }

const header = (m: GmailMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** "Jane Doe <jane@x.com>" -> { name: "Jane Doe", email: "jane@x.com" } */
export function parseFrom(value: string): { name: string | null; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: value.trim().toLowerCase() };
}

function decode(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function findPart(p: GmailPart | undefined, type: string): GmailPart | null {
  if (!p) return null;
  if (p.mimeType === type && p.body?.data) return p;
  for (const c of p.parts ?? []) { const f = findPart(c, type); if (f) return f; }
  return null;
}

const htmlToText = (html: string) => html
  .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The reply's own words: plain text (or the HTML as text), without the quoted earlier email. */
export function replyText(m: GmailMessage): string {
  const plain = findPart(m.payload, "text/plain");
  const html = plain ? null : findPart(m.payload, "text/html");
  const raw = plain?.body?.data ? decode(plain.body.data) : html?.body?.data ? htmlToText(decode(html.body.data)) : "";
  return stripQuoted(raw).slice(0, 20000);
}

/** Cut the quoted history ("On Tue, … wrote:", "> …", "-----Original Message-----"). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next2 = `${l} ${lines[i + 1] ?? ""}`;
    if (/^\s*On .{3,200}wrote:\s*$/i.test(l) || /^\s*On .{3,200}\s*$/.test(l) && /wrote:\s*$/i.test(next2)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{5,}\s*$/.test(l) || /^From:\s.+/.test(l) && i > 0 && /^\s*$/.test(lines[i - 1])) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

/** Messages in a thread that are replies to us: not sent by the account, and not already saved. */
export function newReplies(thread: GmailMessage[], accountEmail: string, known: Set<string>): GmailMessage[] {
  const me = accountEmail.toLowerCase();
  return thread.filter((m) => {
    if (known.has(m.id)) return false;
    if (m.labelIds?.includes("SENT") || m.labelIds?.includes("DRAFT")) return false;
    return parseFrom(header(m, "From")).email !== me;
  });
}

export function replyRow(m: GmailMessage, outbound: { workspace_id: string; contact_id: string | null; email_account_id: string; subject: string | null }, accountEmail: string) {
  const from = parseFrom(header(m, "From"));
  return {
    workspace_id: outbound.workspace_id,
    contact_id: outbound.contact_id,
    channel: "email",
    direction: "inbound",
    subject: header(m, "Subject") || (outbound.subject ? `Re: ${outbound.subject}` : null),
    body: replyText(m) || "(no text)",
    from_email: from.email,
    from_name: from.name,
    to_address: accountEmail,
    status: "delivered",
    provider_message_id: m.id,
    provider_thread_id: m.threadId,
    email_account_id: outbound.email_account_id,
    sent_at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
  };
}
