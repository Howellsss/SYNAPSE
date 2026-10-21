import { describe, expect, it } from 'vitest';
import { createDefaultDefinition, createElement } from './form-definition';
import type { FormDefinition, FormElement } from './form-builder-types';
import {
  attribution, closedReason, conditionMet, finalAnswers, nextStep, paymentDue, paymentFor, prefillAnswers, presentationOf,
  runLogic, scoreLabel, scoreQuiz, stepErrors, stepsOf,
} from './form-engine';

/** A definition with these elements, one section per page (pages: list of element lists). */
function build(pages: FormElement[][], tweak: (d: FormDefinition) => void = () => {}): FormDefinition {
  const d = createDefaultDefinition('Test');
  d.pages = []; d.sections = {}; d.elements = {};
  pages.forEach((els, i) => {
    const pid = `p${i + 1}`;
    const sid = `s${i + 1}`;
    d.pages.push({ id: pid, name: `Page ${i + 1}`, visible: true, sectionIds: [sid] });
    d.sections[sid] = { id: sid, name: sid, visible: true, columnCount: 1, elementIds: els.map((e) => e.id) };
    els.forEach((e) => { d.elements[e.id] = e; });
  });
  tweak(d);
  return d;
}
function field(type: Parameters<typeof createElement>[0], id: string, extra: Partial<NonNullable<FormElement['field']>> = {}): FormElement {
  const el = createElement(type, 0);
  el.id = `el-${id}`;
  el.field = { ...el.field!, fieldId: id, required: false, ...extra };
  return el;
}

describe('logic', () => {
  it('conditions: equals works on checkbox lists, numbers compare', () => {
    expect(conditionMet({ fieldId: 'a', operator: 'equals', value: 'Blue' }, { a: 'Red,blue' })).toBe(true);
    expect(conditionMet({ fieldId: 'a', operator: 'greater_than', value: '10' }, { a: '12' })).toBe(true);
    expect(conditionMet({ fieldId: 'a', operator: 'less_than', value: '10' }, { a: '' })).toBe(false);
    expect(conditionMet({ fieldId: 'a', operator: 'is_empty', value: '' }, {})).toBe(true);
  });

  const budget = field('radio', 'budget', { options: ['Under $1k', '$1k+'] });
  const company = field('text_field', 'company', { required: true });
  const why = field('long_text', 'why');
  const def = build([[budget, company, why]], (d) => {
    d.logic = [
      { id: 'r1', action: 'show', targetElementId: company.id, triggerFieldId: 'budget', operator: 'equals', triggerValue: '$1k+' },
      { id: 'r2', action: 'require', targetElementId: why.id, triggerFieldId: '', operator: 'equals', triggerValue: '', conditions: [{ fieldId: 'budget', operator: 'equals', value: '$1k+' }, { fieldId: 'company', operator: 'is_not_empty', value: '' }], match: 'all' },
      { id: 'r3', action: 'disqualify', targetElementId: '', triggerFieldId: 'budget', operator: 'equals', triggerValue: 'Under $1k', message: 'Sorry, we start at $1k.' },
    ];
  });

  it('show rules hide until met; a hidden field is not required', () => {
    const s = runLogic(def, {});
    expect(s.hidden.has(company.id)).toBe(true);
    expect(s.required.has('company')).toBe(false);
    const t = runLogic(def, { budget: '$1k+' });
    expect(t.hidden.has(company.id)).toBe(false);
    expect(t.required.has('company')).toBe(true);
  });
  it('several conditions, all must match', () => {
    expect(runLogic(def, { budget: '$1k+' }).required.has('why')).toBe(false);
    expect(runLogic(def, { budget: '$1k+', company: 'Acme' }).required.has('why')).toBe(true);
  });
  it('disqualify ends with its message', () => {
    expect(runLogic(def, { budget: 'Under $1k' }).disqualify?.message).toBe('Sorry, we start at $1k.');
    expect(runLogic(def, { budget: '$1k+' }).disqualify).toBeNull();
  });
  it('only visible answers are sent, with set values', () => {
    const d2 = { ...def, logic: [...def.logic, { id: 'r4', action: 'set_value' as const, targetElementId: why.id, triggerFieldId: 'budget', operator: 'equals' as const, triggerValue: '$1k+', value: 'Big budget' }] };
    const s = runLogic(d2, { budget: 'Under $1k', company: 'Acme' });
    expect(finalAnswers(d2, { budget: 'Under $1k', company: 'Acme' }, s)).toEqual({ budget: 'Under $1k' });
    expect(finalAnswers(d2, { budget: '$1k+' }, runLogic(d2, { budget: '$1k+' })).why).toBe('Big budget');
  });
});

describe('steps', () => {
  const a = field('text_field', 'a');
  const b = field('radio', 'b', { options: ['Yes', 'No'] });
  const c = field('text_field', 'c');
  const head = createElement('heading', 0); head.id = 'h1';
  const def = build([[a], [head, b], [c]]);

  it('a form with one page is one long page; a survey goes slide by slide', () => {
    const one = build([[a, b, c]]);
    expect(presentationOf(one, 'form')).toBe('one_page');
    expect(presentationOf(one, 'survey')).toBe('one_question');
    expect(presentationOf(def, 'survey')).toBe('pages');
    expect(stepsOf(def, 'form').def.pages).toHaveLength(3);
    expect(stepsOf({ ...def, settings: { ...def.settings, presentation: 'one_page' } }, 'form').def.pages).toHaveLength(1);
  });
  it('one question per slide keeps headings with the question after them', () => {
    const s = stepsOf({ ...def, settings: { ...def.settings, presentation: 'one_question' } }, 'survey');
    expect(s.def.pages).toHaveLength(3);
    expect(s.def.sections[s.def.pages[1].sectionIds[0]].elementIds).toEqual(['h1', b.id]);
    expect(s.origin).toEqual(['p1', 'p2', 'p3']);
  });
  it('jumps skip ahead; pages with nothing showing are skipped', () => {
    const jd = build([[a], [b], [c], [field('text_field', 'd')]], (d) => {
      d.logic = [
        { id: 'j', action: 'navigate', targetElementId: '', targetPageId: 'p4', triggerFieldId: 'b', operator: 'equals', triggerValue: 'No' },
        { id: 'h', action: 'hide', targetElementId: c.id, triggerFieldId: 'b', operator: 'equals', triggerValue: 'Maybe' },
      ];
    });
    const steps = stepsOf(jd, 'survey');
    expect(nextStep(steps, 1, { b: 'No' }, runLogic(jd, { b: 'No' }))).toBe(3);
    expect(nextStep(steps, 1, { b: 'Yes' }, runLogic(jd, { b: 'Yes' }))).toBe(2);
    expect(nextStep(steps, 1, { b: 'Maybe' }, runLogic(jd, { b: 'Maybe' }))).toBe(3);
    expect(nextStep(steps, 3, {}, runLogic(jd, {}))).toBe(-1);
  });
});

describe('checking answers', () => {
  const email = field('email', 'email', { required: true });
  const age = field('number', 'age', { validation: { minValue: 18 } });
  const ok = field('consent', 'ok', { required: true });
  const def = build([[email, age, ok]]);
  it('required, email format, numbers and consent', () => {
    const s = runLogic(def, {});
    expect(stepErrors(def, 0, { email: 'nope', age: '12' }, s)).toEqual({ email: 'Enter a valid email address.', age: 'Enter 18 or more.', ok: 'Please tick this box to continue.' });
    expect(stepErrors(def, 0, { email: 'a@b.co', age: '30', ok: 'true' }, s)).toEqual({});
  });
});

describe('the link fills things in', () => {
  const email = field('email', 'f_email', { mappedContactField: 'email' });
  const ref = field('hidden', 'ref', { queryKey: 'ref', defaultValue: 'site' });
  const plan = field('dropdown', 'plan', { label: 'Your plan', options: ['Pro'] });
  const def = build([[email, ref, plan]]);
  it('by contact field, query key, label; hidden defaults', () => {
    expect(prefillAnswers(def, new URLSearchParams('email=jo@x.com&your_plan=Pro'))).toEqual({ f_email: 'jo@x.com', ref: 'site', plan: 'Pro' });
    expect(prefillAnswers(def, new URLSearchParams('REF=ad1')).ref).toBe('ad1');
    const off = { ...def, settings: { ...def.settings, prefillFromUrl: false } };
    expect(prefillAnswers(off, new URLSearchParams('email=jo@x.com'))).toEqual({ ref: 'site' });
  });
  it('remembers where they came from', () => {
    expect(attribution(new URLSearchParams('utm_source=ig&x=1'), 'https://a.com')).toEqual({ utm_source: 'ig', referrer: 'https://a.com' });
  });
});

describe('quiz', () => {
  const q1 = field('radio', 'q1', { options: ['Paris', 'Rome'], correctOptions: ['Paris'], points: 2, quizCategory: 'Geo' });
  const q2 = field('radio', 'q2', { options: ['Low', 'High'], optionScores: { Low: 1, High: 3 }, quizCategory: 'Drive' });
  const q3 = field('checkbox', 'q3', { options: ['A', 'B', 'C'], correctOptions: ['A', 'C'], quizCategory: 'Geo' });
  const def = build([[q1, q2, q3]], (d) => {
    d.settings.quiz = {
      enabled: true, showScore: 'percent', scoring: 'total', categories: ['Geo', 'Drive'],
      results: [
        { id: 'lo', heading: 'Keep going', message: '', minPercent: 0, maxPercent: 49 },
        { id: 'hi', heading: 'Expert', message: '', minPercent: 50, maxPercent: 100 },
      ],
    };
  });
  it('right answers, option points and multi-answer questions add up', () => {
    const s = scoreQuiz(def, { q1: 'Paris', q2: 'High', q3: 'C,A' })!;
    expect([s.score, s.max, s.percent]).toEqual([6, 6, 100]);
    expect(s.result?.id).toBe('hi');
    expect(s.marks.map((m) => m.correct)).toEqual([true, null, true]);
    const t = scoreQuiz(def, { q1: 'Rome', q2: 'Low', q3: 'A' })!;
    expect([t.score, t.percent, t.result?.id]).toEqual([1, 17, 'lo']);
    expect(scoreLabel(t, 'points')).toBe('1 / 6');
    expect(scoreLabel(t, 'out_of_10')).toBe('1.7 / 10');
  });
  it('top category picks the result for the strongest category', () => {
    const d2 = { ...def, settings: { ...def.settings, quiz: { ...def.settings.quiz!, scoring: 'top_category' as const, results: [{ id: 'g', heading: 'Explorer', message: '', category: 'Geo' }, { id: 'd', heading: 'Driver', message: '', category: 'Drive' }] } } };
    expect(scoreQuiz(d2, { q2: 'High' })!.result?.id).toBe('d');
    expect(scoreQuiz(d2, { q1: 'Paris', q3: 'A,C' })!.result?.id).toBe('g');
  });
  it('off unless turned on', () => expect(scoreQuiz(build([[q1]]), { q1: 'Paris' })).toBeNull());
});

describe('payment', () => {
  it('fixed, products (with quantity) and custom amounts, in cents', () => {
    expect(paymentFor({ mode: 'fixed', currency: 'USD', amount: 25 }, '')?.amount).toBe(2500);
    const products = { mode: 'products' as const, currency: 'usd', multiple: true, quantity: true, products: [{ id: 'a', name: 'Ticket', price: 10 }, { id: 'b', name: 'Shirt', price: 19.99 }] };
    expect(paymentFor(products, 'a:2,b:1')).toEqual({ amount: 3999, currency: 'usd', items: [{ name: 'Ticket', unitAmount: 1000, quantity: 2 }, { name: 'Shirt', unitAmount: 1999, quantity: 1 }] });
    expect(paymentFor({ ...products, multiple: false }, 'a:2,b:1')?.amount).toBe(1000 * 2);
    expect(paymentFor({ mode: 'custom', currency: 'usd', minAmount: 5 }, '3')).toBeNull();
    expect(paymentFor({ mode: 'custom', currency: 'usd', minAmount: 5 }, '$12.50')?.amount).toBe(1250);
  });
  it('a hidden payment asks for nothing', () => {
    const pay = field('payment', 'pay', { payment: { mode: 'fixed', currency: 'usd', amount: 30 } });
    const def = build([[pay]], (d) => { d.logic = [{ id: 'x', action: 'hide', targetElementId: pay.id, triggerFieldId: 'free', operator: 'equals', triggerValue: 'yes' }]; });
    expect(paymentDue(def, {}, runLogic(def, {}))?.amount).toBe(3000);
    expect(paymentDue(def, { free: 'yes' }, runLogic(def, { free: 'yes' }))).toBeNull();
  });
});

describe('open or closed', () => {
  const def = createDefaultDefinition('X');
  it('drafts, closing dates and response limits', () => {
    expect(closedReason(def, 'draft', 0)).toMatch(/isn’t published/);
    expect(closedReason(def, 'published', 0)).toBeNull();
    expect(closedReason({ ...def, settings: { ...def.settings, closeAt: '2020-01-01T00:00:00Z' } }, 'published', 0)).toMatch(/no longer/);
    expect(closedReason({ ...def, settings: { ...def.settings, maxResponses: 3, closedMessage: 'Full!' } }, 'published', 3)).toBe('Full!');
  });
});
