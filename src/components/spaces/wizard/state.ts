import type { SizeBand, SpaceType, UserRole } from '@/types';
import { recommendedTemplate, templatesFor, BLANK_TEMPLATE_KEY } from '@/spatial/data/templates';
import { slugify, slugProblem } from '@/spatial/slug';

export const TOTAL_STEPS = 7;
export const STEP_NAMES = ['Name', 'Type', 'Team size', 'Layout', 'Invite', 'Avatar', 'Camera & mic'] as const;

export type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'unknown';

export interface WizardState {
  step: number;
  name: string;
  slug: string;
  /** Once the user edits the link themselves, the name stops overwriting it. */
  slugEdited: boolean;
  description: string;
  spaceType: SpaceType;
  sizeBand: SizeBand;
  templateKey: string;
  invites: string[];
  inviteRole: Extract<UserRole, 'member' | 'admin'>;
  assignDesks: boolean;
}

export const initialState: WizardState = {
  step: 1,
  name: '',
  slug: '',
  slugEdited: false,
  description: '',
  spaceType: 'office',
  sizeBand: 'small',
  templateKey: recommendedTemplate('office').key,
  invites: [],
  inviteRole: 'member',
  assignDesks: true,
};

export type WizardAction =
  | { type: 'setName'; name: string }
  | { type: 'setSlug'; slug: string }
  | { type: 'setDescription'; description: string }
  | { type: 'setSpaceType'; spaceType: SpaceType }
  | { type: 'setSizeBand'; sizeBand: SizeBand }
  | { type: 'setTemplate'; templateKey: string }
  | { type: 'setInvites'; invites: string[] }
  | { type: 'setInviteRole'; role: WizardState['inviteRole'] }
  | { type: 'setAssignDesks'; value: boolean }
  | { type: 'goTo'; step: number }
  | { type: 'next' }
  | { type: 'back' };

const clampStep = (n: number) => Math.min(TOTAL_STEPS, Math.max(1, n));
const SPACE_TYPE_KEYS: SpaceType[] = ['office', 'classroom', 'event_hall', 'coaching_studio', 'community_hub'];
const SIZE_BANDS: SizeBand[] = ['solo', 'small', 'medium', 'large', 'xl'];

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.name, slug: state.slugEdited ? state.slug : slugify(action.name) };
    case 'setSlug':
      return { ...state, slug: action.slug, slugEdited: true };
    case 'setDescription':
      return { ...state, description: action.description };
    case 'setSpaceType': {
      if (action.spaceType === state.spaceType) return state;
      // A template belongs to one type; keep a blank floor, otherwise switch to the new type's pick.
      const templateKey = state.templateKey === BLANK_TEMPLATE_KEY
        ? BLANK_TEMPLATE_KEY
        : recommendedTemplate(action.spaceType).key;
      return { ...state, spaceType: action.spaceType, templateKey };
    }
    case 'setSizeBand':
      return { ...state, sizeBand: action.sizeBand };
    case 'setTemplate':
      return { ...state, templateKey: action.templateKey };
    case 'setInvites':
      return { ...state, invites: action.invites };
    case 'setInviteRole':
      return { ...state, inviteRole: action.role };
    case 'setAssignDesks':
      return { ...state, assignDesks: action.value };
    case 'goTo':
      return { ...state, step: clampStep(action.step) };
    case 'next':
      return { ...state, step: clampStep(state.step + 1) };
    case 'back':
      return { ...state, step: clampStep(state.step - 1) };
  }
}

/** Whether the current step's answers are enough to continue. */
export function canContinue(state: WizardState, slugStatus: SlugStatus): boolean {
  switch (state.step) {
    case 1:
      return state.name.trim().length > 0
        && slugProblem(state.slug) === null
        // If the check itself failed we still let them go on; the insert enforces uniqueness.
        && (slugStatus === 'available' || slugStatus === 'unknown');
    case 4:
      return state.templateKey === BLANK_TEMPLATE_KEY
        || templatesFor(state.spaceType).some((t) => t.key === state.templateKey);
    default:
      return true;
  }
}

// ---------- Draft (sessionStorage) ----------

const draftKey = (workspaceId: string) => `synapse.spaceDraft.${workspaceId}`;

/** Reads a saved draft. Storage can be unavailable or hold junk, so every access is guarded. */
export function readDraft(workspaceId: string): WizardState | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    if (!parsed || typeof parsed !== 'object') return null;
    const merged: WizardState = { ...initialState, ...parsed };
    merged.step = clampStep(Number(merged.step) || 1);
    if (!SPACE_TYPE_KEYS.includes(merged.spaceType)) merged.spaceType = initialState.spaceType;
    if (!SIZE_BANDS.includes(merged.sizeBand)) merged.sizeBand = initialState.sizeBand;
    if (merged.inviteRole !== 'admin') merged.inviteRole = 'member';
    for (const k of ['name', 'slug', 'description'] as const) if (typeof merged[k] !== 'string') merged[k] = '';
    merged.invites = Array.isArray(merged.invites) ? merged.invites.filter((e) => typeof e === 'string') : [];
    if (!templatesFor(merged.spaceType).some((t) => t.key === merged.templateKey) && merged.templateKey !== BLANK_TEMPLATE_KEY) {
      merged.templateKey = recommendedTemplate(merged.spaceType).key;
    }
    return merged;
  } catch {
    return null;
  }
}

export function saveDraft(workspaceId: string, state: WizardState): void {
  try {
    window.sessionStorage.setItem(draftKey(workspaceId), JSON.stringify(state));
  } catch {
    /* storage full or blocked: the wizard still works, it just won't survive a refresh */
  }
}

export function clearDraft(workspaceId: string): void {
  try {
    window.sessionStorage.removeItem(draftKey(workspaceId));
  } catch {
    /* nothing to clear */
  }
}

/** A draft is worth offering back only once the user has typed something. */
export function hasMeaningfulDraft(draft: WizardState | null): draft is WizardState {
  return !!draft && (draft.name.trim().length > 0 || draft.step > 1);
}
