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
      <div role="radiogroup" aria-label="Workspace type" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                  'relative flex min-h-[168px] items-center gap-3 overflow-hidden rounded-xl border-2 bg-white p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60',
                  selected ? 'border-gold-400 shadow-[0_0_0_3px_rgba(228,169,60,0.15)]' : 'border-transparent ring-1 ring-inset ring-navy-100',
                  disabled ? 'cursor-not-allowed' : !selected && 'hover:ring-navy-200 hover:shadow-card-hover',
                )}
              >
                <span className="relative block aspect-square w-[40%] max-w-[136px] shrink-0">
                  <TypeArt info={t} light />
                </span>
                <span className="min-w-0 flex-1 pr-1">
                  <t.icon className={cn('h-6 w-6', disabled ? 'text-ivory-500' : selected ? 'text-gold-600' : 'text-navy-800')} />
                  <span className={cn('mt-2 block text-[16px] font-bold leading-tight', disabled ? 'text-ivory-600' : 'text-navy-900')}>{t.name}</span>
                  <span className={cn('mt-1.5 line-clamp-4 block text-[13px] leading-snug', disabled ? 'text-ivory-500' : 'text-ivory-700')}>{t.description}</span>
                </span>
                {selected && (
                  <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-gold-400 text-white">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                )}
                {disabled && (
                  <span className="absolute right-2.5 top-2.5 rounded-md bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">Coming soon</span>
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
