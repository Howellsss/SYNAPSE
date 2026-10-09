import { describe, expect, it } from 'vitest';
import { parseCaptionMsg, transcriptText } from './captions';

describe('captions', () => {
  it('accepts only well-formed messages', () => {
    expect(parseCaptionMsg({ t: 'state', on: true })).toEqual({ t: 'state', on: true });
    expect(parseCaptionMsg({ t: 'line', id: 'a1', text: '  hello   there ', final: true })).toEqual({ t: 'line', id: 'a1', text: 'hello there', final: true });
    expect(parseCaptionMsg({ t: 'line', id: 'a1', text: '   ' })).toBeNull();
    expect(parseCaptionMsg({ t: 'line', id: 'bad id', text: 'x' })).toBeNull();
    expect(parseCaptionMsg({ t: 'line', id: 'a', text: 'x'.repeat(900) })).toMatchObject({ text: 'x'.repeat(500), final: false });
    expect(parseCaptionMsg(null)).toBeNull();
  });

  it('writes a readable transcript', () => {
    const at = new Date(2026, 9, 9, 10, 2, 13).getTime();
    const t = transcriptText('Team call', [{ id: '1', who: 'u2', name: 'Ama Owusu', text: 'Shall we start?', at }]);
    expect(t.startsWith('Team call — transcript')).toBe(true);
    expect(t).toMatch(/\[\d{1,2}:02:13.*\] Ama Owusu: Shall we start\?\n$/);
  });
});
