// Sending from your own domain through Resend (https://resend.com/docs/api-reference/emails/send-email).
// A 'resend' email account is an address on a domain verified in Resend, e.g. tickets@deraspeaks.com.

export interface ResendMail {
  from: string; fromName?: string | null; to: string[]; cc: string[]; bcc: string[];
  subject: string; text: string; html: string | null; replyTo?: string | null;
}

/** The request body Resend expects: "Name <address>", and only the parts that are there. */
export function resendBody(p: ResendMail): Record<string, unknown> {
  const name = p.fromName ? p.fromName.replace(/[\r\n]+/g, " ").replace(/["<>]/g, "").trim() : "";
  return {
    from: name ? `${name} <${p.from}>` : p.from,
    to: p.to,
    ...(p.cc.length ? { cc: p.cc } : {}),
    ...(p.bcc.length ? { bcc: p.bcc } : {}),
    subject: p.subject,
    ...(p.text.trim() ? { text: p.text } : {}),
    ...(p.html ? { html: p.html } : {}),
    ...(p.replyTo ? { reply_to: p.replyTo } : {}),
  };
}

/** Send one email; returns Resend's id, or throws with Resend's reason. */
export async function resendSend(key: string | undefined, p: ResendMail, doFetch: typeof fetch = fetch): Promise<string | null> {
  if (!key) throw new Error("RESEND_API_KEY isn't set: add it in Supabase → Edge Functions → Secrets.");
  const res = await doFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(resendBody(p)),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend: ${out?.message ?? out?.error ?? res.status}`);
  return out?.id ?? null;
}
