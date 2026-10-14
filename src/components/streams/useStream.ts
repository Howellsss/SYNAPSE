import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteTrack, Room } from 'livekit-client';
import { useMeetingBus } from '@/meetings/useMeetingBus';
import { newChatId } from '@/meetings/messages';
import { STREAM_TOPICS, parseReaction, parseStreamChat, type StreamChatLine } from '@/lib/streams';

/** Plays the host's microphone and shared-screen sound for viewers. */
export function useStreamAudio(room: Room | null) {
  useEffect(() => {
    if (!room) return;
    const box = document.createElement('div');
    box.style.display = 'none';
    box.dataset.streamAudio = '';
    document.body.appendChild(box);
    const attach = (track: RemoteTrack) => { if (track.kind === 'audio') box.appendChild(track.attach()); };
    const detach = (track: RemoteTrack) => { if (track.kind === 'audio') track.detach().forEach((el) => el.remove()); };
    for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) if (pub.track && pub.kind === 'audio') attach(pub.track as RemoteTrack);
    room.on('trackSubscribed', attach).on('trackUnsubscribed', detach);
    return () => { room.off('trackSubscribed', attach).off('trackUnsubscribed', detach); box.remove(); };
  }, [room]);
}

export interface FloatingReaction { id: number; e: string; left: number }

/** Chat and reactions over the stream's data channel. */
export function useStreamChat(room: Room | null, me: { id: string; name: string }, hostId: string) {
  const bus = useMeetingBus(room);
  const [lines, setLines] = useState<StreamChatLine[]>([]);
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const nextId = useRef(0);
  const names = useRef(new Map<string, string>());

  const float = useCallback((e: string) => {
    const id = nextId.current++;
    setFloating((f) => [...f.slice(-30), { id, e, left: 10 + Math.random() * 80 }]);
    window.setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 2600);
  }, []);

  useEffect(() => {
    if (!room) return;
    const remember = () => { for (const p of room.remoteParticipants.values()) names.current.set(p.identity, p.name || 'Viewer'); };
    remember();
    room.on('participantConnected', remember);
    return () => { room.off('participantConnected', remember); };
  }, [room]);

  useEffect(() => bus.on(STREAM_TOPICS.chat, (raw, from) => {
    const m = parseStreamChat(raw);
    if (!m) return;
    const name = names.current.get(from) ?? room?.remoteParticipants.get(from)?.name ?? 'Viewer';
    setLines((l) => (l.some((x) => x.id === m.id) ? l : [...l.slice(-299), { id: m.id, from, name, text: m.text, at: Date.now(), host: from === hostId }]));
  }), [bus, room, hostId]);
  useEffect(() => bus.on(STREAM_TOPICS.react, (raw) => { const e = parseReaction(raw); if (e) float(e); }), [bus, float]);

  const lastSent = useRef(0);
  const send = useCallback((text: string) => {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!t || Date.now() - lastSent.current < 800) return false;
    lastSent.current = Date.now();
    const id = newChatId();
    void bus.send(STREAM_TOPICS.chat, { id, text: t });
    setLines((l) => [...l.slice(-299), { id, from: me.id, name: me.name, text: t, at: Date.now(), host: me.id === hostId }]);
    return true;
  }, [bus, me.id, me.name, hostId]);

  const lastReact = useRef(0);
  const react = useCallback((e: string) => {
    if (Date.now() - lastReact.current < 400) return;
    lastReact.current = Date.now();
    void bus.send(STREAM_TOPICS.react, { e }, { reliable: false });
    float(e);
  }, [bus, float]);

  return { bus, lines, send, react, floating };
}

