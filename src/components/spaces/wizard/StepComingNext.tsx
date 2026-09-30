import type { LucideIcon } from 'lucide-react';
import { StepTitle } from './ui';

/** Steps 6 and 7 until the avatar builder and the camera check exist. */
export function StepComingNext({ title, subtitle, icon: Icon, cardTitle, cardText }: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  cardTitle: string;
  cardText: string;
}) {
  return (
    <>
      <StepTitle title={title} subtitle={subtitle} />
      <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-navy-100 bg-ivory-200/20 px-6 py-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-800 text-gold-400"><Icon className="h-7 w-7" /></span>
        <p className="mt-4 font-semibold text-navy-800">{cardTitle}</p>
        <p className="mt-1 max-w-sm text-sm text-ivory-700">{cardText}</p>
        <span className="mt-4 rounded-full bg-gold-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold-700">Coming next</span>
      </div>
    </>
  );
}
