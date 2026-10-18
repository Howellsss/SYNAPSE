/**
 * Who is around, and what they are up to.
 *
 * - Online: worked out live with Supabase Realtime presence (nothing stored). Everyone with
 *   SYNAPSE open in the account shows as online.
 * - Status and away: stored in `member_status` (migration 20261018090000_member_status.sql), so
 *   others see them and they survive a reload. Until that file is run the app says so instead of
 *   failing.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface MemberStatus {
  workspace_id: string;
  user_id: string;
  emoji: string | null;
  text: string | null;
  clear_at: string | null;
  away: boolean;
  updated_at: string;
}

export const STATUS_NOT_SET_UP = 'Statuses need the database update 02_member_status.sql (run it in the Supabase SQL editor).';

/** One-click statuses, each clearing itself after a sensible time. */
export const STATUS_PRESETS: { emoji: string; text: string; clear: ClearAfter }[] = [
  { emoji: '📅', text: 'In a meeting', clear: '1h' },
  { emoji: '🎧', text: 'Focusing', clear: '2h' },
  { emoji: '🚌', text: 'Commuting', clear: '30m' },
  { emoji: '🤒', text: 'Out sick', clear: 'today' },
  { emoji: '🌴', text: 'On holiday', clear: 'never' },
];

export type ClearAfter = '30m' | '1h' | '2h' | '4h' | 'today' | 'week' | 'never';
export const CLEAR_LABEL: Record<ClearAfter, string> = {
  '30m': '30 minutes', '1h': '1 hour', '2h': '2 hours', '4h': '4 hours', today: 'Today', week: 'This week', never: "Don't clear",
};

/** When a status chosen at `now` should clear. Today ends at midnight; the week ends on Sunday night. */
export function clearAtFor(after: ClearAfter, now = new Date()): Date | null {
  const mins = { '30m': 30, '1h': 60, '2h': 120, '4h': 240 } as const;
  if (after in mins) return new Date(now.getTime() + mins[after as keyof typeof mins] * 60_000);
  if (after === 'today' || after === 'week') {
    const d = new Date(now);
    d.setHours(23, 59, 59, 0);
    if (after === 'week') d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    return d;
  }
  return null;
}

/** The status line still showing (it clears itself once `clear_at` has passed). */
export function liveStatus(s: MemberStatus | undefined, now = Date.now()): { emoji: string | null; text: string } | null {
  if (!s || (!s.text && !s.emoji)) return null;
  if (s.clear_at && new Date(s.clear_at).getTime() <= now) return null;
  return { emoji: s.emoji, text: s.text ?? '' };
}

/** "until 3:30 PM", "until tomorrow", or '' when it never clears. */
export function untilLabel(clearAt: string | null, now = new Date()): string {
  if (!clearAt) return '';
  const d = new Date(clearAt);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay && !(d.getHours() === 23 && d.getMinutes() === 59)) return `until ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (sameDay) return 'until tonight';
  return `until ${d.toLocaleDateString(undefined, { weekday: 'long' })}`;
}

const missing = (code?: string, message?: string) => code === '42P01' || code === 'PGRST205' || /member_status/.test(message ?? '');

export async function loadStatuses(workspaceId: string): Promise<{ data: MemberStatus[]; ready: boolean }> {
  const { data, error } = await supabase.from('member_status').select('*').eq('workspace_id', workspaceId);
  if (error) return { data: [], ready: !missing(error.code, error.message) };
  return { data: (data ?? []) as MemberStatus[], ready: true };
}

export async function saveStatus(workspaceId: string, userId: string, change: Partial<Pick<MemberStatus, 'emoji' | 'text' | 'clear_at' | 'away'>>): Promise<{ data: MemberStatus | null; error: string | null }> {
  const { data, error } = await supabase.from('member_status')
    .upsert({ workspace_id: workspaceId, user_id: userId, ...change, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,user_id' })
    .select('*').single();
  if (error) return { data: null, error: missing(error.code, error.message) ? STATUS_NOT_SET_UP : error.message };
  return { data: data as MemberStatus, error: null };
}

/**
 * Live view of the account: who is online right now (presence) and everyone's status (table).
 * Your own presence is announced while this hook is mounted.
 */
export function usePresence(workspaceId: string | undefined, me: string) {
  // You are always here to yourself, even before the live connection is up.
  const [online, setOnline] = useState<Set<string>>(() => new Set(me ? [me] : []));
  const [statuses, setStatuses] = useState<Map<string, MemberStatus>>(new Map());
  const [ready, setReady] = useState(true);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!workspaceId || !me) return;
    let alive = true;
    loadStatuses(workspaceId).then((r) => {
      if (!alive) return;
      setReady(r.ready);
      setStatuses(new Map(r.data.map((s) => [s.user_id, s])));
    });
    const ch = supabase.channel(`presence:${workspaceId}`, { config: { presence: { key: me } } })
      .on('presence', { event: 'sync' }, () => setOnline(new Set([me, ...Object.keys(ch.presenceState())])))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_status', filter: `workspace_id=eq.${workspaceId}` }, (p) => {
        const row = (p.new && 'user_id' in p.new ? p.new : p.old) as MemberStatus;
        setStatuses((m) => { const n = new Map(m); if (p.eventType === 'DELETE') n.delete(row.user_id); else n.set(row.user_id, row); return n; });
      })
      .subscribe((state) => { if (state === 'SUBSCRIBED') void ch.track({ at: new Date().toISOString() }); });
    // Statuses clear themselves on time, so look again every minute.
    const timer = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => { alive = false; window.clearInterval(timer); void supabase.removeChannel(ch); };
  }, [workspaceId, me]);

  const set = (s: MemberStatus) => setStatuses((m) => new Map(m).set(s.user_id, s));
  return { online, statuses, ready, set };
}
