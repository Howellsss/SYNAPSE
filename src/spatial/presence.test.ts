import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { mergePresence, statusInfo, type PresencePerson } from './presence';
import { autoQuality } from './quality';

const person = (user_id: string, name: string, joined_at: string, extra: Partial<PresencePerson> = {}): PresencePerson => ({
  user_id, name, avatar_url: null, status: 'available', zone: null, conversation: [], joined_at, ...extra,
});

describe('mergePresence', () => {
  it('shows each person once, sorted by name, using their newest tab', () => {
    const merged = mergePresence({
      u2: [person('u2', 'Zara', '2026-10-01T10:00:00Z', { status: 'busy' }), person('u2', 'Zara', '2026-10-01T10:05:00Z', { status: 'focus' })],
      u1: [person('u1', 'Ade', '2026-10-01T09:00:00Z')],
    });
    expect(merged.map((p) => p.name)).toEqual(['Ade', 'Zara']);
    expect(merged[1].status).toBe('focus');
  });

  it('ignores malformed entries', () => {
    expect(mergePresence({ x: [{} as PresencePerson] })).toEqual([]);
  });
});

describe('status and quality', () => {
  it('falls back to Available for unknown statuses', () => {
    expect(statusInfo(undefined).label).toBe('Available');
    expect(statusInfo('dnd').label).toBe('Do not disturb');
  });

  it('picks low quality on small devices', () => {
    expect(autoQuality(4, 8)).toBe('low');
    expect(autoQuality(8, 4)).toBe('low');
    expect(autoQuality(8, 8)).toBe('high');
    expect(autoQuality(undefined, undefined)).toBe('high');
  });
});
