/**
 * How a form or survey behaves while someone fills it in: which steps it has, what logic shows,
 * hides or requires, where a jump goes, what counts as a mistake, what the link fills in, how a
 * quiz scores, and what a payment comes to. Pure functions over the saved definition, used by the
 * public page and the builder's preview alike. (The form-submit function re-checks the quiz score
 * and the payment amount on the server with the same rules.)
 *
 * Forms and surveys differ in how they are shown: a form is one long page (or its pages in turn,
 * when it has several); a survey goes slide by slide, optionally one question per slide.
 */
import type {
  FieldDefinition, FormDefinition, FormElement, FormLogicRule, FormPage, LogicCondition, PaymentConfig, QuizResult,
} from './form-builder-types';

export type FormKind = 'form' | 'survey';
export type Answers = Record<string, string>;

const CHOICE = new Set(['radio', 'checkbox', 'dropdown', 'multi_select', 'yes_no']);
const MULTI = new Set(['checkbox', 'multi_select']);
const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

// ---------- reading the definition ----------

/** Every element, in the order they appear (page by page, section by section). */
export function orderedElements(def: FormDefinition, pages: FormPage[] = def.pages): FormElement[] {
  const out: FormElement[] = [];
  for (const page of pages) {
    for (const sid of page.sectionIds) {
      const section = def.sections[sid];
      if (!section || section.visible === false) continue;
      for (const eid of section.elementIds) { const el = def.elements[eid]; if (el) out.push(el); }
    }
  }
  return out;
}

export const isField = (el: FormElement): el is FormElement & { field: FieldDefinition } => !!el.field;
export const fieldElements = (def: FormDefinition) => orderedElements(def).filter(isField);
const fieldById = (def: FormDefinition, fieldId: string) => fieldElements(def).find((e) => e.field.fieldId === fieldId);

/** The picks in a choice answer (checkboxes are stored comma-separated). */
export function picks(type: string, value: string | undefined): string[] {
  if (!value) return [];
  return MULTI.has(type) ? value.split(',').map((v) => v.trim()).filter(Boolean) : [value];
}

// ---------- logic ----------

/** A rule's conditions (older rules have a single trigger). */
export function ruleConditions(r: FormLogicRule): LogicCondition[] {
  if (r.conditions?.length) return r.conditions;
  return r.triggerFieldId ? [{ fieldId: r.triggerFieldId, operator: r.operator, value: r.triggerValue }] : [];
}

export function conditionMet(c: LogicCondition, answers: Answers): boolean {
  const raw = (answers[c.fieldId] ?? '').trim();
  const v = raw.toLowerCase();
  const want = (c.value ?? '').trim().toLowerCase();
  const list = raw.split(',').map((x) => x.trim().toLowerCase());
  switch (c.operator) {
    case 'is_empty': return raw === '';
    case 'is_not_empty': return raw !== '';
    case 'equals': return v === want || list.includes(want);
    case 'not_equals': return v !== want && !list.includes(want);
    case 'contains': return v.includes(want);
    case 'not_contains': return !v.includes(want);
    case 'starts_with': return v.startsWith(want);
    case 'greater_than': return raw !== '' && Number(raw) > Number(c.value);
    case 'less_than': return raw !== '' && Number(raw) < Number(c.value);
    default: return false;
  }
}

export function ruleMet(r: FormLogicRule, answers: Answers): boolean {
  const cs = ruleConditions(r);
  if (!cs.length) return false;
  return r.match === 'any' ? cs.some((c) => conditionMet(c, answers)) : cs.every((c) => conditionMet(c, answers));
}

export interface LogicState {
  /** Elements hidden right now. */
  hidden: Set<string>;
  /** Fields required right now (their own setting, or a "require" rule). */
  required: Set<string>;
  /** Values rules have set. */
  values: Answers;
  /** A "disqualify" rule that matched: the form ends here. */
  disqualify: { message: string; redirectUrl: string | null } | null;
  /** Where a "redirect" rule sends them after they submit. */
  redirectUrl: string | null;
}

export function runLogic(def: FormDefinition, answers: Answers): LogicState {
  const rules = def.logic ?? [];
  const hidden = new Set<string>();
  const required = new Set<string>();
  const values: Answers = {};
  let disqualify: LogicState['disqualify'] = null;
  let redirectUrl: string | null = null;

  // Elements with a "show" rule stay hidden until one of their show rules is met.
  const shownBy = new Map<string, boolean>();
  for (const r of rules) {
    const met = ruleMet(r, answers);
    if (r.action === 'show') shownBy.set(r.targetElementId, (shownBy.get(r.targetElementId) ?? false) || met);
    if (!met) continue;
    if (r.action === 'hide') hidden.add(r.targetElementId);
    if (r.action === 'require') { const f = def.elements[r.targetElementId]?.field; if (f) required.add(f.fieldId); }
    if (r.action === 'set_value') { const f = def.elements[r.targetElementId]?.field; if (f) values[f.fieldId] = r.value ?? ''; }
    if (r.action === 'disqualify' && !disqualify) disqualify = { message: r.message || r.value || 'Thanks for your interest. Unfortunately you don’t qualify.', redirectUrl: r.redirectUrl || null };
    if (r.action === 'redirect' && !redirectUrl && r.redirectUrl) redirectUrl = r.redirectUrl;
  }
  for (const [id, shown] of shownBy) if (!shown) hidden.add(id);
  for (const el of Object.values(def.elements)) {
    if (el.field?.visible === false && el.type !== 'hidden') hidden.add(el.id);
    if (el.field?.required && !hidden.has(el.id)) required.add(el.field.fieldId);
  }
  // A hidden field is never required.
  for (const id of hidden) { const f = def.elements[id]?.field; if (f) required.delete(f.fieldId); }
  return { hidden, required, values, disqualify, redirectUrl };
}

// ---------- steps ----------

export type Presentation = 'one_page' | 'pages' | 'one_question';

export function presentationOf(def: FormDefinition, kind: FormKind): Presentation {
  const p = def.settings.presentation ?? 'auto';
  if (p !== 'auto') return p;
  const pages = def.pages.filter((pg) => pg.visible !== false).length;
  // A survey goes slide by slide: its pages, or one question per slide when it has a single page.
  if (kind === 'survey') return pages > 1 ? 'pages' : 'one_question';
  return pages > 1 ? 'pages' : 'one_page';
}

/**
 * The definition re-cut into the steps people go through: one page with everything, the pages
 * as built, or one question per slide (headings and text go with the question after them).
 * `origin` says which built page each step came from, for jumps.
 */
export function stepsOf(def: FormDefinition, kind: FormKind): { def: FormDefinition; origin: string[] } {
  const pages = def.pages.filter((p) => p.visible !== false);
  const how = presentationOf(def, kind);
  if (how === 'pages') return { def: { ...def, pages }, origin: pages.map((p) => p.id) };
  if (how === 'one_page') {
    const page: FormPage = { id: pages[0]?.id ?? 'page', name: 'Page 1', visible: true, sectionIds: pages.flatMap((p) => p.sectionIds) };
    return { def: { ...def, pages: [page] }, origin: [page.id] };
  }
  const sections = { ...def.sections };
  const out: FormPage[] = [];
  const origin: string[] = [];
  for (const p of pages) {
    let pending: string[] = [];
    for (const sid of p.sectionIds) {
      const section = def.sections[sid];
      if (!section || section.visible === false) continue;
      for (const eid of section.elementIds) {
        const el = def.elements[eid];
        if (!el) continue;
        pending.push(eid);
        if (!el.field || el.type === 'hidden') continue;
        const id = `slide-${eid}`;
        sections[id] = { id, name: el.field.label, visible: true, columnCount: 1, elementIds: pending, style: section.style };
        out.push({ id, name: el.field.label, visible: true, sectionIds: [id] });
        origin.push(p.id);
        pending = [];
      }
    }
    // Leftover headings or hidden fields join the last slide of their page.
    if (pending.length && out.length) {
      const last = sections[out[out.length - 1].sectionIds[0]];
      sections[last.id] = { ...last, elementIds: [...last.elementIds, ...pending] };
    } else if (pending.length) {
      const id = `slide-${p.id}`;
      sections[id] = { id, name: p.name, visible: true, columnCount: 1, elementIds: pending };
      out.push({ id, name: p.name, visible: true, sectionIds: [id] });
      origin.push(p.id);
    }
  }
  return { def: { ...def, pages: out, sections }, origin };
}

/** What a step shows right now (logic applied). */
export function visibleOnStep(def: FormDefinition, step: number, state: LogicState): FormElement[] {
  const page = def.pages[step];
  return page ? orderedElements(def, [page]).filter((el) => !state.hidden.has(el.id)) : [];
}

const stepHasSomething = (def: FormDefinition, step: number, state: LogicState) =>
  visibleOnStep(def, step, state).some((el) => el.type !== 'hidden');

/** The step after this one: a jump rule's page if one is met, else the next step with something on it. -1 = the end. */
export function nextStep(steps: { def: FormDefinition; origin: string[] }, from: number, answers: Answers, state: LogicState): number {
  const { def, origin } = steps;
  const here = new Set(visibleOnStep(def, from, state).filter(isField).map((el) => el.field.fieldId));
  for (const r of def.logic ?? []) {
    if (r.action !== 'navigate' || !r.targetPageId) continue;
    if (!ruleConditions(r).some((c) => here.has(c.fieldId)) || !ruleMet(r, answers)) continue;
    const to = origin.indexOf(r.targetPageId);
    if (to > from) return stepHasSomething(def, to, state) ? to : nextStep(steps, to, answers, state);
  }
  for (let i = from + 1; i < def.pages.length; i++) if (stepHasSomething(def, i, state)) return i;
  return -1;
}

// ---------- checking answers ----------

export function fieldError(el: FormElement & { field: FieldDefinition }, value: string, required: boolean): string | null {
  const f = el.field;
  const v = (value ?? '').trim();
  if (el.type === 'payment') {
    if (!required && !v) return null;
    const pay = paymentFor(f.payment, v);
    if (!pay || pay.amount <= 0) return f.payment?.mode === 'custom' ? `Enter an amount${f.payment.minAmount ? ` of at least ${money(f.payment.minAmount * 100, f.payment.currency)}` : ''}.` : 'Choose what you’d like to pay for.';
    return null;
  }
  if (!v) return required ? (el.type === 'consent' ? 'Please tick this box to continue.' : 'This is required.') : null;
  if (el.type === 'email' && !EMAIL_RE.test(v)) return 'Enter a valid email address.';
  if (el.type === 'phone' && v.replace(/\D/g, '').length < 7) return 'Enter a valid phone number.';
  if (el.type === 'website' && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(v)) return 'Enter a valid web address.';
  const val = f.validation;
  if (val) {
    if (val.minLength && v.length < val.minLength) return `Use at least ${val.minLength} characters.`;
    if (val.maxLength && v.length > val.maxLength) return `Use at most ${val.maxLength} characters.`;
    if (el.type === 'number' || val.minValue !== undefined || val.maxValue !== undefined) {
      const n = Number(v);
      if (Number.isNaN(n)) return 'Enter a number.';
      if (val.minValue !== undefined && n < val.minValue) return `Enter ${val.minValue} or more.`;
      if (val.maxValue !== undefined && n > val.maxValue) return `Enter ${val.maxValue} or less.`;
    }
    if (val.pattern) { try { if (!new RegExp(val.pattern).test(v)) return val.patternMessage || 'This doesn’t look right.'; } catch { /* a bad pattern is ignored */ } }
  }
  return null;
}

/** Mistakes on a step, by field id. */
export function stepErrors(def: FormDefinition, step: number, answers: Answers, state: LogicState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of visibleOnStep(def, step, state)) {
    if (!isField(el) || el.type === 'hidden') continue;
    const e = fieldError(el, answers[el.field.fieldId] ?? '', state.required.has(el.field.fieldId));
    if (e) out[el.field.fieldId] = e;
  }
  return out;
}

// ---------- the link fills things in ----------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** The names a field answers to in a link: its own key, id, contact field, type and label. */
export function queryKeysFor(el: FormElement & { field: FieldDefinition }): string[] {
  const f = el.field;
  return [f.queryKey, f.fieldId, f.mappedContactField, el.type === 'hidden' ? null : el.type, slug(f.label)]
    .filter((k): k is string => !!k).map((k) => k.toLowerCase());
}

/** Answers filled in from the link (?email=…&first_name=…), plus hidden fields' default values. */
export function prefillAnswers(def: FormDefinition, params: URLSearchParams): Answers {
  const lower = new Map<string, string>();
  params.forEach((v, k) => lower.set(k.toLowerCase(), v));
  const out: Answers = {};
  for (const el of fieldElements(def)) {
    if (el.type === 'payment') continue;
    if (el.type === 'hidden' && el.field.defaultValue) out[el.field.fieldId] = el.field.defaultValue;
    if (def.settings.prefillFromUrl === false) continue;
    const key = queryKeysFor(el).find((k) => lower.has(k));
    if (key) out[el.field.fieldId] = lower.get(key)!.slice(0, 2000);
  }
  return out;
}

/** Where they came from: utm_* tags, ?source=, and the page that sent them. */
export function attribution(params: URLSearchParams, referrer = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'gclid', 'fbclid']) {
    const v = params.get(k);
    if (v) out[k] = v.slice(0, 300);
  }
  if (referrer) out.referrer = referrer.slice(0, 500);
  return out;
}

// ---------- quiz ----------

export interface QuizScore {
  score: number;
  max: number;
  percent: number;
  categories: Record<string, { score: number; max: number; percent: number }>;
  topCategory: string | null;
  result: QuizResult | null;
  /** Each scored question: right or not (when it has a right answer). */
  marks: { fieldId: string; label: string; correct: boolean | null; score: number; max: number }[];
}

/** Points for one question, and the most it could have scored. */
export function questionScore(el: FormElement & { field: FieldDefinition }, value: string | undefined): { score: number; max: number; correct: boolean | null } | null {
  const f = el.field;
  const scores = f.optionScores && Object.keys(f.optionScores).length ? f.optionScores : null;
  const correct = f.correctOptions?.length ? f.correctOptions : null;
  if (!scores && !correct) return null;
  const chosen = picks(el.type, value);
  let score = 0;
  let max = 0;
  if (scores) {
    const vals = Object.values(scores).map((n) => Number(n) || 0);
    score += chosen.reduce((n, c) => n + (Number(scores[c]) || 0), 0);
    max += MULTI.has(el.type) ? vals.filter((n) => n > 0).reduce((a, b) => a + b, 0) : Math.max(0, ...vals);
  }
  let right: boolean | null = null;
  if (correct) {
    const points = f.points ?? 1;
    right = chosen.length === correct.length && correct.every((c) => chosen.includes(c));
    if (right) score += points;
    max += points;
  }
  return { score, max, correct: right };
}

export function scoreQuiz(def: FormDefinition, answers: Answers): QuizScore | null {
  const quiz = def.settings.quiz;
  if (!quiz?.enabled) return null;
  let score = 0;
  let max = 0;
  const categories: QuizScore['categories'] = {};
  const marks: QuizScore['marks'] = [];
  for (const el of fieldElements(def)) {
    if (!CHOICE.has(el.type) && el.type !== 'rating' && el.type !== 'scale') continue;
    const q = questionScore(el, answers[el.field.fieldId]);
    if (!q) continue;
    score += q.score;
    max += q.max;
    marks.push({ fieldId: el.field.fieldId, label: el.field.label, correct: q.correct, score: q.score, max: q.max });
    const cat = el.field.quizCategory;
    if (cat) {
      const c = (categories[cat] ??= { score: 0, max: 0, percent: 0 });
      c.score += q.score;
      c.max += q.max;
    }
  }
  for (const c of Object.values(categories)) c.percent = c.max > 0 ? Math.round((c.score / c.max) * 100) : 0;
  const percent = max > 0 ? Math.round((score / max) * 100) : 0;
  const ranked = Object.entries(categories).sort((a, b) => b[1].percent - a[1].percent || b[1].score - a[1].score);
  const topCategory = ranked[0]?.[0] ?? null;
  const result = quiz.scoring === 'top_category'
    ? quiz.results.find((r) => r.category === topCategory) ?? null
    : quiz.results.find((r) => percent >= (r.minPercent ?? 0) && percent <= (r.maxPercent ?? 100)) ?? null;
  return { score, max, percent, categories, topCategory, result, marks };
}

/** The score as the quiz shows it. */
export function scoreLabel(s: QuizScore, how: 'percent' | 'points' | 'out_of_10' | 'none'): string {
  if (how === 'none') return '';
  if (how === 'points') return `${s.score} / ${s.max}`;
  if (how === 'out_of_10') return `${s.max > 0 ? Math.round((s.score / s.max) * 100) / 10 : 0} / 10`;
  return `${s.percent}%`;
}

// ---------- payment ----------

export interface PaymentDue { amount: number; currency: string; items: { name: string; unitAmount: number; quantity: number }[] }

/** Minor units (cents) for a major-unit price. */
const cents = (n: number) => Math.round((Number(n) || 0) * 100);

/**
 * What a payment answer comes to. Answers: fixed — anything; products — "id:qty,id:qty";
 * custom — the amount typed. Null when nothing is chosen.
 */
export function paymentFor(cfg: PaymentConfig | undefined, value: string): PaymentDue | null {
  if (!cfg) return null;
  const currency = (cfg.currency || 'usd').toLowerCase();
  if (cfg.mode === 'fixed') {
    const amount = cents(cfg.amount ?? 0);
    return amount > 0 ? { amount, currency, items: [{ name: cfg.description || 'Payment', unitAmount: amount, quantity: 1 }] } : null;
  }
  if (cfg.mode === 'custom') {
    const typed = cents(Number(String(value).replace(/[^0-9.]/g, '')));
    if (typed <= 0 || typed < cents(cfg.minAmount ?? 0)) return null;
    return { amount: typed, currency, items: [{ name: cfg.description || 'Payment', unitAmount: typed, quantity: 1 }] };
  }
  const items: PaymentDue['items'] = [];
  for (const part of String(value || '').split(',')) {
    const [id, q] = part.split(':');
    const product = cfg.products?.find((p) => p.id === id);
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(q) || 1)));
    if (product) items.push({ name: product.name, unitAmount: cents(product.price), quantity: cfg.quantity ? quantity : 1 });
    if (!cfg.multiple && items.length) break;
  }
  const amount = items.reduce((n, i) => n + i.unitAmount * i.quantity, 0);
  return amount > 0 ? { amount, currency, items } : null;
}

/** The payment the form asks for right now (the first visible payment element). */
export function paymentDue(def: FormDefinition, answers: Answers, state: LogicState): (PaymentDue & { fieldId: string }) | null {
  for (const el of fieldElements(def)) {
    if (el.type !== 'payment' || state.hidden.has(el.id)) continue;
    const due = paymentFor(el.field.payment, answers[el.field.fieldId] ?? '');
    if (due) return { ...due, fieldId: el.field.fieldId };
  }
  return null;
}

export function money(minor: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100); }
  catch { return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`; }
}

// ---------- open or closed ----------

/** Why it is not taking responses, or null when it is. */
export function closedReason(def: FormDefinition, status: string, responses: number, now = Date.now()): string | null {
  const s = def.settings;
  const msg = s.closedMessage?.trim() || 'This form is no longer accepting responses.';
  if (status !== 'published') return status === 'archived' ? msg : 'This form isn’t published yet.';
  if (s.closeAt && new Date(s.closeAt).getTime() <= now) return msg;
  if (s.maxResponses && responses >= s.maxResponses) return msg;
  return null;
}

/** The answers to send: only what is visible, with logic's values in. */
export function finalAnswers(def: FormDefinition, answers: Answers, state: LogicState): Answers {
  const out: Answers = {};
  for (const el of fieldElements(def)) {
    if (state.hidden.has(el.id) && el.type !== 'hidden') continue;
    const v = state.values[el.field.fieldId] ?? answers[el.field.fieldId];
    if (v !== undefined && v !== '') out[el.field.fieldId] = v;
  }
  return out;
}

export { fieldById };
