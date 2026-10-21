import { RECIPES } from './recipes';
import { settingsFrom } from './model';
import { PRESET_KEY, type Preset } from '@/components/workflows/Builder';

/**
 * A new workflow that starts when this form (or survey) is submitted: the "Form submission
 * follow-up" recipe, its trigger set to this form. Opens in the workflow builder as a draft.
 */
export function workflowPresetForForm(formId: string, formName: string, survey: boolean): Preset {
  const recipe = RECIPES.find((r) => r.key === 'form')!;
  const b = recipe.build();
  const triggers = b.triggers.map((t) => ({ ...t, name: `${survey ? 'Survey' : 'Form'}: ${formName}`.slice(0, 80), filters: { ...t.filters, forms: [formId] } }));
  return { name: `${formName} follow-up`.slice(0, 120), notes: recipe.description, triggers, steps: b.steps, settings: settingsFrom(b.settings) };
}

export function openWorkflowForForm(formId: string, formName: string, survey: boolean) {
  try { sessionStorage.setItem(PRESET_KEY, JSON.stringify(workflowPresetForForm(formId, formName, survey))); } catch { /* private mode */ }
  window.location.hash = '/workflows/new';
}
