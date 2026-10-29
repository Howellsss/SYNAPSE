/**
 * Incoming contact links: other apps (Zapier, Make, a website form, a live chat) add or update
 * contacts by POSTing to a secret link. Database: 20261101090000_incoming_contacts.sql;
 * Edge Function: api (supabase/functions/api).
 */
import { supabase } from '@/lib/supabase';

export interface InboundLink { id: string; name: string; token: string; tags: string[]; source: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }
export interface InboundCall { id: number; ok: boolean; created: boolean | null; contact_id: string | null; error: string | null; payload: Record<string, unknown> | null; at: string }

const LINK_COLS = 'id, name, token, tags, source, created_at, last_used_at, revoked_at';
const tableError = (m: string | undefined) =>
  (m && /inbound_(links|log)|schema cache|does not exist/i.test(m) ? 'Incoming links need the database update 20261101090000_incoming_contacts.sql.' : m ?? null);

/** The address another app POSTs contacts to. */
export function incomingUrl(token: string, base = import.meta.env.VITE_SUPABASE_URL as string): string {
  return `${String(base).replace(/\/+$/, '')}/functions/v1/api/incoming/${token}`;
}

/** "VIP, Lead ,, vip" → ["VIP", "Lead"]: trimmed, blanks and repeats (any case) dropped. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  return text.split(',').map((t) => t.trim().slice(0, 60)).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/** A ready-to-run example for the link, so people can see it work before wiring up an app. */
export function curlExample(url: string): string {
  return [
    `curl -X POST '${url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"first_name": "Jane", "last_name": "Doe", "email": "jane@example.com", "phone": "+1 555 010 2000", "tags": ["New lead"], "message": "Please call me back"}'`,
  ].join('\n');
}

export const FIELD_HELP: { field: string; also: string }[] = [
  { field: 'email', also: 'email_address' },
  { field: 'phone', also: 'phone_number, mobile' },
  { field: 'first_name', also: 'firstName, or name / full_name for the whole name' },
  { field: 'last_name', also: 'lastName, surname' },
  { field: 'company', also: 'company_name, organization' },
  { field: 'job_title', also: 'title, position' },
  { field: 'date_of_birth', also: 'birthday, dob (YYYY-MM-DD)' },
  { field: 'source', also: 'utm_source' },
  { field: 'tags', also: 'a list ["VIP"] or "VIP, Lead"' },
  { field: 'message', also: 'note, comment: saved as a note on the contact' },
];

export async function listLinks(workspaceId: string) {
  const { data, error } = await supabase.from('inbound_links').select(LINK_COLS).eq('workspace_id', workspaceId).order('created_at');
  return { data: (data ?? []) as InboundLink[], error: tableError(error?.message) };
}

export async function createLink(workspaceId: string, userId: string | undefined, l: { name: string; tags: string[]; source: string }) {
  const { data, error } = await supabase.from('inbound_links')
    .insert({ workspace_id: workspaceId, created_by: userId ?? null, name: l.name.trim(), tags: l.tags, source: l.source.trim() || null })
    .select(LINK_COLS).single();
  return { data: data as InboundLink | null, error: tableError(error?.message) };
}

export async function updateLink(id: string, changes: Partial<Pick<InboundLink, 'name' | 'tags' | 'source' | 'revoked_at'>>) {
  const { error } = await supabase.from('inbound_links').update(changes).eq('id', id);
  return tableError(error?.message);
}

export async function deleteLink(id: string) {
  const { error } = await supabase.from('inbound_links').delete().eq('id', id);
  return tableError(error?.message);
}

export async function listCalls(linkId: string, limit = 25) {
  const { data, error } = await supabase.from('inbound_log').select('id, ok, created, contact_id, error, payload, at').eq('link_id', linkId).order('at', { ascending: false }).limit(limit);
  return { data: (data ?? []) as InboundCall[], error: tableError(error?.message) };
}
