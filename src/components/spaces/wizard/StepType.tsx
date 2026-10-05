import { Check } from 'lucide-react';
import { SPACE_TYPE_CHOICES, typeChoiceInfo } from '@/spatial/data/spaceTypes';
import { cn } from '@/lib/utils';
import { TypeArt } from '../TypeArt';
import { StepTitle } from './ui';
import { GlancePanel } from './GlancePanel';
import type { WizardAction, WizardState } from './state';

export function StepType({ state, dispatch }: { state: WizardState; dispatch: (a: WizardAction) => void }) {
  return (
    <>
      <StepTitle title="Choose a workspace type" subtitle="Select the type of workspace that best fits your goals. You can customise everything later." />
      <div role="radiogroup" aria-label="Workspace type" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SPACE_TYPE_CHOICES.map((t) => {
          const selected = state.typeChoice === t.key;
          const disabled = !!t.comingSoon;
          return (
            <div key={t.key} className="contents">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => dispatch({ type: 'setTypeChoice', choice: t.key })}
                className={cn(
                  'relative flex items-stretch gap-3 overflow-hidden rounded-2xl border bg-white p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60',
                  selected ? 'border-gold-400 shadow-[0_0_0_3px_rgba(228,169,60,0.18)]' : 'border-navy-100',
                  disabled ? 'cursor-not-allowed bg-ivory-200/20' : !selected && 'hover:border-navy-200 hover:shadow-card-hover',
                )}
              >
                <span className="relative block aspect-[4/3] w-[42%] max-w-[150px] shrink-0 overflow-hidden rounded-xl bg-navy-800">
                  <TypeArt info={t} />
                </span>
                <span className="min-w-0 flex-1 py-1 pr-1">
                  <t.icon className={cn('h-5 w-5', disabled ? 'text-ivory-600' : 'text-gold-600')} />
                  <span className={cn('mt-1.5 block font-bold leading-tight', disabled ? 'text-ivory-700' : 'text-navy-800')}>{t.name}</span>
                  <span className="mt-1 line-clamp-3 block text-xs leading-snug text-ivory-700">{t.description}</span>
                </span>
                {selected && (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-gold-400 text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                {disabled && (
                  <span className="absolute right-2 top-2 rounded-full bg-ivory-200 px-2 py-0.5 text-[11px] font-semibold text-ivory-800">Coming soon</span>
                )}
              </button>
              {/* On phones the details sit right under the chosen card. */}
              {selected && (
                <div className="rounded-2xl bg-navy-800 p-5 sm:col-span-2 lg:hidden">
                  <GlancePanel info={typeChoiceInfo(t.key)} compact />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
