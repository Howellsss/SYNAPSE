import type { FieldDefinition, FormElement, QuizSettings } from '@/lib/form-builder-types';
import { queryKeysFor } from '@/lib/form-engine';

const label = 'block text-xs font-medium text-navy-700 mb-1';

/** Quiz: points per option, the right answer(s), and the category a question counts towards. */
export function QuizScoringEditor({ element, quiz, onUpdate }: { element: FormElement; quiz: QuizSettings; onUpdate: (id: string, u: Partial<FieldDefinition>) => void }) {
  const f = element.field!;
  const options = f.options ?? [];
  const correct = f.correctOptions ?? [];
  const multi = element.type === 'checkbox' || element.type === 'multi_select';
  const toggleCorrect = (o: string) => {
    const next = multi ? (correct.includes(o) ? correct.filter((c) => c !== o) : [...correct, o]) : (correct.includes(o) ? [] : [o]);
    onUpdate(element.id, { correctOptions: next });
  };
  return (
    <div className="space-y-2 rounded-xl border border-gold-300 bg-gold-50/40 p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-gold-800">Quiz scoring</p>
      <p className="text-[11px] text-ivory-600">Tick the right answer{multi ? 's' : ''}, give options points, or both.</p>
      {options.map((o) => (
        <div key={o} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={correct.includes(o)} onChange={() => toggleCorrect(o)} aria-label={`${o} is right`} title="Right answer" />
          <span className="min-w-0 flex-1 truncate text-navy-800">{o}</span>
          <input type="number" className="input-field !h-8 w-16 !px-2 text-xs" aria-label={`Points for ${o}`} placeholder="pts" value={f.optionScores?.[o] ?? ''}
            onChange={(e) => {
              const next = { ...(f.optionScores ?? {}) };
              if (e.target.value === '') delete next[o]; else next[o] = Number(e.target.value);
              onUpdate(element.id, { optionScores: next });
            }} />
        </div>
      ))}
      {correct.length > 0 && (
        <label className="flex items-center justify-between text-sm text-navy-700">Points for the right answer
          <input type="number" min={0} className="input-field !h-8 w-16 !px-2 text-xs" value={f.points ?? 1} onChange={(e) => onUpdate(element.id, { points: Number(e.target.value) || 0 })} />
        </label>
      )}
      {quiz.categories.length > 0 && (
        <label className="block text-sm text-navy-700">Category
          <select className="input-field mt-1" value={f.quizCategory ?? ''} onChange={(e) => onUpdate(element.id, { quizCategory: e.target.value || undefined })}>
            <option value="">None</option>
            {quiz.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/** The name this field answers to in a link, so links can fill it in (?key=value). */
export function LinkKeyEditor({ element, onUpdate }: { element: FormElement; onUpdate: (id: string, u: Partial<FieldDefinition>) => void }) {
  const f = element.field!;
  const keys = queryKeysFor(element as FormElement & { field: FieldDefinition });
  return (
    <div>
      <label className={label}>Fill from link (key)</label>
      <input className="input-field" value={f.queryKey ?? ''} onChange={(e) => onUpdate(element.id, { queryKey: e.target.value.trim() || undefined })} placeholder={keys[0]} />
      <p className="mt-1 text-[11px] text-ivory-600">A link ending <code className="rounded bg-ivory-100 px-1">?{f.queryKey || keys[0]}=…</code> fills this in{element.type === 'hidden' ? ' (great for tracking where people came from)' : ''}.</p>
    </div>
  );
}
