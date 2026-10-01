import type {
  AccessMode, Persistence, SizeBand, SpaceBranding, SpacePermissions, SpaceRoom, SpaceSchedule, SpaceType, UserRole,
} from '@/types';
import { recommendedTemplate, templatesFor, BLANK_TEMPLATE_KEY } from '@/spatial/data/templates';
import { SPACE_TYPE_CHOICES, typeChoiceInfo, type TypeChoice } from '@/spatial/data/spaceTypes';
import { buildRooms, MAX_ROOM_CAPACITY } from '@/spatial/data/rooms';
import { DEFAULT_SCHEDULE, scheduleProblem } from '@/spatial/schedule';
import type { LayoutFile } from '@/spatial/layoutFile';
import { slugify, slugProblem } from '@/spatial/slug';

// ---------- Steps ----------

export type StepId = 'name' | 'type' | 'size' | 'layout' | 'import' | 'configure' | 'invite' | 'avatar' | 'media';

export const STEP_LABELS: Record<StepId, string> = {
  name: 'Name',
  type: 'Type',
  size: 'Team size',
  layout: 'Layout',
  import: 'Import',
  configure: 'Configure',
  invite: 'Invite',
  avatar: 'Avatar',
  media: 'Camera & mic',
};

const TAIL: StepId[] = ['configure', 'invite', 'avatar', 'media'];

/**
 * Step order for the chosen type:
 * template types: Name, Type, Size, Layout, Configure, Invite, Avatar, Camera (8)
 * Custom Space:   Name, Type, Size, Configure, Invite, Avatar, Camera (7) — empty floor sized by team
 * Import:         Name, Type, Import, Configure, Invite, Avatar, Camera (7)
 */
export function stepsFor(choice: TypeChoice): StepId[] {
  const flow = typeChoiceInfo(choice).flow;
  if (flow === 'custom') return ['name', 'type', 'size', ...TAIL];
  if (flow === 'import') return ['name', 'type', 'import', ...TAIL];
  return ['name', 'type', 'size', 'layout', ...TAIL];
}

export type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'unknown';

// ---------- State ----------

export interface WizardState {
  step: StepId;
  name: string;
  slug: string;
  /** Once the user edits the link themselves, the name stops overwriting it. */
  slugEdited: boolean;
  description: string;
  typeChoice: TypeChoice;
  sizeBand: SizeBand;
  templateKey: string;
  importedLayout: LayoutFile | null;
  importFileName: string | null;
  /** Edited rooms. null = use the rooms built from the template/size (or the imported file). */
  rooms: SpaceRoom[] | null;
  accessMode: AccessMode;
  guestLinkToken: string | null;
  permissions: SpacePermissions;
  persistence: Persistence;
  /** Kept even while "always on" so switching back to scheduled keeps the times. */
  schedule: SpaceSchedule;
  branding: SpaceBranding;
  invites: string[];
  inviteRole: Extract<UserRole, 'member' | 'admin'>;
  assignDesks: boolean;
}

const browserTimezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

function withTypeDefaults(state: WizardState, choice: TypeChoice): WizardState {
  const info = typeChoiceInfo(choice);
  const d = info.defaults;
  return {
    ...state,
    typeChoice: choice,
    accessMode: d.access_mode,
    persistence: d.persistence,
    permissions: { ...d.permissions },
    templateKey: info.flow === 'template' && info.type ? recommendedTemplate(info.type).key : BLANK_TEMPLATE_KEY,
    rooms: null,
  };
}

export const initialState: WizardState = withTypeDefaults({
  step: 'name',
  name: '',
  slug: '',
  slugEdited: false,
  description: '',
  typeChoice: 'office',
  sizeBand: 'small',
  templateKey: recommendedTemplate('office').key,
  importedLayout: null,
  importFileName: null,
  rooms: null,
  accessMode: 'members',
  guestLinkToken: null,
  permissions: { edit_office: ['owner', 'admin'], lock_rooms: ['owner', 'admin'], broadcast: ['owner', 'admin'], invite: ['owner', 'admin'] },
  persistence: 'always_on',
  schedule: DEFAULT_SCHEDULE('UTC'),
  branding: {},
  invites: [],
  inviteRole: 'member',
  assignDesks: true,
}, 'office');

/** A fresh state using the browser's timezone for schedules. */
export function freshState(): WizardState {
  return { ...initialState, schedule: DEFAULT_SCHEDULE(browserTimezone()) };
}

// ---------- Derived values ----------

/** The space_type that will be saved. */
export function effectiveType(state: WizardState): SpaceType {
  if (state.typeChoice === 'import') return state.importedLayout?.space_type ?? 'custom';
  return typeChoiceInfo(state.typeChoice).type ?? 'office';
}

export function effectiveTemplateKey(state: WizardState): string {
  if (state.typeChoice === 'import') return state.importedLayout?.template_key ?? BLANK_TEMPLATE_KEY;
  if (typeChoiceInfo(state.typeChoice).flow === 'custom') return BLANK_TEMPLATE_KEY;
  return state.templateKey;
}

export function effectiveSizeBand(state: WizardState): SizeBand {
  return (state.typeChoice === 'import' && state.importedLayout?.size_band) || state.sizeBand;
}

/** The rooms the space will be created with. */
export function effectiveRooms(state: WizardState): SpaceRoom[] {
  if (state.rooms) return state.rooms;
  if (state.typeChoice === 'import') return state.importedLayout?.config.rooms ?? [];
  return buildRooms(effectiveTemplateKey(state), state.sizeBand);
}

// ---------- Reducer ----------

export type WizardAction =
  | { type: 'setName'; name: string }
  | { type: 'setSlug'; slug: string }
  | { type: 'setDescription'; description: string }
  | { type: 'setTypeChoice'; choice: TypeChoice }
  | { type: 'setSizeBand'; sizeBand: SizeBand }
  | { type: 'setTemplate'; templateKey: string }
  | { type: 'setImported'; layout: LayoutFile; fileName: string }
  | { type: 'clearImport' }
  | { type: 'setRooms'; rooms: SpaceRoom[] }
  | { type: 'resetRooms' }
  | { type: 'setAccessMode'; mode: AccessMode }
  | { type: 'setGuestToken'; token: string }
  | { type: 'setPermissions'; permissions: SpacePermissions }
  | { type: 'setPersistence'; persistence: Persistence }
  | { type: 'setSchedule'; schedule: SpaceSchedule }
  | { type: 'setBranding'; branding: SpaceBranding }
  | { type: 'setInvites'; invites: string[] }
  | { type: 'setInviteRole'; role: WizardState['inviteRole'] }
  | { type: 'setAssignDesks'; value: boolean }
  | { type: 'goTo'; step: StepId }
  | { type: 'next' }
  | { type: 'back' };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.name, slug: state.slugEdited ? state.slug : slugify(action.name) };
    case 'setSlug':
      return { ...state, slug: action.slug, slugEdited: true };
    case 'setDescription':
      return { ...state, description: action.description };
    case 'setTypeChoice': {
      if (action.choice === state.typeChoice || typeChoiceInfo(action.choice).comingSoon) return state;
      return withTypeDefaults(state, action.choice);
    }
    case 'setSizeBand':
      return action.sizeBand === state.sizeBand ? state : { ...state, sizeBand: action.sizeBand, rooms: state.typeChoice === 'import' ? state.rooms : null };
    case 'setTemplate':
      return action.templateKey === state.templateKey ? state : { ...state, templateKey: action.templateKey, rooms: null };
    case 'setImported':
      return {
        ...state,
        importedLayout: action.layout,
        importFileName: action.fileName,
        sizeBand: action.layout.size_band ?? state.sizeBand,
        rooms: null,
        name: state.name || action.layout.name || '',
        slug: state.slugEdited || state.name ? state.slug : slugify(action.layout.name ?? ''),
      };
    case 'clearImport':
      return { ...state, importedLayout: null, importFileName: null, rooms: null };
    case 'setRooms':
      return { ...state, rooms: action.rooms };
    case 'resetRooms':
      return { ...state, rooms: null };
    case 'setAccessMode':
      return { ...state, accessMode: action.mode };
    case 'setGuestToken':
      return { ...state, guestLinkToken: action.token };
    case 'setPermissions':
      return { ...state, permissions: action.permissions };
    case 'setPersistence':
      return { ...state, persistence: action.persistence };
    case 'setSchedule':
      return { ...state, schedule: action.schedule };
    case 'setBranding':
      return { ...state, branding: action.branding };
    case 'setInvites':
      return { ...state, invites: action.invites };
    case 'setInviteRole':
      return { ...state, inviteRole: action.role };
    case 'setAssignDesks':
      return { ...state, assignDesks: action.value };
    case 'goTo':
      return stepsFor(state.typeChoice).includes(action.step) ? { ...state, step: action.step } : state;
    case 'next':
    case 'back': {
      const steps = stepsFor(state.typeChoice);
      const i = Math.max(0, steps.indexOf(state.step));
      const j = Math.min(steps.length - 1, Math.max(0, i + (action.type === 'next' ? 1 : -1)));
      return { ...state, step: steps[j] };
    }
  }
}

/** Position for the progress bar: "Step index of total". */
export function stepPosition(state: WizardState): { index: number; total: number; label: string } {
  const steps = stepsFor(state.typeChoice);
  return { index: Math.max(0, steps.indexOf(state.step)) + 1, total: steps.length, label: STEP_LABELS[state.step] };
}

export function isLastStep(state: WizardState): boolean {
  const steps = stepsFor(state.typeChoice);
  return steps[steps.length - 1] === state.step;
}

export function roomsProblem(rooms: SpaceRoom[]): string | null {
  if (rooms.length === 0) return 'Add at least one room or zone.';
  if (rooms.some((r) => !r.name.trim())) return 'Every room needs a name.';
  if (rooms.some((r) => !Number.isInteger(r.capacity) || r.capacity < 1 || r.capacity > MAX_ROOM_CAPACITY)) {
    return `Room capacity must be between 1 and ${MAX_ROOM_CAPACITY}.`;
  }
  return null;
}

/** Whether the current step's answers are enough to continue. */
export function canContinue(state: WizardState, slugStatus: SlugStatus): boolean {
  switch (state.step) {
    case 'name':
      return state.name.trim().length > 0
        && slugProblem(state.slug) === null
        // If the check itself failed we still let them go on; the insert enforces uniqueness.
        && (slugStatus === 'available' || slugStatus === 'unknown');
    case 'type':
      return !typeChoiceInfo(state.typeChoice).comingSoon;
    case 'layout': {
      const type = effectiveType(state);
      return state.templateKey === BLANK_TEMPLATE_KEY || templatesFor(type).some((t) => t.key === state.templateKey);
    }
    case 'import':
      return state.importedLayout !== null;
    case 'configure':
      return roomsProblem(effectiveRooms(state)) === null
        && (state.persistence !== 'scheduled' || scheduleProblem(state.schedule) === null);
    default:
      return true;
  }
}

// ---------- Draft (sessionStorage) ----------

const draftKey = (workspaceId: string) => `synapse.spaceDraft.${workspaceId}`;
const SIZE_BANDS: SizeBand[] = ['solo', 'small', 'medium', 'large', 'xl'];
const CHOICES = SPACE_TYPE_CHOICES.map((c) => c.key);
/** Step order before Configure/Import existed, for drafts saved with numeric steps. */
const LEGACY_STEPS: StepId[] = ['name', 'type', 'size', 'layout', 'invite', 'avatar', 'media'];

/** Reads a saved draft. Storage can be unavailable or hold junk, so every access is guarded. */
export function readDraft(workspaceId: string): WizardState | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardState> & { spaceType?: string; step?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    const base = freshState();
    // Drafts from the first version stored `spaceType` and a numeric step.
    let choice = (parsed.typeChoice ?? (parsed.spaceType === 'community_hub' ? 'town_square' : parsed.spaceType)) as TypeChoice;
    if (!CHOICES.includes(choice) || typeChoiceInfo(choice).comingSoon) choice = base.typeChoice;
    const merged: WizardState = { ...withTypeDefaults(base, choice), ...parsed, typeChoice: choice };
    delete (merged as { spaceType?: unknown }).spaceType;
    const steps = stepsFor(choice);
    const step = typeof parsed.step === 'number' ? LEGACY_STEPS[parsed.step - 1] : parsed.step;
    merged.step = steps.includes(step as StepId) ? (step as StepId) : 'name';
    if (!SIZE_BANDS.includes(merged.sizeBand)) merged.sizeBand = base.sizeBand;
    if (merged.inviteRole !== 'admin') merged.inviteRole = 'member';
    for (const k of ['name', 'slug', 'description'] as const) if (typeof merged[k] !== 'string') merged[k] = '';
    merged.invites = Array.isArray(merged.invites) ? merged.invites.filter((e) => typeof e === 'string') : [];
    const type = effectiveType(merged);
    if (typeChoiceInfo(choice).flow === 'template' && merged.templateKey !== BLANK_TEMPLATE_KEY && !templatesFor(type).some((t) => t.key === merged.templateKey)) {
      merged.templateKey = recommendedTemplate(type).key;
    }
    if (!['members', 'invite_only', 'guest_link'].includes(merged.accessMode)) merged.accessMode = typeChoiceInfo(choice).defaults.access_mode;
    if (!['always_on', 'scheduled'].includes(merged.persistence)) merged.persistence = typeChoiceInfo(choice).defaults.persistence;
    if (!merged.permissions || typeof merged.permissions !== 'object') merged.permissions = { ...typeChoiceInfo(choice).defaults.permissions };
    if (merged.rooms !== null && !Array.isArray(merged.rooms)) merged.rooms = null;
    if (!merged.schedule || typeof merged.schedule !== 'object') merged.schedule = base.schedule;
    if (!merged.branding || typeof merged.branding !== 'object') merged.branding = {};
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
  return !!draft && (draft.name.trim().length > 0 || draft.step !== 'name');
}
