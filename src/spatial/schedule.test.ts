import { describe, it, expect } from 'vitest';
import { isOpenAt, nextOpening, opensLabel, scheduleProblem, describeSchedule } from './schedule';
import type { SpaceSchedule } from '@/types';

const base: SpaceSchedule = { opens_at: '09:00', closes_at: '17:00', recurrence: 'weekdays', timezone: 'Africa/Lagos', calendar_id: null };
// Africa/Lagos is UTC+1 all year. 2026-10-01 is a Thursday.
const lagos = (iso: string) => new Date(`${iso}+01:00`);

describe('schedule open / closed', () => {
  it('weekdays 09:00–17:00', () => {
    expect(isOpenAt(base, lagos('2026-10-01T08:59'))).toBe(false);
    expect(isOpenAt(base, lagos('2026-10-01T09:00'))).toBe(true);
    expect(isOpenAt(base, lagos('2026-10-01T16:59'))).toBe(true);
    expect(isOpenAt(base, lagos('2026-10-01T17:00'))).toBe(false);
    expect(isOpenAt(base, lagos('2026-10-03T12:00'))).toBe(false); // Saturday
  });

  it('uses the schedule timezone, not the viewer’s', () => {
    // 08:30 UTC is 09:30 in Lagos.
    expect(isOpenAt(base, new Date('2026-10-01T08:30:00Z'))).toBe(true);
    expect(isOpenAt({ ...base, timezone: 'UTC' }, new Date('2026-10-01T08:30:00Z'))).toBe(false);
  });

  it('weekly on chosen days', () => {
    const s: SpaceSchedule = { ...base, recurrence: 'weekly', days: [0, 6] };
    expect(isOpenAt(s, lagos('2026-10-03T10:00'))).toBe(true);
    expect(isOpenAt(s, lagos('2026-10-01T10:00'))).toBe(false);
  });

  it('a one-off date', () => {
    const s: SpaceSchedule = { ...base, recurrence: 'once', date: '2026-10-15' };
    expect(isOpenAt(s, lagos('2026-10-15T10:00'))).toBe(true);
    expect(isOpenAt(s, lagos('2026-10-16T10:00'))).toBe(false);
    expect(nextOpening(s, lagos('2026-10-16T10:00'))).toBeNull();
  });

  it('windows that run past midnight', () => {
    const s: SpaceSchedule = { ...base, opens_at: '20:00', closes_at: '02:00', recurrence: 'weekly', days: [5] }; // Friday night
    expect(isOpenAt(s, lagos('2026-10-02T21:00'))).toBe(true); // Fri 21:00
    expect(isOpenAt(s, lagos('2026-10-03T01:30'))).toBe(true); // Sat 01:30, still Friday's window
    expect(isOpenAt(s, lagos('2026-10-03T02:00'))).toBe(false);
    expect(isOpenAt(s, lagos('2026-10-03T21:00'))).toBe(false); // Saturday has no window
  });
});

describe('next opening', () => {
  it('later today, or the next scheduled day', () => {
    expect(nextOpening(base, lagos('2026-10-01T07:00'))?.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    // Friday evening → Monday 09:00 Lagos
    expect(nextOpening(base, lagos('2026-10-02T18:00'))?.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });

  it('handles daylight-saving timezones', () => {
    const ny: SpaceSchedule = { ...base, timezone: 'America/New_York', recurrence: 'daily' };
    // Before the 1 Nov 2026 change NY is UTC-4; after it, UTC-5.
    expect(nextOpening(ny, new Date('2026-10-30T20:00:00Z'))?.toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(nextOpening(ny, new Date('2026-11-01T20:00:00Z'))?.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('labels only closed scheduled spaces', () => {
    expect(opensLabel(base, 'always_on', lagos('2026-10-03T12:00'))).toBeNull();
    expect(opensLabel(base, 'scheduled', lagos('2026-10-01T10:00'))).toBeNull();
    expect(opensLabel(base, 'scheduled', lagos('2026-10-03T12:00'))).toMatch(/^Opens /);
  });
});

describe('schedule validation', () => {
  it('catches bad input', () => {
    expect(scheduleProblem(base)).toBeNull();
    expect(scheduleProblem({ ...base, opens_at: '9am' })).toMatch(/times/);
    expect(scheduleProblem({ ...base, closes_at: '09:00' })).toMatch(/differ/);
    expect(scheduleProblem({ ...base, recurrence: 'weekly', days: [] })).toMatch(/day/);
    expect(scheduleProblem({ ...base, recurrence: 'once' })).toMatch(/date/);
    expect(describeSchedule(base)).toBe('Weekdays, 09:00–17:00 (Africa/Lagos)');
  });
});
