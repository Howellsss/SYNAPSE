import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormDefinition, Viewport } from '@/lib/form-builder-types';
import {
  finalAnswers, nextStep, runLogic, scoreLabel, scoreQuiz, stepErrors, stepsOf,
  type Answers, type FormKind, type PaymentDue, type QuizScore,
} from '@/lib/form-engine';
import { FormRenderer, type FormRuntime } from './FormRenderer';
import { dataUrlToBlob, uploadFormResponseFile } from '@/lib/form-files';

/** What the player hands over when someone submits. */
export interface FormPayload {
  answers: Answers;
  quiz: QuizScore | null;
  payment: (PaymentDue & { fieldId: string }) | null;
  disqualified: boolean;
  /** Filled in only by bots (a trap field people never see). */
  trap: string;
}
export type SubmitOutcome = { ok: true; checkoutUrl?: string | null } | { ok: false; error: string; closed?: boolean };

const REMEMBER_KEY = 'synapse.respondent';
const REMEMBERED = ['first_name', 'last_name', 'email', 'phone', 'company'] as const;

/** Details saved on this device by forms that remember people (by contact field). */
export function rememberedDetails(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
}

/**
 * Someone filling in a form or survey: step by step (a form is one long page unless it has
 * pages; a survey goes slide by slide), with the logic, checks, quiz result and payment. Used by
 * the public page and the builder's preview (`onSubmit` absent: nothing is sent).
 */
export function FormPlayer({ definition, formName, formDescription, kind, viewport = 'desktop', initialAnswers, onSubmit, done: doneFromOutside, formId, fill = false }: {
  definition: FormDefinition;
  /** Where files and signatures are sent (File Upload, Signature). */
  formId?: string;
  formName: string;
  formDescription?: string | null;
  kind: FormKind;
  viewport?: Viewport;
  initialAnswers?: Answers;
  onSubmit?: (payload: FormPayload) => Promise<SubmitOutcome>;
  /** Show the end screen straight away (back from paying). */
  done?: { note?: string };
  /** Fill the box it sits in (the builder's preview card). */
  fill?: boolean;
}) {
  const steps = useMemo(() => stepsOf(definition, kind), [definition, kind]);
  const [answers, setAnswers] = useState<Answers>(() => {
    const out: Answers = { ...(initialAnswers ?? {}) };
    // Remembered details fill the fields mapped to them (but never over what the link says).
    if (definition.settings.rememberRespondent) {
      const saved = rememberedDetails();
      for (const el of Object.values(definition.elements)) {
        const key = el.field?.mappedContactField;
        if (key && saved[key] && !out[el.field!.fieldId]) out[el.field!.fieldId] = saved[key];
      }
    }
    return out;
  });
  const [step, setStep] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState<null | { kind: 'done' | 'disqualified' | 'closed'; quiz?: QuizScore | null; message?: string; redirect?: string | null; note?: string }>(
    doneFromOutside ? { kind: 'done', note: doneFromOutside.note } : null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const trap = useRef('');
  const top = useRef<HTMLDivElement>(null);

  const state = useMemo(() => runLogic(steps.def, answers), [steps.def, answers]);
  const next = nextStep(steps, step, answers, state);
  const isLast = next === -1;
  const quizOn = !!definition.settings.quiz?.enabled;
  // Forms don't take payments.
  const due = null;

  // Back to the top of the card when the step changes.
  useEffect(() => { top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [step, end]);

  const showErrors = (errs: Record<string, string>) => {
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) requestAnimationFrame(() => document.getElementById(`field-${first}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const finish = async (disqualified: boolean) => {
    const quiz = scoreQuiz(steps.def, finalAnswers(steps.def, answers, state));
    const payload: FormPayload = { answers: finalAnswers(steps.def, answers, state), quiz, payment: disqualified ? null : due, disqualified, trap: trap.current };
    // Signatures are drawings until now: send each as a picture and keep its link.
    const drawn = Object.entries(payload.answers).filter(([, v]) => typeof v === 'string' && v.startsWith('data:image/'));
    if (drawn.length && onSubmit) {
      if (!formId) { setFailure('Signatures can’t be sent from here.'); return; }
      setBusy(true);
      setFailure(null);
      try {
        for (const [id, v] of drawn) payload.answers[id] = await uploadFormResponseFile(formId, dataUrlToBlob(v), 'signature.png');
      } catch (e) {
        setBusy(false);
        setFailure(`Your signature couldn’t be sent: ${(e as Error).message}`);
        return;
      }
    }
    if (definition.settings.rememberRespondent) {
      const saved = rememberedDetails();
      for (const el of Object.values(definition.elements)) {
        const key = el.field?.mappedContactField;
        if (key && (REMEMBERED as readonly string[]).includes(key) && payload.answers[el.field!.fieldId]) saved[key] = payload.answers[el.field!.fieldId];
      }
      try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(saved)); } catch { /* private mode */ }
    }
    if (onSubmit) {
      setBusy(true);
      setFailure(null);
      const out = await onSubmit(payload);
      setBusy(false);
      if (!out.ok) {
        if (out.closed) setEnd({ kind: 'closed', message: out.error });
        else setFailure(out.error);
        return;
      }
      // Paying: off to the secure checkout; they come back to the end screen.
      if (out.checkoutUrl) { window.location.href = out.checkoutUrl; return; }
    }
    if (disqualified) { setEnd({ kind: 'disqualified', message: state.disqualify!.message, redirect: state.disqualify!.redirectUrl }); return; }
    const redirect = state.redirectUrl ?? quiz?.result?.redirectUrl ?? (definition.notifications.postSubmission.type === 'redirect' ? definition.notifications.postSubmission.redirectUrl || definition.settings.redirectUrl : null);
    setEnd({ kind: 'done', quiz, redirect });
  };

  // Redirects (after a moment, so the end screen flashes up first).
  useEffect(() => {
    if (!end?.redirect || !onSubmit) return;
    const url = end.redirect;
    const t = window.setTimeout(() => {
      if (definition.settings.redirectNewTab) window.open(url, '_blank', 'noopener');
      else window.location.href = url;
    }, 900);
    return () => window.clearTimeout(t);
  }, [end, onSubmit, definition.settings.redirectNewTab]);

  const goNext = () => {
    const errs = stepErrors(steps.def, step, answers, state);
    if (Object.keys(errs).length) { showErrors(errs); return; }
    setErrors({});
    if (state.disqualify) { void finish(true); return; }
    if (isLast) { void finish(false); return; }
    setHistory((h) => [...h, step]);
    setStep(next);
  };
  const goBack = () => {
    setErrors({});
    setHistory((h) => { const copy = [...h]; const prev = copy.pop(); if (prev !== undefined) setStep(prev); return copy; });
  };

  // Slides that move on when a single choice is picked (only when that's all the slide asks).
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;
  const autoAdvance = definition.settings.autoAdvance && steps.def.pages.length > 1;
  const onPicked = autoAdvance ? () => window.setTimeout(() => goNextRef.current(), 260) : undefined;

  const theme = definition.theme;
  const runtime: FormRuntime = {
    hidden: state.hidden, required: state.required, errors,
    canGoBack: history.length > 0 && definition.settings.allowBackNavigation !== false,
    isLast: isLast || !!state.disqualify, busy,
    submitLabel: kind === 'survey' ? 'Finish' : 'Submit',
    autoComplete: definition.settings.disableAutofill ? 'off' : 'on',
    onPicked,
    formId,
  };

  if (end) {
    return <div ref={top}><EndScreen definition={definition} formName={formName} end={end} preview={!onSubmit} /></div>;
  }

  return (
    <div ref={top}>
      <form onSubmit={(e) => { e.preventDefault(); goNext(); }} autoComplete={runtime.autoComplete} noValidate>
        {/* A trap for bots: people never see or fill it. */}
        {definition.settings.spamProtection !== false && (
          <input type="text" name="company_website" tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue=""
            onChange={(e) => { trap.current = e.target.value; }} style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', opacity: 0 }} />
        )}
        <div key={step} className="animate-fade-in">
          <FormRenderer
            fill={fill}
            definition={steps.def}
            formName={formName}
            formDescription={formDescription}
            viewport={viewport}
            currentPageIndex={step}
            currentPage={history.length}
            totalPages={Math.max(history.length + 1, steps.def.pages.length)}
            answers={{ ...answers, ...state.values }}
            onAnswerChange={(fieldId, value) => { setAnswers((a) => ({ ...a, [fieldId]: value })); setErrors((e) => { if (!e[fieldId]) return e; const c = { ...e }; delete c[fieldId]; return c; }); }}
            onNext={goNext}
            onPrevious={goBack}
            onSubmit={goNext}
            runtime={runtime}
          />
        </div>
      </form>
      {failure && (
        <p role="alert" className="mx-auto mt-4 max-w-xl rounded-xl px-4 py-3 text-sm" style={{ background: '#FDECEC', color: theme.colors.error }}>
          {failure}
        </p>
      )}
      {quizOn && !onSubmit && <p className="mt-3 text-center text-xs text-ivory-600">Preview: the quiz is scored when you finish.</p>}
    </div>
  );
}

/** After they submit: the quiz result, the thank-you page, a message, or the disqualified note. */
function EndScreen({ definition, formName, end, preview }: {
  definition: FormDefinition; formName: string; preview: boolean;
  end: { kind: 'done' | 'disqualified' | 'closed'; quiz?: QuizScore | null; message?: string; redirect?: string | null; note?: string };
}) {
  const theme = definition.theme;
  const post = definition.notifications.postSubmission;
  const quiz = definition.settings.quiz;
  const card: React.CSSProperties = {
    maxWidth: '640px', margin: '0 auto', background: theme.colors.surfaceBackground, borderRadius: '20px', padding: '40px 32px',
    textAlign: 'center', fontFamily: theme.typography.primaryFont, boxShadow: '0 20px 50px rgba(9,21,48,0.12)',
  };
  const h = { color: theme.colors.heading, fontFamily: theme.typography.headingFont, fontSize: '26px', fontWeight: 800, margin: 0 } as React.CSSProperties;
  const p = { color: theme.colors.bodyText, fontSize: theme.typography.bodySize, lineHeight: 1.6, marginTop: '12px', whiteSpace: 'pre-wrap' } as React.CSSProperties;
  const bg = theme.background.type === 'solid' ? theme.background.color : theme.colors.pageBackground;

  let body: React.ReactNode;
  if (end.kind === 'closed') {
    body = <><h2 style={h}>{formName}</h2><p style={p}>{end.message}</p></>;
  } else if (end.kind === 'disqualified') {
    body = <><h2 style={h}>Thank you</h2><p style={p}>{end.message}</p></>;
  } else if (end.quiz && quiz?.enabled) {
    const r = end.quiz.result;
    body = (
      <>
        {quiz.showScore !== 'none' && (
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '128px', height: '128px', borderRadius: '50%', border: `6px solid ${theme.colors.primary}`, marginBottom: '18px' }}>
            <span style={{ fontSize: '30px', fontWeight: 800, color: theme.colors.heading }}>{scoreLabel(end.quiz, quiz.showScore)}</span>
            <span style={{ fontSize: '12px', color: theme.colors.mutedText }}>your score</span>
          </div>
        )}
        <h2 style={h}>{r?.heading || 'Thanks for taking the quiz'}</h2>
        {r?.message && <p style={p}>{r.message}</p>}
        {quiz.scoring === 'top_category' && end.quiz.topCategory && <p style={{ ...p, fontWeight: 600 }}>Your strongest area: {end.quiz.topCategory}</p>}
        {Object.keys(end.quiz.categories).length > 1 && (
          <div style={{ marginTop: '18px', textAlign: 'left' }}>
            {Object.entries(end.quiz.categories).map(([name, c]) => (
              <div key={name} style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: theme.colors.bodyText }}><span>{name}</span><span>{c.percent}%</span></div>
                <div style={{ height: '8px', borderRadius: '99px', background: theme.colors.border, overflow: 'hidden' }}><div style={{ width: `${c.percent}%`, height: '100%', background: theme.colors.primary }} /></div>
              </div>
            ))}
          </div>
        )}
        {quiz.showAnswers && end.quiz.marks.some((m) => m.correct !== null) && (
          <ul style={{ marginTop: '18px', textAlign: 'left', listStyle: 'none', padding: 0 }}>
            {end.quiz.marks.filter((m) => m.correct !== null).map((m) => (
              <li key={m.fieldId} style={{ display: 'flex', gap: '8px', fontSize: '14px', color: theme.colors.bodyText, marginTop: '6px' }}>
                <span style={{ color: m.correct ? theme.colors.success : theme.colors.error, fontWeight: 800 }}>{m.correct ? '✓' : '✕'}</span>{m.label}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else if (post.type === 'custom_message') {
    body = <p style={{ ...p, marginTop: 0 }}>{post.customMessage || definition.settings.successMessage}</p>;
  } else {
    const ty = post.thankYouPage;
    body = (
      <>
        {ty.imageUrl && <img src={ty.imageUrl} alt="" style={{ maxHeight: '160px', margin: '0 auto 18px', borderRadius: '12px' }} />}
        <h2 style={h}>{ty.heading || 'Thank you!'}</h2>
        <p style={p}>{ty.message || definition.settings.successMessage}</p>
        {ty.buttonText && ty.buttonLink && (
          <a href={ty.buttonLink} style={{ display: 'inline-block', marginTop: '20px', padding: '12px 22px', borderRadius: '12px', background: theme.buttonStyle.background, color: theme.buttonStyle.textColor, fontWeight: 700, textDecoration: 'none' }}>{ty.buttonText}</a>
        )}
      </>
    );
  }

  return (
    <div style={{ background: bg, padding: '48px 16px', minHeight: '100%' }}>
      <div style={card} role="status">
        {end.note && <p style={{ ...p, marginTop: 0, marginBottom: '14px', color: theme.colors.success, fontWeight: 700 }}>{end.note}</p>}
        {body}
        {end.redirect && <p style={{ ...p, fontSize: '13px', color: theme.colors.mutedText }}>{preview ? `(Would now go to ${end.redirect})` : 'Taking you there…'}</p>}
      </div>
    </div>
  );
}
