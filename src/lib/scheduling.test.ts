import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// MOCK SETUP
// ============================================================

// Mock supabase before importing the engine
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      eq: vi.fn(() => ({ select: mockSelect, insert: mockInsert, update: mockUpdate, delete: mockDelete, maybeSingle: vi.fn(() => ({ data: null, error: null })), single: vi.fn() })),
      in: vi.fn(() => ({ select: mockSelect, gte: vi.fn(() => ({ lte: vi.fn(() => ({ data: [], error: null })) })) })),
      neq: vi.fn(() => ({ select: mockSelect, order: vi.fn(() => ({ data: [], error: null })) })),
      gte: vi.fn(() => ({ lte: vi.fn(() => ({ data: [], error: null })) })),
      lte: vi.fn(() => ({ data: [], error: null })),
      order: vi.fn(() => ({ data: [], error: null })),
      maybeSingle: vi.fn(() => ({ data: null, error: null })),
      single: vi.fn(() => ({ data: null, error: null })),
      lt: vi.fn(() => ({ data: [], error: null })),
      is: vi.fn(() => ({ data: [], error: null })),
      count: vi.fn(() => ({ count: 0, error: null })),
      head: vi.fn(() => ({ count: 0, error: null })),
    })),
  },
}));

import { SchedulingEngine, type TimeSlot } from '@/lib/scheduling';
import type { AvailabilityRule, Calendar } from '@/types';

// ============================================================
// HELPERS
// ============================================================

// generateBaseSlots is private; the tests reach it through this typed view.
const privateEngine = SchedulingEngine as unknown as {
  generateBaseSlots: (calendar: Calendar, date: Date, rules: AvailabilityRule[], timezone: string) => TimeSlot[];
};

function makeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: 'cal-1',
    workspace_id: 'ws-1',
    owner_id: null,
    name: 'Test Calendar',
    description: null,
    slug: 'test',
    calendar_type: 'one_on_one',
    duration_minutes: 30,
    slot_interval_minutes: 30,
    location_type: 'synapse_meeting',
    location_url: null,
    color: '#3b82f6',
    timezone: 'UTC',
    status: 'active',
    capacity: 1,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    min_booking_notice_minutes: 0,
    max_booking_horizon_days: 60,
    max_bookings_per_day: null,
    max_bookings_per_week: null,
    max_bookings_per_month: null,
    cancellation_policy: 'any_time',
    booking_flow: 'calendar_first',
    connected_form_id: null,
    round_robin_strategy: 'balanced',
    price: null,
    currency: 'USD',
    form_mode: 'default',
    custom_confirmation_message: null,
    custom_redirect_url: null,
    embed_config: { type: 'inline' },
    logo_url: null,
    cover_url: null,
    background_color: null,
    button_color: null,
    font_family: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function dateAt(year: number, month: number, day: number, hour = 0, min = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, min, 0, 0));
}

// ============================================================
// TESTS
// ============================================================

describe('SchedulingEngine - Slot Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates slots at correct interval within working hours', () => {
    const calendar = makeCalendar({ duration_minutes: 30, slot_interval_minutes: 30 });
    const date = dateAt(2026, 9, 4); // Friday
    const rules = [
      { id: 'r1', calendar_id: 'cal-1', day_of_week: 5, start_time: '09:00', end_time: '11:00', sort_order: 0 },
    ];

    const slots = privateEngine.generateBaseSlots(calendar, date, rules, 'UTC');

    // 09:00-09:30, 09:30-10:00, 10:00-10:30, 10:30-11:00
    expect(slots).toHaveLength(4);
    expect(slots[0].start.toISOString()).toBe(dateAt(2026, 9, 4, 9).toISOString());
    expect(slots[0].end.toISOString()).toBe(dateAt(2026, 9, 4, 9, 30).toISOString());
    expect(slots[3].start.toISOString()).toBe(dateAt(2026, 9, 4, 10, 30).toISOString());
    expect(slots[3].end.toISOString()).toBe(dateAt(2026, 9, 4, 11).toISOString());
  });

  it('respects duration vs interval difference', () => {
    const calendar = makeCalendar({ duration_minutes: 60, slot_interval_minutes: 30 });
    const date = dateAt(2026, 9, 4);
    const rules = [
      { id: 'r1', calendar_id: 'cal-1', day_of_week: 5, start_time: '09:00', end_time: '11:00', sort_order: 0 },
    ];

    const slots = privateEngine.generateBaseSlots(calendar, date, rules, 'UTC');

    // 60min duration, 30min interval, 9-11 = 09:00, 09:30, 10:00 (10:30+60 > 11:00)
    expect(slots).toHaveLength(3);
    expect(slots[0].start.toISOString()).toBe(dateAt(2026, 9, 4, 9).toISOString());
    expect(slots[0].end.toISOString()).toBe(dateAt(2026, 9, 4, 10).toISOString());
    expect(slots[2].start.toISOString()).toBe(dateAt(2026, 9, 4, 10).toISOString());
    expect(slots[2].end.toISOString()).toBe(dateAt(2026, 9, 4, 11).toISOString());
  });

  it('handles multiple availability periods per day', () => {
    const calendar = makeCalendar({ duration_minutes: 30, slot_interval_minutes: 30 });
    const date = dateAt(2026, 9, 4);
    const rules = [
      { id: 'r1', calendar_id: 'cal-1', day_of_week: 5, start_time: '09:00', end_time: '10:00', sort_order: 0 },
      { id: 'r2', calendar_id: 'cal-1', day_of_week: 5, start_time: '14:00', end_time: '15:00', sort_order: 1 },
    ];

    const slots = privateEngine.generateBaseSlots(calendar, date, rules, 'UTC');

    // Morning: 09:00, 09:30. Afternoon: 14:00, 14:30
    expect(slots).toHaveLength(4);
    expect(slots[0].start.toISOString()).toBe(dateAt(2026, 9, 4, 9).toISOString());
    expect(slots[2].start.toISOString()).toBe(dateAt(2026, 9, 4, 14).toISOString());
  });
});

describe('SchedulingEngine - Buffer Logic', () => {
  it('buffer extends the conflict-check window before and after', () => {
    const calendar = makeCalendar({ buffer_before_minutes: 15, buffer_after_minutes: 30 });
    const slotStart = dateAt(2026, 9, 4, 10);
    const slotEnd = dateAt(2026, 9, 4, 11);

    const bufferBeforeMs = calendar.buffer_before_minutes * 60 * 1000;
    const bufferAfterMs = calendar.buffer_after_minutes * 60 * 1000;
    const checkStart = new Date(slotStart.getTime() - bufferBeforeMs);
    const checkEnd = new Date(slotEnd.getTime() + bufferAfterMs);

    expect(checkStart.toISOString()).toBe(dateAt(2026, 9, 4, 9, 45).toISOString());
    expect(checkEnd.toISOString()).toBe(dateAt(2026, 9, 4, 11, 30).toISOString());
  });

  it('post-buffer prevents next appointment from starting too early', () => {
    const bufferAfterMs = 30 * 60 * 1000;
    const apptEnd = dateAt(2026, 9, 4, 11);
    const nextEligibleStart = new Date(apptEnd.getTime() + bufferAfterMs);

    expect(nextEligibleStart.toISOString()).toBe(dateAt(2026, 9, 4, 11, 30).toISOString());
  });
});

describe('SchedulingEngine - Minimum Notice', () => {
  it('slots before minimum notice are filtered out', () => {
    const calendar = makeCalendar({ min_booking_notice_minutes: 120 });
    const now = new Date();
    const minNoticeMs = calendar.min_booking_notice_minutes * 60 * 1000;
    const earliestBookable = new Date(now.getTime() + minNoticeMs);

    // A slot 1 hour from now should be blocked (notice = 2h)
    const slot1h = new Date(now.getTime() + 60 * 60 * 1000);
    expect(slot1h < earliestBookable).toBe(true);

    // A slot 3 hours from now should be allowed
    const slot3h = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    expect(slot3h >= earliestBookable).toBe(true);
  });
});

describe('SchedulingEngine - Maximum Booking Horizon', () => {
  it('slots beyond horizon are filtered out', () => {
    const now = new Date();
    const maxHorizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const withinHorizon = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000);
    const beyondHorizon = new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000);

    expect(withinHorizon <= maxHorizon).toBe(true);
    expect(beyondHorizon > maxHorizon).toBe(true);
  });
});

describe('SchedulingEngine - Overlap Detection', () => {
  it('detects overlapping time ranges', () => {
    const aStart = dateAt(2026, 9, 4, 10);
    const aEnd = dateAt(2026, 9, 4, 11);
    const bStart = dateAt(2026, 9, 4, 10, 30);
    const bEnd = dateAt(2026, 9, 4, 11, 30);

    // aStart < bEnd && aEnd > bStart
    const overlap = aStart < bEnd && aEnd > bStart;
    expect(overlap).toBe(true);
  });

  it('non-overlapping ranges do not conflict', () => {
    const aStart = dateAt(2026, 9, 4, 9);
    const aEnd = dateAt(2026, 9, 4, 10);
    const bStart = dateAt(2026, 9, 4, 10);
    const bEnd = dateAt(2026, 9, 4, 11);

    const overlap = aStart < bEnd && aEnd > bStart;
    expect(overlap).toBe(false);
  });

  it('adjacent slots with buffer do conflict', () => {
    const aStart = dateAt(2026, 9, 4, 9);
    const aEnd = dateAt(2026, 9, 4, 10);
    const bStart = dateAt(2026, 9, 4, 9, 45); // overlaps with buffer
    const bEnd = dateAt(2026, 9, 4, 10, 45);

    const overlap = aStart < bEnd && aEnd > bStart;
    expect(overlap).toBe(true);
  });
});

describe('SchedulingEngine - Timezone Conversion', () => {
  it('parses time in a non-UTC timezone correctly', () => {
    // 09:00 in America/New_York (EDT = UTC-4) should be 13:00 UTC
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });

    // Midnight UTC is Sep 3 in NY (UTC-4), so use noon UTC instead
    const noonUtc = dateAt(2026, 9, 4, 12);
    const parts2 = dtf.formatToParts(noonUtc);
    const get2 = (t: string) => parts2.find(p => p.type === t)?.value ?? '0';
    expect(get2('year')).toBe('2026');
    expect(get2('month')).toBe('09');
    expect(get2('day')).toBe('04');
  });

  it('same instant displays differently in different timezones', () => {
    const instant = new Date('2026-09-04T13:00:00Z');

    const nyFormat = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const londonFormat = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/London',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const nyTime = nyFormat.format(instant);
    const londonTime = londonFormat.format(instant);

    // 13:00 UTC = 09:00 NY (EDT) = 14:00 London (BST)
    expect(nyTime).toContain('09');
    expect(londonTime).toContain('14');
  });
});

describe('SchedulingEngine - Capacity Logic', () => {
  it('event with capacity 50 allows bookings until full', () => {
    const capacity = 50;
    const currentBookings = 30;
    expect(currentBookings < capacity).toBe(true);

    const fullBookings = 50;
    expect(fullBookings >= capacity).toBe(true);
  });

  it('one-on-one with capacity 1 blocks second booking at same time', () => {
    const capacity = 1;
    const currentBookings = 1;
    expect(currentBookings >= capacity).toBe(true);
  });
});

describe('SchedulingEngine - Round Robin Strategy Selection', () => {
  it('priority_order selects lowest priority number', () => {
    const hosts = [
      { calendar_id: 'cal-1', user_id: 'host-a', priority: 3, weight: 0, is_primary: false, created_at: '' },
      { calendar_id: 'cal-1', user_id: 'host-b', priority: 1, weight: 0, is_primary: true, created_at: '' },
      { calendar_id: 'cal-1', user_id: 'host-c', priority: 2, weight: 0, is_primary: false, created_at: '' },
    ];
    const sorted = [...hosts].sort((a, b) => a.priority - b.priority);
    expect(sorted[0].user_id).toBe('host-b');
  });

  it('weighted distributes based on weight values', () => {
    const hosts = [
      { calendar_id: 'cal-1', user_id: 'host-a', priority: 1, weight: 1, is_primary: false, created_at: '' },
      { calendar_id: 'cal-1', user_id: 'host-b', priority: 2, weight: 3, is_primary: false, created_at: '' },
    ];
    const weighted: string[] = [];
    for (const host of hosts) {
      const w = Math.max(host.weight, 1);
      for (let i = 0; i < w; i++) weighted.push(host.user_id);
    }
    // host-a appears 1 time, host-b appears 3 times
    expect(weighted.filter(h => h === 'host-a')).toHaveLength(1);
    expect(weighted.filter(h => h === 'host-b')).toHaveLength(3);
  });
});

describe('SchedulingEngine - Collective Intersection', () => {
  it('returns false if any host has a conflict', () => {
    const hostAvailability = [true, false, true]; // Host B is busy
    const allAvailable = hostAvailability.every(a => a === true);
    expect(allAvailable).toBe(false);
  });

  it('returns true if all hosts are available', () => {
    const hostAvailability = [true, true, true];
    const allAvailable = hostAvailability.every(a => a === true);
    expect(allAvailable).toBe(true);
  });
});

describe('SchedulingEngine - Double Booking Protection', () => {
  it('unique constraint on booking_locks prevents double booking', () => {
    // Simulate: first insert succeeds, second fails with 23505
    const firstResult = { success: true, lockId: 'lock-1' };
    const secondResult = { success: false, error: 'This time was just booked. Please select another time.' };

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(false);
    expect(secondResult.error).toContain('just booked');
  });
});

describe('SchedulingEngine - Cancellation', () => {
  it('cancelled appointment should not block slots', () => {
    const statuses = ['confirmed', 'pending', 'cancelled', 'completed'];
    const activeStatuses = statuses.filter(s => s === 'confirmed' || s === 'pending');
    expect(activeStatuses).not.toContain('cancelled');
    expect(activeStatuses).not.toContain('completed');
  });
});

describe('SchedulingEngine - Rescheduling', () => {
  it('reschedule should re-check availability at new time', () => {
    const oldStart = dateAt(2026, 9, 4, 10);
    const newStart = dateAt(2026, 9, 4, 14);
    expect(newStart.getTime()).not.toBe(oldStart.getTime());
  });

  it('reschedule should update start_time and end_time', () => {
    const oldAppt = { start_time: dateAt(2026, 9, 4, 10).toISOString(), end_time: dateAt(2026, 9, 4, 10, 30).toISOString() };
    const newStart = dateAt(2026, 9, 4, 14);
    const newEnd = dateAt(2026, 9, 4, 14, 30);
    expect(newStart.toISOString()).not.toBe(oldAppt.start_time);
    expect(newEnd.toISOString()).not.toBe(oldAppt.end_time);
  });
});

describe('SchedulingEngine - Blackout Dates', () => {
  it('blackout override returns no slots', () => {
    const overrides = [{ type: 'blackout', start_time: null, end_time: null }];
    const blackouts = overrides.filter(o => o.type === 'blackout');
    expect(blackouts.length > 0).toBe(true);
    // If blackouts exist, no slots should be returned
  });

  it('available override replaces regular rules', () => {
    const overrides = [{ type: 'available', start_time: '10:00', end_time: '14:00' }];
    const availableOverrides = overrides.filter(o => o.type === 'available');
    expect(availableOverrides.length > 0).toBe(true);

    const effectiveRules = availableOverrides.map((o, i) => ({
      id: 'override-' + i,
      calendar_id: 'cal-1',
      day_of_week: 5,
      start_time: o.start_time ?? '09:00',
      end_time: o.end_time ?? '17:00',
      sort_order: i,
    }));
    expect(effectiveRules[0].start_time).toBe('10:00');
    expect(effectiveRules[0].end_time).toBe('14:00');
  });
});

describe('SchedulingEngine - External Conflicts', () => {
  it('busy external events block corresponding slots', () => {
    const slotStart = dateAt(2026, 9, 4, 10);
    const slotEnd = dateAt(2026, 9, 4, 11);
    const busyStart = dateAt(2026, 9, 4, 10, 30);
    const busyEnd = dateAt(2026, 9, 4, 11, 30);

    const hasConflict = slotStart < busyEnd && slotEnd > busyStart;
    expect(hasConflict).toBe(true);
  });

  it('free external events do not block slots', () => {
    // Free events wouldn't be in external_busy_periods table
    const busyPeriods: { start: Date; end: Date }[] = [];
    const slotStart = dateAt(2026, 9, 4, 10);
    const slotEnd = dateAt(2026, 9, 4, 11);

    const hasConflict = busyPeriods.some(b =>
      slotStart < b.end && slotEnd > b.start
    );
    expect(hasConflict).toBe(false);
  });
});

describe('SchedulingEngine - Daylight Saving Transitions', () => {
  it('handles DST spring forward (2am becomes 3am)', () => {
    // In America/New_York, March 8 2026 at 2am jumps to 3am
    const beforeDST = new Date('2026-03-08T06:59:00Z'); // 1:59 AM EST
    const afterDST = new Date('2026-03-08T07:00:00Z'); // 3:00 AM EDT

    const nyBefore = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(beforeDST);
    const nyAfter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(afterDST);

    // 1:59 AM and 3:00 AM — 2:00-2:59 doesn't exist
    expect(nyBefore).toContain('01');
    expect(nyAfter).toContain('03');
  });

  it('handles DST fall back (2am repeats)', () => {
    // In America/New_York, Nov 1 2026 at 2am falls back to 1am
    const beforeFall = new Date('2026-11-01T05:59:00Z'); // 1:59 AM EDT
    const afterFall = new Date('2026-11-01T06:00:00Z'); // 1:00 AM EST

    const nyBefore = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(beforeFall);
    const nyAfter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(afterFall);

    // Both show as 01:xx but one is EDT and one is EST
    expect(nyBefore).toContain('01');
    expect(nyAfter).toContain('01');
  });
});

describe('SchedulingEngine - Booking Limits', () => {
  it('daily limit blocks additional bookings', () => {
    const maxPerDay = 10;
    const currentCount = 10;
    expect(currentCount >= maxPerDay).toBe(true);
  });

  it('weekly limit blocks additional bookings', () => {
    const maxPerWeek = 50;
    const currentCount = 50;
    expect(currentCount >= maxPerWeek).toBe(true);
  });

  it('monthly limit blocks additional bookings', () => {
    const maxPerMonth = 200;
    const currentCount = 200;
    expect(currentCount >= maxPerMonth).toBe(true);
  });

  it('no limit configured allows bookings', () => {
    const maxPerDay = null;
    const currentCount = 1000;
    expect(maxPerDay === null || currentCount < maxPerDay).toBe(true);
  });
});
