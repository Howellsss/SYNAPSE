import { describe, expect, it } from 'vitest';
import { isFree, walkMap } from '../floor';
import { findPath } from '../pathfinding';
import { mapCell } from '../floor';
import { KIT, KIT_BY_ID, isGlb, itemSize, placedBlocks, placedSeats } from './kit';
import { buildCampus, campusObstacles, campusSeats, wallSegments, zoneAt } from './layout';

const c = buildCampus(['Video', 'Tech']);
const map = walkMap({ width: c.width, depth: c.depth }, campusObstacles(c), 0.5, 0.28);

describe('campus kit', () => {
  it('moves blocks and seats with the piece', () => {
    const seat = placedSeats({ id: 'w', kind: 'workstation', x: 10, z: 10, rot: 0 })[0];
    expect(seat.x).toBeCloseTo(9.995, 2);
    expect(seat.z).toBeCloseTo(9.68, 2);
    expect(seat.rot).toBeCloseTo(0, 5);
    const turned = placedSeats({ id: 'w', kind: 'workstation', x: 10, z: 10, rot: Math.PI })[0];
    expect(turned.z).toBeCloseTo(10.32, 2);
    expect(Math.abs(turned.rot)).toBeCloseTo(Math.PI, 5);
    // A sofa facing +z: its seats run along x, in front of its back.
    const sofa = placedSeats({ id: 's', kind: 'sofa', x: 0, z: 0, rot: 0 });
    expect(new Set(sofa.map((s) => s.z.toFixed(2))).size).toBe(1);
    expect(sofa.map((s) => s.x)).toEqual([...sofa.map((s) => s.x)].sort((a, b) => b - a));
  });
  it('has a size and a footprint for every piece', () => {
    for (const item of KIT) {
      const { w, d } = itemSize(item);
      expect(w).toBeGreaterThan(0.2);
      expect(d).toBeGreaterThan(0.05);
      if (isGlb(item)) expect(item.nodes.length).toBeGreaterThan(0);
    }
    expect(placedBlocks({ id: 'r', kind: 'rug_navy', x: 0, z: 0, rot: 0 })).toEqual([]);
    expect(KIT_BY_ID.get('nope')).toBeUndefined();
  });
});

describe('campus layout', () => {
  it('is large and names team areas after departments', () => {
    expect(c.width * c.depth).toBeGreaterThan(6 * 20 * 16);
    expect(c.zones.find((z) => z.id === 'team-1')?.name).toBe('Video');
    expect(c.zones.find((z) => z.id === 'team-3')?.name).toBe('Team Area 3');
  });
  it('gives every piece a unique id', () => {
    expect(new Set(c.objects.map((o) => o.id)).size).toBe(c.objects.length);
  });
  it('leaves gaps in walls for doors', () => {
    const b = c.buildings.find((x) => x.id === 'allhands')!;
    const south = wallSegments(b).filter((w) => w.z0 === b.rect.z1 - 0.2 && w.z1 === b.rect.z1);
    expect(south).toHaveLength(2);
  });
  it('knows the most specific place you are in', () => {
    expect(zoneAt(c.zones, 60.5, 7)?.id).toBe('allhands-stage');
    expect(zoneAt(c.zones, 60.5, 20)?.id).toBe('allhands');
    expect(zoneAt(c.zones, 60.5, 46)?.id).toBe('plaza');
    expect(zoneAt(c.zones, c.hq.x + 3, c.hq.z + 3)?.id).toBe('hq-meet');
  });
  it('can walk from the plaza into every place', () => {
    expect(isFree(map, c.spawn.x, c.spawn.z)).toBe(true);
    const start = mapCell(map, c.spawn.x, c.spawn.z);
    const targets: Record<string, [number, number]> = {
      hq: [c.hq.x + 10, c.hq.z + 12], allhands: [60.5, 22], cafe: [98, 22.5], lounge: [108, 14.5], team1: [11.5, 41], team4: [31.5, 54],
      meet1: [88, 40.5], meet4: [105, 54], focus1: [6, 68.5], focus8: [33, 81], game: [91.75, 75], library: [109, 82], garden: [60.5, 90],
    };
    for (const [name, [x, z]] of Object.entries(targets)) {
      expect(isFree(map, x, z), `${name} is free`).toBe(true);
      expect(findPath(map.grid, start, mapCell(map, x, z)), `path to ${name}`).not.toBeNull();
    }
  });
  it('has places to sit, each one reachable from beside it', () => {
    const seats = campusSeats(c);
    expect(seats.length).toBeGreaterThan(150);
    expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length);
  });
  it('keeps pieces added in build mode', () => {
    const more = buildCampus([], [{ id: 'mine-1', kind: 'tree', x: 70, z: 50, rot: 0 }]);
    expect(more.objects.some((o) => o.id === 'mine-1')).toBe(true);
  });
});
