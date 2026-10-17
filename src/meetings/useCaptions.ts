import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { TOPICS, type MeetingBus } from './useMeetingBus';
import { newChatId } from './messages';
import { parseCaptionMsg, speechRecognitionCtor, VoiceTimeline, type SpeechRecognitionLike, type TranscriptLine } from './captions';
import { canTranslate, enablePair, Interpreter, loadMyLanguage, needsClick, saveMyLanguage, translate, voiceTag } from './translate';

/**
 * A caption on screen: someone's words as they speak, in my language when they speak another
 * (`original` is then what they said, in `lang`).
 */
export interface LiveCaption { who: string; name: string; text: string; at: number; lang?: string; original?: string; untranslated?: boolean }

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
  /** The language I speak and read (my captions are made in it; others' are translated into it). */
  language: string;
  setLanguage: (code: string) => void;
  /** This browser translates on its own (Chrome, Edge). */
  translates: boolean;
  /** A language someone speaks that needs a click to start translating (first time only). */
  pending: string | null;
  enableTranslation: () => void;
  /** Hear others in my language (they're turned down underneath). */
  interpreter: boolean;
  setInterpreter: (on: boolean) => void;
}

const SHOW_MS = 6000;
/** How often the call is asked which devices are talking. */
const SAMPLE_MS = 100;
/** A word in progress counts as yours if your device talked in this last stretch. */
const INTERIM_WINDOW_MS = 1500;
/** Speaking detection lags the words a little. */
const LEAD_MS = 600;

/**
 * Anyone can turn captions on or off for the meeting. While they're on, each person's browser
 * captions their own voice (only while their mic is on, and only while their device is the one
 * talking) and shares the words under their name.
 */
export function useCaptions({ bus, room, me, myName, micOn, names }: { bus: MeetingBus; room: Room | null; me: string; myName: string; micOn: boolean; names: Record<string, string> }): Captions {
  const [on, setOn] = useState(false);
  const [language, setLanguageState] = useState(loadMyLanguage);
  const langRef = useRef(language);
  langRef.current = language;
  const [pending, setPending] = useState<string | null>(null);
  const [interpreter, setInterpreterState] = useState(false);
  const interpreterRef = useRef(interpreter);
  interpreterRef.current = interpreter;
  const voice = useRef<Interpreter | null>(null);
  const [shown, setShown] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState<LiveCaption[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const onRef = useRef(on);
  onRef.current = on;
  const Ctor = speechRecognitionCtor();

  const put = useCallback((who: string, name: string, text: string, final: boolean, id: string, extra: Partial<LiveCaption> = {}) => {
    const at = Date.now();
    setLive((l) => [...l.filter((c) => c.who !== who), { who, name, text, at, ...extra }].slice(-3));
    window.setTimeout(() => setLive((l) => l.filter((c) => !(c.who === who && c.at === at))), SHOW_MS);
    if (final) {
      const line: TranscriptLine = extra.original
        ? { id: `${who}:${id}`, who, name, text: extra.original, translated: text, lang: extra.lang, at }
        : { id: `${who}:${id}`, who, name, text, lang: extra.lang, at };
      setTranscript((t) => (t.some((x) => x.id === line.id) ? t : [...t, line].slice(-2000)));
    }
  }, []);
  // Someone's words: as they are when they speak my language, otherwise translated into mine (and
  // read aloud by the interpreter voice when that's on). Interim words are translated too, but
  // only the latest of them matters.
  const latestFor = useRef(new Map<string, number>());
  const show = useCallback((who: string, name: string, text: string, final: boolean, id: string, lang?: string) => {
    const mine = langRef.current;
    if (!lang || lang === mine || who === me) { put(who, name, text, final, id, lang ? { lang } : {}); return; }
    const ticket = (latestFor.current.get(who) ?? 0) + 1;
    latestFor.current.set(who, ticket);
    void translate(text, lang, mine).then((out) => {
      if (!final && latestFor.current.get(who) !== ticket) return;
      if (out === null) {
        if (needsClick(lang, mine)) setPending(lang);
        put(who, name, text, final, id, { lang, untranslated: true });
        return;
      }
      put(who, name, out, final, id, { lang, original: text });
      if (final && interpreterRef.current) voice.current?.say(out);
    });
  }, [me, put]);

  useEffect(() => bus.on(TOPICS.captions, (raw, from) => {
    const msg = parseCaptionMsg(raw);
    if (!msg) return;
    if (msg.t === 'state') { setOn(msg.on); if (msg.on) setShown(true); return; }
    if (!onRef.current) setOn(true); // joined after they were turned on
    show(from, namesRef.current[from] ?? 'Guest', msg.text, msg.final, msg.id, msg.lang);
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
    let lineStart = 0;
    let lastSent = 0;
    // Which device is talking, from the call's echo-cancelled audio (not from the raw mic).
    const voices = new VoiceTimeline();
    const sample = window.setInterval(() => {
      if (!room) return;
      let others = false;
      room.remoteParticipants.forEach((p) => { if (p.isSpeaking) others = true; });
      voices.add(Date.now(), room.localParticipant.isSpeaking, others);
    }, SAMPLE_MS);
    // Without the call (still connecting) there is nothing to check against.
    const mine = (from: number, to: number) => !room || voices.mine(from, to);
    const start = () => {
      rec = new Ctor();
      rec.lang = voiceTag(language);
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = r[0].transcript.trim();
          if (!text) continue;
          const now = Date.now();
          if (!lineStart) lineStart = now;
          if (r.isFinal) {
            // Someone else's voice coming out of your speakers is not yours to caption.
            if (mine(lineStart - LEAD_MS, now)) {
              void bus.send(TOPICS.captions, { t: 'line', id: lineId, text, final: true, lang: language });
              show(me, myName, text, true, lineId);
            }
            lineId = newChatId();
            lineStart = 0;
          } else if (now - lastSent > 250 && mine(now - INTERIM_WINDOW_MS, now)) {
            lastSent = now;
            void bus.send(TOPICS.captions, { t: 'line', id: lineId, text, final: false, lang: language }, { reliable: false });
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
    return () => { stopped = true; window.clearInterval(sample); try { rec?.abort(); } catch { /* not started */ } };
  }, [on, micOn, Ctor, bus, room, me, myName, show, language]);

  // The interpreter voice: others turned right down underneath while it speaks for them.
  useEffect(() => {
    if (!interpreter || !room) return;
    const v = new Interpreter(langRef.current);
    voice.current = v;
    const quiet = (p: { setVolume?: (n: number) => void }) => p.setVolume?.(0.15);
    room.remoteParticipants.forEach(quiet);
    room.on('participantConnected', quiet);
    return () => {
      room.off('participantConnected', quiet);
      room.remoteParticipants.forEach((p) => p.setVolume?.(1));
      v.stop();
      voice.current = null;
    };
  }, [interpreter, room]);
  useEffect(() => { voice.current?.setLanguage(language); }, [language]);

  const setLanguage = useCallback((code: string) => { setLanguageState(code); saveMyLanguage(code); setPending(null); }, []);
  const enableTranslation = useCallback(() => {
    const from = pending;
    if (!from) return;
    void enablePair(from, langRef.current).then((ok) => { if (ok) setPending(null); });
  }, [pending]);

  const turnOn = useCallback(() => { setOn(true); setShown(true); void bus.send(TOPICS.captions, { t: 'state', on: true }); }, [bus]);
  const turnOff = useCallback(() => { setOn(false); setLive([]); setInterpreterState(false); void bus.send(TOPICS.captions, { t: 'state', on: false }); }, [bus]);
  // The interpreter needs everyone's words, so it turns captions on for the meeting.
  const setInterpreter = useCallback((v: boolean) => {
    setInterpreterState(v);
    if (v && !onRef.current) turnOn();
  }, [turnOn]);

  return {
    on, shown, setShown, supported: !!Ctor, problem, live, transcript, turnOn, turnOff,
    language, setLanguage, translates: canTranslate(), pending, enableTranslation, interpreter, setInterpreter,
  };
}
