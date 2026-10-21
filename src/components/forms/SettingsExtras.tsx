import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { FormDefinition, FormSettings, QuizResult, QuizSettings } from '@/lib/form-builder-types';
import { presentationOf, type FormKind } from '@/lib/form-engine';

const h2 = 'text-lg font-semibold text-navy-800 mb-1';
const sub = 'text-sm text-ivory-600 mb-4';
const label = 'block text-sm font-medium text-navy-700 mb-1.5';
const newId = () => Math.random().toString(36).slice(2, 9);

function Toggle({ label: text, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1.5">
      <span><span className="block text-sm font-medium text-navy-700">{text}</span>{hint && <span className="block text-xs text-ivory-600">{hint}</span>}</span>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-navy-800" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** The settings forms and surveys have beyond the basics: how it's shown, who can respond, people, emails, quiz. */
export function SettingsExtras({ definition, kind, workspaceId, onUpdate }: {
  definition: FormDefinition; kind: FormKind; workspaceId: string | null; onUpdate: (u: Partial<FormSettings>) => void;
}) {
  const s = definition.settings;
  const [accounts, setAccounts] = useState<{ id: string; email: string; status: string }[]>([]);
  useEffect(() => {
    if (!workspaceId) return;
    supabase.from('email_accounts').select('id, email, status').eq('workspace_id', workspaceId).then(({ data }) => setAccounts((data ?? []) as typeof accounts));
  }, [workspaceId]);
  const how = presentationOf(definition, kind);

  return (
    <>
      <section>
        <h2 className={h2}>How it’s shown</h2>
        <p className={sub}>{kind === 'survey' ? 'A survey goes slide by slide by default: its pages, or one question per slide when it has one page.' : 'A form is one long page by default (or its pages in turn, if it has several).'}</p>
        <div className="space-y-3">
          <div>
            <label className={label}>Layout</label>
            <select className="input-field" value={s.presentation ?? 'auto'} onChange={(e) => onUpdate({ presentation: e.target.value as FormSettings['presentation'] })}>
              <option value="auto">Automatic ({how === 'one_page' ? 'one page' : how === 'one_question' ? 'one question per slide' : 'page by page'})</option>
              <option value="one_page">One long page (everything at once)</option>
              <option value="pages">Page by page (each page is a slide)</option>
              <option value="one_question">One question per slide</option>
            </select>
          </div>
          {how !== 'one_page' && <>
            <Toggle label="Allow going back" checked={s.allowBackNavigation !== false} onChange={(v) => onUpdate({ allowBackNavigation: v })} />
            <Toggle label="Move on when a choice is picked" hint="Slides with a single choice go to the next one by themselves." checked={!!s.autoAdvance} onChange={(v) => onUpdate({ autoAdvance: v })} />
          </>}
        </div>
      </section>

      <section>
        <h2 className={h2}>Responses</h2>
        <p className={sub}>Stop taking responses on a date or after a number of them.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Close on</label>
            <input type="datetime-local" className="input-field" value={s.closeAt ? toLocalInput(s.closeAt) : ''} onChange={(e) => onUpdate({ closeAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </div>
          <div>
            <label className={label}>Most responses</label>
            <input type="number" min={1} className="input-field" value={s.maxResponses ?? ''} placeholder="No limit" onChange={(e) => onUpdate({ maxResponses: Number(e.target.value) || null })} />
          </div>
        </div>
        <div className="mt-3">
          <label className={label}>Message once it’s closed</label>
          <input className="input-field" value={s.closedMessage ?? ''} placeholder="This form is no longer accepting responses." onChange={(e) => onUpdate({ closedMessage: e.target.value })} />
        </div>
      </section>

      <section>
        <h2 className={h2}>The people filling it in</h2>
        <p className={sub}>Save them typing, and keep spam out.</p>
        <Toggle label="Fill fields in from the link" hint="?email=…&first_name=… or each field’s own key (set it on the field)." checked={s.prefillFromUrl !== false} onChange={(v) => onUpdate({ prefillFromUrl: v })} />
        <Toggle label="Remember people on their device" hint="Their name, email and phone are filled in next time." checked={!!s.rememberRespondent} onChange={(v) => onUpdate({ rememberRespondent: v })} />
        <Toggle label="Turn off browser autofill" checked={!!s.disableAutofill} onChange={(v) => onUpdate({ disableAutofill: v })} />
        <Toggle label="Spam protection" hint="A hidden trap field that only bots fill in; their responses are dropped." checked={s.spamProtection !== false} onChange={(v) => onUpdate({ spamProtection: v })} />
        <Toggle label="Open redirect links in a new tab" checked={!!s.redirectNewTab} onChange={(v) => onUpdate({ redirectNewTab: v })} />
      </section>

      <section>
        <h2 className={h2}>Emails are sent from</h2>
        <p className={sub}>The team alert and the auto-reply (set them up under Notifications) go from a connected Gmail account.</p>
        {accounts.length ? (
          <select className="input-field" value={s.senderAccountId ?? ''} onChange={(e) => onUpdate({ senderAccountId: e.target.value || null })}>
            <option value="">The first connected account</option>
            {accounts.map((a) => <option key={a.id} value={a.id} disabled={a.status !== 'active'}>{a.email}{a.status !== 'active' ? ' (reconnect needed)' : ''}</option>)}
          </select>
        ) : <p className="rounded-xl bg-gold-50 px-4 py-3 text-sm text-gold-900">No email account connected yet. Connect Gmail in Settings → Email so notifications can be sent.</p>}
      </section>

      <QuizSettingsEditor quiz={s.quiz} onChange={(quiz) => onUpdate({ quiz })} />
    </>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DEFAULT_QUIZ: QuizSettings = {
  enabled: true, showScore: 'percent', scoring: 'total', categories: [], showAnswers: true,
  results: [
    { id: 'r-low', heading: 'Keep going', message: 'You’re on your way. Here’s what to look at next.', minPercent: 0, maxPercent: 49 },
    { id: 'r-mid', heading: 'Nicely done', message: 'You know your stuff.', minPercent: 50, maxPercent: 79 },
    { id: 'r-high', heading: 'Expert', message: 'Top marks!', minPercent: 80, maxPercent: 100 },
  ],
};

/** Quiz mode: score answers, then show a result by score range, or by the strongest category. */
function QuizSettingsEditor({ quiz, onChange }: { quiz?: QuizSettings; onChange: (q: QuizSettings) => void }) {
  const q = quiz ?? { ...DEFAULT_QUIZ, enabled: false };
  const set = (u: Partial<QuizSettings>) => onChange({ ...q, ...u });
  const setResult = (i: number, u: Partial<QuizResult>) => set({ results: q.results.map((r, j) => (j === i ? { ...r, ...u } : r)) });
  return (
    <section>
      <h2 className={h2}>Quiz</h2>
      <p className={sub}>Score the answers and show each person a result. Set the right answers and points on each question (select it in Build).</p>
      <Toggle label="Make this a quiz" checked={q.enabled} onChange={(v) => onChange(v && !quiz ? DEFAULT_QUIZ : { ...q, enabled: v })} />
      {q.enabled && (
        <div className="mt-3 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Show the score as</label>
              <select className="input-field" value={q.showScore} onChange={(e) => set({ showScore: e.target.value as QuizSettings['showScore'] })}>
                <option value="percent">A percentage (80%)</option><option value="points">Points (8 / 10)</option><option value="out_of_10">Out of 10</option><option value="none">Don’t show it</option>
              </select>
            </div>
            <div>
              <label className={label}>The result shown depends on</label>
              <select className="input-field" value={q.scoring} onChange={(e) => set({ scoring: e.target.value as QuizSettings['scoring'] })}>
                <option value="total">The total score</option><option value="top_category">Their strongest category (personality quiz)</option>
              </select>
            </div>
          </div>
          <Toggle label="Show which answers were right" checked={!!q.showAnswers} onChange={(v) => set({ showAnswers: v })} />
          <div>
            <label className={label}>Categories (optional, comma separated)</label>
            <input className="input-field" value={q.categories.join(', ')} placeholder="e.g. Marketing, Sales, Operations" onChange={(e) => set({ categories: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-navy-800">Results</p>
            {q.results.map((r, i) => (
              <div key={r.id} className="space-y-2 rounded-xl border border-navy-100 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {q.scoring === 'total' ? (
                    <span className="flex items-center gap-1 text-sm text-navy-700">
                      From <input type="number" min={0} max={100} aria-label="From %" className="input-field !h-8 w-16 !px-2" value={r.minPercent ?? 0} onChange={(e) => setResult(i, { minPercent: Number(e.target.value) })} />
                      to <input type="number" min={0} max={100} aria-label="To %" className="input-field !h-8 w-16 !px-2" value={r.maxPercent ?? 100} onChange={(e) => setResult(i, { maxPercent: Number(e.target.value) })} />%
                    </span>
                  ) : (
                    <select aria-label="Category" className="input-field !h-8 !w-auto" value={r.category ?? ''} onChange={(e) => setResult(i, { category: e.target.value })}>
                      <option value="">Category…</option>{q.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  <span className="flex-1" />
                  <button type="button" onClick={() => set({ results: q.results.filter((_, j) => j !== i) })} aria-label="Remove result" className="rounded-md p-1 text-ivory-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                <input className="input-field" aria-label="Result heading" value={r.heading} onChange={(e) => setResult(i, { heading: e.target.value })} placeholder="Heading" />
                <textarea className="input-field min-h-[56px]" aria-label="Result message" value={r.message} onChange={(e) => setResult(i, { message: e.target.value })} placeholder="What they read" />
                <input className="input-field" aria-label="Result link" value={r.redirectUrl ?? ''} onChange={(e) => setResult(i, { redirectUrl: e.target.value || undefined })} placeholder="Then send them to (optional) https://" />
              </div>
            ))}
            <button type="button" onClick={() => set({ results: [...q.results, { id: `r-${newId()}`, heading: 'New result', message: '', minPercent: 0, maxPercent: 100 }] })} className="btn-ghost btn-sm"><Plus className="h-3.5 w-3.5" /> Add a result</button>
          </div>
        </div>
      )}
    </section>
  );
}
