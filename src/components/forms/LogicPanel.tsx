import { GitBranch, Plus, Trash2 } from 'lucide-react';
import type { FormDefinition, FormLogicRule, LogicCondition, LogicOperator } from '@/lib/form-builder-types';
import { fieldElements, orderedElements, ruleConditions } from '@/lib/form-engine';

const OPERATORS: { v: LogicOperator; label: string; needsValue: boolean }[] = [
  { v: 'equals', label: 'is', needsValue: true },
  { v: 'not_equals', label: 'is not', needsValue: true },
  { v: 'contains', label: 'contains', needsValue: true },
  { v: 'not_contains', label: 'doesn’t contain', needsValue: true },
  { v: 'starts_with', label: 'starts with', needsValue: true },
  { v: 'greater_than', label: 'is more than', needsValue: true },
  { v: 'less_than', label: 'is less than', needsValue: true },
  { v: 'is_not_empty', label: 'is answered', needsValue: false },
  { v: 'is_empty', label: 'is not answered', needsValue: false },
];

const ACTIONS: { v: FormLogicRule['action']; label: string; help: string }[] = [
  { v: 'show', label: 'Show', help: 'Hidden until this matches.' },
  { v: 'hide', label: 'Hide', help: 'Hidden while this matches.' },
  { v: 'require', label: 'Make required', help: 'Must be answered while this matches.' },
  { v: 'set_value', label: 'Set the answer of', help: 'Fills a field in for them (handy with hidden fields).' },
  { v: 'navigate', label: 'Jump to page', help: 'Skips ahead to a page or slide when they press Next.' },
  { v: 'disqualify', label: 'Disqualify', help: 'Ends the form with a message (the response is still saved, marked disqualified).' },
  { v: 'redirect', label: 'Send them to a link', help: 'After they submit, go to this address instead of the thank-you page.' },
];

const newId = () => `rule_${Math.random().toString(36).slice(2, 9)}`;
const label = 'block text-xs font-medium text-navy-700 mb-1';

/**
 * Logic: "When … (all / any of these) then …". Show, hide or require a question, set an answer,
 * jump to a page, disqualify, or send them to a link. Rules run top to bottom.
 */
export function LogicPanel({ definition, onChange }: { definition: FormDefinition; onChange: (logic: FormLogicRule[]) => void }) {
  const rules = definition.logic ?? [];
  const fields = fieldElements(definition).filter((el) => el.type !== 'payment');
  const targets = orderedElements(definition).filter((el) => el.type !== 'spacer' && el.type !== 'divider');
  const pages = definition.pages;
  const set = (i: number, u: Partial<FormLogicRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...u } : r)));
  const setConditions = (i: number, cs: LogicCondition[]) => set(i, { conditions: cs, triggerFieldId: cs[0]?.fieldId ?? '', operator: cs[0]?.operator ?? 'equals', triggerValue: cs[0]?.value ?? '' });
  const add = () => {
    const first = fields[0];
    onChange([...rules, {
      id: newId(), action: 'show', targetElementId: targets.find((t) => t.id !== first?.id)?.id ?? '',
      triggerFieldId: first?.field.fieldId ?? '', operator: 'equals', triggerValue: '', match: 'all',
      conditions: [{ fieldId: first?.field.fieldId ?? '', operator: 'equals', value: '' }],
    }]);
  };
  const elLabel = (id: string) => { const el = definition.elements[id]; return el?.field?.label || el?.content?.text || el?.displayLabel || 'Element'; };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F2F2F5]">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6 pb-28 sm:p-8 sm:pb-28">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-navy-800">Logic</h2>
            <p className="text-sm text-ivory-600">Change the form as people answer. Rules run top to bottom. Try them in Preview.</p>
          </div>
          <button type="button" onClick={add} disabled={!fields.length} className="btn-primary btn-sm"><Plus className="h-4 w-4" /> Add rule</button>
        </div>

        {!fields.length && <p className="rounded-xl bg-white p-6 text-center text-sm text-ivory-600">Add a question first, then make rules that react to its answer.</p>}
        {fields.length > 0 && !rules.length && (
          <div className="rounded-2xl border border-dashed border-navy-200 bg-white p-8 text-center">
            <GitBranch className="mx-auto h-8 w-8 text-ivory-500" />
            <p className="mt-2 font-semibold text-navy-800">No rules yet</p>
            <p className="mt-1 text-sm text-ivory-600">For example: when “Budget” is “Under $1k”, disqualify; or when “Interested in” is “Training”, show the training questions.</p>
          </div>
        )}

        {rules.map((r, i) => {
          const conds = ruleConditions(r).length ? ruleConditions(r) : [{ fieldId: fields[0]?.field.fieldId ?? '', operator: 'equals' as const, value: '' }];
          const action = ACTIONS.find((a) => a.v === r.action);
          return (
            <section key={r.id} className="space-y-3 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(9,21,48,0.08),0_0_0_1px_#E8EBF0]" aria-label={`Rule ${i + 1}`}>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-navy-800 px-2 py-0.5 text-xs font-bold text-white">Rule {i + 1}</span>
                <span className="flex-1" />
                <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label={`Delete rule ${i + 1}`} className="rounded-md p-1.5 text-ivory-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>

              <div className="space-y-2">
                {conds.map((c, k) => {
                  const fieldEl = fields.find((f) => f.field.fieldId === c.fieldId);
                  const options = fieldEl?.field.options;
                  const op = OPERATORS.find((o) => o.v === c.operator);
                  const update = (u: Partial<LogicCondition>) => setConditions(i, conds.map((x, j) => (j === k ? { ...x, ...u } : x)));
                  return (
                    <div key={k} className="flex flex-wrap items-center gap-2">
                      <span className="w-14 text-sm font-semibold text-navy-700">{k === 0 ? 'When' : r.match === 'any' ? 'or' : 'and'}</span>
                      <select aria-label="Question" className="input-field !w-auto min-w-[160px] flex-1" value={c.fieldId} onChange={(e) => update({ fieldId: e.target.value, value: '' })}>
                        {fields.map((f) => <option key={f.field.fieldId} value={f.field.fieldId}>{f.field.label}</option>)}
                      </select>
                      <select aria-label="Condition" className="input-field !w-auto" value={c.operator} onChange={(e) => update({ operator: e.target.value as LogicOperator })}>
                        {OPERATORS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                      </select>
                      {op?.needsValue && (options?.length && (c.operator === 'equals' || c.operator === 'not_equals')
                        ? <select aria-label="Answer" className="input-field !w-auto min-w-[120px]" value={c.value} onChange={(e) => update({ value: e.target.value })}><option value="">Choose…</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                        : <input aria-label="Answer" className="input-field !w-auto min-w-[120px] flex-1" value={c.value} onChange={(e) => update({ value: e.target.value })} placeholder="Answer" />)}
                      {conds.length > 1 && <button type="button" onClick={() => setConditions(i, conds.filter((_, j) => j !== k))} aria-label="Remove condition" className="rounded-md p-1 text-ivory-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2 pl-16">
                  <button type="button" onClick={() => setConditions(i, [...conds, { fieldId: fields[0]?.field.fieldId ?? '', operator: 'equals', value: '' }])} className="btn-ghost btn-sm"><Plus className="h-3.5 w-3.5" /> Add condition</button>
                  {conds.length > 1 && (
                    <select aria-label="Match" className="input-field !h-8 !w-auto text-xs" value={r.match ?? 'all'} onChange={(e) => set(i, { match: e.target.value as 'all' | 'any' })}>
                      <option value="all">All must match</option><option value="any">Any one matches</option>
                    </select>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
                <span className="w-14 text-sm font-semibold text-navy-700">Then</span>
                <select aria-label="Action" className="input-field !w-auto" value={r.action} onChange={(e) => {
                  const action = e.target.value as FormLogicRule['action'];
                  // Require and Set value need a field: move off a heading or picture.
                  const needsField = action === 'require' || action === 'set_value';
                  const ok = targets.find((t) => t.id === r.targetElementId && (!needsField || t.field));
                  set(i, { action, ...(ok ? {} : { targetElementId: (needsField ? targets.find((t) => t.field) : targets[0])?.id ?? '' }) });
                }}>
                  {ACTIONS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
                </select>
                {['show', 'hide', 'require', 'set_value'].includes(r.action) && (
                  <select aria-label="Target" className="input-field !w-auto min-w-[160px] flex-1" value={r.targetElementId} onChange={(e) => set(i, { targetElementId: e.target.value })}>
                    {(r.action === 'show' || r.action === 'hide' ? targets : targets.filter((t) => t.field)).map((t) => <option key={t.id} value={t.id}>{elLabel(t.id)}</option>)}
                  </select>
                )}
                {r.action === 'navigate' && (
                  <select aria-label="Page" className="input-field !w-auto min-w-[160px]" value={r.targetPageId ?? ''} onChange={(e) => set(i, { targetPageId: e.target.value })}>
                    <option value="">Choose a page…</option>
                    {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {r.action === 'set_value' && <input aria-label="Value" className="input-field !w-auto min-w-[120px]" value={r.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} placeholder="Value" />}
              </div>
              {r.action === 'disqualify' && (
                <div className="grid gap-2 pl-0 sm:grid-cols-2 sm:pl-16">
                  <div><label className={label}>Message they see</label><textarea className="input-field min-h-[60px]" value={r.message ?? ''} onChange={(e) => set(i, { message: e.target.value })} placeholder="Thanks for your interest. Unfortunately you don’t qualify right now." /></div>
                  <div><label className={label}>Or send them to (optional)</label><input className="input-field" value={r.redirectUrl ?? ''} onChange={(e) => set(i, { redirectUrl: e.target.value })} placeholder="https://" /></div>
                </div>
              )}
              {r.action === 'redirect' && (
                <div className="pl-0 sm:pl-16"><label className={label}>Link</label><input className="input-field" value={r.redirectUrl ?? ''} onChange={(e) => set(i, { redirectUrl: e.target.value })} placeholder="https://" /></div>
              )}
              {action && <p className="text-xs text-ivory-600 sm:pl-16">{action.help}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
