import { CheckCircle2, Info, Users } from 'lucide-react';
import { CUSTOMISE_NOTE, type SpaceTypeInfo } from '@/spatial/data/spaceTypes';
import { TypeArt } from '../TypeArt';
import { cn } from '@/lib/utils';

/** "Workspace at a glance" for the selected type (desktop side panel, and inline on phones). */
export function GlancePanel({ info, className, compact }: { info: SpaceTypeInfo; className?: string; compact?: boolean }) {
  return (
    <div className={cn('text-white', className)}>
      <p className={cn('font-bold', compact ? 'text-base' : 'text-xl')}>Workspace at a glance</p>
      <div className="mt-4 aspect-[16/10] overflow-hidden rounded-xl bg-white p-2">
        <TypeArt info={info} eager light />
      </div>
      <p className="mt-5 flex items-center gap-2.5 text-xl font-bold">
        <info.icon className="h-6 w-6 text-gold-400" /> {info.name}
        {info.comingSoon && <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-ivory-200">Coming soon</span>}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ivory-300">{info.description}</p>

      <p className="mt-5 text-sm font-semibold">Best for</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {info.bestFor.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5 rounded-md border border-gold-400/70 px-3 py-1 text-xs font-medium text-ivory-100">
            <b.icon className="h-3.5 w-3.5 text-gold-400" /> {b.label}
          </span>
        ))}
      </div>

      <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ivory-200">
        <Users className="h-4 w-4 text-gold-400" /> Recommended team size: <strong className="text-base text-white">{info.recommendedTeamSize}</strong>
      </p>

      <p className="mt-5 text-sm font-semibold">Key features</p>
      <ul className="mt-2 space-y-2">
        {info.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-ivory-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 fill-gold-400 text-navy-800" /> {f}
          </li>
        ))}
      </ul>

      <p className="mt-5 flex items-start gap-2.5 rounded-xl bg-white/[0.06] px-3.5 py-3 text-xs leading-relaxed text-ivory-200 ring-1 ring-white/10">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ivory-500" /> {CUSTOMISE_NOTE}
      </p>
    </div>
  );
}
