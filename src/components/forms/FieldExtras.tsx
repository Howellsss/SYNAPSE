import { Plus, Trash2 } from 'lucide-react';
import type { FieldDefinition, FormElement, PaymentConfig, QuizSettings } from '@/lib/form-builder-types';
import { queryKeysFor } from '@/lib/form-engine';

const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'ngn', 'ghs', 'kes', 'zar', 'inr', 'aed'];
const label = 'block text-xs font-medium text-navy-700 mb-1';
const newId = () => Math.random().toString(36).slice(2, 9);

/** Payment element: a set price, products to pick from, or an amount they type (donations). */
export function PaymentEditor({ element, onUpdate }: { element: FormElement; onUpdate: (id: string, u: Partial<FieldDefinition>) => void }) {
  const cfg: PaymentConfig = element.field?.payment ?? { mode: 'fixed', currency: 'usd', amount: 50 };
  const set = (u: Partial<PaymentConfig>) => onUpdate(element.id, { payment: { ...cfg, ...u } });
  const products = cfg.products ?? [];
  const setProduct = (i: number, u: Partial<(typeof products)[number]>) => set({ products: products.map((p, j) => (j === i ? { ...p, ...u } : p)) });
  return (
    <div className="space-y-3 rounded-xl border border-navy-100 p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-ivory-500">Payment</p>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-ivory-50 p-1">
        {(['fixed', 'products', 'custom'] as const).map((m) => (
          <button key={m} type="button" onClick={() => set({ mode: m, products: m === 'products' && !products.length ? [{ id: newId(), name: 'Product', price: 25 }] : cfg.products })}
            className={`rounded-md py-1.5 text-xs font-semibold ${cfg.mode === m ? 'bg-navy-800 text-white' : 'text-navy-700'}`}>
            {m === 'fixed' ? 'Set price' : m === 'products' ? 'Products' : 'They choose'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>Currency</label>
          <select className="input-field" value={cfg.currency} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
        </div>
        {cfg.mode === 'fixed' && (
          <div><label className={label}>Amount</label><input type="number" min={0} step="0.01" className="input-field" value={cfg.amount ?? ''} onChange={(e) => set({ amount: Number(e.target.value) || 0 })} /></div>
        )}
        {cfg.mode === 'custom' && (
          <div><label className={label}>Smallest amount</label><input type="number" min={0} step="0.01" className="input-field" value={cfg.minAmount ?? ''} onChange={(e) => set({ minAmount: Number(e.target.value) || 0 })} /></div>
        )}
      </div>
      <div><label className={label}>What it’s for (shown at checkout)</label><input className="input-field" value={cfg.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Workshop ticket" /></div>
      {cfg.mode === 'custom' && (
        <div><label className={label}>Suggested amounts (comma separated)</label>
          <input className="input-field" value={(cfg.suggested ?? []).join(', ')} onChange={(e) => set({ suggested: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) })} placeholder="10, 25, 50" /></div>
      )}
      {cfg.mode === 'products' && (
        <>
          {products.map((p, i) => (
            <div key={p.id} className="space-y-1.5 rounded-lg bg-ivory-50 p-2">
              <div className="flex gap-1.5">
                <input className="input-field flex-1" value={p.name} aria-label="Product name" onChange={(e) => setProduct(i, { name: e.target.value })} />
                <input type="number" min={0} step="0.01" className="input-field w-20" value={p.price} aria-label="Price" onChange={(e) => setProduct(i, { price: Number(e.target.value) || 0 })} />
                <button type="button" onClick={() => set({ products: products.filter((_, j) => j !== i) })} aria-label="Remove product" className="rounded-md p-1.5 text-ivory-500 hover:bg-white hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
              <input className="input-field" value={p.description ?? ''} placeholder="Short description (optional)" onChange={(e) => setProduct(i, { description: e.target.value })} />
            </div>
          ))}
          <button type="button" onClick={() => set({ products: [...products, { id: newId(), name: 'Product', price: 25 }] })} className="btn-ghost btn-sm"><Plus className="h-3.5 w-3.5" /> Add product</button>
          <label className="flex items-center justify-between text-sm text-navy-700">They can pick more than one <input type="checkbox" checked={!!cfg.multiple} onChange={(e) => set({ multiple: e.target.checked })} /></label>
          <label className="flex items-center justify-between text-sm text-navy-700">They choose how many <input type="checkbox" checked={!!cfg.quantity} onChange={(e) => set({ quantity: e.target.checked })} /></label>
        </>
      )}
      <p className="text-[11px] leading-relaxed text-ivory-600">They pay by card on Stripe’s secure page after submitting. Needs your Stripe secret key in Supabase (STRIPE_SECRET_KEY).</p>
    </div>
  );
}

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
