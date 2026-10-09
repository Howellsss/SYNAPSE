import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Room } from 'livekit-client';

type Listener = (msg: unknown, from: string) => void;

export const TOPICS = {
  annotate: 'synapse.annotate',
  chat: 'synapse.chat',
  react: 'synapse.react',
  control: 'synapse.control',
  poll: 'synapse.poll',
  board: 'synapse.board',
  captions: 'synapse.captions',
  record: 'synapse.record',
} as const;

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Small JSON messages between people in a meeting, over LiveKit's data channel.
 * `from` is the sender's LiveKit identity (set by the server), never taken from the message.
 */
export function useMeetingBus(room: Room | null) {
  const listeners = useRef(new Map<string, Set<Listener>>());

  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string) => {
      if (!topic || !participant) return;
      const set = listeners.current.get(topic);
      if (!set?.size) return;
      let msg: unknown;
      try { msg = JSON.parse(dec.decode(payload)); } catch { return; }
      set.forEach((fn) => fn(msg, participant.identity));
    };
    room.on('dataReceived', onData);
    return () => { room.off('dataReceived', onData); };
  }, [room]);

  const send = useCallback(async (topic: string, msg: unknown, opts: { reliable?: boolean; to?: string[] } = {}): Promise<void> => {
    if (!room) return;
    await room.localParticipant
      .publishData(enc.encode(JSON.stringify(msg)), { reliable: opts.reliable ?? true, topic, destinationIdentities: opts.to })
      .catch(() => { /* dropped: the room is reconnecting */ });
  }, [room]);

  const on = useCallback((topic: string, fn: Listener) => {
    const map = listeners.current;
    if (!map.has(topic)) map.set(topic, new Set());
    map.get(topic)!.add(fn);
    return () => { map.get(topic)?.delete(fn); };
  }, []);

  return useMemo(() => ({ send, on }), [send, on]);
}

export type MeetingBus = ReturnType<typeof useMeetingBus>;
