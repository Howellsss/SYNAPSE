import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { TOPICS, type MeetingBus } from './useMeetingBus';
import { newChatId } from './messages';
import { parseCaptionMsg, speechRecognitionCtor, type SpeechRecognitionLike, type TranscriptLine } from './captions';

/** A caption on screen: someone's words as they speak. */
export interface LiveCaption { who: string; name: string; text: string; at: number }

export interface Captions {
  /** Captions are on for the meeting. */
  on: boolean;
  /** You can hide them on your screen without turning them off for others. */
  shown: boolean;
  setShown: (v: boolean) => void;
  /** This browser can caption your voice. */
  supported: boolean;
  /** Why your voice isn't being captioned, if it isn't. */
  problem: string | null;
  live: LiveCaption[];
  transcript: TranscriptLine[];
  turnOn: () => void;
  turnOff: () => void;
}

const SHOW_MS = 6000;

/**
 * Anyone can turn captions on or off for the meeting. While they're on, each person's browser
 * captions their own voice (only while their mic is on) and shares the words.
 */
export function useCaptions({ bus, room, me, myName, micOn, names }: { bus: MeetingBus; room: Room | null; me: string; myName: string; micOn: boolean; names: Record<string, string> }): Captions {
  const [on, setOn] = useState(false);
  const [shown, setShown] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState<LiveCaption[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const onRef = useRef(on);
  onRef.current = on;
  const Ctor = speechRecognitionCtor();

  const show = useCallback((who: string, name: string, text: string, final: boolean, id: string) => {
    const at = Date.now();
    setLive((l) => [...l.filter((c) => c.who !== who), { who, name, text, at }].slice(-3));
    window.setTimeout(() => setLive((l) => l.filter((c) => !(c.who === who && c.at === at))), SHOW_MS);
    if (final) setTranscript((t) => (t.some((x) => x.id === `${who}:${id}`) ? t : [...t, { id: `${who}:${id}`, who, name, text, at }].slice(-2000)));
  }, []);

  useEffect(() => bus.on(TOPICS.captions, (raw, from) => {
    const msg = parseCaptionMsg(raw);
    if (!msg) return;
    if (msg.t === 'state') { setOn(msg.on); if (msg.on) setShown(true); return; }
    if (!onRef.current) setOn(true); // joined after they were turned on
    show(from, namesRef.current[from] ?? 'Guest', msg.text, msg.final, msg.id);
  }), [bus, show]);

  // Tell newcomers captions are on.
  useEffect(() => {
    if (!room) return;
    const onJoin = (p: { identity: string }) => { if (onRef.current) void bus.send(TOPICS.captions, { t: 'state', on: true }, { to: [p.identity] }); };
    room.on('participantConnected', onJoin);
    return () => { room.off('participantConnected', onJoin); };
  }, [room, bus]);

  // Caption my own voice while captions are on and my mic is on.
  useEffect(() => {
    if (!on || !micOn) return;
    if (!Ctor) { setProblem("Your browser can't caption your voice. Chrome, Edge or Safari can; you still see everyone else's captions."); return; }
    setProblem(null);
    let stopped = false;
    let rec: SpeechRecognitionLike | null = null;
    let lineId = newChatId();
    let lastSent = 0;
    const start = () => {
      rec = new Ctor();
      rec.lang = navigator.language || 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = r[0].transcript.trim();
          if (!text) continue;
          const now = Date.now();
          if (r.isFinal) {
            void bus.send(TOPICS.captions, { t: 'line', id: lineId, text, final: true });
            show(me, myName, text, true, lineId);
            lineId = newChatId();
          } else if (now - lastSent > 250) {
            lastSent = now;
            void bus.send(TOPICS.captions, { t: 'line', id: lineId, text, final: false }, { reliable: false });
            show(me, myName, text, false, lineId);
          }
        }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          stopped = true;
          setProblem("Captions for your voice are blocked. Allow the microphone for this site's speech recognition, then turn captions on again.");
        }
      };
      // Browsers stop listening after a pause; keep going while captions are on.
      rec.onend = () => { if (!stopped) window.setTimeout(() => { if (!stopped) { try { start(); } catch { /* already started */ } } }, 300); };
      try { rec.start(); } catch { /* already started */ }
    };
    start();
    return () => { stopped = true; try { rec?.abort(); } catch { /* not started */ } };
  }, [on, micOn, Ctor, bus, me, myName, show]);

  const turnOn = useCallback(() => { setOn(true); setShown(true); void bus.send(TOPICS.captions, { t: 'state', on: true }); }, [bus]);
  const turnOff = useCallback(() => { setOn(false); setLive([]); void bus.send(TOPICS.captions, { t: 'state', on: false }); }, [bus]);

  return { on, shown, setShown, supported: !!Ctor, problem, live, transcript, turnOn, turnOff };
}
