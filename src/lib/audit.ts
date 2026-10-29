/**
 * The audit log: who changed what. The database writes the entries (20261029120000_audit_log.sql);
 * this turns them into plain sentences, groups them, and exports them.
 */
import { supabase } from '@/lib/supabase';
import { FEATURES } from '@/lib/access';
import { describeWork, ROLE_LABELS, type MemberWork } from '@/lib/team';
import type { UserRole } from '@/types';

export interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export type AuditCategory = 'people' | 'deletions' | 'publishing' | 'settings' | 'other';

export const AUDIT_CATEGORIES: { key: AuditCategory; label: string }[] = [
  { key: 'people', label: 'People and roles' },
  { key: 'deletions', label: 'Deletions' },
  { key: 'publishing', label: 'Publishing' },
  { key: 'settings', label: 'Settings' },
  { key: 'other', label: 'Other' },
];

const PEOPLE = ['member_joined', 'member_invited', 'invite_cancelled', 'role_changed', 'access_changed', 'member_suspended', 'member_reactivated', 'member_removed'];
const PUBLISHING = ['workflow_published', 'workflow_paused', 'form_published', 'form_unpublished', 'workflow_activated'];
const SETTINGS = ['settings_changed', 'email_connected', 'email_disconnected', 'integration_connected', 'integration_disconnected',
  'webhook_added', 'webhook_changed', 'webhook_removed', 'room_assigned', 'room_unassigned', 'api_key_created', 'api_key_revoked'];

export function categoryOf(action: string): AuditCategory {
  if (PEOPLE.includes(action)) return 'people';
  if (action.endsWith('_deleted')) return 'deletions';
  if (PUBLISHING.includes(action)) return 'publishing';
  if (SETTINGS.includes(action) || action.endsWith('_created') || action.endsWith('_renamed')) return 'settings';
  return 'other';
}

/** The actions in a category, for asking the database (Other is everything else, so it can't be listed). */
export function actionsOf(category: AuditCategory): string[] | null {
  if (category === 'people') return PEOPLE;
  if (category === 'publishing') return PUBLISHING;
  return null;
}

const KIND: Record<string, string> = {
  contact: 'contact', form: 'form', workflow: 'workflow', calendar: 'calendar', event: 'event', room: 'room',
  department: 'department', channel: 'channel',
};
const AREA: Record<string, string> = { company: 'company details', email: 'email', sms: 'SMS', notifications: 'notification', branding: 'branding', security: 'security', api: 'API' };
const FIELD: Record<string, string> = { name: 'name', slug: 'web address', logo_url: 'logo', timezone: 'time zone', default_booking_settings: 'booking defaults' };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const role = (v: unknown) => ROLE_LABELS[v as UserRole] ?? str(v) ?? 'a role';
const quote = (v: unknown) => `“${str(v) ?? 'untitled'}”`;
const featureLabel = (k: string) => FEATURES.find((f) => f.key === k)?.label ?? k;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Who did it (as the entry recorded them) and what they did, as a sentence without the subject. */
export function describeAudit(e: Pick<AuditEntry, 'action' | 'details'>): { actor: string; text: string } {
  const d = e.details ?? {};
  const actor = str(d.actor) ?? 'Someone';
  const name = str(d.name) ?? 'someone';
  const handed = str(d.handed_to_name);
  const moved = describeWork(d.moved as MemberWork | undefined);
  const handover = handed ? `, handing ${moved ? `${moved} ` : 'their work '}to ${handed}` : '';
  const [kind, verb] = (() => { const i = e.action.lastIndexOf('_'); return [e.action.slice(0, i), e.action.slice(i + 1)]; })();

  switch (e.action) {
    case 'member_joined': return name === actor ? { actor, text: `joined as ${role(d.role)}` } : { actor, text: `added ${name} as ${role(d.role)}` };
    case 'member_invited': return { actor, text: `invited ${str(d.email) ?? 'someone'} as ${role(d.role)}` };
    case 'invite_cancelled': return { actor, text: `cancelled the invitation for ${str(d.email) ?? 'someone'}` };
    case 'role_changed': return { actor, text: `changed ${name}’s role from ${role(d.from)} to ${role(d.to)}` };
    case 'access_changed': {
      const from = Array.isArray(d.from) ? (d.from as string[]) : [];
      const to = Array.isArray(d.to) ? (d.to as string[]) : [];
      const added = to.filter((x) => !from.includes(x)).map(featureLabel);
      const removed = from.filter((x) => !to.includes(x)).map(featureLabel);
      const parts = [added.length ? `turned on ${list(added)}` : '', removed.length ? `turned off ${list(removed)}` : ''].filter(Boolean);
      return { actor, text: `changed what ${name} can see${parts.length ? `: ${parts.join('; ')}` : ''}` };
    }
    case 'member_suspended': return { actor, text: `suspended ${name}${handover}` };
    case 'member_reactivated': return { actor, text: `reactivated ${name}` };
    case 'member_removed': return { actor, text: `removed ${name}${handover}` };
    case 'workflow_published': case 'workflow_activated': return { actor, text: `switched on the workflow ${quote(d.name)}` };
    case 'workflow_paused': return { actor, text: `switched off the workflow ${quote(d.name)}` };
    case 'form_published': return { actor, text: `published the form ${quote(d.name)}` };
    case 'form_unpublished': return { actor, text: `took down the form ${quote(d.name)}` };
    case 'settings_changed': {
      const area = str(d.area) ?? 'the';
      if (area === 'company') {
        const fields = Array.isArray(d.fields) ? (d.fields as string[]).map((f) => FIELD[f] ?? f) : [];
        return { actor, text: `changed the company ${fields.length ? list(fields) : 'details'}` };
      }
      return { actor, text: `changed the ${AREA[area] ?? area} settings` };
    }
    case 'email_connected': return { actor, text: `connected the email account ${str(d.name) ?? ''}`.trim() };
    case 'email_disconnected': return { actor, text: `disconnected the email account ${str(d.name) ?? ''}`.trim() };
    case 'integration_connected': return { actor, text: `connected ${str(d.name) ?? 'an integration'}` };
    case 'integration_disconnected': return { actor, text: `disconnected ${str(d.name) ?? 'an integration'}` };
    case 'webhook_added': return { actor, text: `added a webhook to ${str(d.name) ?? 'a web address'}` };
    case 'webhook_changed': return { actor, text: `changed the webhook to ${str(d.name) ?? 'a web address'}` };
    case 'webhook_removed': return { actor, text: `removed the webhook to ${str(d.name) ?? 'a web address'}` };
    case 'api_key_created': return { actor, text: `made the API key ${quote(d.name)} (${str(d.access) ?? 'read and write'})` };
    case 'api_key_revoked': return { actor, text: `revoked the API key ${quote(d.name)}` };
    case 'room_assigned': return { actor, text: `gave ${str(d.person) ?? 'someone'} the room ${quote(d.name)}` };
    case 'room_unassigned': return { actor, text: `took ${str(d.person) ?? 'someone'} off the room ${quote(d.name)}` };
  }
  if (KIND[kind] && verb === 'deleted') return { actor, text: `deleted the ${KIND[kind]} ${quote(d.name)}` };
  if (KIND[kind] && verb === 'created') return { actor, text: `created the ${KIND[kind]} ${quote(d.name)}` };
  if (KIND[kind] && verb === 'renamed') return { actor, text: `renamed the ${KIND[kind]} ${quote(d.from)} to ${quote(d.name)}` };
  return { actor, text: e.action.replace(/_/g, ' ') };
}

/** "Today", "Yesterday", or the date, for grouping the list. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function auditCsv(entries: AuditEntry[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = entries.map((e) => { const { actor, text } = describeAudit(e); return [new Date(e.created_at).toISOString(), actor, `${actor} ${text}`, categoryOf(e.action), e.action]; });
  return [['When (UTC)', 'Who', 'What happened', 'Category', 'Action'], ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

export const AUDIT_PAGE = 50;

export async function loadAudit(workspaceId: string, opts: { before?: string; since?: string; category?: AuditCategory | ''; userId?: string }) {
  let q = supabase.from('audit_logs').select('id, user_id, action, entity_type, entity_id, details, created_at')
    .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(AUDIT_PAGE);
  if (opts.before) q = q.lt('created_at', opts.before);
  if (opts.since) q = q.gte('created_at', opts.since);
  if (opts.userId) q = q.eq('user_id', opts.userId);
  const only = opts.category ? actionsOf(opts.category) : null;
  if (only) q = q.in('action', only);
  else if (opts.category === 'deletions') q = q.like('action', '%\\_deleted');
  const { data, error } = await q;
  let rows = (data ?? []) as AuditEntry[];
  // Settings and Other are worked out from the action names.
  if (opts.category === 'settings' || opts.category === 'other') rows = rows.filter((r) => categoryOf(r.action) === opts.category);
  return { data: rows, full: (data ?? []).length === AUDIT_PAGE, error: error?.message ?? null };
}
