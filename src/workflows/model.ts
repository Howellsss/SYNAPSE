/**
 * Workflows: the shapes the builder edits and the server engine runs.
 *
 * The builder edits a tree (steps in order; an If/Else step holds a Yes list and a No list, and
 * ends its list, like the GoHighLevel builder). Saving turns the tree into a flat graph
 * ({ start, graph: { id: { type, config, next | yes/no } } }) that the database engine walks.
 */

export type TriggerType =
  | 'contact_created' | 'contact_changed' | 'contact_tag' | 'contact_dnd' | 'note_added'
  | 'birthday_reminder' | 'custom_date_reminder'
  | 'task_added' | 'task_reminder' | 'task_completed'
  | 'customer_booked_appointment' | 'appointment_status'
  | 'form_submitted' | 'customer_replied' | 'event_registered';

export type StepType =
  | 'add_tag' | 'remove_tag' | 'update_field' | 'assign_user' | 'remove_assigned_user' | 'set_dnd'
  | 'add_note' | 'add_task'
  | 'send_email' | 'notify'
  | 'wait' | 'if_else' | 'add_to_workflow' | 'remove_from_workflow' | 'end'
  | 'webhook';

export type Config = Record<string, unknown>;

export interface Trigger {
  id: string;
  type: TriggerType;
  name: string;
  filters: Config;
}

export interface Step {
  id: string;
  type: StepType;
  name: string;
  config: Config;
  /** If/Else only. */
  yes?: Step[];
  no?: Step[];
}

export interface WorkflowSettings {
  allow_reentry: boolean;
  stop_on_response: boolean;
  timezone: 'account' | 'contact';
  time_window: { enabled: boolean; start: string; end: string; days: number[] };
  sender: { account_id: string; from_name: string };
}

export interface GraphNode { type: StepType; name: string; config: Config; next?: string; yes?: string; no?: string }
export interface Definition {
  version: 2;
  triggers: Trigger[];
  start: string;
  graph: Record<string, GraphNode>;
  /** The tree, kept so the builder reopens exactly as it was. */
  steps: Step[];
}

export const DEFAULT_SETTINGS: WorkflowSettings = {
  allow_reentry: false,
  stop_on_response: false,
  timezone: 'account',
  time_window: { enabled: false, start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  sender: { account_id: '', from_name: '' },
};

export function settingsFrom(raw: unknown): WorkflowSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WorkflowSettings>;
  return {
    allow_reentry: !!r.allow_reentry,
    stop_on_response: !!r.stop_on_response,
    timezone: r.timezone === 'contact' ? 'contact' : 'account',
    time_window: { ...DEFAULT_SETTINGS.time_window, ...(r.time_window ?? {}) },
    sender: { ...DEFAULT_SETTINGS.sender, ...(r.sender ?? {}) },
  };
}

export const newId = (prefix = 's') => `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// ---------------------------------------------------------------- tree <-> graph

export function compile(triggers: Trigger[], steps: Step[]): Definition {
  const graph: Record<string, GraphNode> = {};
  const walk = (list: Step[]): string => {
    list.forEach((s, i) => {
      const node: GraphNode = { type: s.type, name: s.name, config: s.config };
      if (s.type === 'if_else') {
        node.yes = walk(s.yes ?? []);
        node.no = walk(s.no ?? []);
        node.next = '';
      } else {
        node.next = list[i + 1]?.id ?? '';
      }
      graph[s.id] = node;
    });
    return list[0]?.id ?? '';
  };
  const start = walk(steps);
  return { version: 2, triggers, start, graph, steps };
}

/** Steps in the order they appear (depth first), for counts and look-ups. */
export function flatten(steps: Step[]): Step[] {
  return steps.flatMap((s) => [s, ...(s.type === 'if_else' ? [...flatten(s.yes ?? []), ...flatten(s.no ?? [])] : [])]);
}

/** Where a step list lives: the top level, or a branch of an If/Else. */
export interface Place { parent: string | null; branch: 'yes' | 'no' | null }

function listAt(steps: Step[], place: Place): Step[] | null {
  if (!place.parent) return steps;
  const p = flatten(steps).find((s) => s.id === place.parent);
  if (!p || p.type !== 'if_else' || !place.branch) return null;
  return p[place.branch] ?? (p[place.branch] = []);
}

const clone = (steps: Step[]): Step[] => JSON.parse(JSON.stringify(steps));

/** Insert a step at a position. An If/Else takes over everything after it as its Yes branch. */
export function insertStep(steps: Step[], place: Place, index: number, step: Step): Step[] {
  const next = clone(steps);
  const list = listAt(next, place);
  if (!list) return steps;
  if (step.type === 'if_else') {
    const rest = list.splice(index);
    step = { ...step, yes: step.yes?.length ? step.yes : rest, no: step.no ?? [] };
  } else if (list[index - 1]?.type === 'if_else') {
    return steps; // nothing can follow an If/Else in the same list
  }
  list.splice(index, 0, step);
  return next;
}

export function updateStep(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  const next = clone(steps);
  const s = flatten(next).find((x) => x.id === id);
  if (s) Object.assign(s, patch);
  return next;
}

/** Remove a step. Removing an If/Else keeps its Yes branch in its place. */
export function removeStep(steps: Step[], id: string): Step[] {
  const next = clone(steps);
  const strip = (list: Step[]): boolean => {
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) {
      const [gone] = list.splice(i, 1);
      if (gone.type === 'if_else') list.splice(i, 0, ...(gone.yes ?? []));
      return true;
    }
    return list.some((s) => s.type === 'if_else' && (strip(s.yes ?? []) || strip(s.no ?? [])));
  };
  strip(next);
  return next;
}

/** Move a step one place up or down within its own list. */
export function moveStep(steps: Step[], id: string, dir: -1 | 1): Step[] {
  const next = clone(steps);
  const go = (list: Step[]): boolean => {
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) {
      const j = i + dir;
      if (j < 0 || j >= list.length || list[i].type === 'if_else' || list[j].type === 'if_else') return true;
      [list[i], list[j]] = [list[j], list[i]];
      return true;
    }
    return list.some((s) => s.type === 'if_else' && (go(s.yes ?? []) || go(s.no ?? [])));
  };
  go(next);
  return next;
}

/** A copy of a step (and its branches) with new ids. */
export function duplicateStep(steps: Step[], id: string): Step[] {
  const next = clone(steps);
  const renew = (s: Step): Step => ({ ...s, id: newId(), yes: s.yes?.map(renew), no: s.no?.map(renew) });
  const go = (list: Step[]): boolean => {
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) {
      if (list[i].type === 'if_else') return true;
      list.splice(i + 1, 0, renew(list[i]));
      return true;
    }
    return list.some((s) => s.type === 'if_else' && (go(s.yes ?? []) || go(s.no ?? [])));
  };
  go(next);
  return next;
}

// ---------------------------------------------------------------- checks ("Errors found")

export interface Issue { id: string; where: 'trigger' | 'step' | 'settings'; message: string }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

export function checkTrigger(t: Trigger): string | null {
  const f = t.filters;
  if (!t.name.trim()) return 'Give the trigger a name.';
  switch (t.type) {
    case 'contact_tag': return list(f.tags).length ? null : 'Choose at least one tag.';
    case 'contact_changed': return !str(f.field) ? 'Choose which field to watch.' : f.op === 'has_changed_to' && !str(f.value) ? 'Type the new value to watch for.' : null;
    case 'contact_dnd': return /specific/.test(str(f.flag)) && !list(f.channels).length ? 'Choose the channel(s).' : null;
    case 'birthday_reminder':
    case 'custom_date_reminder':
    case 'task_reminder': return f.offset && f.offset !== 'on' && !(Number(f.days) >= 1) ? 'Enter how many days.' : null;
    case 'task_completed': return (f.user_op === 'is' || f.user_op === 'is_not') && !list(f.users).length ? 'Choose the user(s).' : null;
    default: return null;
  }
}

export function checkStep(s: Step): string | null {
  const c = s.config;
  switch (s.type) {
    case 'add_tag':
    case 'remove_tag': return list(c.tags).length ? null : 'Choose at least one tag.';
    case 'update_field': return str(c.field) ? null : 'Choose a field.';
    case 'assign_user': return str(c.user_id) ? null : 'Choose who to assign.';
    case 'set_dnd': return c.scope === 'channels' && !list(c.channels).length ? 'Choose the channel(s).' : null;
    case 'add_note': return str(c.text) ? null : 'Write the note.';
    case 'add_task': return str(c.title) ? null : 'Give the task a title.';
    case 'send_email': return !str(c.subject) ? 'Add a subject.' : !str(c.body) ? 'Write the email.' : null;
    case 'notify': return !str(c.title) ? 'Add a title for the notification.' : c.to === 'users' && !list(c.users).length ? 'Choose who to notify.' : null;
    case 'wait': return Number(c.amount) >= 1 ? null : 'Wait at least 1.';
    case 'if_else': return Array.isArray(c.conditions) && c.conditions.length ? null : 'Add at least one condition.';
    case 'add_to_workflow': return str(c.workflow_id) ? null : 'Choose a workflow.';
    case 'webhook': return /^https:\/\/\S+$/.test(str(c.url)) ? null : 'Enter an https:// address.';
    default: return null;
  }
}

export function issues(triggers: Trigger[], steps: Step[], settings: WorkflowSettings): Issue[] {
  const out: Issue[] = [];
  if (!triggers.length) out.push({ id: '', where: 'trigger', message: 'Add a trigger: what starts this workflow?' });
  for (const t of triggers) { const m = checkTrigger(t); if (m) out.push({ id: t.id, where: 'trigger', message: m }); }
  const all = flatten(steps);
  if (!all.length) out.push({ id: '', where: 'step', message: 'Add at least one step.' });
  for (const s of all) { const m = checkStep(s); if (m) out.push({ id: s.id, where: 'step', message: m }); }
  if (all.some((s) => s.type === 'send_email') && !settings.sender.account_id && !all.some((s) => s.type === 'send_email' && str(s.config.account_id))) {
    out.push({ id: '', where: 'settings', message: 'Choose the email account to send from (Settings → Sender).' });
  }
  return out;
}

// ---------------------------------------------------------------- older workflows

const LEGACY_TRIGGERS: Record<string, Partial<Trigger>> = {
  appointment_booked: { type: 'customer_booked_appointment' },
  calendar_booking_created: { type: 'customer_booked_appointment' },
  appointment_confirmed: { type: 'appointment_status', filters: { statuses: ['confirmed'] } },
  appointment_cancelled: { type: 'appointment_status', filters: { statuses: ['cancelled'] } },
  calendar_booking_cancelled: { type: 'appointment_status', filters: { statuses: ['cancelled'] } },
  appointment_rescheduled: { type: 'appointment_status', filters: { statuses: ['rescheduled'] } },
  appointment_completed: { type: 'appointment_status', filters: { statuses: ['showed'] } },
  appointment_no_show: { type: 'appointment_status', filters: { statuses: ['no_show'] } },
  form_submitted: { type: 'form_submitted' },
  contact_created: { type: 'contact_created' },
  contact_updated: { type: 'contact_changed' },
  tag_added: { type: 'contact_tag', filters: { event: 'added', tags: [] } },
  tag_removed: { type: 'contact_tag', filters: { event: 'removed', tags: [] } },
  note_added: { type: 'note_added' },
  task_created: { type: 'task_added' },
  task_completed: { type: 'task_completed' },
  birthday: { type: 'birthday_reminder', filters: { offset: 'on' } },
  customer_replied: { type: 'customer_replied' },
};

/** Turn a workflow from the old builder (trigger_type + workflow_nodes) into triggers and steps. */
export function fromLegacy(triggerType: string, nodes: { node_type: string; action_type: string | null; config: Config }[]): { triggers: Trigger[]; steps: Step[]; dropped: string[] } {
  const t = LEGACY_TRIGGERS[triggerType];
  const triggers: Trigger[] = t ? [{ id: newId('t'), type: t.type!, name: '', filters: { ...(t.filters ?? {}) } }] : [];
  const steps: Step[] = [];
  const dropped: string[] = [];
  for (const n of nodes) {
    if (n.node_type === 'trigger') continue;
    const c = n.config ?? {};
    const a = n.node_type === 'delay' || n.node_type === 'wait' ? 'wait' : n.action_type ?? '';
    const push = (type: StepType, config: Config) => steps.push({ id: newId(), type, name: '', config });
    switch (a) {
      case 'send_email': push('send_email', { subject: c.subject ?? '', body: c.body ?? '' }); break;
      case 'add_tag': push('add_tag', { tags: c.tag ? [c.tag] : (c.tags ?? []) }); break;
      case 'remove_tag': push('remove_tag', { tags: c.tag ? [c.tag] : (c.tags ?? []) }); break;
      case 'add_note': push('add_note', { text: c.content ?? c.text ?? '' }); break;
      case 'create_task': push('add_task', { title: c.title ?? 'Follow up', due_in_days: '1', assign: 'owner' }); break;
      case 'send_internal_notification': push('notify', { to: 'owner', title: c.title ?? c.subject ?? 'Workflow notification', body: c.body ?? c.message ?? '' }); break;
      case 'send_webhook':
      case 'http_request': push('webhook', { url: c.url ?? '' }); break;
      case 'wait': {
        const unit = ['minutes', 'hours', 'days'].includes(String(c.duration_unit)) ? c.duration_unit : 'hours';
        push('wait', { amount: Number(c.duration_value ?? c.delay_minutes ?? 1) || 1, unit });
        break;
      }
      case 'end_workflow': push('end', {}); break;
      default: dropped.push(a || n.node_type);
    }
  }
  return { triggers, steps, dropped };
}

/** "Wait 2 days" */
export function waitLabel(c: Config): string {
  const n = Number(c.amount) || 0;
  const unit = String(c.unit ?? 'hours');
  return `Wait ${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
}
