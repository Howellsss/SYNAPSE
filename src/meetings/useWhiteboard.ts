import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { TOPICS, type MeetingBus } from './useMeetingBus';

/** Drawings on the whiteboard use their own channel, apart from screen annotations. */
export const BOARD_DRAW_TOPIC = 'synapse.board.draw';

export interface WhiteboardState {
  /** Who opened the whiteboard (their drawings are the reference copy), or null when closed. */
  owner: string | null;
  open: () => void;
  close: () => void;
  /** You may close it: you opened it, or you're the host. */
  canClose: boolean;
}

const isBoardMsg = (raw: unknown): raw is { t: 'board'; open: boolean } =>
  !!raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'board' && typeof (raw as { open?: unknown }).open === 'boolean';

/**
 * A shared whiteboard, like Zoom's: anyone can open one for everyone, and everyone can draw on it.
 * Whoever opened it (or the host) can close it. Nothing is saved after the meeting unless someone
 * saves it as an image.
 */
export function useWhiteboard({ bus, room, me, hostId }: { bus: MeetingBus; room: Room | null; me: string; hostId: string }): WhiteboardState {
  const [owner, setOwner] = useState<string | null>(null);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  useEffect(() => bus.on(TOPICS.board, (raw, from) => {
    if (!isBoardMsg(raw)) return;
    if (raw.open) setOwner(from);
    else if (from === ownerRef.current || from === hostId) setOwner(null);
  }), [bus, hostId]);

  useEffect(() => {
    if (!room) return;
    // Late joiners: whoever has the board open tells them. If they leave, the board closes.
    const onJoin = (p: { identity: string }) => { if (ownerRef.current === me) void bus.send(TOPICS.board, { t: 'board', open: true }, { to: [p.identity] }); };
    const onGone = (p: { identity: string }) => { if (p.identity === ownerRef.current) setOwner(null); };
    room.on('participantConnected', onJoin).on('participantDisconnected', onGone);
    return () => { room.off('participantConnected', onJoin).off('participantDisconnected', onGone); };
  }, [room, bus, me]);

  const open = useCallback(() => {
    setOwner(me);
    void bus.send(TOPICS.board, { t: 'board', open: true });
  }, [bus, me]);
  const close = useCallback(() => {
    setOwner(null);
    void bus.send(TOPICS.board, { t: 'board', open: false });
  }, [bus]);

  return { owner, open, close, canClose: !!owner && (owner === me || me === hostId) };
}
