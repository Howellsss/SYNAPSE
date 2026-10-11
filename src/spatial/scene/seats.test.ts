import { describe, expect, it } from 'vitest';
import { isFree, walkMap } from './floor';
import { OFFICE_02 } from './offices';
import { seatApproach, seatAt, seatForward, seatOnRay, sittingSpot, type Seat } from './seats';

const seats = OFFICE_02.seats!;
const map = walkMap(OFFICE_02.floor, OFFICE_02.obstacles, 0.25, 0.28);

describe('Office 02 seats', () => {
  it('has a seat for every chair, sofa place and armchair', () => {
    expect(seats).toHaveLength(27);
    expect(new Set(seats.map((s) => s.id)).size).toBe(27);
    expect(seats.filter((s) => s.kind === 'sofa')).toHaveLength(3);
    expect(seats.filter((s) => s.kind === 'armchair')).toHaveLength(2);
  });
  it('puts every seat inside furniture (so nobody walks through it) with a free place to stand beside it', () => {
    for (const s of seats) {
      expect(isFree(map, s.x, s.z)).toBe(false);
      const a = seatApproach(map, s);
      expect(isFree(map, a.x, a.z)).toBe(true);
      expect(Math.hypot(a.x - s.x, a.z - s.z)).toBeLessThan(1.6);
    }
  });
  it('faces chairs at their desk or table', () => {
    const desk = seats.find((s) => s.id === 'desk-1')!;
    expect(seatForward(desk).z).toBeGreaterThan(0.9); // towards the desk row at z 2.9
    const cafe = seats.find((s) => s.id === 'cafe-1')!;
    const f = seatForward(cafe);
    const toTable = { x: 13.4 - cafe.x, z: 11.3 - cafe.z };
    expect(f.x * toTable.x + f.z * toTable.z).toBeGreaterThan(0);
  });
  it('stands you up behind a chair and in front of the sofa', () => {
    const desk = seats.find((s) => s.id === 'desk-1')!;
    expect(seatApproach(map, desk).z).toBeLessThan(desk.z); // behind, away from the desk
    const sofa = seats.find((s) => s.id === 'sofa-2')!;
    expect(seatApproach(map, sofa).x).toBeGreaterThan(sofa.x); // in front, away from the wall
  });
});

describe('finding seats', () => {
  const a: Seat = { id: 'a', x: 2, z: 2, rot: 0, y: 0.48, kind: 'chair' };
  const b: Seat = { id: 'b', x: 3, z: 2, rot: Math.PI, y: 0.48, kind: 'chair' };
  it('matches a position to the nearest seat within reach', () => {
    expect(seatAt([a, b], 2.1, 2)).toBe(a);
    expect(seatAt([a, b], 2.9, 2.1)).toBe(b);
    expect(seatAt([a, b], 2.5, 3)).toBeNull();
  });
  it('follows a tap down to the cushion, not the floor behind it', () => {
    // Looking down at 45° from +z: the ray crosses the cushion height above seat a,
    // but reaches the floor half a metre further on.
    const origin = { x: 2, y: 10.48, z: 12 };
    const dir = { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 };
    expect(seatOnRay([a, b], origin, dir)).toBe(a);
    expect(seatAt([a, b], 2, 2 - 0.48)).toBeNull();
    expect(seatOnRay([a, b], origin, { x: 0, y: 1, z: 0 })).toBeNull();
  });
  it('draws sitting people a little back from the seat centre', () => {
    const p = sittingSpot(a);
    expect(p.x).toBeCloseTo(2);
    expect(p.z).toBeLessThan(2);
  });
});
