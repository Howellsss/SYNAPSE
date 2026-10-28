/**
 * Translating captions on this computer, for free: the browser's own translator (Chrome and Edge,
 * the Translator API). Each speaker's captions arrive with the language they speak; each listener
 * sees (and can hear) them in their own. Nothing is sent to a translation service.
 *
 * A language pair the browser hasn't used before downloads once; browsers only allow that after a
 * click, so the first time it shows a "Translate from …" button instead (see `needsClick`).
 */

export interface Language {
  code: string;
  /** In English (how the list is sorted), and in the language itself. */
  name: string;
  native: string;
  /** Speech recognition and the interpreter's voice (BCP 47). */
  voice: string;
  /** Codes the browser's translator may know it by, if not `code` (Hebrew is "iw" in some). */
  alt?: string[];
}

/**
 * Every language the interpreter handles: the ones the browser's own translator (Chrome's
 * Translator API) translates, each with a voice for speech recognition and for reading aloud.
 */
export const LANGUAGES: Language[] = [
  { code: 'ar', name: 'Arabic', native: 'العربية', voice: 'ar-SA' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', voice: 'bn-IN' },
  { code: 'bg', name: 'Bulgarian', native: 'Български', voice: 'bg-BG' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文', voice: 'zh-CN' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文', voice: 'zh-TW' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski', voice: 'hr-HR' },
  { code: 'cs', name: 'Czech', native: 'Čeština', voice: 'cs-CZ' },
  { code: 'da', name: 'Danish', native: 'Dansk', voice: 'da-DK' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', voice: 'nl-NL' },
  { code: 'en', name: 'English', native: 'English', voice: 'en-US' },
  { code: 'fi', name: 'Finnish', native: 'Suomi', voice: 'fi-FI' },
  { code: 'fr', name: 'French', native: 'Français', voice: 'fr-FR' },
  { code: 'de', name: 'German', native: 'Deutsch', voice: 'de-DE' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', voice: 'el-GR' },
  { code: 'he', name: 'Hebrew', native: 'עברית', voice: 'he-IL', alt: ['iw'] },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', voice: 'hi-IN' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar', voice: 'hu-HU' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', voice: 'id-ID' },
  { code: 'it', name: 'Italian', native: 'Italiano', voice: 'it-IT' },
  { code: 'ja', name: 'Japanese', native: '日本語', voice: 'ja-JP' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', voice: 'kn-IN' },
  { code: 'ko', name: 'Korean', native: '한국어', voice: 'ko-KR' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių', voice: 'lt-LT' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', voice: 'mr-IN' },
  { code: 'no', name: 'Norwegian', native: 'Norsk', voice: 'nb-NO', alt: ['nb'] },
  { code: 'pl', name: 'Polish', native: 'Polski', voice: 'pl-PL' },
  { code: 'pt', name: 'Portuguese', native: 'Português', voice: 'pt-BR' },
  { code: 'ro', name: 'Romanian', native: 'Română', voice: 'ro-RO' },
  { code: 'ru', name: 'Russian', native: 'Русский', voice: 'ru-RU' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina', voice: 'sk-SK' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina', voice: 'sl-SI' },
  { code: 'es', name: 'Spanish', native: 'Español', voice: 'es-ES' },
  { code: 'sv', name: 'Swedish', native: 'Svenska', voice: 'sv-SE' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', voice: 'ta-IN' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', voice: 'te-IN' },
  { code: 'th', name: 'Thai', native: 'ไทย', voice: 'th-TH' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', voice: 'tr-TR' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', voice: 'uk-UA' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', voice: 'vi-VN' },
];

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

/** One of our language codes ("es", "zh-Hant") for a tag ("es-MX", "zh-TW", "iw", "nb-NO"), if we offer it. */
export function langCode(tag: string | null | undefined): string | null {
  const t = (tag ?? '').trim().replace(/_/g, '-').toLowerCase();
  if (!t) return null;
  if (/^zh-(hant|tw|hk|mo)\b/.test(t)) return 'zh-Hant';
  const c = t.split('-')[0];
  if (c === 'iw') return 'he';
  if (c === 'nb' || c === 'nn') return 'no';
  return byCode.has(c) ? c : null;
}

/** "Spanish (Español)"; English shows just once. */
export const languageLabel = (code: string) => {
  const l = byCode.get(code);
  if (!l) return code;
  return l.native === l.name ? l.name : `${l.name} (${l.native})`;
};
export const languageName = (code: string) => byCode.get(code)?.name ?? code;
export const voiceTag = (code: string) => byCode.get(code)?.voice ?? code;
/** The codes to ask the browser's translator for. */
const translatorCodes = (code: string) => [code, ...(byCode.get(code)?.alt ?? [])];

const KEY = 'synapse.myLanguage';
/** The language I speak and want to hear (remembered on this device; first time, the browser's). */
export function loadMyLanguage(): string {
  try { const saved = langCode(localStorage.getItem(KEY)); if (saved) return saved; } catch { /* private mode */ }
  return langCode(typeof navigator === 'undefined' ? 'en' : navigator.language) ?? 'en';
}
export function saveMyLanguage(code: string) {
  try { localStorage.setItem(KEY, code); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- the browser's translator

interface TranslatorLike { translate(text: string): Promise<string>; destroy?(): void }
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorLike>;
}
const api = (): TranslatorStatic | null => (typeof self !== 'undefined' ? ((self as unknown as { Translator?: TranslatorStatic }).Translator ?? null) : null);

/** This browser can translate on its own. */
export const canTranslate = () => !!api();

const ready = new Map<string, Promise<TranslatorLike | null>>();
const blocked = new Set<string>();

/**
 * A translator for a pair, if the browser has (or can get) one. Without a click it only opens
 * pairs that are already downloaded; `withClick` (called from a click) may download.
 */
function translatorFor(from: string, to: string, withClick = false): Promise<TranslatorLike | null> {
  const key = `${from}>${to}`;
  const have = ready.get(key);
  if (have) return have;
  const T = api();
  if (!T) return Promise.resolve(null);
  const p = (async () => {
    // The first spelling of the pair the browser knows (Hebrew may be "he" or "iw").
    for (const sourceLanguage of translatorCodes(from)) {
      for (const targetLanguage of translatorCodes(to)) {
        const state = await T.availability({ sourceLanguage, targetLanguage }).catch(() => 'unavailable' as const);
        if (state === 'unavailable') continue;
        if (state !== 'available' && !withClick) { blocked.add(key); return null; }
        try { const t = await T.create({ sourceLanguage, targetLanguage }); blocked.delete(key); return t; } catch { blocked.add(key); return null; }
      }
    }
    return null;
  })();
  ready.set(key, p);
  // Not ready yet (needs a click, or failed): ask again next time.
  void p.then((t) => { if (!t) ready.delete(key); });
  return p;
}

/** The pair needs a click to download before it can translate. */
export const needsClick = (from: string, to: string) => blocked.has(`${from}>${to}`);

/** Download a pair (call from a click). True when it's ready. */
export async function enablePair(from: string, to: string): Promise<boolean> {
  return !!(await translatorFor(from, to, true));
}

/** The text in `to`, or null when this browser can't translate that pair (yet). */
export async function translate(text: string, from: string, to: string): Promise<string | null> {
  if (from === to) return text;
  const t = await translatorFor(from, to);
  if (!t) return null;
  try { return (await t.translate(text)).trim() || null; } catch { return null; }
}

// ---------------------------------------------------------------- the interpreter voice

/**
 * Reads finished sentences aloud in the listener's language, one after another (never on top of
 * each other), with the browser's own voices. Too far behind, it skips ahead so it never lags
 * the conversation by more than a few sentences.
 */
export class Interpreter {
  private queue: string[] = [];
  private speaking = false;
  /** When it spoke (start, end), so its own voice from the speakers isn't taken for yours. */
  private spans: [number, number][] = [];
  constructor(private lang: string, private now: () => number = Date.now) {}

  static supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

  setLanguage(lang: string) { this.lang = lang; }

  say(text: string) {
    if (!Interpreter.supported()) return;
    this.queue.push(text);
    if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    if (!this.speaking) this.next();
  }

  /** Was it talking at any time between `from` and `to` (with a little tail for the room's echo)? */
  spokeDuring(from: number, to: number, tailMs = 700): boolean {
    const t = this.now();
    this.spans = this.spans.filter(([, end]) => end === Infinity || t - end < 60_000);
    return this.spans.some(([start, end]) => start <= to && (end === Infinity ? t : end) + tailMs >= from);
  }

  /** Mark a stretch of speech (used by `next`, and by tests). */
  markStart() { this.spans.push([this.now(), Infinity]); }
  markEnd() { const last = this.spans[this.spans.length - 1]; if (last && last[1] === Infinity) last[1] = this.now(); }

  private next() {
    const text = this.queue.shift();
    if (!text) { this.speaking = false; return; }
    this.speaking = true;
    const u = new SpeechSynthesisUtterance(text);
    const tag = voiceTag(this.lang);
    const base = tag.split('-')[0];
    u.lang = tag;
    const voices = window.speechSynthesis.getVoices();
    const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-');
    u.voice = voices.find((v) => norm(v) === tag && /natural|google|premium|enhanced/i.test(v.name))
      ?? voices.find((v) => norm(v) === tag)
      ?? voices.find((v) => norm(v).split('-')[0] === base)
      ?? null;
    u.rate = 1.05;
    u.onstart = () => this.markStart();
    const done = () => { this.markEnd(); this.next(); };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  stop() {
    this.queue = [];
    this.speaking = false;
    this.markEnd();
    if (Interpreter.supported()) window.speechSynthesis.cancel();
  }
}
