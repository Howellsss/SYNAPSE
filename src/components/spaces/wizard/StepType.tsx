import { SPACE_TYPES } from '@/spatial/data/spaceTypes';
import { StepTitle, SelectedMark, Thumb } from './ui';
import { optionClass } from './styles';
import type { WizardAction, WizardState } from './state';

export function StepType({ state, dispatch }: { state: WizardState; dispatch: (a: WizardAction) => void }) {
  return (
    <>
      <StepTitle title="What kind of workspace?" subtitle="Pick the one closest to how you'll use it. Each comes with its own furniture and rooms." />
      <div role="radiogroup" aria-label="Workspace type" className="space-y-2.5">
        {SPACE_TYPES.map((t) => {
          const selected = state.spaceType === t.type;
          return (
            <button
              key={t.type}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => dispatch({ type: 'setSpaceType', spaceType: t.type })}
              className={`${optionClass(selected)} flex items-center gap-3.5 p-3`}
            >
              <Thumb className="h-12 w-14"><t.icon className="h-5 w-5" /></Thumb>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-navy-800">{t.name}</span>
                <span className="block text-sm text-ivory-700">{t.description}</span>
              </span>
              <SelectedMark selected={selected} />
            </button>
          );
        })}
      </div>
    </>
  );
}
