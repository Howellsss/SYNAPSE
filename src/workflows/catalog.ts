import {
  UserPlus, UserCog, Tag, BellOff, StickyNote, Cake, CalendarClock, ListPlus, AlarmClock, ListChecks,
  CalendarPlus, CalendarCheck2, FileText, MessageCircleReply, Ticket,
  Tags, TagsIcon, PenLine, UserCheck, UserMinus, Moon, NotebookPen, ClipboardList, Mail, BellRing,
  Hourglass, GitBranch, Workflow, LogOut, Square, Webhook, type LucideIcon,
} from 'lucide-react';
import type { Config, StepType, TriggerType } from './model';
import { waitLabel } from './model';

/** Names the summaries need (users, forms, calendars, events, other workflows). */
export interface Lookups {
  users: Record<string, string>;
  forms: Record<string, string>;
  calendars: Record<string, string>;
  events: Record<string, string>;
  workflows: Record<string, string>;
}

export const EMPTY_LOOKUPS: Lookups = { users: {}, forms: {}, calendars: {}, events: {}, workflows: {} };

/** A colour family for an icon chip: SYNAPSE navy, gold, indigo, green, burgundy, slate. */
export type Tone = 'navy' | 'gold' | 'indigo' | 'green' | 'burgundy' | 'slate';
export const TONE: Record<Tone, string> = {
  navy: 'bg-navy-800 text-gold-300',
  gold: 'bg-gold-400 text-navy-900',
  indigo: 'bg-[#5B5BD6] text-white',
  green: 'bg-green-600 text-white',
  burgundy: 'bg-burgundy-500 text-white',
  slate: 'bg-[#4F596B] text-white',
};

export interface TriggerDef {
  type: TriggerType;
  label: string;
  group: 'Contacts' | 'Dates & tasks' | 'Appointments' | 'Forms, events & replies';
  icon: LucideIcon;
  tone: Tone;
  description: string;
  defaults: () => Config;
  summary: (f: Config, l: Lookups) => string;
}

export interface StepDef {
  type: StepType;
  label: string;
  group: 'Contact' | 'Messages & alerts' | 'Notes & tasks' | 'Timing & logic' | 'Workflows' | 'Send data';
  icon: LucideIcon;
  tone: Tone;
  description: string;
  defaults: () => Config;
  summary: (c: Config, l: Lookups) => string;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const names = (ids: unknown, map: Record<string, string>) => arr(ids).map((id) => map[id] ?? 'someone').join(', ');
const days = (f: Config, what: string) => (f.offset === 'before' ? `${f.days || '?'} day${Number(f.days) === 1 ? '' : 's'} before ${what}` : f.offset === 'after' ? `${f.days || '?'} day${Number(f.days) === 1 ? '' : 's'} after ${what}` : `On ${what}`);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export { MONTHS };

export const CONTACT_FIELDS: { value: string; label: string; date?: boolean }[] = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'company', label: 'Company' },
  { value: 'job_title', label: 'Job title' },
  { value: 'contact_type', label: 'Contact type' },
  { value: 'source', label: 'Source' },
  { value: 'timezone', label: 'Time zone' },
  { value: 'date_of_birth', label: 'Date of birth', date: true },
];
export const fieldLabel = (v: unknown) => CONTACT_FIELDS.find((f) => f.value === v)?.label ?? (v === 'owner_id' ? 'Assigned user' : String(v ?? ''));

export const APPOINTMENT_STATUSES: { value: string; label: string }[] = [
  { value: 'booked', label: 'Booked' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'showed', label: 'Showed' },
  { value: 'no_show', label: 'No-show' },
];

export const DND_CHANNELS = [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }, { value: 'calls', label: 'Calls' }];

export const TRIGGERS: TriggerDef[] = [
  {
    type: 'contact_created', label: 'Contact created', group: 'Contacts', icon: UserPlus, tone: 'navy',
    description: 'A new contact is added: by hand, from a form, a booking or an import of one.',
    defaults: () => ({ tag_rules: [] }),
    summary: (f) => (arr((f.tag_rules as Config[] | undefined)?.flatMap((r) => arr(r.tags))).length ? 'New contacts that match your tag rules' : 'Every new contact'),
  },
  {
    type: 'contact_changed', label: 'Contact changed', group: 'Contacts', icon: UserCog, tone: 'navy',
    description: 'A field on a contact is updated, e.g. Contact type becomes Customer.',
    defaults: () => ({ field: 'contact_type', op: 'has_changed_to', value: 'customer' }),
    summary: (f) => (f.op === 'has_changed_to' ? `${fieldLabel(f.field)} changes to "${f.value ?? ''}"` : `${fieldLabel(f.field)} changes`),
  },
  {
    type: 'contact_tag', label: 'Contact tag', group: 'Contacts', icon: Tag, tone: 'gold',
    description: 'A tag is added to or removed from a contact.',
    defaults: () => ({ event: 'added', tags: [] }),
    summary: (f) => `Tag ${f.event === 'removed' ? 'removed' : f.event === 'any' ? 'added or removed' : 'added'}: ${arr(f.tags).join(', ') || 'choose a tag'}`,
  },
  {
    type: 'contact_dnd', label: 'Contact DND', group: 'Contacts', icon: BellOff, tone: 'slate',
    description: 'Do Not Disturb is turned on or off for a contact, for all channels or some.',
    defaults: () => ({ flag: 'enabled_all', channels: [], tag_rules: [] }),
    summary: (f) => ({ enabled_all: 'DND turned on for all channels', disabled_all: 'DND turned off for all channels', enabled_specific: `DND turned on for ${arr(f.channels).join(', ') || '…'}`, disabled_specific: `DND turned off for ${arr(f.channels).join(', ') || '…'}` } as Record<string, string>)[String(f.flag)] ?? 'Any DND change',
  },
  {
    type: 'note_added', label: 'Note added', group: 'Contacts', icon: StickyNote, tone: 'gold',
    description: 'Someone adds a note to a contact.',
    defaults: () => ({ has_tag: '', not_tag: '' }),
    summary: (f) => [f.has_tag && `contacts tagged ${f.has_tag}`, f.not_tag && `not tagged ${f.not_tag}`].filter(Boolean).join(', ') || 'Any note on any contact',
  },
  {
    type: 'birthday_reminder', label: 'Birthday reminder', group: 'Dates & tasks', icon: Cake, tone: 'gold',
    description: 'Runs at 8 AM (your account’s time zone) on, before or after each contact’s birthday.',
    defaults: () => ({ offset: 'on', days: 0, month: '' }),
    summary: (f) => `${days(f, 'the birthday')}${f.month ? ` · born in ${MONTHS[Number(f.month) - 1]}` : ''}`,
  },
  {
    type: 'custom_date_reminder', label: 'Date reminder', group: 'Dates & tasks', icon: CalendarClock, tone: 'gold',
    description: 'Runs at 8 AM on, before or after a date on the contact (birthday or date added).',
    defaults: () => ({ field: 'date_of_birth', offset: 'before', days: 7, match_year: false, has_tag: '', weekday: '', month: '' }),
    summary: (f) => days(f, f.field === 'created_at' ? 'the date added' : 'the date of birth'),
  },
  {
    type: 'task_added', label: 'Task added', group: 'Dates & tasks', icon: ListPlus, tone: 'indigo',
    description: 'A task is added to a contact.',
    defaults: () => ({ users: [] }),
    summary: (f, l) => (arr(f.users).length ? `Assigned to ${names(f.users, l.users)}` : 'Any new task'),
  },
  {
    type: 'task_reminder', label: 'Task reminder', group: 'Dates & tasks', icon: AlarmClock, tone: 'indigo',
    description: 'Runs at 8 AM a number of days before or after a task is due.',
    defaults: () => ({ offset: 'before', days: 1 }),
    summary: (f) => days(f, 'the due date'),
  },
  {
    type: 'task_completed', label: 'Task completed', group: 'Dates & tasks', icon: ListChecks, tone: 'indigo',
    description: 'A task is marked done.',
    defaults: () => ({ user_op: 'any', users: [] }),
    summary: (f, l) => ({ is: `Completed by ${names(f.users, l.users)}`, is_not: `Not assigned to ${names(f.users, l.users)}`, is_empty: 'Unassigned tasks', is_not_empty: 'Any assigned task' } as Record<string, string>)[String(f.user_op)] ?? 'Any completed task',
  },
  {
    type: 'customer_booked_appointment', label: 'Appointment booked', group: 'Appointments', icon: CalendarPlus, tone: 'indigo',
    description: 'A contact books an appointment on one of your calendars.',
    defaults: () => ({ calendars: [] }),
    summary: (f, l) => (arr(f.calendars).length ? `On ${names(f.calendars, l.calendars)}` : 'On any calendar'),
  },
  {
    type: 'appointment_status', label: 'Appointment status', group: 'Appointments', icon: CalendarCheck2, tone: 'indigo',
    description: 'An appointment is booked, confirmed, cancelled, rescheduled, showed or no-show.',
    defaults: () => ({ statuses: ['no_show'], calendars: [] }),
    summary: (f) => `${arr(f.statuses).map((s) => APPOINTMENT_STATUSES.find((x) => x.value === s)?.label ?? s).join(' or ') || 'Any status'}`,
  },
  {
    type: 'form_submitted', label: 'Form submitted', group: 'Forms, events & replies', icon: FileText, tone: 'green',
    description: 'Someone fills in one of your forms.',
    defaults: () => ({ forms: [] }),
    summary: (f, l) => (arr(f.forms).length ? names(f.forms, l.forms) : 'Any form'),
  },
  {
    type: 'event_registered', label: 'Event registration', group: 'Forms, events & replies', icon: Ticket, tone: 'green',
    description: 'Someone registers for one of your events.',
    defaults: () => ({ events: [] }),
    summary: (f, l) => (arr(f.events).length ? names(f.events, l.events) : 'Any event'),
  },
  {
    type: 'customer_replied', label: 'Customer replied', group: 'Forms, events & replies', icon: MessageCircleReply, tone: 'green',
    description: 'A contact replies to you.',
    defaults: () => ({ channels: [] }),
    summary: (f) => (arr(f.channels).length ? `By ${arr(f.channels).join(' or ')}` : 'On any channel'),
  },
];

export const STEPS: StepDef[] = [
  { type: 'add_tag', label: 'Add tag', group: 'Contact', icon: Tags, tone: 'gold', description: 'Add one or more tags to the contact.', defaults: () => ({ tags: [] }), summary: (c) => arr(c.tags).join(', ') || 'Choose tags' },
  { type: 'remove_tag', label: 'Remove tag', group: 'Contact', icon: TagsIcon, tone: 'slate', description: 'Take tags off the contact.', defaults: () => ({ tags: [] }), summary: (c) => arr(c.tags).join(', ') || 'Choose tags' },
  { type: 'update_field', label: 'Update contact field', group: 'Contact', icon: PenLine, tone: 'navy', description: 'Set a field, e.g. Contact type to Customer.', defaults: () => ({ field: 'contact_type', value: '' }), summary: (c) => `${fieldLabel(c.field)} → "${c.value ?? ''}"` },
  { type: 'assign_user', label: 'Assign to user', group: 'Contact', icon: UserCheck, tone: 'navy', description: 'Make a team member the contact’s owner.', defaults: () => ({ user_id: '' }), summary: (c, l) => (c.user_id ? l.users[String(c.user_id)] ?? 'A team member' : 'Choose someone') },
  { type: 'remove_assigned_user', label: 'Remove assigned user', group: 'Contact', icon: UserMinus, tone: 'slate', description: 'Clear the contact’s owner.', defaults: () => ({}), summary: () => 'Unassign' },
  { type: 'set_dnd', label: 'Do Not Disturb', group: 'Contact', icon: Moon, tone: 'slate', description: 'Turn Do Not Disturb on or off, for all channels or some.', defaults: () => ({ mode: 'enable', scope: 'all', channels: [] }), summary: (c) => `${c.mode === 'disable' ? 'Turn off' : 'Turn on'} for ${c.scope === 'channels' ? arr(c.channels).join(', ') || '…' : 'all channels'}` },
  { type: 'send_email', label: 'Send email', group: 'Messages & alerts', icon: Mail, tone: 'green', description: 'Email the contact from your connected Gmail.', defaults: () => ({ subject: '', body: '' }), summary: (c) => String(c.subject || 'No subject yet') },
  { type: 'notify', label: 'Internal notification', group: 'Messages & alerts', icon: BellRing, tone: 'burgundy', description: 'Alert someone on your team (under the bell).', defaults: () => ({ to: 'owner', users: [], title: '', body: '' }), summary: (c, l) => `To ${c.to === 'everyone' ? 'everyone' : c.to === 'users' ? names(c.users, l.users) || '…' : 'the assigned user'}` },
  { type: 'add_note', label: 'Add note', group: 'Notes & tasks', icon: NotebookPen, tone: 'gold', description: 'Write a note on the contact.', defaults: () => ({ text: '' }), summary: (c) => String(c.text || 'Write the note') },
  { type: 'add_task', label: 'Add task', group: 'Notes & tasks', icon: ClipboardList, tone: 'indigo', description: 'Create a to-do on the contact, with a due date.', defaults: () => ({ title: '', body: '', due_in_days: '1', assign: 'owner' }), summary: (c) => `${c.title || 'Task'}${c.due_in_days ? ` · due in ${c.due_in_days} day${c.due_in_days === '1' ? '' : 's'}` : ''}` },
  { type: 'wait', label: 'Wait', group: 'Timing & logic', icon: Hourglass, tone: 'slate', description: 'Pause before the next step: minutes, hours or days.', defaults: () => ({ amount: 1, unit: 'days' }), summary: (c) => waitLabel(c) },
  { type: 'if_else', label: 'If / Else', group: 'Timing & logic', icon: GitBranch, tone: 'navy', description: 'Split the path: contacts who match go Yes, others go No.', defaults: () => ({ match: 'all', conditions: [{ field: 'tag', op: 'has', value: '' }] }), summary: (c) => `${(c.conditions as unknown[] | undefined)?.length ?? 0} condition${(c.conditions as unknown[] | undefined)?.length === 1 ? '' : 's'} · match ${c.match === 'any' ? 'any' : 'all'}` },
  { type: 'add_to_workflow', label: 'Add to workflow', group: 'Workflows', icon: Workflow, tone: 'navy', description: 'Start another workflow for this contact.', defaults: () => ({ workflow_id: '' }), summary: (c, l) => l.workflows[String(c.workflow_id)] ?? 'Choose a workflow' },
  { type: 'remove_from_workflow', label: 'Remove from workflow', group: 'Workflows', icon: LogOut, tone: 'burgundy', description: 'Take the contact out of this or another workflow.', defaults: () => ({ workflow_id: 'current' }), summary: (c, l) => (c.workflow_id === 'current' || !c.workflow_id ? 'This workflow' : l.workflows[String(c.workflow_id)] ?? 'Another workflow') },
  { type: 'end', label: 'End', group: 'Workflows', icon: Square, tone: 'slate', description: 'Stop here.', defaults: () => ({}), summary: () => 'The workflow ends for this contact' },
  { type: 'webhook', label: 'Webhook', group: 'Send data', icon: Webhook, tone: 'slate', description: 'Send the contact’s details to another app (POST, JSON).', defaults: () => ({ url: '' }), summary: (c) => String(c.url || 'Enter an address') },
];

export const triggerDef = (t: string) => TRIGGERS.find((d) => d.type === t);
export const stepDef = (t: string) => STEPS.find((d) => d.type === t);

/** Everything SYNAPSE can do, grouped for the pickers. */
export function grouped<T extends { group: string; label: string; description: string }>(items: T[], q: string): [string, T[]][] {
  const s = q.trim().toLowerCase();
  const hits = items.filter((i) => !s || i.label.toLowerCase().includes(s) || i.description.toLowerCase().includes(s) || i.group.toLowerCase().includes(s));
  const out = new Map<string, T[]>();
  for (const h of hits) out.set(h.group, [...(out.get(h.group) ?? []), h]);
  return [...out.entries()];
}
