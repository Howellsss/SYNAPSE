import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { supabase } from '@/lib/supabase';
import { MoveSender, type LocalState } from './moveSender';
import { RemoteMover } from './interpolation';
import {
  mergePresence, parseAdmit, parseEmote, parseKnock, parseLayout, parseMove, parsePath,
  type AdmitMsg, type EmoteKind, type Gait, type EmoteMsg, type KnockMsg, type LayoutMsg, type MoveMsg, type PathMsg, type PresenceMeta,
} from './protocol';
import type { ConnectionState } from './status';

/** What you share about yourself; joinedAt and away are filled in by the hook. */
export type MeInput = Omit<PresenceMeta, 'joinedAt' | 'away'>;

type RealtimeChannel = ReturnType<typeof supabase.channel>;
type SpaceEvent = 'move' | 'path' | 'emote' | 'knock' | 'admit' | 'layout';

/** LiveKit data topic for movement and signals inside a space. */
export const SPACE_TOPIC = 'synapse.space';
const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Who still needs a message over the realtime channel: people present in the space who aren't
 * connected to its call (everyone else gets it over the call's data channel).
 */
export function needsRealtime(present: Iterable<string>, inCall: Set<string>, me: string): boolean {
  for (const id of present) if (id !== me && !inCall.has(id)) return true;
  return false;
}

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
 *
 * Once the space's call is connected (`setCallRoom`), movement, emotes and knocks go over the
 * call's data channel instead: Supabase counts every broadcast once per receiver (100 a second on
 * the free plan), LiveKit doesn't, so a 50-person space stays within the free plan. The realtime
 * channel still carries presence, and anything for people who aren't in the call.
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
  const layoutListeners = useRef(new Set<() => void>());
  const lastLocal = useRef<LocalState | null>(null);
  const userId = me?.userId ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  // Emotes and knocks can arrive over both channels (when someone isn't in the call): once each.
  const seenSignals = useRef(new Set<string>());
  const payload = useMemo(() => (me ? JSON.stringify({ ...me, away }) : null), [me, away]);

  const [callRoom, setCallRoom] = useState<Room | null>(null);
  const callRef = useRef<Room | null>(null);
  callRef.current = callRoom;

  const send = useCallback((event: SpaceEvent, body: MoveMsg | PathMsg | EmoteMsg | KnockMsg | AdmitMsg | LayoutMsg) => {
    const room = callRef.current;
    if (room && room.state === 'connected') {
      room.localParticipant
        .publishData(enc.encode(JSON.stringify({ e: event, p: body })), { reliable: event !== 'move', topic: SPACE_TOPIC })
        .catch(() => { /* reconnecting: the next update or heartbeat catches up */ });
      const inCall = new Set([...room.remoteParticipants.values()].map((x) => x.identity));
      if (!needsRealtime(presentIds.current, inCall, userIdRef.current ?? '')) return;
    }
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

  /** One incoming message, from either channel. `from` is the call identity when it came over the call. */
  const handle = (event: SpaceEvent, raw: unknown, from?: string) => {
    // Only accept messages from people who are present, never for yourself, and over the call
    // only from the person they claim to be from.
    const accept = (id: string) => id !== userId && presentIds.current.has(id) && (from === undefined || from === id);
    const once = (key: string) => {
      if (seenSignals.current.has(key)) return false;
      seenSignals.current.add(key);
      if (seenSignals.current.size > 500) seenSignals.current = new Set([...seenSignals.current].slice(-250));
      return true;
    };
    if (event === 'move') {
      const m = parseMove(raw);
      if (m && accept(m.userId)) remotes.get(m.userId).receiveMove(m, performance.now());
    } else if (event === 'path') {
      const p = parsePath(raw);
      if (p && accept(p.userId)) remotes.get(p.userId).receivePath(p, performance.now());
    } else if (event === 'emote') {
      const e = parseEmote(raw);
      if (!e || !accept(e.userId) || (e.to && e.to !== userId) || !once(`e:${e.userId}:${e.t}:${e.kind}`)) return;
      emoteListeners.current.forEach((fn) => fn(e));
    } else if (event === 'knock') {
      const k = parseKnock(raw);
      if (k && accept(k.userId) && once(`k:${k.userId}:${k.t}`)) roomListeners.current.forEach((fn) => fn({ knock: k }));
    } else if (event === 'admit') {
      const a = parseAdmit(raw);
      if (a && accept(a.userId) && a.to === userId && once(`a:${a.userId}:${a.t}`)) roomListeners.current.forEach((fn) => fn({ admit: a }));
    } else if (event === 'layout') {
      const l = parseLayout(raw);
      if (l && accept(l.userId) && once(`l:${l.userId}:${l.t}`)) layoutListeners.current.forEach((fn) => fn());
    }
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // Movement over the call's data channel.
  useEffect(() => {
    if (!callRoom) return;
    const onData = (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string) => {
      if (topic !== SPACE_TOPIC || !participant) return;
      let msg: { e?: unknown; p?: unknown };
      try { msg = JSON.parse(dec.decode(payload)); } catch { return; }
      if (msg.e === 'move' || msg.e === 'path' || msg.e === 'emote' || msg.e === 'knock' || msg.e === 'admit' || msg.e === 'layout') handleRef.current(msg.e, msg.p, participant.identity);
    };
    callRoom.on('dataReceived', onData);
    // Joined the call: send where you are so people place you straight away.
    if (lastLocal.current) senderRef.current?.flush(lastLocal.current);
    return () => { callRoom.off('dataReceived', onData); };
  }, [callRoom]);

  useEffect(() => {
    if (!spaceId || !userId) return;
    setConnection('connecting');
    let subscribed = false;
    const channel = supabase.channel(`space:${spaceId}`, {
      config: { presence: { key: userId }, broadcast: { self: false, ack: false } },
    });
    channelRef.current = channel;

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
      .on('broadcast', { event: 'move' }, ({ payload }) => handleRef.current('move', payload))
      .on('broadcast', { event: 'path' }, ({ payload }) => handleRef.current('path', payload))
      .on('broadcast', { event: 'emote' }, ({ payload }) => handleRef.current('emote', payload))
      .on('broadcast', { event: 'knock' }, ({ payload }) => handleRef.current('knock', payload))
      .on('broadcast', { event: 'admit' }, ({ payload }) => handleRef.current('admit', payload))
      .on('broadcast', { event: 'layout' }, ({ payload }) => handleRef.current('layout', payload))
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

  const startPath = useCallback((points: [number, number][], speed: number, sitAtEnd = false, gait: Gait = 'walk') => sender?.startPath(points, speed, sitAtEnd, gait), [sender]);
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

  /** Build mode: tell everyone the campus changed (they reload it). */
  const sendLayout = useCallback(() => {
    if (userId) send('layout', { userId, t: Date.now() });
  }, [send, userId]);
  const onLayout = useCallback((fn: () => void) => {
    layoutListeners.current.add(fn);
    return () => { layoutListeners.current.delete(fn); };
  }, []);

  return { people, connection, remotes, updateLocal, startPath, endPath, sendEmote, onEmote, sendKnock, sendAdmit, onRoomSignal, sendLayout, onLayout, setCallRoom };
}
