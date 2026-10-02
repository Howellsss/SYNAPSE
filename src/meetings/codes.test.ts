import { describe, expect, it } from 'vitest';
import { calendarLinks, makeCode, parseJoinInput, startsLabel, toNickname, CODE_RE } from './codes';

describe('meeting codes', () => {
  it('uses the title for the letters', () => {
    expect(makeCode('Focus room', () => 0.358)).toBe('FOCU-358');
    expect(CODE_RE.test(makeCode('1:1'))).toBe(true);
    expect(CODE_RE.test(makeCode(''))).toBe(true);
  });

  it('reads codes, links and nicknames typed into Join', () => {
    expect(parseJoinInput('focu-358')).toEqual({ code: 'FOCU-358' });
    expect(parseJoinInput(' FOCU358 ')).toEqual({ code: 'FOCU-358' });
    expect(parseJoinInput('https://synapse.app/meetings/FOCU-358?x=1')).toEqual({ code: 'FOCU-358' });
    expect(parseJoinInput('Weekly Sync')).toEqual({ nickname: 'weekly-sync' });
    expect(parseJoinInput('')).toBeNull();
    expect(parseJoinInput('!')).toBeNull();
    expect(toNickname('a')).toBeNull();
  });

  it('says when a room starts', () => {
    const now = new Date('2026-10-02T10:00:00');
    expect(startsLabel(new Date('2026-10-02T10:00:20'), now)).toBe('in 0 min');
    expect(startsLabel(new Date('2026-10-02T10:25:00'), now)).toBe('in 25 min');
    expect(startsLabel(new Date('2026-10-02T09:50:00'), now)).toBe('started 10 min ago');
    expect(startsLabel(null, now)).toBe('Ready now');
    expect(startsLabel(new Date('2026-10-03T09:00:00'), now)).toMatch(/^tomorrow /);
  });

  it('builds calendar links', () => {
    const { google, ics } = calendarLinks({ title: 'Design, review', code: 'DESI-101', start: new Date('2026-10-02T15:00:00Z'), durationMin: 45 }, 'https://s.app');
    expect(google).toContain('dates=20261002T150000Z/20261002T154500Z');
    expect(ics).toContain('SUMMARY:Design\\, review');
    expect(ics).toContain('https://s.app/meetings/DESI-101');
  });
});
