import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type PresenceStatus = 'available' | 'busy' | 'focus' | 'dnd';

export const STATUS_OPTIONS: { value: PresenceStatus; label: string; dot: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-green-500' },
  { value: 'busy', label: 'Busy', dot: 'bg-gold-500' },
  { value: 'focus', label: 'Focus', dot: 'bg-indigo-500' },
  { value: 'dnd', label: 'Do not disturb', dot: 'bg-burgundy-500' },
];

export const statusInfo = (s: PresenceStatus | undefined) => STATUS_OPTIONS.find((o) => o.value === s) ?? STATUS_OPTIONS[0];

const STATUS_KEY = 'synapse.status';

export function loadStatus(): PresenceStatus {
  try {
    const v = localStorage.getItem(STATUS_KEY);
    return STATUS_OPTIONS.some((o) => o.value === v) ? (v as PresenceStatus) : 'available';
  } catch {
    return 'available';
  }
}

export function saveStatus(s: PresenceStatus) {
  try { localStorage.setItem(STATUS_KEY, s); } catch { /* private mode */ }
}

/** What each person shares with everyone else in the space while they're in it. */
export interface PresencePerson {
  user_id: string;
  name: string;
  avatar_url: string | null;
  status: PresenceStatus;
  /** Zone id they're standing in, or null for the open floor. Filled once the 3D office exists. */
  zone: string | null;
  /** Ids of the people in their conversation circle. Filled by proximity video. */
  conversation: string[];
  joined_at: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/**
 * Merges presence entries into one row per person. Someone with two tabs open appears once,
 * using the most recently joined tab.
 */
export function mergePresence(state: Record<string, PresencePerson[]>): PresencePerson[] {
  const byUser = new Map<string, PresencePerson>();
  for (const entries of Object.values(state)) {
    for (const p of entries) {
      if (!p?.user_id) continue;
      const prev = byUser.get(p.user_id);
      if (!prev || p.joined_at > prev.joined_at) byUser.set(p.user_id, p);
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Live list of who's in a space, over a Supabase Realtime presence channel.
 * `me` is re-sent whenever it changes (status, zone); leaving the page leaves the channel.
 */
export function useSpacePresence(spaceId: string | null, me: Omit<PresencePerson, 'joined_at'> | null) {
  const [people, setPeople] = useState<PresencePerson[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const joinedAt = useRef(new Date().toISOString());
  const userId = me?.user_id ?? null;
  const payload = useMemo(() => (me ? JSON.stringify(me) : null), [me]);

  useEffect(() => {
    if (!spaceId || !userId) return;
    setConnection('connecting');
    let subscribed = false;
    const channel = supabase.channel(`space:${spaceId}`, { config: { presence: { key: userId } } });
    channelRef.current = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        setPeople(mergePresence(channel.presenceState<PresencePerson>() as unknown as Record<string, PresencePerson[]>));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          setConnection('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnection(subscribed ? 'reconnecting' : 'offline');
        } else if (status === 'CLOSED') {
          setConnection('offline');
        }
      });

    const goOffline = () => setConnection('offline');
    const goOnline = () => setConnection(subscribed ? 'reconnecting' : 'connecting');
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      channelRef.current = null;
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, [spaceId, userId]);

  // Share yourself once connected, and any change (status, zone) without rejoining.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !payload || connection !== 'connected') return;
    ch.track({ ...JSON.parse(payload), joined_at: joinedAt.current }).catch(() => {});
  }, [payload, connection]);

  return { people, connection };
}
