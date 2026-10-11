import { describe, expect, it } from 'vitest';
import { cellCenter, freeSpot, isFree, mapCell, stepTo, walkMap } from './floor';
import { findPath } from './pathfinding';
import { OFFICE_01, OFFICE_02, OFFICES, officeFor } from './offices';

const map = walkMap(OFFICE_01.floor, OFFICE_01.obstacles, 0.25, 0.28);
const reach = (from: { x: number; z: number }, to: { x: number; z: number }) => {
  const path = findPath(map.grid, mapCell(map, from.x, from.z), mapCell(map, to.x, to.z));
  if (!path) return null;
  const [ex, ez] = cellCenter(map, path[path.length - 1]);
  return Math.hypot(ex - to.x, ez - to.z);
};

describe('SYNAPSE Office 01', () => {
  it('is picked by id and absent otherwise', () => {
    expect(officeFor('office-01')).toBe(OFFICE_01);
    expect(officeFor(null)).toBeNull();
    expect(officeFor('nope')).toBeNull();
  });
  it('keeps every obstacle on the floor', () => {
    for (const o of OFFICE_01.obstacles) {
      expect(o.x0).toBeGreaterThanOrEqual(0);
      expect(o.z0).toBeGreaterThanOrEqual(0);
      expect(o.x1).toBeLessThanOrEqual(OFFICE_01.floor.width);
      expect(o.z1).toBeLessThanOrEqual(OFFICE_01.floor.depth);
    }
  });
  it('spawns people in the open middle', () => {
    expect(isFree(map, OFFICE_01.spawn.x, OFFICE_01.spawn.z)).toBe(true);
  });
  it('blocks desks, the meeting table and walls', () => {
    expect(isFree(map, 15, 3.4)).toBe(false); // desks
    expect(isFree(map, 3.6, 3.4)).toBe(false); // meeting table
    expect(isFree(map, 7, 3)).toBe(false); // glass wall
    expect(isFree(map, 5, 0.1)).toBe(false); // back wall
  });
  it('reaches every area from the spawn point, including through the meeting room door', () => {
    const spawn = OFFICE_01.spawn;
    for (const spot of [{ x: 2.5, z: 5.6 }, { x: 3.5, z: 13.8 }, { x: 15, z: 5.6 }, { x: 15, z: 1.3 }, { x: 15, z: 10 }, { x: 9, z: 14.6 }]) {
      expect(isFree(map, spot.x, spot.z)).toBe(true);
      expect(reach(spawn, spot)).not.toBeNull();
      expect(reach(spawn, spot)!).toBeLessThan(0.3);
    }
  });
  it('moves a tap on furniture to the nearest free spot', () => {
    const p = freeSpot(map, 15, 3.4);
    expect(isFree(map, p.x, p.z)).toBe(true);
    expect(Math.hypot(p.x - 15, p.z - 3.4)).toBeLessThan(2.3);
  });
  it('slides along a wall instead of stopping dead', () => {
    // Walking into the back wall diagonally keeps moving along it.
    const p = stepTo(map, 12.5, 0.55, 0.1, -0.1);
    expect(p.x).toBeGreaterThan(12.5);
    expect(p.z).toBeCloseTo(0.55, 6);
  });
});

describe('SYNAPSE Office 02', () => {
  const map2 = walkMap(OFFICE_02.floor, OFFICE_02.obstacles, 0.25, 0.28);
  const reach2 = (from: { x: number; z: number }, to: { x: number; z: number }) => {
    const path = findPath(map2.grid, mapCell(map2, from.x, from.z), mapCell(map2, to.x, to.z));
    if (!path) return null;
    const [ex, ez] = cellCenter(map2, path[path.length - 1]);
    return Math.hypot(ex - to.x, ez - to.z);
  };
  it('is listed first and found by id', () => {
    expect(Object.keys(OFFICES)[0]).toBe('office-02');
    expect(officeFor('office-02')).toBe(OFFICE_02);
    expect(officeFor('office-01')).toBe(OFFICE_01);
  });
  it('keeps every footprint on the floor', () => {
    for (const o of OFFICE_02.obstacles) {
      expect(o.x0).toBeLessThan(o.x1);
      expect(o.z0).toBeLessThan(o.z1);
      expect(o.x0).toBeGreaterThanOrEqual(0);
      expect(o.z0).toBeGreaterThanOrEqual(0);
      expect(o.x1).toBeLessThanOrEqual(OFFICE_02.floor.width);
      expect(o.z1).toBeLessThanOrEqual(OFFICE_02.floor.depth);
    }
  });
  it('blocks furniture and walls, and spawns in the open', () => {
    expect(isFree(map2, OFFICE_02.spawn.x, OFFICE_02.spawn.z)).toBe(true);
    expect(isFree(map2, 15, 3.4)).toBe(false); // desks
    expect(isFree(map2, 3.6, 3.4)).toBe(false); // meeting table
    expect(isFree(map2, 0.75, 11.4)).toBe(false); // sofa
    expect(isFree(map2, 13.4, 11.3)).toBe(false); // café table
    expect(isFree(map2, 8.8, 0.5)).toBe(false); // coffee bar
    expect(isFree(map2, 7, 3)).toBe(false); // glass wall
  });
  it('reaches every area from the spawn point, including inside the meeting room', () => {
    for (const spot of [{ x: 3.6, z: 1.5 }, { x: 6.2, z: 5.5 }, { x: 3.3, z: 13.4 }, { x: 15, z: 5.6 }, { x: 15, z: 1.4 }, { x: 15.1, z: 11.9 }, { x: 9, z: 14.5 }, { x: 8.8, z: 1.6 }]) {
      expect(isFree(map2, spot.x, spot.z)).toBe(true);
      expect(reach2(OFFICE_02.spawn, spot)).not.toBeNull();
      expect(reach2(OFFICE_02.spawn, spot)!).toBeLessThan(0.3);
    }
  });
  it('lights from the sun direction the floor was baked with', () => {
    const s = OFFICE_02.sun!;
    expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 2);
    expect(s.y).toBeGreaterThan(0);
  });
});

describe('open floor walk map', () => {
  it('matches the old 1 m grid with nothing blocked', () => {
    const open = walkMap({ width: 20, depth: 16 });
    expect(open.grid.width).toBe(20);
    expect(open.grid.depth).toBe(16);
    expect(open.grid.blocked.every((b) => b === 0)).toBe(true);
    expect(mapCell(open, 3.7, 0.2)).toEqual({ x: 3, z: 0 });
    expect(cellCenter(open, { x: 3, z: 0 })).toEqual([3.5, 0.5]);
  });
});
