// A form or survey being submitted from its public page (/f/<id>), or a payment being confirmed.
//
//   POST { mode: "submit", formId, answers, disqualified?, trap?, source?, meta?, payment?, returnUrl? }
//     -> { success, submissionId, checkoutUrl? }        (checkoutUrl: pay by card first)
//     -> { success: false, closed: true, error }         (closed, or the response limit is reached)
//   POST { mode: "confirm_payment", formId, submissionId, sessionId }   (back from Stripe)
//     -> { paid: true } once Stripe says it is paid
//   POST { mode: "test_email", ... }  -> acknowledged (the builder's "send a test")
//
// On the server it re-checks what matters: the form is open, the quiz score, and the amount to
// charge (worked out from the form, never taken from the browser). Notification emails (to the
// team, and the auto-reply to the person) are queued as messages and sent by the send-email
// mailer from the form's chosen connected account; for paid forms they go once payment clears.
//
// Secrets: STRIPE_SECRET_KEY (only for forms that take payment). Single file, so it can be pasted
// into the Supabase dashboard. The quiz and payment rules mirror src/lib/form-engine.ts.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

// ---------- the parts of a saved definition used here ----------
interface Field {
  fieldId: string; label?: string; visible?: boolean; mappedContactField?: string | null;
  options?: string[]; optionScores?: Record<string, number>; correctOptions?: string[]; points?: number; quizCategory?: string;
  payment?: PaymentConfig;
}
interface Element { type?: string; displayLabel?: string; field?: Field }
interface PaymentConfig { mode: "fixed" | "products" | "custom"; currency: string; amount?: number; description?: string; products?: { id: string; name: string; price: number }[]; multiple?: boolean; quantity?: boolean; minAmount?: number }
interface QuizResult { id: string; heading: string; minPercent?: number; maxPercent?: number; category?: string }
interface Definition {
  pages?: { id: string; sectionIds: string[]; visible?: boolean }[];
  sections?: Record<string, { elementIds: string[]; visible?: boolean }>;
  elements?: Record<string, Element>;
  settings?: {
    createContact?: boolean; updateContact?: boolean; autoTags?: string[];
    closeAt?: string | null; maxResponses?: number | null; closedMessage?: string; senderAccountId?: string | null;
    quiz?: { enabled: boolean; scoring: "total" | "top_category"; results: QuizResult[] };
  };
  notifications?: {
    internal?: { enabled?: boolean; recipients?: string[]; subject?: string; message?: string; includeAllFields?: boolean; includeFields?: string[] };
    respondent?: { enabled?: boolean; emailFieldId?: string | null; subject?: string; senderName?: string; replyTo?: string; message?: string; includeAnswers?: string; includedFields?: string[] };
  };
}

function parseDefinition(raw: unknown): Definition | null {
  try { const d = typeof raw === "string" ? JSON.parse(raw) : raw; return d && typeof d === "object" ? d as Definition : null; } catch { return null; }
}
/** Field elements in the order people see them. */
function fieldsOf(def: Definition): (Element & { field: Field })[] {
  const out: (Element & { field: Field })[] = [];
  const seen = new Set<string>();
  for (const p of def.pages ?? []) for (const sid of p.sectionIds ?? []) for (const eid of def.sections?.[sid]?.elementIds ?? []) {
    const el = def.elements?.[eid];
    if (el?.field && !seen.has(eid)) { seen.add(eid); out.push(el as Element & { field: Field }); }
  }
  return out;
}

// ---------- quiz (mirrors src/lib/form-engine.ts) ----------
const MULTI = new Set(["checkbox", "multi_select"]);
const CHOICE = new Set(["radio", "checkbox", "dropdown", "multi_select", "yes_no", "rating", "scale"]);
const picks = (type: string, v: string | undefined) => !v ? [] : MULTI.has(type) ? v.split(",").map((x) => x.trim()).filter(Boolean) : [v];
function scoreQuiz(def: Definition, answers: Record<string, string>) {
  const quiz = def.settings?.quiz;
  if (!quiz?.enabled) return null;
  let score = 0, max = 0;
  const cats: Record<string, { score: number; max: number }> = {};
  for (const el of fieldsOf(def)) {
    if (!CHOICE.has(el.type ?? "")) continue;
    const f = el.field;
    const scores = f.optionScores && Object.keys(f.optionScores).length ? f.optionScores : null;
    const correct = f.correctOptions?.length ? f.correctOptions : null;
    if (!scores && !correct) continue;
    const chosen = picks(el.type ?? "", answers[f.fieldId]);
    let s = 0, m = 0;
    if (scores) {
      const vals = Object.values(scores).map((n) => Number(n) || 0);
      s += chosen.reduce((n, c) => n + (Number(scores[c]) || 0), 0);
      m += MULTI.has(el.type ?? "") ? vals.filter((n) => n > 0).reduce((a, b) => a + b, 0) : Math.max(0, ...vals);
    }
    if (correct) {
      const points = f.points ?? 1;
      if (chosen.length === correct.length && correct.every((c) => chosen.includes(c))) s += points;
      m += points;
    }
    score += s; max += m;
    if (f.quizCategory) { const c = (cats[f.quizCategory] ??= { score: 0, max: 0 }); c.score += s; c.max += m; }
  }
  const percent = max > 0 ? Math.round((score / max) * 100) : 0;
  const pct = (c: { score: number; max: number }) => c.max > 0 ? Math.round((c.score / c.max) * 100) : 0;
  const top = Object.entries(cats).sort((a, b) => pct(b[1]) - pct(a[1]) || b[1].score - a[1].score)[0]?.[0] ?? null;
  const result = quiz.scoring === "top_category"
    ? quiz.results.find((r) => r.category === top) ?? null
    : quiz.results.find((r) => percent >= (r.minPercent ?? 0) && percent <= (r.maxPercent ?? 100)) ?? null;
  return { score, max, percent, result: result?.heading ?? null, top };
}

// ---------- payment (mirrors src/lib/form-engine.ts) ----------
const cents = (n: number) => Math.round((Number(n) || 0) * 100);
function paymentFor(cfg: PaymentConfig | undefined, value: string) {
  if (!cfg) return null;
  const currency = (cfg.currency || "usd").toLowerCase();
  if (cfg.mode === "fixed") { const a = cents(cfg.amount ?? 0); return a > 0 ? { amount: a, currency, items: [{ name: cfg.description || "Payment", unitAmount: a, quantity: 1 }] } : null; }
  if (cfg.mode === "custom") {
    const t = cents(Number(String(value).replace(/[^0-9.]/g, "")));
    if (t <= 0 || t < cents(cfg.minAmount ?? 0)) return null;
    return { amount: t, currency, items: [{ name: cfg.description || "Payment", unitAmount: t, quantity: 1 }] };
  }
  const items: { name: string; unitAmount: number; quantity: number }[] = [];
  for (const part of String(value || "").split(",")) {
    const [id, q] = part.split(":");
    const p = cfg.products?.find((x) => x.id === id);
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(q) || 1)));
    if (p) items.push({ name: p.name, unitAmount: cents(p.price), quantity: cfg.quantity ? quantity : 1 });
    if (!cfg.multiple && items.length) break;
  }
  const amount = items.reduce((n, i) => n + i.unitAmount * i.quantity, 0);
  return amount > 0 ? { amount, currency, items } : null;
}
const money = (minor: number, cur: string) => `${(minor / 100).toFixed(2)} ${cur.toUpperCase()}`;

// ---------- Stripe ----------
async function stripe(path: string, init: { method?: string; form?: Record<string, string> } = {}) {
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!key) throw new PaymentsOff();
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: init.method ?? (init.form ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${key}`, ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message ?? `Stripe returned ${res.status}`);
  return out;
}
class PaymentsOff extends Error { constructor() { super("Payments aren’t set up for this form yet. Please contact the organiser."); } }

// ---------- main ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const body = await req.json();
    if (body.mode === "test_email") {
      if (!body.testEmail || !EMAIL_RE.test(body.testEmail)) return json({ error: "Valid test email required" }, 400);
      return json({ success: true, message: `Test email queued for ${body.testEmail}` });
    }
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (!body.formId) return json({ error: "formId is required" }, 400);
    const { data: form } = await db.from("forms").select("id, workspace_id, name, status, definition, create_contact, update_contact, auto_tags").eq("id", body.formId).maybeSingle();
    if (!form) return json({ error: "Form not found" }, 404);
    const def = parseDefinition(form.definition) ?? {};

    if (body.mode === "confirm_payment") return await confirmPayment(db, form, def, String(body.submissionId ?? ""), String(body.sessionId ?? ""));
    if (body.mode !== "submit" && body.mode !== undefined) return json({ error: "Unknown mode" }, 400);
    if (!body.answers || typeof body.answers !== "object") return json({ error: "answers are required" }, 400);

    // Open?
    const s = def.settings ?? {};
    const closedMsg = s.closedMessage?.trim() || "This form is no longer accepting responses.";
    if (form.status !== "published") return json({ success: false, closed: true, error: form.status === "archived" ? closedMsg : "This form isn’t published yet." });
    if (s.closeAt && new Date(s.closeAt).getTime() <= Date.now()) return json({ success: false, closed: true, error: closedMsg });
    if (s.maxResponses) {
      const { count } = await db.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", form.id);
      if ((count ?? 0) >= s.maxResponses) return json({ success: false, closed: true, error: closedMsg });
    }
    // A bot filled the trap field: say thanks and keep nothing.
    if (typeof body.trap === "string" && body.trap.trim()) return json({ success: true, submissionId: null });

    // Only answers to this form's fields, as text.
    const fields = fieldsOf(def);
    const answers: Record<string, string> = {};
    for (const el of fields) {
      const v = (body.answers as Record<string, unknown>)[el.field.fieldId];
      if (v !== undefined && v !== null && String(v).trim() !== "") answers[el.field.fieldId] = String(v).slice(0, 5000);
    }
    const quiz = scoreQuiz(def, answers);
    const disqualified = body.disqualified === true;
    let pay: ReturnType<typeof paymentFor> = null;
    if (body.payment && !disqualified) {
      const el = fields.find((f) => f.type === "payment" && f.field.fieldId === body.payment.fieldId);
      pay = el ? paymentFor(el.field.payment, answers[el.field.fieldId] ?? String(body.payment.answer ?? "")) : null;
      if (!pay) return json({ success: false, error: "Choose what you’d like to pay for." }, 400);
    }
    const meta: Record<string, string> = {};
    if (body.meta && typeof body.meta === "object") for (const [k, v] of Object.entries(body.meta)) if (typeof v === "string") meta[k.slice(0, 40)] = v.slice(0, 500);

    const row: Record<string, unknown> = {
      form_id: form.id, workspace_id: form.workspace_id, answers, source: String(body.source || "public").slice(0, 60),
    };
    const extra: Record<string, unknown> = {
      meta, disqualified,
      ...(quiz ? { score: quiz.score, score_max: quiz.max, score_percent: quiz.percent, quiz_result: quiz.result } : {}),
      ...(pay ? { payment_status: "pending", payment_amount: pay.amount, payment_currency: pay.currency } : {}),
    };
    // The contact first, so the submission is saved with it and its workflows start ("Form submitted").
    const contactId = await resolveContact(db, form, def, answers);
    if (contactId) row.contact_id = contactId;
    // With the new columns if the database has them (03_forms_upgrade.sql), else the basics.
    let { data: sub, error: subErr } = await db.from("form_submissions").insert({ ...row, ...extra }).select("id").single();
    if (subErr && /column/i.test(subErr.message)) {
      if (pay) return json({ success: false, error: "Payments need the database update 03_forms_upgrade.sql." }, 500);
      ({ data: sub, error: subErr } = await db.from("form_submissions").insert(row).select("id").single());
    }
    if (subErr || !sub) return json({ error: "Failed to save submission" }, 500);
    const submissionId = sub.id as string;

    if (contactId) await linkContact(db, form, def, contactId, submissionId);

    if (pay) {
      try {
        const emailField = fields.find((f) => f.field.mappedContactField === "email");
        const email = emailField ? answers[emailField.field.fieldId] : undefined;
        const back = safeReturn(String(body.returnUrl ?? ""), form.id);
        const f: Record<string, string> = {
          mode: "payment",
          success_url: `${back}?paid=${submissionId}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${back}?cancelled=${submissionId}`,
          client_reference_id: submissionId,
          "metadata[submission_id]": submissionId,
          "metadata[form_id]": form.id,
        };
        if (email && EMAIL_RE.test(email)) f.customer_email = email;
        pay.items.forEach((it, i) => {
          f[`line_items[${i}][quantity]`] = String(it.quantity);
          f[`line_items[${i}][price_data][currency]`] = pay!.currency;
          f[`line_items[${i}][price_data][unit_amount]`] = String(it.unitAmount);
          f[`line_items[${i}][price_data][product_data][name]`] = `${it.name}`.slice(0, 250);
        });
        const session = await stripe("checkout/sessions", { form: f });
        await db.from("form_submissions").update({ stripe_session_id: session.id }).eq("id", submissionId);
        return json({ success: true, submissionId, contactId, checkoutUrl: session.url });
      } catch (e) {
        await db.from("form_submissions").update({ payment_status: "failed" }).eq("id", submissionId);
        return json({ success: false, error: (e as Error).message }, e instanceof PaymentsOff ? 503 : 502);
      }
    }

    await notify(db, form, def, answers, submissionId, contactId, quiz, null, disqualified);
    return json({ success: true, submissionId, contactId });
  } catch (err) {
    console.error("Form submission error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

/** Back to the form's own page only (never somewhere else). */
function safeReturn(url: string, formId: string): string {
  try { const u = new URL(url); if ((u.protocol === "https:" || u.protocol === "http:") && u.pathname.endsWith(`/f/${formId}`)) return `${u.origin}${u.pathname}`; } catch { /* fall through */ }
  return `${Deno.env.get("PUBLIC_APP_URL") ?? "https://synapse-dj3a.vercel.app"}/f/${formId}`;
}

async function confirmPayment(db: SupabaseClient, form: Record<string, unknown>, def: Definition, submissionId: string, sessionId: string) {
  const { data: sub } = await db.from("form_submissions").select("id, answers, contact_id, payment_status, stripe_session_id, payment_amount, payment_currency, score, score_max, score_percent, quiz_result")
    .eq("id", submissionId).eq("form_id", form.id as string).maybeSingle();
  if (!sub || !sessionId || sub.stripe_session_id !== sessionId) return json({ paid: false, error: "We couldn’t find that payment." }, 404);
  if (sub.payment_status === "paid") return json({ paid: true });
  const session = await stripe(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.payment_status !== "paid" || session.metadata?.submission_id !== submissionId) return json({ paid: false, error: "The payment hasn’t gone through yet." });
  const { data: claimed } = await db.from("form_submissions").update({ payment_status: "paid" }).eq("id", submissionId).neq("payment_status", "paid").select("id");
  // Only the first confirmation sends the emails.
  if (claimed?.length) {
    const quiz = sub.score !== null ? { score: Number(sub.score), max: Number(sub.score_max), percent: Number(sub.score_percent), result: sub.quiz_result, top: null } : null;
    await notify(db, form, def, sub.answers ?? {}, submissionId, sub.contact_id, quiz, { amount: sub.payment_amount, currency: sub.payment_currency }, false);
  }
  return json({ paid: true });
}

const CONTACT_KEYS = ["first_name", "last_name", "email", "phone", "company", "job_title"];
/** The contact field an answer fills: its mapping, else what the question plainly is (its type or label). */
function contactKeyOf(el: Element & { field: Field }): string | null {
  const mapped = el.field.mappedContactField;
  if (mapped && CONTACT_KEYS.includes(mapped)) return mapped;
  if (el.type && CONTACT_KEYS.includes(el.type)) return el.type;
  const l = (el.field.label ?? "").toLowerCase();
  if (/e-?mail/.test(l)) return "email";
  if (/phone|mobile|whatsapp/.test(l)) return "phone";
  if (/first name/.test(l)) return "first_name";
  if (/last name|surname/.test(l)) return "last_name";
  if (/^(full )?name$|your name/.test(l)) return "full_name";
  if (/company|business name|organi[sz]ation/.test(l)) return "company";
  if (/job title|role|position/.test(l)) return "job_title";
  return null;
}

/** Find the person by email (or phone) in the workspace, or add them. Returns their contact id. */
async function resolveContact(db: SupabaseClient, form: Record<string, unknown>, def: Definition, answers: Record<string, string>): Promise<string | null> {
  const s = def.settings ?? {};
  const create = s.createContact ?? (form.create_contact as boolean | null) ?? true;
  const update = s.updateContact ?? (form.update_contact as boolean | null) ?? true;
  if (create === false) return null;
  const data: Record<string, string> = {};
  for (const el of fieldsOf(def)) {
    const key = contactKeyOf(el);
    const v = (answers[el.field.fieldId] ?? "").trim();
    if (!key || !v) continue;
    if (key === "full_name") {
      const [first, ...rest] = v.split(/\s+/);
      data.first_name ??= first;
      if (rest.length) data.last_name ??= rest.join(" ");
    } else if (key === "email") {
      if (EMAIL_RE.test(v)) data.email ??= v.toLowerCase();
    } else data[key] ??= v;
  }
  if (!data.email && !data.phone && !data.first_name) return null;
  const ws = form.workspace_id as string;
  let existing: { id: string } | null = null;
  if (data.email) existing = (await db.from("contacts").select("id").eq("workspace_id", ws).ilike("email", data.email).order("created_at").limit(1).maybeSingle()).data;
  if (!existing && data.phone) existing = (await db.from("contacts").select("id").eq("workspace_id", ws).eq("phone", data.phone).order("created_at").limit(1).maybeSingle()).data;
  if (existing) {
    if (update) {
      const { error } = await db.from("contacts").update({ ...data, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) console.error("form-submit: contact update failed", error.message);
    }
    return existing.id;
  }
  const { data: added, error } = await db.from("contacts").insert({ workspace_id: ws, ...data, source: "form" }).select("id").single();
  if (error) console.error("form-submit: contact insert failed", error.message);
  return added?.id ?? null;
}

/** The contact's timeline entry and the form's tags. */
async function linkContact(db: SupabaseClient, form: Record<string, unknown>, def: Definition, id: string, submissionId: string) {
  const s = def.settings ?? {};
  const ws = form.workspace_id as string;
  await db.from("form_activity_timeline").insert({ contact_id: id, submission_id: submissionId, form_id: form.id, workspace_id: ws, form_name: form.name });
  for (const name of s.autoTags ?? (form.auto_tags as string[]) ?? []) {
    let tagId = (await db.from("tags").select("id").eq("workspace_id", ws).eq("name", name).maybeSingle()).data?.id;
    if (!tagId) tagId = (await db.from("tags").insert({ workspace_id: ws, name }).select("id").single()).data?.id;
    if (tagId) await db.from("contact_tags").upsert({ contact_id: id, tag_id: tagId });
  }
}

/** Queue the team alert and the auto-reply (sent by the mailer from the chosen connected account). */
async function notify(
  db: SupabaseClient, form: Record<string, unknown>, def: Definition, answers: Record<string, string>, submissionId: string, contactId: string | null,
  quiz: { score: number; max: number; percent: number; result: string | null } | null, paid: { amount: number; currency: string } | null, disqualified: boolean,
) {
  const n = def.notifications ?? {};
  const internal = n.internal;
  const respondent = n.respondent;
  if (!internal?.enabled && !respondent?.enabled) return;
  const ws = form.workspace_id as string;
  // The account they chose, or else the account's first connected email.
  let account: { id: string; email: string; display_name: string | null } | null = null;
  if (def.settings?.senderAccountId) account = (await db.from("email_accounts").select("id, email, display_name").eq("id", def.settings.senderAccountId).eq("workspace_id", ws).eq("status", "active").maybeSingle()).data;
  if (!account) account = (await db.from("email_accounts").select("id, email, display_name").eq("workspace_id", ws).eq("status", "active").order("created_at").limit(1).maybeSingle()).data;

  const fields = fieldsOf(def);
  const label = (fid: string) => fields.find((f) => f.field.fieldId === fid)?.field.label ?? fid;
  const lines = (ids: string[] | null) => fields
    .filter((f) => f.type !== "hidden" && f.type !== "payment" && answers[f.field.fieldId] !== undefined && (!ids || ids.includes(f.field.fieldId)))
    .map((f) => `${label(f.field.fieldId)}: ${answers[f.field.fieldId]}`).join("\n");
  const fill = (t: string) => {
    let out = t.replace(/{{form\.name}}/g, String(form.name)).replace(/{{submission\.id}}/g, submissionId).replace(/{{submission\.created_at}}/g, new Date().toISOString());
    for (const [k, v] of Object.entries(answers)) out = out.split(`{{submission.${k}}}`).join(v);
    if (quiz) out = out.replace(/{{quiz\.score}}/g, `${quiz.percent}%`).replace(/{{quiz\.result}}/g, quiz.result ?? "");
    return out;
  };
  const extras = [
    quiz ? `Quiz score: ${quiz.score} / ${quiz.max} (${quiz.percent}%)${quiz.result ? ` · ${quiz.result}` : ""}` : "",
    paid ? `Paid: ${money(paid.amount, paid.currency)}` : "",
    disqualified ? "Disqualified by the form's logic." : "",
  ].filter(Boolean).join("\n");

  const queue = async (type: "internal" | "respondent", to: string, subject: string, text: string, toContact: string | null, fromName?: string) => {
    const log = { submission_id: submissionId, form_id: form.id, workspace_id: ws, type, channel: "email", recipient: to, subject, body: text };
    if (!account) { await db.from("form_notification_logs").insert({ ...log, status: "failed", error: "No connected email account to send from. Connect Gmail in Settings → Email." }); return; }
    const { error } = await db.from("messages").insert({
      workspace_id: ws, contact_id: toContact, channel: "email", direction: "outbound", subject, body: text, status: "queued",
      from_email: account.email, from_name: fromName || account.display_name, to_address: to, email_account_id: account.id, form_submission_id: submissionId,
    });
    await db.from("form_notification_logs").insert({ ...log, status: error ? "failed" : "pending", ...(error ? { error: error.message } : {}) });
  };

  if (internal?.enabled) {
    const subject = fill(internal.subject || `New response: ${form.name}`);
    const body = `${fill(internal.message || "A new response came in.")}\n\n${lines(internal.includeAllFields === false && internal.includeFields?.length ? internal.includeFields : null)}${extras ? `\n\n${extras}` : ""}`;
    for (const to of (internal.recipients ?? []).filter((r) => EMAIL_RE.test(r)).slice(0, 20)) await queue("internal", to, subject, body, null);
  }
  if (respondent?.enabled && respondent.emailFieldId && !disqualified) {
    const to = answers[respondent.emailFieldId];
    if (to && EMAIL_RE.test(to)) {
      const which = respondent.includeAnswers === "all" ? null : respondent.includeAnswers === "selected" ? respondent.includedFields ?? [] : [];
      const answersText = which && !which.length ? "" : `\n\nYour answers:\n${lines(which)}`;
      const body = `${fill(respondent.message || "Thanks, we’ve received your response.")}${answersText}${quiz ? `\n\nYour score: ${quiz.percent}%${quiz.result ? ` · ${quiz.result}` : ""}` : ""}${paid ? `\n\nPaid: ${money(paid.amount, paid.currency)}` : ""}`;
      await queue("respondent", to, fill(respondent.subject || `Thanks for your response to ${form.name}`), body, contactId, respondent.senderName);
    }
  }
}
