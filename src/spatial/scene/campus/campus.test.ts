import { describe, expect, it } from 'vitest';
import { isFree, walkMap } from '../floor';
import { findPath } from '../pathfinding';
import { mapCell } from '../floor';
import { KIT, KIT_BY_ID, fitsAt, isGlb, itemSize, pieceAt, placedBlocks, placedSeats } from './kit';
import { addPiece, applyEdits, movePiece, NO_EDITS, readEdits, removePiece } from './office';
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

describe('build mode', () => {
  const obstacles = campusObstacles(c);
  it('places pieces on open ground, not in walls, water or other furniture', () => {
    expect(fitsAt(obstacles, { id: 'g', kind: 'bench', x: 60.5, z: 56, rot: 0 }, c.width, c.depth)).toBe(true);
    expect(fitsAt(obstacles, { id: 'g', kind: 'bench', x: 60.5, z: 79, rot: 0 }, c.width, c.depth)).toBe(false); // the pond
    expect(fitsAt(obstacles, { id: 'g', kind: 'bench', x: 45.1, z: 15, rot: 0 }, c.width, c.depth)).toBe(false); // the hall's wall
    expect(fitsAt(obstacles, { id: 'g', kind: 'bench', x: 0.2, z: 15, rot: 0 }, c.width, c.depth)).toBe(false); // off the grounds
    // A rug can go under things.
    expect(fitsAt(obstacles, { id: 'g', kind: 'rug_navy', x: 60.5, z: 15, rot: 0 }, c.width, c.depth)).toBe(true);
  });

  it('picks the smallest piece under a point and never layout-only ones', () => {
    const objects = [...c.objects, { id: 'r', kind: 'rug_gold', x: 60.5, z: 50, rot: 0 }, { id: 'p', kind: 'planter_small', x: 60.5, z: 50, rot: 0 }];
    expect(pieceAt(objects, 60.5, 50)?.id).toBe('p');
    expect(pieceAt(objects, 61.6, 50)?.id).toBe('r');
    expect(pieceAt(c.objects, 60.5, 46.75)).toBeNull(); // the grand fountain is part of the layout
  });

  it('adds, moves, turns and removes pieces, and the result survives saving', () => {
    const base = c.objects.find((o) => o.kind === 'bench')!;
    let e = addPiece(NO_EDITS, { id: 'u1', kind: 'monstera', x: 50, z: 50, rot: 0 });
    e = movePiece(e, c.objects, 'u1', { x: 51, z: 50, rot: Math.PI / 2 });
    expect(e.added).toEqual([{ id: 'u1', kind: 'monstera', x: 51, z: 50, rot: Math.PI / 2 }]);
    // A layout piece moved becomes an added copy, and the original is taken away.
    e = movePiece(e, c.objects, base.id, { x: 52, z: 52, rot: 0 }, 'u2');
    expect(e.removed).toEqual([base.id]);
    expect(e.added.find((p) => p.id === 'u2')).toMatchObject({ kind: base.kind, x: 52, z: 52 });
    e = removePiece(e, 'u1');
    expect(e.added.map((p) => p.id)).toEqual(['u2']);
    const saved = readEdits(JSON.parse(JSON.stringify(e)));
    expect(saved).toEqual(e);
    const out = applyEdits(c, saved);
    expect(out.objects.some((o) => o.id === base.id)).toBe(false);
    expect(out.objects.some((o) => o.id === 'u2')).toBe(true);
  });

  it('drops anything unsafe in saved edits', () => {
    const e = readEdits({ added: [{ id: 'bad id!', kind: 'bench', x: 1, z: 1, rot: 0 }, { id: 'ok', kind: 'nope', x: 1, z: 1, rot: 0 }, { id: 'u3', kind: 'bench', x: 9999, z: 5, rot: 0 }], removed: [5, 'x'] });
    expect(e.added).toEqual([{ id: 'u3', kind: 'bench', x: c.width, z: 5, rot: 0 }]);
    expect(e.removed).toEqual(['x']);
  });
});
