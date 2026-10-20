/**
 * Live interpretation between people who speak different languages, as plain logic (no React, no
 * browser), so it can be tested end to end.
 *
 * Each person speaks their own language; their words reach everyone with that language attached.
 * A listener gets them as said when it's their own language, and otherwise translated into it:
 * shown as a caption, and, with "hear others in my language" on, read aloud while the speaker's
 * own voice is turned down. So a Spanish speaker and an English speaker each hear the other in
 * their own language, both ways.
 */

export type TranslateFn = (text: string, from: string, to: string) => Promise<string | null>;

export interface Heard {
  /** What to show, in my language when it could be translated. */
  text: string;
  /** What was really said, when `text` is a translation. */
  original?: string;
  lang?: string;
  /** Couldn't translate (shown as said). */
  untranslated?: boolean;
  /** A language pair that needs one click before this browser can translate it. */
  pending?: string;
  /** Read this aloud (a finished sentence, translated, with the interpreter on). */
  speak?: string;
}

/** How loud the interpreter leaves someone's own voice while it speaks for them. */
export const DUCKED = 0.15;

export class Interpretation {
  /** The language each person last spoke in. */
  private spoken = new Map<string, string>();
  /** Whether each person's words are being translated for me (only then is their voice turned down). */
  private translated = new Map<string, boolean>();
  /** Only the latest words in progress from each person matter. */
  private tickets = new Map<string, number>();

  constructor(private opts: {
    me: string;
    myLanguage: () => string;
    interpreter: () => boolean;
    translate: TranslateFn;
    needsClick: (from: string, to: string) => boolean;
  }) {}

  /** The language someone speaks, once they've said something. */
  languageOf(who: string): string | undefined { return this.spoken.get(who); }

  /**
   * Someone's words arrive. Null when they've been overtaken (newer words in progress from them
   * came first).
   */
  async hear(who: string, text: string, final: boolean, lang?: string): Promise<Heard | null> {
    const mine = this.opts.myLanguage();
    if (lang && who !== this.opts.me) this.spoken.set(who, lang);
    if (!lang || lang === mine || who === this.opts.me) return { text, ...(lang ? { lang } : {}) };
    const ticket = (this.tickets.get(who) ?? 0) + 1;
    this.tickets.set(who, ticket);
    const out = await this.opts.translate(text, lang, mine);
    this.translated.set(who, out !== null);
    if (!final && this.tickets.get(who) !== ticket) return null;
    if (out === null) {
      return { text, lang, untranslated: true, ...(this.opts.needsClick(lang, mine) ? { pending: lang } : {}) };
    }
    return { text: out, original: text, lang, ...(final && this.opts.interpreter() ? { speak: out } : {}) };
  }

  /**
   * How loud each person's own voice should be: turned down under the interpreter when they speak
   * another language than mine and their words are being translated, full otherwise (people who
   * speak mine, or whose words this browser can't translate, aren't read aloud: they must stay
   * audible).
   */
  volume(who: string): number {
    if (!this.opts.interpreter()) return 1;
    const lang = this.spoken.get(who);
    return lang && lang !== this.opts.myLanguage() && this.translated.get(who) ? DUCKED : 1;
  }
}
