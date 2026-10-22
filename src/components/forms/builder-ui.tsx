import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * The form builder's controls, in one calm style: grouped cards with hairline dividers,
 * iOS-style switches, quiet inputs with a blue focus ring, and segmented controls.
 */

export const ink = 'text-[#1D1D1F]';
export const subtle = 'text-[#6E6E73]';

export const inputCls = 'h-9 w-full rounded-[9px] border border-[#D2D2D7] bg-white px-3 text-[13px] text-[#1D1D1F] outline-none transition placeholder:text-[#A1A1A6] focus:border-[#0071E3] focus:ring-[3px] focus:ring-[#0071E3]/15 disabled:bg-[#F5F5F7]';
export const areaCls = cn(inputCls, 'h-auto min-h-[72px] resize-y py-2 leading-relaxed');

/** A titled group of settings, like an iOS settings card. Collapsible when given a title. */
export function Group({ title, hint, children, defaultOpen = true, collapsible = true, className }: {
  title?: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean; collapsible?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn('overflow-hidden rounded-[14px] bg-white ring-1 ring-black/[0.06]', className)}>
      {title && (
        <button type="button" disabled={!collapsible} onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-3.5 pb-2 pt-3 text-left disabled:cursor-default">
          <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6E6E73]">{title}</span>
          {collapsible && <ChevronDown className={cn('h-4 w-4 text-[#A1A1A6] transition-transform', !open && '-rotate-90')} />}
        </button>
      )}
      {open && <div className={cn('space-y-3 px-3.5 pb-3.5', !title && 'pt-3.5')}>{children}</div>}
      {open && hint && <p className="border-t border-black/[0.05] bg-[#FAFAFB] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-[#6E6E73]">{hint}</p>}
    </section>
  );
}

/** A labelled control. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[12px] font-medium text-[#3A3A3C]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] leading-snug text-[#8E8E93]">{hint}</span>}
    </label>
  );
}

/** An on/off row: label (and a line about it) on the left, the switch on the right. */
export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 pt-0.5">
        <p className="text-[13px] font-medium text-[#1D1D1F]">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-[#8E8E93]">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={typeof label === 'string' ? label : undefined} />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40', checked ? 'bg-[#34C759]' : 'bg-[#E3E3E8]')}>
      <span className={cn('absolute left-0 top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
    </button>
  );
}

/** Two to five choices side by side. */
export function Segmented<T extends string | number>({ value, options, onChange, size = 'md', className }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string;
}) {
  return (
    <div role="radiogroup" className={cn('flex rounded-[10px] bg-[#EFEFF2] p-[3px]', className)}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} title={o.title} onClick={() => onChange(o.value)}
          className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-[8px] font-medium transition-all',
            size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]' : 'text-[#6E6E73] hover:text-[#1D1D1F]')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A colour: the swatch opens the picker; the hex can be typed. */
export function ColorField({ value, onChange, placeholder = 'None' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-[9px] ring-1 ring-black/10" style={{ background: value || 'repeating-conic-gradient(#EEF0F3 0% 25%, #fff 0% 50%) 50% / 10px 10px' }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick a colour" />
      </label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(inputCls, 'font-mono text-[12px] uppercase')} />
    </div>
  );
}

/** A quiet button for panels. */
export function PanelButton({ children, onClick, tone = 'default', className, disabled, title }: {
  children: ReactNode; onClick: () => void; tone?: 'default' | 'danger' | 'accent'; className?: string; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={cn('inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium transition-colors disabled:opacity-40',
        tone === 'danger' ? 'text-[#D70015] hover:bg-[#FFF0F0]' : tone === 'accent' ? 'text-[#0066CC] hover:bg-[#EEF5FF]' : 'text-[#1D1D1F] hover:bg-[#F0F0F3]', className)}>
      {children}
    </button>
  );
}
