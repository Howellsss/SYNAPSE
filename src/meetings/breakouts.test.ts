import { describe, expect, it } from 'vitest';
import { autoAssign, makeRooms, parseBreakout, roomOf, timeLeft } from './breakouts';

describe('breakout rooms', () => {
  it('makes 1 to 20 rooms', () => {
    expect(makeRooms(3)).toEqual([{ n: 1, name: 'Room 1' }, { n: 2, name: 'Room 2' }, { n: 3, name: 'Room 3' }]);
    expect(makeRooms(0)).toHaveLength(1);
    expect(makeRooms(99)).toHaveLength(20);
  });

  it('spreads people evenly', () => {
    const a = autoAssign(['a', 'b', 'c', 'd', 'e'], 2, () => 0.5);
    const counts = Object.values(a).reduce<Record<number, number>>((m, n) => ({ ...m, [n]: (m[n] ?? 0) + 1 }), {});
    expect(Object.keys(a).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(counts).toEqual({ 1: 3, 2: 2 });
  });

  it('reads the plan from the server safely', () => {
    const b = parseBreakout({ open: true, rooms: [{ n: 1, name: ' Sales ' }, { n: 2 }, { n: 99 }], assign: { u1: 1, u2: 2, u3: 7, u4: 'x' }, message: { text: 'Two minutes left', at: '2026-10-09T10:00:00Z' } });
    expect(b).toEqual({ open: true, rooms: [{ n: 1, name: 'Sales' }, { n: 2, name: 'Room 2' }], assign: { u1: 1, u2: 2 }, ends_at: null, message: { text: 'Two minutes left', at: '2026-10-09T10:00:00Z' }, names: {} });
    expect(roomOf(b, 'u2')).toBe(2);
    expect(roomOf(b, 'host')).toBe(0);
    expect(roomOf({ ...b!, open: false }, 'u2')).toBe(0);
    expect(parseBreakout(null)).toBeNull();
    expect(parseBreakout({ open: true, rooms: [] })?.open).toBe(false);
  });

  it('counts down', () => {
    expect(timeLeft('2026-10-09T10:05:05Z', Date.parse('2026-10-09T10:00:00Z'))).toBe('5:05 left');
    expect(timeLeft('2026-10-09T10:00:00Z', Date.parse('2026-10-09T10:01:00Z'))).toBe('0:00 left');
    expect(timeLeft(null, 0)).toBeNull();
  });
});
