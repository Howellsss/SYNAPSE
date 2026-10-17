import { tableTag } from './keys';

/** RPCs that only read: calling them changes nothing cached. Any other RPC refreshes everything. */
const READ_ONLY_RPC = new Set([
  'workspace_directory', 'stream_by_watch', 'public_ticket', 'public_events', 'public_event_stats', 'public_event',
  'meeting_by_invite', 'is_space_slug_available', 'is_platform_admin', 'get_invitation', 'get_form_submission_counts',
  'chat_unread', 'room_heartbeat', 'dashboard_summary',
]);

/**
 * What a request to Supabase changes, for refreshing the cache: the table's tag for a write to a
 * table, '*' (everything) for an RPC that may write, nothing for reads. Every write in SYNAPSE goes
 * through the Supabase client, so checking here catches them all.
 */
export function tagsWrittenBy(url: string, method: string): string[] | '*' {
  const m = method.toUpperCase();
  let path: string;
  try { path = new URL(url).pathname; } catch { return []; }
  const rest = path.match(/\/rest\/v1\/(.+)$/);
  if (!rest) return [];
  const [first, second] = rest[1].split('/');
  if (first === 'rpc') return second && READ_ONLY_RPC.has(second) ? [] : '*';
  if (m === 'GET' || m === 'HEAD') return [];
  return [tableTag(first)];
}
