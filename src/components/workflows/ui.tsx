import { useId, useState, type ReactNode } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { TONE, type Tone } from '@/workflows/catalog';
import { cn } from '@/lib/utils';

/** A small rounded square with an icon, coloured like an Apple app icon. */
export function Chip({ tone, icon: Icon, size = 'md' }: { tone: Tone; icon: React.ComponentType<{ className?: string }>; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]', TONE[tone],
      size === 'sm' ? 'h-7 w-7 rounded-lg' : size === 'lg' ? 'h-11 w-11 rounded-[12px]' : 'h-9 w-9 rounded-[10px]')}>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-[18px] w-[18px]'} />
    </span>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-navy-900">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-ivory-700">{hint}</p>}
    </div>
  );
}

export const inputCls = 'h-10 w-full rounded-[10px] bg-white px-3 text-sm text-navy-900 ring-1 ring-inset ring-navy-100 placeholder:text-ivory-600 focus:outline-none focus:ring-2 focus:ring-gold-400';
export const areaCls = 'min-h-[110px] w-full rounded-[10px] bg-white px-3 py-2.5 text-sm text-navy-900 ring-1 ring-inset ring-navy-100 placeholder:text-ivory-600 focus:outline-none focus:ring-2 focus:ring-gold-400';

export function TextInput({ label, value, onChange, placeholder, hint, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; type?: string }) {
  const id = useId();
  return <Field label={label} hint={hint} htmlFor={id}><input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} /></Field>;
}

export function TextArea({ label, value, onChange, placeholder, hint, rows }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: ReactNode; rows?: number }) {
  const id = useId();
  return <Field label={label} hint={hint} htmlFor={id}><textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={areaCls} /></Field>;
}

export function Select({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'pr-8')}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/** iOS-style segmented control. */
export function Segmented<T extends string>({ label, value, onChange, options }: { label?: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div>
      {label && <p className="mb-1.5 text-[13px] font-semibold text-navy-900">{label}</p>}
      <div role="radiogroup" aria-label={label} className="flex rounded-[10px] bg-navy-50 p-[3px]">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
            className={cn('flex-1 rounded-[8px] px-2.5 py-1.5 text-[13px] font-semibold transition', value === o.value ? 'bg-white text-navy-900 shadow-[0_1px_2px_rgba(13,28,59,0.14)]' : 'text-navy-600 hover:text-navy-900')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** iOS-style switch with a label and a line of explanation. */
export function Switch({ label, description, checked, onChange }: { label: string; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-navy-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ivory-700">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex h-[26px] w-[44px] shrink-0 rounded-full transition', checked ? 'bg-green-600' : 'bg-navy-100')}>
        <span className={cn('absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[21px]' : 'left-[3px]')} />
      </button>
    </label>
  );
}

/** Tags: pick from the account's tags or type a new one. */
export function TagInput({ label, value, onChange, options, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; options: string[]; hint?: ReactNode }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setDraft('');
  };
  const suggestions = options.filter((o) => !value.some((v) => v.toLowerCase() === o.toLowerCase()) && (!draft || o.toLowerCase().includes(draft.toLowerCase()))).slice(0, 8);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="rounded-[10px] bg-white p-1.5 ring-1 ring-inset ring-navy-100 focus-within:ring-2 focus-within:ring-gold-400">
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-gold-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-navy-900 ring-1 ring-inset ring-gold-200">
              {t}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="rounded-full p-0.5 hover:bg-gold-100"><X className="h-3 w-3" /></button>
            </span>
          ))}
          <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }}
            placeholder={value.length ? 'Add another' : 'Type a tag and press Enter'} className="min-w-[140px] flex-1 bg-transparent px-1.5 py-1 text-sm focus:outline-none" />
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><Plus className="h-3 w-3" />{s}</button>
          ))}
        </div>
      )}
    </Field>
  );
}

/** Tick any number of options (users, forms, calendars, statuses…). Nothing ticked = any. */
export function MultiPick({ label, value, onChange, options, empty, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; options: { value: string; label: string }[]; empty?: string; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      {options.length === 0 ? <p className="rounded-[10px] bg-navy-50 px-3 py-2.5 text-xs text-ivory-700">{empty ?? 'Nothing to choose yet.'}</p> : (
        <div role="group" aria-label={label} className="max-h-56 divide-y divide-navy-50 overflow-y-auto rounded-[10px] ring-1 ring-inset ring-navy-100">
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button key={o.value} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-navy-900 hover:bg-navy-50">
                <span className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] ring-1 ring-inset', on ? 'bg-navy-800 text-white ring-navy-800' : 'ring-navy-200')}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </Field>
  );
}

const MERGE_FIELDS = ['{{contact.first_name}}', '{{contact.last_name}}', '{{contact.name}}', '{{contact.email}}', '{{contact.phone}}', '{{contact.company}}'];

/** Click to insert a merge field at the end of a text. */
export function MergeFields({ onPick }: { onPick: (f: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MERGE_FIELDS.map((f) => (
        <button key={f} type="button" onClick={() => onPick(f)} className="rounded-md bg-navy-50 px-2 py-1 font-mono text-[11px] text-navy-700 hover:bg-navy-100">{f.replace('{{contact.', '').replace('}}', '')}</button>
      ))}
    </div>
  );
}
