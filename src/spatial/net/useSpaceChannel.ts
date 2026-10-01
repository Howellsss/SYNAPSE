import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MoveSender, type LocalState } from './moveSender';
import { RemoteMover } from './interpolation';
import {
  mergePresence, parseAdmit, parseEmote, parseKnock, parseMove, parsePath,
  type AdmitMsg, type EmoteKind, type EmoteMsg, type KnockMsg, type MoveMsg, type PathMsg, type PresenceMeta,
} from './protocol';
import type { ConnectionState } from './status';

/** What you share about yourself; joinedAt and away are filled in by the hook. */
export type MeInput = Omit<PresenceMeta, 'joinedAt' | 'away'>;

type RealtimeChannel = ReturnType<typeof supabase.channel>;

/** Remote people's movers, kept outside React state so 10 updates a second don't re-render the page. */
export class RemoteStore {
  private movers = new Map<string, RemoteMover>();
  get(userId: string): RemoteMover {
    let m = this.movers.get(userId);
    if (!m) { m = new RemoteMover(); this.movers.set(userId, m); }
    return m;
  }
  has(userId: string) { return this.movers.has(userId); }
  /** Where someone is drawn right now, without creating a mover. */
  pose(userId: string, now: number) { return this.movers.get(userId)?.sample(now) ?? null; }
  ids() { return [...this.movers.keys()]; }
  /** Forget people who left. */
  keepOnly(ids: Set<string>) {
    for (const id of this.movers.keys()) if (!ids.has(id)) this.movers.delete(id);
  }
}

/**
 * The realtime channel for one space (`space:<spaceId>`): presence for who's here, broadcast for
 * movement and emotes. Tracks you on join, re-tracks after a reconnect, untracks on leave.
 */
export function useSpaceChannel(spaceId: string | null, me: MeInput | null, away: boolean) {
  const [people, setPeople] = useState<PresenceMeta[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinedAt = useRef(new Date().toISOString());
  const remotes = useRef(new RemoteStore()).current;
  const presentIds = useRef(new Set<string>());
  const emoteListeners = useRef(new Set<(e: EmoteMsg) => void>());
  const roomListeners = useRef(new Set<(e: { knock?: KnockMsg; admit?: AdmitMsg }) => void>());
  const lastLocal = useRef<LocalState | null>(null);
  const userId = me?.userId ?? null;
  const payload = useMemo(() => (me ? JSON.stringify({ ...me, away }) : null), [me, away]);

  const send = useCallback((event: 'move' | 'path' | 'emote' | 'knock' | 'admit', body: MoveMsg | PathMsg | EmoteMsg | KnockMsg | AdmitMsg) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({ type: 'broadcast', event, payload: body }).catch(() => {});
  }, []);

  const sender = useMemo(
    () => (userId ? new MoveSender(userId, (m) => send('move', m), (p) => send('path', p)) : null),
    [userId, send],
  );
  const senderRef = useRef(sender);
  senderRef.current = sender;

  useEffect(() => {
    if (!spaceId || !userId) return;
    setConnection('connecting');
    let subscribed = false;
    const channel = supabase.channel(`space:${spaceId}`, {
      config: { presence: { key: userId }, broadcast: { self: false, ack: false } },
    });
    channelRef.current = channel;

    // Only accept movement from people who are present, and never for yourself.
    const accept = (id: string) => id !== userId && presentIds.current.has(id);

    channel
      .on('presence', { event: 'sync' }, () => {
        const list = mergePresence(channel.presenceState() as unknown as Record<string, unknown[]>);
        const before = presentIds.current;
        presentIds.current = new Set(list.map((p) => p.userId));
        // Someone new arrived: send where you are once, so they see you without waiting for a heartbeat.
        if (list.some((p) => p.userId !== userId && !before.has(p.userId)) && lastLocal.current) {
          senderRef.current?.flush(lastLocal.current);
        }
        remotes.keepOnly(presentIds.current);
        setPeople(list);
      })
      .on('broadcast', { event: 'move' }, ({ payload: raw }) => {
        const m = parseMove(raw);
        if (m && accept(m.userId)) remotes.get(m.userId).receiveMove(m, performance.now());
      })
      .on('broadcast', { event: 'path' }, ({ payload: raw }) => {
        const p = parsePath(raw);
        if (p && accept(p.userId)) remotes.get(p.userId).receivePath(p, performance.now());
      })
      .on('broadcast', { event: 'emote' }, ({ payload: raw }) => {
        const e = parseEmote(raw);
        if (!e || !accept(e.userId) || (e.to && e.to !== userId)) return;
        emoteListeners.current.forEach((fn) => fn(e));
      })
      .on('broadcast', { event: 'knock' }, ({ payload: raw }) => {
        const k = parseKnock(raw);
        if (k && accept(k.userId)) roomListeners.current.forEach((fn) => fn({ knock: k }));
      })
      .on('broadcast', { event: 'admit' }, ({ payload: raw }) => {
        const a = parseAdmit(raw);
        if (a && accept(a.userId) && a.to === userId) roomListeners.current.forEach((fn) => fn({ admit: a }));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          setConnection('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // supabase-js keeps retrying; we show "Reconnecting…" meanwhile.
          setConnection(subscribed ? 'reconnecting' : 'offline');
        } else if (status === 'CLOSED') {
          setConnection(subscribed ? 'reconnecting' : 'offline');
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
  }, [spaceId, userId, remotes]);

  // Track yourself once connected, re-track on every reconnect, and share changes without rejoining.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !payload || connection !== 'connected') return;
    ch.track({ ...JSON.parse(payload), joinedAt: joinedAt.current }).catch(() => {});
  }, [payload, connection]);

  // After (re)connecting, send where you are so others place you straight away.
  useEffect(() => {
    if (connection === 'connected' && sender && lastLocal.current) sender.flush(lastLocal.current);
  }, [connection, sender]);

  /** Call every frame with your avatar's state; sends only when needed. */
  const updateLocal = useCallback((state: LocalState) => {
    lastLocal.current = state;
    sender?.update(state);
  }, [sender]);

  const startPath = useCallback((points: [number, number][], speed: number, sitAtEnd = false) => sender?.startPath(points, speed, sitAtEnd), [sender]);
  const endPath = useCallback(() => sender?.endPath(), [sender]);

  const sendEmote = useCallback((kind: EmoteKind, to: string | null = null) => {
    if (!userId) return;
    send('emote', { userId, kind, to, t: Date.now() });
  }, [send, userId]);

  const onEmote = useCallback((fn: (e: EmoteMsg) => void) => {
    emoteListeners.current.add(fn);
    return () => { emoteListeners.current.delete(fn); };
  }, []);

  const sendKnock = useCallback((zoneId: string) => {
    if (userId) send('knock', { userId, zoneId, t: Date.now() });
  }, [send, userId]);
  const sendAdmit = useCallback((to: string, zoneId: string) => {
    if (userId) send('admit', { userId, to, zoneId, t: Date.now() });
  }, [send, userId]);
  const onRoomSignal = useCallback((fn: (e: { knock?: KnockMsg; admit?: AdmitMsg }) => void) => {
    roomListeners.current.add(fn);
    return () => { roomListeners.current.delete(fn); };
  }, []);

  return { people, connection, remotes, updateLocal, startPath, endPath, sendEmote, onEmote, sendKnock, sendAdmit, onRoomSignal };
}
