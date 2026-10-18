import { describe, expect, it } from 'vitest';
import { clearAtFor, liveStatus, untilLabel, type MemberStatus } from './presence';

const row = (over: Partial<MemberStatus>): MemberStatus => ({
  workspace_id: 'w', user_id: 'u', emoji: '📅', text: 'In a meeting', clear_at: null, away: false, updated_at: '', ...over,
});

describe('clearAtFor', () => {
  const now = new Date(2026, 9, 14, 10, 0, 0); // a Wednesday
  it('adds minutes and hours', () => {
    expect(clearAtFor('30m', now)!.getTime() - now.getTime()).toBe(30 * 60_000);
    expect(clearAtFor('2h', now)!.getTime() - now.getTime()).toBe(2 * 3_600_000);
  });
  it('today ends at midnight, the week on Sunday night', () => {
    const t = clearAtFor('today', now)!;
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([14, 23, 59]);
    const w = clearAtFor('week', now)!;
    expect([w.getDay(), w.getDate(), w.getHours()]).toEqual([0, 18, 23]);
  });
  it("don't clear has no end", () => expect(clearAtFor('never', now)).toBeNull());
});

describe('liveStatus', () => {
  it('shows a status until it clears', () => {
    const at = new Date(2026, 9, 14, 11).toISOString();
    expect(liveStatus(row({ clear_at: at }), new Date(2026, 9, 14, 10).getTime())?.text).toBe('In a meeting');
    expect(liveStatus(row({ clear_at: at }), new Date(2026, 9, 14, 12).getTime())).toBeNull();
  });
  it('nothing set means nothing shown', () => {
    expect(liveStatus(row({ emoji: null, text: null }))).toBeNull();
    expect(liveStatus(undefined)).toBeNull();
  });
});

describe('untilLabel', () => {
  const now = new Date(2026, 9, 14, 10);
  it('reads naturally', () => {
    expect(untilLabel(null, now)).toBe('');
    expect(untilLabel(new Date(2026, 9, 14, 23, 59, 59).toISOString(), now)).toBe('until tonight');
    expect(untilLabel(new Date(2026, 9, 14, 15, 30).toISOString(), now)).toMatch(/^until 3:30/);
  });
});
