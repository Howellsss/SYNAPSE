import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { TOPICS, type MeetingBus } from './useMeetingBus';
import { newChatId } from './messages';
import { parseCaptionMsg, speechRecognitionCtor, VoiceTimeline, type SpeechRecognitionLike, type TranscriptLine } from './captions';
import { canTranslate, enablePair, Interpreter, loadMyLanguage, needsClick, saveMyLanguage, translate, voiceTag } from './translate';
import { Interpretation } from './interpretation';

/** "Don't ask me again" for the speaking-language question. */
const ASK_KEY = 'synapse.askLanguage';
const askedNever = () => { try { return localStorage.getItem(ASK_KEY) === 'never'; } catch { return false; } };

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
  /**
   * Asking me which language I speak: someone turned translation (or captions) on, or spoke
   * another language. Null when not asking.
   */
  ask: 'translation' | 'captions' | null;
  /** Ask now (from a menu). */
  openAsk: () => void;
  /** My answer (null: cancel). `hear` turns the interpreter voice on or off. */
  answerAsk: (a: { language: string; hear: boolean; dontAskAgain: boolean } | null) => void;
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
  const [ask, setAsk] = useState<Captions['ask']>(null);
  const asked = useRef(false);
  const askOnce = useCallback((why: 'translation' | 'captions') => {
    if (asked.current || askedNever()) return;
    asked.current = true;
    setAsk(why);
  }, []);
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
  const interp = useRef<Interpretation | null>(null);
  interp.current ??= new Interpretation({
    me,
    myLanguage: () => langRef.current,
    interpreter: () => interpreterRef.current,
    translate,
    needsClick,
  });
  const roomRef = useRef(room);
  roomRef.current = room;
  /** Someone's own voice: turned down under the interpreter when they speak another language. */
  const level = useCallback((who: string) => {
    const p = roomRef.current?.remoteParticipants.get(who) as { setVolume?: (n: number) => void } | undefined;
    p?.setVolume?.(interp.current!.volume(who));
  }, []);
  const show = useCallback((who: string, name: string, text: string, final: boolean, id: string, lang?: string) => {
    const known = interp.current!.languageOf(who);
    void interp.current!.hear(who, text, final, lang).then((h) => {
      if (!h) return;
      if (h.pending) setPending(h.pending);
      put(who, name, h.text, final, id, { ...(h.lang ? { lang: h.lang } : {}), ...(h.original ? { original: h.original } : {}), ...(h.untranslated ? { untranslated: true } : {}) });
      if (h.speak) voice.current?.say(h.speak);
      if (who !== me) level(who);
    });
    if (who !== me && lang && lang !== known && lang !== langRef.current) askOnce('translation');
  }, [me, put, level, askOnce]);

  useEffect(() => bus.on(TOPICS.captions, (raw, from) => {
    const msg = parseCaptionMsg(raw);
    if (!msg) return;
    if (msg.t === 'state') {
      setOn(msg.on);
      if (msg.on) { setShown(true); askOnce(msg.translation ? 'translation' : 'captions'); }
      return;
    }
    if (!onRef.current) setOn(true); // joined after they were turned on
    show(from, namesRef.current[from] ?? 'Guest', msg.text, msg.final, msg.id, msg.lang);
  }), [bus, show, askOnce]);

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
            // Someone else's voice coming out of your speakers is not yours to caption, and nor
            // is the interpreter's (it reads others aloud in your language).
            if (mine(lineStart - LEAD_MS, now) && !voice.current?.spokeDuring(lineStart - LEAD_MS, now)) {
              void bus.send(TOPICS.captions, { t: 'line', id: lineId, text, final: true, lang: language });
              show(me, myName, text, true, lineId);
            }
            lineId = newChatId();
            lineStart = 0;
          } else if (now - lastSent > 250 && mine(now - INTERIM_WINDOW_MS, now) && !voice.current?.spokeDuring(now - INTERIM_WINDOW_MS, now)) {
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
    // Only people speaking another language are turned down (the interpreter reads them aloud);
    // people speaking mine stay at full volume.
    const all = () => room.remoteParticipants.forEach((p) => level(p.identity));
    all();
    const join = (p: { identity: string }) => level(p.identity);
    room.on('participantConnected', join);
    return () => {
      room.off('participantConnected', join);
      room.remoteParticipants.forEach((p) => p.setVolume?.(1));
      v.stop();
      voice.current = null;
    };
  }, [interpreter, room, level]);
  // A new language of mine: the interpreter speaks it, and who is turned down changes.
  useEffect(() => {
    voice.current?.setLanguage(language);
    room?.remoteParticipants.forEach((p) => level(p.identity));
  }, [language, room, level]);

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
    if (v && !onRef.current) setOn(true);
    // Tell everyone translation is on, so they're asked which language they speak.
    if (v) { setShown(true); void bus.send(TOPICS.captions, { t: 'state', on: true, translation: true }); }
  }, [bus]);
  const openAsk = useCallback(() => setAsk('translation'), []);
  const answerAsk = useCallback((a: { language: string; hear: boolean; dontAskAgain: boolean } | null) => {
    setAsk(null);
    if (!a) return;
    if (a.dontAskAgain) { try { localStorage.setItem(ASK_KEY, 'never'); } catch { /* private mode */ } }
    setLanguage(a.language);
    if (a.hear !== interpreterRef.current) setInterpreter(a.hear);
  }, [setLanguage, setInterpreter]);

  return {
    on, shown, setShown, supported: !!Ctor, problem, live, transcript, turnOn, turnOff,
    language, setLanguage, translates: canTranslate(), pending, enableTranslation, interpreter, setInterpreter,
    ask, openAsk, answerAsk,
  };
}
