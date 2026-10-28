import { describe, expect, it } from 'vitest';
import { parseCaptionMsg } from './captions';
import { DUCKED, Interpretation, type TranslateFn } from './interpretation';
import { Interpreter, langCode, LANGUAGES, languageLabel, voiceTag } from './translate';

/** A stand-in for the browser's translator: a few known sentences, both ways. */
const PHRASES: [string, string][] = [
  ['Hola, ¿cómo estás?', 'Hello, how are you?'],
  ['Estoy bien, gracias.', "I'm fine, thanks."],
];
const fakeTranslate: TranslateFn = async (text, from, to) => {
  if (from === to) return text;
  for (const [es, en] of PHRASES) {
    if (from === 'es' && to === 'en' && text === es) return en;
    if (from === 'en' && to === 'es' && text === en) return es;
  }
  return null;
};

/** One person in the call: their language, what they see and what the interpreter reads them. */
function person(me: string, lang: string, opts: { interpreter?: boolean; translate?: TranslateFn } = {}) {
  const shown: string[] = [];
  const spoken: string[] = [];
  const interp = new Interpretation({
    me,
    myLanguage: () => lang,
    interpreter: () => opts.interpreter ?? true,
    translate: opts.translate ?? fakeTranslate,
    needsClick: () => false,
  });
  return {
    me, lang, interp, shown, spoken,
    async receive(from: string, raw: unknown) {
      const msg = parseCaptionMsg(JSON.parse(JSON.stringify(raw))); // over the wire
      if (!msg || msg.t !== 'line') return;
      const h = await interp.hear(from, msg.text, msg.final, msg.lang);
      if (!h) return;
      shown.push(h.text);
      if (h.speak) spoken.push(h.speak);
    },
  };
}

/** Someone says a sentence: it goes to everyone else with their language on it. */
async function say(from: ReturnType<typeof person>, text: string, everyone: ReturnType<typeof person>[]) {
  const line = { t: 'line', id: 'l1', text, final: true, lang: from.lang };
  for (const p of everyone) if (p !== from) await p.receive(from.me, line);
}

describe('interpreting between two languages', () => {
  it('lets a Spanish speaker and an English speaker hear each other in their own language, both ways', async () => {
    const ana = person('ana', 'es');
    const ben = person('ben', 'en');
    await say(ana, 'Hola, ¿cómo estás?', [ana, ben]);
    expect(ben.shown).toEqual(['Hello, how are you?']);
    expect(ben.spoken).toEqual(['Hello, how are you?']);
    await say(ben, "I'm fine, thanks.", [ana, ben]);
    expect(ana.shown).toEqual(['Estoy bien, gracias.']);
    expect(ana.spoken).toEqual(['Estoy bien, gracias.']);
  });

  it('turns down only the voices it reads aloud', async () => {
    const ben = person('ben', 'en');
    await ben.receive('ana', { t: 'line', id: 'a', text: 'Hola, ¿cómo estás?', final: true, lang: 'es' });
    await ben.receive('cal', { t: 'line', id: 'c', text: 'Morning all', final: true, lang: 'en' });
    expect(ben.interp.volume('ana')).toBe(DUCKED); // read aloud in English instead
    expect(ben.interp.volume('cal')).toBe(1); // speaks English: heard as is
    expect(ben.interp.volume('dee')).toBe(1); // hasn't spoken yet
  });

  it('leaves voices alone when the interpreter is off, or when this browser cannot translate them', async () => {
    const off = person('ben', 'en', { interpreter: false });
    await off.receive('ana', { t: 'line', id: 'a', text: 'Hola, ¿cómo estás?', final: true, lang: 'es' });
    expect(off.shown).toEqual(['Hello, how are you?']); // captions still translated
    expect(off.spoken).toEqual([]);
    expect(off.interp.volume('ana')).toBe(1);
    const noTranslator = person('ben', 'en', { translate: async () => null });
    await noTranslator.receive('ana', { t: 'line', id: 'a', text: 'Hola', final: true, lang: 'es' });
    expect(noTranslator.shown).toEqual(['Hola']); // as said
    expect(noTranslator.spoken).toEqual([]);
    expect(noTranslator.interp.volume('ana')).toBe(1); // never muffled with nothing in its place
  });

  it('reads aloud finished sentences only, and drops words in progress that were overtaken', async () => {
    let release: () => void = () => {};
    const slow: TranslateFn = (t, f, to) => new Promise((ok) => { const go = () => void fakeTranslate(t, f, to).then(ok); release = go; });
    const ben = person('ben', 'en', { translate: slow });
    const first = ben.interp.hear('ana', 'Hola, ¿cómo estás?', false, 'es');
    const releaseFirst = release;
    const second = ben.interp.hear('ana', 'Hola, ¿cómo estás?', true, 'es');
    releaseFirst();
    release();
    expect(await first).toBeNull();
    expect((await second)?.speak).toBe('Hello, how are you?');
  });

  it('passes the same language straight through', async () => {
    const ben = person('ben', 'en');
    await ben.receive('cal', { t: 'line', id: 'c', text: 'Morning all', final: true, lang: 'en' });
    expect(ben.shown).toEqual(['Morning all']);
    expect(ben.spoken).toEqual([]);
  });
});

describe('the interpreter voice', () => {
  it("remembers when it spoke, so its own voice from the speakers isn't taken for yours", () => {
    let t = 1000;
    const v = new Interpreter('en', () => t);
    v.markStart();
    t = 3000;
    expect(v.spokeDuring(2000, 2500)).toBe(true); // still talking
    v.markEnd();
    t = 3200;
    expect(v.spokeDuring(3100, 3200)).toBe(true); // the room's echo, just after
    t = 10_000;
    expect(v.spokeDuring(9000, 10_000)).toBe(false);
  });
});

describe('languages', () => {
  it('offers every language the translator handles, each with a voice', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(39);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    for (const l of LANGUAGES) expect(voiceTag(l.code)).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/);
    // Sorted by English name, as in the menu.
    expect(LANGUAGES.map((l) => l.name)).toEqual([...LANGUAGES.map((l) => l.name)].sort((a, b) => a.localeCompare(b)));
  });

  it('reads the tags browsers use', () => {
    expect(langCode('es-MX')).toBe('es');
    expect(langCode('zh-TW')).toBe('zh-Hant');
    expect(langCode('zh-CN')).toBe('zh');
    expect(langCode('iw')).toBe('he');
    expect(langCode('nb-NO')).toBe('no');
    expect(langCode('xx')).toBeNull();
    expect(languageLabel('es')).toBe('Spanish (Español)');
    expect(languageLabel('en')).toBe('English');
  });

  it('takes only languages we offer off the wire', () => {
    expect(parseCaptionMsg({ t: 'line', id: 'a', text: 'Hi', final: true, lang: 'zh-Hant' })).toMatchObject({ lang: 'zh-Hant' });
    expect(parseCaptionMsg({ t: 'line', id: 'a', text: 'Hi', final: true, lang: 'klingon' })).not.toHaveProperty('lang');
    expect(parseCaptionMsg({ t: 'state', on: true, translation: true })).toEqual({ t: 'state', on: true, translation: true });
  });
});
