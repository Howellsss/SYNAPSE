import { newId, type Step, type Trigger, type WorkflowSettings, DEFAULT_SETTINGS } from './model';
import type { Tone } from './catalog';

/** Ready-made starting points, written for how SYNAPSE is used. Everything stays editable. */
export interface Recipe {
  key: string;
  name: string;
  description: string;
  tone: Tone;
  build: () => { triggers: Trigger[]; steps: Step[]; settings?: Partial<WorkflowSettings> };
}

const t = (type: Trigger['type'], name: string, filters: Trigger['filters']): Trigger => ({ id: newId('t'), type, name, filters });
const s = (type: Step['type'], name: string, config: Step['config'], extra: Partial<Step> = {}): Step => ({ id: newId(), type, name, config, ...extra });

export const RECIPES: Recipe[] = [
  {
    key: 'welcome', name: 'Welcome new contacts', tone: 'navy',
    description: 'Tag every new contact, email a welcome, and remind the owner to call two days later.',
    build: () => ({
      triggers: [t('contact_created', 'New contact', { tag_rules: [] })],
      steps: [
        s('add_tag', 'Tag as new lead', { tags: ['New lead'] }),
        s('send_email', 'Welcome email', { subject: 'Welcome, {{contact.first_name}}', body: 'Hi {{contact.first_name}},\n\nThanks for getting in touch. Reply to this email any time.\n' }),
        s('wait', '', { amount: 2, unit: 'days' }),
        s('add_task', 'Call task for the owner', { title: 'Call {{contact.name}}', body: '', due_in_days: '0', assign: 'owner' }),
      ],
      settings: { stop_on_response: true },
    }),
  },
  {
    key: 'interested', name: 'Interested lead follow-up', tone: 'gold',
    description: 'When a contact is tagged Interested: alert the owner, then follow up by email unless they reply.',
    build: () => ({
      triggers: [t('contact_tag', 'Tagged Interested', { event: 'added', tags: ['Interested'] })],
      steps: [
        s('notify', 'Tell the owner', { to: 'owner', users: [], title: '{{contact.name}} is interested', body: 'Reach out today.' }),
        s('wait', '', { amount: 1, unit: 'days' }),
        s('send_email', 'Follow-up email', { subject: 'Next steps, {{contact.first_name}}', body: 'Hi {{contact.first_name}},\n\nWould you like to book a short call?\n' }),
      ],
      settings: { stop_on_response: true },
    }),
  },
  {
    key: 'birthday', name: 'Birthday greeting', tone: 'gold',
    description: 'Every year at 8 AM on their birthday, send a warm note.',
    build: () => ({
      triggers: [t('birthday_reminder', 'On the birthday', { offset: 'on', days: 0, month: '' })],
      steps: [s('send_email', 'Birthday email', { subject: 'Happy birthday, {{contact.first_name}}!', body: 'Wishing you a wonderful day.\n' })],
      settings: { allow_reentry: true },
    }),
  },
  {
    key: 'noshow', name: 'No-show win-back', tone: 'indigo',
    description: 'When an appointment is marked no-show, email to rebook and add a task for the team.',
    build: () => ({
      triggers: [t('appointment_status', 'No-show', { statuses: ['no_show'], calendars: [] })],
      steps: [
        s('send_email', 'Rebook email', { subject: 'Sorry we missed you', body: 'Hi {{contact.first_name}},\n\nWould you like to pick another time?\n' }),
        s('add_task', 'Follow up', { title: 'Rebook {{contact.name}}', body: '', due_in_days: '1', assign: 'owner' }),
      ],
      settings: { allow_reentry: true },
    }),
  },
  {
    key: 'form', name: 'Form submission follow-up', tone: 'green',
    description: 'Thank people who fill in a form, and branch on whether they are already a customer.',
    build: () => ({
      triggers: [t('form_submitted', 'Form filled in', { forms: [] })],
      steps: [
        s('if_else', 'Already a customer?', { match: 'all', conditions: [{ field: 'contact_type', op: 'equals', value: 'customer' }] }, {
          yes: [s('notify', 'Tell the owner', { to: 'owner', users: [], title: 'Customer {{contact.name}} sent a form', body: '' })],
          no: [s('send_email', 'Thank-you email', { subject: 'Thanks, {{contact.first_name}}', body: 'We received your details and will be in touch.\n' }), s('add_tag', '', { tags: ['Form lead'] })],
        }),
      ],
      settings: { allow_reentry: true },
    }),
  },
  {
    key: 'task', name: 'Task due reminder', tone: 'indigo',
    description: 'The day before a task is due, remind the person it’s assigned to.',
    build: () => ({
      triggers: [t('task_reminder', 'Due tomorrow', { offset: 'before', days: 1 })],
      steps: [s('notify', 'Remind', { to: 'owner', users: [], title: 'Task due tomorrow for {{contact.name}}', body: '' })],
      settings: { allow_reentry: true },
    }),
  },
];

export const recipeSettings = (r: ReturnType<Recipe['build']>): WorkflowSettings => ({ ...DEFAULT_SETTINGS, ...(r.settings ?? {}) });
