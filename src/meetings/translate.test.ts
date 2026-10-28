import { describe, expect, it } from 'vitest';
import { parseCaptionMsg, transcriptText } from './captions';
import { langCode, languageName, translate, voiceTag } from './translate';

describe('caption languages', () => {
  it('carry the language they were said in, and drop a bad one', () => {
    expect(parseCaptionMsg({ t: 'line', id: 'a1', text: 'Hola', final: true, lang: 'es' })).toEqual({ t: 'line', id: 'a1', text: 'Hola', final: true, lang: 'es' });
    expect(parseCaptionMsg({ t: 'line', id: 'a1', text: 'Hola', final: true, lang: '<script>' })).toEqual({ t: 'line', id: 'a1', text: 'Hola', final: true });
  });
  it('keep what was really said under a translated line in the transcript', () => {
    const out = transcriptText('Sync', [{ id: 'x', who: 'u', name: 'Ana', text: 'Hola a todos', translated: 'Hello everyone', lang: 'es', at: 0 }]);
    expect(out).toContain('Ana: Hello everyone');
    expect(out).toContain('(es) Hola a todos');
  });
  it('knows the languages people can pick', () => {
    expect(langCode('es-MX')).toBe('es');
    expect(langCode('xx')).toBeNull();
    expect(languageName('es')).toBe('Spanish');
    expect(voiceTag('en')).toBe('en-US');
  });
  it('passes the same language straight through, and says when it cannot translate', async () => {
    expect(await translate('Hello', 'en', 'en')).toBe('Hello');
    expect(await translate('Hola', 'es', 'en')).toBeNull(); // no browser translator here
  });
});
