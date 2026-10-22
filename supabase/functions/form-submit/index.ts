// A form or survey being submitted from its public page (/f/<id>), or from the builder's Preview.
//
//   POST { mode: "submit", formId, answers, disqualified?, trap?, source?, meta? }
//     -> { success, submissionId, contactId }
//     -> { success: false, closed: true, error }         (closed, or the response limit is reached)
//   POST { ..., preview: true } with the builder's login: the builder's Preview. Works on drafts,
//     ignores the close date and response limit, and is saved with source "preview".
//
// On the server it re-checks what matters: the form is open and the quiz score. It makes or
// updates the contact, and queues the notification emails (to the team, and the auto-reply to
// the person) as messages that the send-email mailer sends from the form's connected account.
// Forms don't take payments. Single file, so it can be pasted into the Supabase dashboard.
// The quiz rules mirror src/lib/form-engine.ts.
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

const money = (minor: number, cur: string) => `${(minor / 100).toFixed(2)} ${cur.toUpperCase()}`;

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

    if (body.mode !== "submit" && body.mode !== undefined) return json({ error: "Unknown mode" }, 400);
    if (!body.answers || typeof body.answers !== "object") return json({ error: "answers are required" }, 400);

    // The builder's Preview: only for people in the form's workspace.
    const preview = body.preview === true;
    if (preview && !(await isTeamMember(req, form.workspace_id as string))) return json({ success: false, error: "Sign in to SYNAPSE to send a preview." }, 401);

    // Open?
    const s = def.settings ?? {};
    const closedMsg = s.closedMessage?.trim() || "This form is no longer accepting responses.";
    if (!preview && form.status !== "published") return json({ success: false, closed: true, error: form.status === "archived" ? closedMsg : "This form isn’t published yet." });
    if (!preview && s.closeAt && new Date(s.closeAt).getTime() <= Date.now()) return json({ success: false, closed: true, error: closedMsg });
    if (!preview && s.maxResponses) {
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
      if (el.type === "captcha" || el.type === "payment") continue;
      if (v !== undefined && v !== null && String(v).trim() !== "") answers[el.field.fieldId] = String(v).slice(0, 5000);
    }
    const quiz = scoreQuiz(def, answers);
    const disqualified = body.disqualified === true;
    const meta: Record<string, string> = {};
    if (body.meta && typeof body.meta === "object") for (const [k, v] of Object.entries(body.meta)) if (typeof v === "string") meta[k.slice(0, 40)] = v.slice(0, 500);

    const row: Record<string, unknown> = {
      form_id: form.id, workspace_id: form.workspace_id, answers, source: preview ? "preview" : String(body.source || "public").slice(0, 60),
    };
    const extra: Record<string, unknown> = {
      meta, disqualified,
      ...(quiz ? { score: quiz.score, score_max: quiz.max, score_percent: quiz.percent, quiz_result: quiz.result } : {}),
    };
    // With the new columns if the database has them (migration 20261021090000_forms_upgrade.sql), else the basics.
    let { data: sub, error: subErr } = await db.from("form_submissions").insert({ ...row, ...extra }).select("id").single();
    if (subErr && /column/i.test(subErr.message)) {
      ({ data: sub, error: subErr } = await db.from("form_submissions").insert(row).select("id").single());
    }
    if (subErr || !sub) return json({ error: "Failed to save submission" }, 500);
    const submissionId = sub.id as string;

    const contactId = await saveContact(db, form, def, answers, submissionId);

    await notify(db, form, def, answers, submissionId, contactId, quiz, null, disqualified);
    return json({ success: true, submissionId, contactId });
  } catch (err) {
    console.error("Form submission error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

/** The caller is signed in and belongs to the workspace (checked with their own login). */
async function isTeamMember(req: Request, workspaceId: string): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
  });
  const { data: who } = await user.auth.getUser(jwt);
  if (!who?.user) return false;
  const { data } = await user.rpc("can_access_workspace", { check_workspace_id: workspaceId });
  return data === true;
}

async function saveContact(db: SupabaseClient, form: Record<string, unknown>, def: Definition, answers: Record<string, string>, submissionId: string): Promise<string | null> {
  const s = def.settings ?? {};
  const create = s.createContact ?? (form.create_contact as boolean) ?? false;
  const update = s.updateContact ?? (form.update_contact as boolean) ?? false;
  if (!create) { console.warn(`form ${form.id}: "Create contact on submission" is off, so no contact`); return null; }
  const data: Record<string, string> = {};
  for (const el of fieldsOf(def)) {
    const key = el.field.mappedContactField;
    const v = answers[el.field.fieldId]?.trim();
    if (!key || !v) continue;
    if (key === "full_name") {
      // "Ada Grace Lovelace" -> first "Ada", last "Grace Lovelace".
      const [first, ...rest] = v.split(/\s+/);
      if (!data.first_name) data.first_name = first;
      if (rest.length && !data.last_name) data.last_name = rest.join(" ");
    } else if (key === "date_of_birth") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) data.date_of_birth = v;
    } else if (["first_name", "last_name", "email", "phone", "company", "job_title"].includes(key)) data[key] = v;
  }
  if (!Object.keys(data).length) { console.warn(`form ${form.id}: no answers mapped to contact fields, so no contact`); return null; }
  const ws = form.workspace_id as string;
  // The oldest matching contact (there may be more than one with the same email or phone).
  const find = async (col: "email" | "phone", value: string) => {
    const q = db.from("contacts").select("id").eq("workspace_id", ws);
    const { data: rows, error } = await (col === "email" ? q.ilike("email", value.replace(/[\\%_]/g, (c) => `\\${c}`)) : q.eq("phone", value)).order("created_at").limit(1);
    if (error) console.error(`form ${form.id}: looking up contact by ${col} failed: ${error.message}`);
    return rows?.[0]?.id as string | undefined;
  };
  let id: string | null = (data.email ? await find("email", data.email) : undefined) ?? (data.phone ? await find("phone", data.phone) : undefined) ?? null;
  if (id && update) {
    const { error } = await db.from("contacts").update({ ...data, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    if (error) console.error(`form ${form.id}: updating contact ${id} failed: ${error.message}`);
  }
  if (!id) {
    let { data: made, error } = await db.from("contacts").insert({ workspace_id: ws, ...data, source: "form" }).select("id").single();
    if (error) {
      // An older database may lack a column (company, job title) or limit "source": keep the basics.
      console.error(`form ${form.id}: creating contact failed: ${error.message}; trying with name, email and phone only`);
      const basic: Record<string, string> = {};
      for (const k of ["first_name", "last_name", "email", "phone"]) if (data[k]) basic[k] = data[k];
      ({ data: made, error } = await db.from("contacts").insert({ workspace_id: ws, ...basic }).select("id").single());
      if (error) console.error(`form ${form.id}: creating contact failed again: ${error.message}`);
    }
    id = (made?.id as string | undefined) ?? null;
  }
  if (!id) return null;
  {
    const { error } = await db.from("form_submissions").update({ contact_id: id }).eq("id", submissionId);
    if (error) console.error(`form ${form.id}: linking submission ${submissionId} to contact ${id} failed: ${error.message}`);
  }
  await db.from("form_activity_timeline").insert({ contact_id: id, submission_id: submissionId, form_id: form.id, workspace_id: ws, form_name: form.name });
  for (const name of s.autoTags ?? (form.auto_tags as string[]) ?? []) {
    let tagId = (await db.from("tags").select("id").eq("workspace_id", ws).eq("name", name).maybeSingle()).data?.id;
    if (!tagId) tagId = (await db.from("tags").insert({ workspace_id: ws, name }).select("id").single()).data?.id;
    if (tagId) await db.from("contact_tags").upsert({ contact_id: id, tag_id: tagId });
  }
  return id;
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
    // {{submission.first_name}}, {{submission.email}}…: the field saved to that contact field.
    for (const f of fields) {
      const v = answers[f.field.fieldId];
      const key = f.field.mappedContactField;
      if (!key || v === undefined) continue;
      out = out.split(`{{submission.${key}}}`).join(v);
      if (key === "full_name") {
        const [first, ...rest] = v.trim().split(/\s+/);
        out = out.split("{{submission.first_name}}").join(first ?? "").split("{{submission.last_name}}").join(rest.join(" "));
      }
    }
    // Anything still unfilled (no answer) reads as nothing rather than as code.
    out = out.replace(/{{submission\.[a-z_]+}}/g, "");
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
  // To the email they gave: the field chosen, or else the field saved to the contact's email.
  const emailField = (respondent?.emailFieldId && fields.some((f) => f.field.fieldId === respondent.emailFieldId) ? respondent.emailFieldId : null)
    ?? fields.find((f) => f.field.mappedContactField === "email")?.field.fieldId ?? fields.find((f) => f.type === "email")?.field.fieldId;
  if (respondent?.enabled && emailField && !disqualified) {
    const to = answers[emailField];
    if (to && EMAIL_RE.test(to)) {
      const which = respondent.includeAnswers === "all" ? null : respondent.includeAnswers === "selected" ? respondent.includedFields ?? [] : [];
      const answersText = which && !which.length ? "" : `\n\nYour answers:\n${lines(which)}`;
      const body = `${fill(respondent.message || "Thanks, we’ve received your response.")}${answersText}${quiz ? `\n\nYour score: ${quiz.percent}%${quiz.result ? ` · ${quiz.result}` : ""}` : ""}${paid ? `\n\nPaid: ${money(paid.amount, paid.currency)}` : ""}`;
      await queue("respondent", to, fill(respondent.subject || `Thanks for your response to ${form.name}`), body, contactId, respondent.senderName);
    }
  }
}
