/**
 * Translating captions on this computer, for free: the browser's own translator (Chrome and Edge,
 * the Translator API). Each speaker's captions arrive with the language they speak; each listener
 * sees (and can hear) them in their own. Nothing is sent to a translation service.
 *
 * A language pair the browser hasn't used before downloads once; browsers only allow that after a
 * click, so the first time it shows a "Translate from …" button instead (see `needsClick`).
 */

export interface Language { code: string; name: string; voice: string }

/** Languages people can choose (the ones the browser translator offers widely). */
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', voice: 'en-US' },
  { code: 'es', name: 'Español', voice: 'es-ES' },
  { code: 'fr', name: 'Français', voice: 'fr-FR' },
  { code: 'pt', name: 'Português', voice: 'pt-BR' },
  { code: 'de', name: 'Deutsch', voice: 'de-DE' },
  { code: 'it', name: 'Italiano', voice: 'it-IT' },
  { code: 'nl', name: 'Nederlands', voice: 'nl-NL' },
  { code: 'zh', name: '中文', voice: 'zh-CN' },
  { code: 'ja', name: '日本語', voice: 'ja-JP' },
  { code: 'ko', name: '한국어', voice: 'ko-KR' },
  { code: 'ar', name: 'العربية', voice: 'ar-SA' },
  { code: 'hi', name: 'हिन्दी', voice: 'hi-IN' },
  { code: 'ru', name: 'Русский', voice: 'ru-RU' },
  { code: 'tr', name: 'Türkçe', voice: 'tr-TR' },
];

/** The short code ("es") of a language tag ("es-MX"), if it's one we offer. */
export function langCode(tag: string | null | undefined): string | null {
  const c = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.some((l) => l.code === c) ? c : null;
}

export const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
export const voiceTag = (code: string) => LANGUAGES.find((l) => l.code === code)?.voice ?? code;

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
    const state = await T.availability({ sourceLanguage: from, targetLanguage: to }).catch(() => 'unavailable' as const);
    if (state === 'unavailable') return null;
    if (state !== 'available' && !withClick) { blocked.add(key); return null; }
    try { const t = await T.create({ sourceLanguage: from, targetLanguage: to }); blocked.delete(key); return t; } catch { blocked.add(key); return null; }
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
  constructor(private lang: string) {}

  static supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

  setLanguage(lang: string) { this.lang = lang; }

  say(text: string) {
    if (!Interpreter.supported()) return;
    this.queue.push(text);
    if (this.queue.length > 3) this.queue.splice(0, this.queue.length - 3);
    if (!this.speaking) this.next();
  }

  private next() {
    const text = this.queue.shift();
    if (!text) { this.speaking = false; return; }
    this.speaking = true;
    const u = new SpeechSynthesisUtterance(text);
    const tag = voiceTag(this.lang);
    u.lang = tag;
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === tag && /natural|google|premium|enhanced/i.test(v.name))
      ?? voices.find((v) => v.lang === tag)
      ?? voices.find((v) => v.lang.startsWith(this.lang))
      ?? null;
    u.rate = 1.05;
    u.onend = () => this.next();
    u.onerror = () => this.next();
    window.speechSynthesis.speak(u);
  }

  stop() {
    this.queue = [];
    this.speaking = false;
    if (Interpreter.supported()) window.speechSynthesis.cancel();
  }
}
