import { LayoutGrid } from 'lucide-react';
import { templatesFor, BLANK_TEMPLATE_KEY } from '@/spatial/data/templates';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { SpacePreview } from '../SpacePreview';
import { StepTitle, SelectedMark } from './ui';
import { optionClass } from './styles';
import { effectiveType, type WizardAction, type WizardState } from './state';

export function StepLayout({ state, dispatch }: { state: WizardState; dispatch: (a: WizardAction) => void }) {
  const spaceType = effectiveType(state);
  const type = spaceTypeInfo(spaceType);
  const templates = templatesFor(spaceType);
  const blank = state.templateKey === BLANK_TEMPLATE_KEY;
  return (
    <>
      <StepTitle title="Choose a layout" subtitle={`Starting floors for a ${type.name.toLowerCase()}. You can move things around later.`} />
      <div role="radiogroup" aria-label="Layout" className="grid gap-3 sm:grid-cols-3">
        {templates.map((t, i) => {
          const selected = state.templateKey === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => dispatch({ type: 'setTemplate', templateKey: t.key })}
              className={`${optionClass(selected)} flex flex-col p-2.5`}
            >
              <span className="relative block">
                <SpacePreview title={t.name} icon={type.icon} size="sm" showLabel={false} />
                {i === 0 && (
                  <span className="absolute left-2 top-2 rounded-full bg-gold-400 px-2 py-0.5 text-[11px] font-bold text-white">Recommended</span>
                )}
              </span>
              <span className="mt-2.5 flex items-start justify-between gap-2 px-1">
                <span className="min-w-0">
                  <span className="block font-semibold text-navy-800">{t.name}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-ivory-700">{t.description}</span>
                </span>
                <SelectedMark selected={selected} />
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => dispatch({ type: 'setTemplate', templateKey: BLANK_TEMPLATE_KEY })}
        aria-pressed={blank}
        className={`mt-4 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold ${blank ? 'text-gold-700' : 'text-navy-700 hover:text-gold-700'}`}
      >
        <LayoutGrid className="h-4 w-4" />
        {blank ? 'Starting from a blank floor' : 'Start from a blank floor'}
      </button>
    </>
  );
}
