/**
 * API keys: other apps read and change contacts, tags and notes with a key.
 * Database: 20261102090000_api_keys.sql; Edge Function: api (supabase/functions/api).
 */
import { supabase } from '@/lib/supabase';

export interface ApiKey { id: string; name: string; prefix: string; can_write: boolean; created_at: string; last_used_at: string | null; revoked_at: string | null }
export interface ApiCall { id: number; method: string; path: string; status: number; error: string | null; at: string }

const KEY_COLS = 'id, name, prefix, can_write, created_at, last_used_at, revoked_at';
const dbError = (m: string | undefined) =>
  (m && /api_(keys|log|key_create|key_revoke)|schema cache|does not exist|Could not find the function/i.test(m) ? 'API keys need the database update 20261102090000_api_keys.sql.' : m ?? null);

/** Where the API lives: requests go to <base>/contacts and so on. */
export function apiBase(base = import.meta.env.VITE_SUPABASE_URL as string): string {
  return `${String(base).replace(/\/+$/, '')}/functions/v1/api/v1`;
}

export const ENDPOINTS: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; what: string }[] = [
  { method: 'GET', path: '/me', what: 'Check the key: your account and the key’s access' },
  { method: 'GET', path: '/contacts', what: 'Newest first. Filters: ?email= ?phone= ?tag= ?q= ?created_after= ?updated_after=, pages with ?limit= (up to 100) and ?offset=' },
  { method: 'POST', path: '/contacts', what: 'Add a contact, or update the one with the same email or phone. Also takes "tags" and a "note"' },
  { method: 'GET', path: '/contacts/{id}', what: 'One contact' },
  { method: 'PATCH', path: '/contacts/{id}', what: 'Change the fields sent; the rest stay as they are' },
  { method: 'DELETE', path: '/contacts/{id}', what: 'Delete a contact' },
  { method: 'POST', path: '/contacts/{id}/tags', what: 'Add tags: { "tags": ["VIP"] }' },
  { method: 'DELETE', path: '/contacts/{id}/tags/{tag}', what: 'Remove a tag by name' },
  { method: 'GET', path: '/contacts/{id}/notes', what: 'The latest 50 notes' },
  { method: 'POST', path: '/contacts/{id}/notes', what: 'Add a note: { "content": "…" }' },
  { method: 'GET', path: '/tags', what: 'Every tag in the account' },
];

/** A ready-to-run first call. */
export function curlMe(base: string, key = 'syn_…'): string {
  return `curl '${base}/me' \\\n  -H 'Authorization: Bearer ${key}'`;
}

export async function listKeys(workspaceId: string) {
  const { data, error } = await supabase.from('api_keys').select(KEY_COLS).eq('workspace_id', workspaceId).order('created_at');
  return { data: (data ?? []) as ApiKey[], error: dbError(error?.message) };
}

/** Make a key. The key itself is only ever returned here. */
export async function createKey(workspaceId: string, name: string, canWrite: boolean) {
  const { data, error } = await supabase.rpc('api_key_create', { p_workspace: workspaceId, p_name: name.trim(), p_can_write: canWrite });
  const r = data as { id: string; key: string } | null;
  return { id: r?.id ?? null, key: r?.key ?? null, error: dbError(error?.message) };
}

export async function revokeKey(id: string) {
  const { error } = await supabase.rpc('api_key_revoke', { p_key: id });
  return dbError(error?.message);
}

export async function deleteKey(id: string) {
  const { error } = await supabase.from('api_keys').delete().eq('id', id);
  return dbError(error?.message);
}

export async function listCalls(keyId: string, limit = 25) {
  const { data, error } = await supabase.from('api_log').select('id, method, path, status, error, at').eq('key_id', keyId).order('at', { ascending: false }).limit(limit);
  return { data: (data ?? []) as ApiCall[], error: dbError(error?.message) };
}
