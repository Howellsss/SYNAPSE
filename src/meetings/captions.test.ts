import { describe, expect, it } from 'vitest';
import { parseCaptionMsg, transcriptText, VoiceTimeline } from './captions';

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

describe('VoiceTimeline', () => {
  const fill = (t: VoiceTimeline, from: number, to: number, me: boolean, others: boolean) => {
    for (let at = from; at <= to; at += 100) t.add(at, me, others);
  };
  it('is mine when my device talked', () => {
    const t = new VoiceTimeline();
    fill(t, 0, 2000, true, false);
    expect(t.mine(0, 2000)).toBe(true);
  });
  it('is not mine when only the other device talked (their voice from my speakers)', () => {
    const t = new VoiceTimeline();
    fill(t, 0, 3000, false, true);
    expect(t.mine(0, 3000)).toBe(false);
  });
  it('is not mine with a blip of mine during their long turn', () => {
    const t = new VoiceTimeline();
    fill(t, 0, 3000, false, true);
    fill(t, 3100, 3200, true, false);
    expect(t.mine(0, 3200)).toBe(false);
  });
  it('is mine when we talked over each other', () => {
    const t = new VoiceTimeline();
    fill(t, 0, 1000, true, true);
    expect(t.mine(0, 1000)).toBe(true);
  });
  it('forgets old samples', () => {
    const t = new VoiceTimeline(1000);
    fill(t, 0, 500, true, false);
    t.add(5000, false, false);
    expect(t.mine(0, 5000)).toBe(false);
  });
});
