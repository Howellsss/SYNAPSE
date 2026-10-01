import { Armchair, DoorClosed, Sofa, Users } from 'lucide-react';
import { SIZE_OPTIONS, setupSummary } from '@/spatial/data/sizing';
import { cn } from '@/lib/utils';
import { StepTitle } from './ui';
import { optionClass } from './styles';
import { effectiveType, type WizardAction, type WizardState } from './state';

const SETUP_ICONS = { desks: Armchair, rooms: DoorClosed, lounges: Sofa, capacity: Users } as const;

export function StepSize({ state, dispatch }: { state: WizardState; dispatch: (a: WizardAction) => void }) {
  return (
    <>
      <StepTitle title="How big is your team?" subtitle="We'll size the floor so everyone has a place. You can grow it later." />
      <div role="radiogroup" aria-label="Team size" className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {SIZE_OPTIONS.map((o) => {
          const selected = state.sizeBand === o.band;
          return (
            <button
              key={o.band}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => dispatch({ type: 'setSizeBand', sizeBand: o.band })}
              className={cn(optionClass(selected), 'flex flex-col items-center justify-center px-2 py-4 text-center', o.band === 'solo' && 'col-span-2 sm:col-span-1')}
            >
              <span className={cn('text-lg font-bold', selected ? 'text-navy-800' : 'text-navy-700')}>{o.label}</span>
              <span className="mt-0.5 text-xs text-ivory-700">{o.band === 'solo' ? '1 person' : 'people'}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-navy-100 bg-ivory-200/30 p-4 sm:p-5">
        <p className="text-sm font-semibold text-navy-800">What we'll set up</p>
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {setupSummary(state.sizeBand, effectiveType(state)).map((item) => {
            const Icon = SETUP_ICONS[item.key as keyof typeof SETUP_ICONS];
            return (
              <li key={item.key} className="flex items-center gap-2.5 text-sm text-navy-700">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-gold-600 ring-1 ring-navy-50"><Icon className="h-4 w-4" /></span>
                {item.text}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
