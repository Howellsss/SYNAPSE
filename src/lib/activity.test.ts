import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { bucketByDay } from './activity';

describe('bucketByDay', () => {
  it('counts the last seven days, oldest first', () => {
    const now = new Date(2026, 9, 5, 15, 0);
    const days = bucketByDay([new Date(2026, 9, 5, 9).toISOString(), new Date(2026, 9, 5, 11).toISOString(), new Date(2026, 9, 1, 8).toISOString(), new Date(2026, 8, 20).toISOString()], now);
    expect(days).toHaveLength(7);
    expect(days[6].count).toBe(2);
    expect(days[2].count).toBe(1);
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(3);
    expect(days[6].label).toBe('Mon');
  });
});
