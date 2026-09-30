import { describe, it, expect } from 'vitest';
import { SIZING, SIZE_OPTIONS, sizingFor, setupSummary } from './sizing';
import type { SizeBand } from '@/types';

const BANDS: SizeBand[] = ['solo', 'small', 'medium', 'large', 'xl'];

describe('sizing', () => {
  it('has settings for every size band, in the order of the tiles', () => {
    expect(SIZE_OPTIONS.map((o) => o.band)).toEqual(BANDS);
    for (const band of BANDS) expect(SIZING[band]).toBeDefined();
  });

  it('maps each band to desks, rooms, lounges and capacity', () => {
    expect(sizingFor('solo')).toEqual({ desks: 1, meetingRooms: 1, lounges: 1, capacity: 6 });
    expect(sizingFor('small')).toEqual({ desks: 10, meetingRooms: 1, lounges: 1, capacity: 15 });
    expect(sizingFor('medium')).toEqual({ desks: 25, meetingRooms: 2, lounges: 1, capacity: 35 });
    expect(sizingFor('large')).toEqual({ desks: 50, meetingRooms: 4, lounges: 2, capacity: 70 });
    expect(sizingFor('xl')).toEqual({ desks: 80, meetingRooms: 6, lounges: 3, capacity: 120 });
  });

  it('gives a desk to everyone at the top of each band', () => {
    const top: Record<SizeBand, number> = { solo: 1, small: 10, medium: 25, large: 50, xl: 50 };
    for (const band of BANDS) expect(SIZING[band].desks).toBeGreaterThanOrEqual(top[band]);
  });

  it('grows with the team and always leaves room for guests', () => {
    for (let i = 1; i < BANDS.length; i++) {
      const prev = SIZING[BANDS[i - 1]];
      const cur = SIZING[BANDS[i]];
      expect(cur.desks).toBeGreaterThan(prev.desks);
      expect(cur.capacity).toBeGreaterThan(prev.capacity);
      expect(cur.meetingRooms).toBeGreaterThanOrEqual(prev.meetingRooms);
    }
    for (const band of BANDS) expect(SIZING[band].capacity).toBeGreaterThan(SIZING[band].desks);
  });

  it('describes the setup in the words of each space type', () => {
    expect(setupSummary('small', 'office').map((i) => i.text)).toEqual([
      '10 desks', '1 meeting room', '1 lounge', 'Room for 15 people at once',
    ]);
    expect(setupSummary('solo', 'classroom').map((i) => i.text)).toEqual([
      '1 seat', '1 breakout room', '1 reading corner', 'Room for 6 people at once',
    ]);
  });
});
