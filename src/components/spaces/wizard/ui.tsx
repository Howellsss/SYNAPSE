import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold leading-tight text-navy-800 sm:text-[28px]">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-ivory-700 sm:text-base">{subtitle}</p>}
    </div>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold text-navy-800">
      <span>{children}</span>
      {hint && <span className="text-xs font-normal text-ivory-600">{hint}</span>}
    </label>
  );
}

/** The round tick on selectable cards. */
export function SelectedMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition',
        selected ? 'border-gold-400 bg-gold-400 text-navy-900' : 'border-navy-100 bg-white',
      )}
    >
      {selected && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

/** Small navy square with an icon, used as a thumbnail in lists. */
export function Thumb({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-navy-700 to-navy-900 text-gold-400', className)}>
      {children}
    </span>
  );
}
