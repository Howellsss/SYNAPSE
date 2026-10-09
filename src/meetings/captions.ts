/**
 * Live captions. Each person's own browser turns their own voice into text (the Web Speech API,
 * in Chrome, Edge and Safari) and shares the words with everyone over the data channel, so
 * nothing extra is installed or paid for. Finished sentences make the meeting transcript.
 */

export const MAX_LINE = 500;

export type CaptionMsg =
  | { t: 'state'; on: boolean }
  | { t: 'line'; id: string; text: string; final: boolean };

export interface TranscriptLine {
  id: string;
  who: string;
  name: string;
  text: string;
  at: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseCaptionMsg(raw: unknown): CaptionMsg | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'state' && typeof raw.on === 'boolean') return { t: 'state', on: raw.on };
  if (raw.t === 'line' && typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) && typeof raw.text === 'string') {
    const text = raw.text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE);
    return text ? { t: 'line', id: raw.id, text, final: raw.final === true } : null;
  }
  return null;
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The transcript as plain text: "[10:02:13] Ama Owusu: Shall we start?" */
export function transcriptText(title: string, lines: TranscriptLine[], startedAt?: number): string {
  const head = [`${title} — transcript`, startedAt ? new Date(startedAt).toLocaleString() : '', ''];
  return [...head, ...lines.map((l) => `[${clock(l.at)}] ${l.name}: ${l.text}`)].join('\n').trim() + '\n';
}

/** Does this browser have speech recognition? */
export function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The parts of the Web Speech API we use. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
