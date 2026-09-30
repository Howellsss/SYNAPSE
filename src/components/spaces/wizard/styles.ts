import { cn } from '@/lib/utils';

/** Border and glow for a selectable option card. */
export const optionClass = (selected: boolean) => cn(
  'w-full rounded-2xl border bg-white text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60',
  selected ? 'border-gold-400 shadow-[0_0_0_3px_rgba(228,169,60,0.18)]' : 'border-navy-100 hover:border-navy-200 hover:shadow-card-hover',
);
