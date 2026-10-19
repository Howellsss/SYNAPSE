/**
 * The worlds fit together: you can board the planes, nothing stands in a doorway or the middle of
 * a way in, solid pieces don't overlap, people and chairs stand on floors, rugs and stages (not in
 * them), and the stages are raised with steps up.
 */
import { describe, expect, it } from 'vitest';
import { isFree, mapCell, walkMap } from '../floor';
import { findPath } from '../pathfinding';
import type { Rect } from '../offices';
import { groundOf, PARK_TOP, RUG_TOP } from './ground';
import { buildHub } from './hub';
import { KIT_BY_ID, pieceAt, placedBlocks, placedBounds, rideAt, STAGE_H } from './kit';
import { buildCampus, campusObstacles, campusSeats, PLANE_BAYS, PLANE_PARK, wallSegments, type CampusLayout } from './layout';

const campus = buildCampus();
const hub = buildHub();
const overlaps = (a: Rect, b: Rect, m = 0.02) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m;

/** The strip just inside and outside each doorway, where nothing should stand. */
function doorways(c: CampusLayout, depth = 2.5) {
  return c.buildings.flatMap((b) => b.doors.map((d) => {
    const { x0, x1, z0, z1 } = b.rect;
    const h = d.width / 2 - 0.2;
    const rect = d.side === 'n' ? { x0: x0 + d.at - h, x1: x0 + d.at + h, z0: z0 - depth, z1: z0 + depth }
      : d.side === 's' ? { x0: x0 + d.at - h, x1: x0 + d.at + h, z0: z1 - depth, z1: z1 + depth }
      : d.side === 'w' ? { x0: x0 - depth, x1: x0 + depth, z0: z0 + d.at - h, z1: z0 + d.at + h }
      : { x0: x1 - depth, x1: x1 + depth, z0: z0 + d.at - h, z1: z0 + d.at + h };
    return { id: `${b.id}/${d.side}`, rect };
  }));
}

describe('getting in', () => {
  it('finds the planes to board, though they are not in the build menu', () => {
    for (const id of ['ap-plane-airliner', 'ap-plane-jet']) {
      const plane = campus.objects.find((o) => o.id === id)!;
      expect(pieceAt(campus.objects, plane.x, plane.z)?.id).not.toBe(id); // build mode leaves them alone
      expect(rideAt(campus.objects, plane.x, plane.z)?.id).toBe(id);
      expect(rideAt(campus.objects, plane.x + 2, plane.z - 1)?.id).toBe(id);
    }
    // A car parked in its bay is still the car, not the car park.
    const car = campus.objects.find((o) => o.id === 'ap-car-0-0')!;
    expect(rideAt(campus.objects, car.x, car.z)?.id).toBe(car.id);
  });

  it('can walk up to the back of each plane to get in', () => {
    const map = walkMap({ width: campus.width, depth: campus.depth }, campusObstacles(campus), 0.5, 0.28);
    const start = mapCell(map, 60, 104);
    for (const id of ['ap-plane-airliner', 'ap-plane-jet']) {
      const plane = campus.objects.find((o) => o.id === id)!;
      const b = placedBlocks(plane)[0];
      const back = { x: plane.x, z: b.z0 - 0.7 };
      expect(isFree(map, back.x, back.z), id).toBe(true);
      expect(findPath(map.grid, start, mapCell(map, back.x, back.z)), id).not.toBeNull();
    }
  });

  for (const [name, c] of [['campus', campus], ['hub', hub]] as const) {
    it(`keeps every ${name} doorway clear`, () => {
      const blocked = doorways(c).flatMap((d) => c.objects
        .filter((o) => placedBlocks(o).some((b) => overlaps(b, d.rect)))
        .map((o) => `${d.id}: ${o.id}`));
      expect(blocked).toEqual([]);
    });
  }

  it('has no lamp in the middle of a way in (the HQ’s, the booths’)', () => {
    const narrow = campus.paths.filter((p) => Math.min(p.x1 - p.x0, p.z1 - p.z0) < 4);
    const lamps = campus.objects.filter((o) => o.kind === 'lamp_post');
    for (const p of narrow) expect(lamps.filter((l) => placedBlocks(l).some((b) => overlaps(b, p))).map((l) => l.id)).toEqual([]);
    // The HQ's way in has a lamp either side of it.
    expect(lamps.filter((l) => Math.abs(l.z - 29.4) < 0.1 && l.x > 16 && l.x < 24).map((l) => l.x).sort()).toEqual([17.6, 22.4]);
  });
});

describe('the airport', () => {
  it('has a plane park with a bay for each plane, and no terminal', () => {
    expect(campus.objects.some((o) => o.kind === 'airport_terminal')).toBe(false);
    expect(KIT_BY_ID.has('airport_terminal')).toBe(false);
    const park = placedBounds(campus.objects.find((o) => o.kind === 'plane_park')!)!;
    const planes = campus.objects.filter((o) => { const item = KIT_BY_ID.get(o.kind); return !!item && 'vehicle' in item && !!item.vehicle?.plane; });
    expect(planes.length).toBeGreaterThan(0);
    expect(planes.length).toBeLessThanOrEqual(PLANE_BAYS);
    const bay = PLANE_PARK.w / PLANE_BAYS;
    for (const p of planes) {
      // Inside the park, wingtips inside its own bay.
      const b = placedBounds(p)!;
      expect(b.x0 >= park.x0 && b.x1 <= park.x1 && b.z0 >= park.z0 && b.z1 <= park.z1, p.id).toBe(true);
      const i = Math.floor((p.x - park.x0) / bay);
      expect(b.x0 >= park.x0 + i * bay && b.x1 <= park.x0 + (i + 1) * bay, p.id).toBe(true);
    }
  });
});

describe('flat ground that never flickers', () => {
  it('keeps car, bike and plane parks above the paving where they meet it (never level with it)', () => {
    for (const c of [campus, hub]) {
      const parks = c.objects.filter((o) => ['car_park', 'bike_park', 'plane_park'].includes(o.kind));
      for (const p of parks) {
        const b = placedBounds(p)!;
        for (const q of c.paths.filter((x) => overlaps(b, x))) {
          const mid = { x: (Math.max(b.x0, q.x0) + Math.min(b.x1, q.x1)) / 2, z: (Math.max(b.z0, q.z0) + Math.min(b.z1, q.z1)) / 2 };
          expect(groundOf(c.buildings, c.objects, c.paths).at(mid.x, mid.z), p.id).toBe(PARK_TOP);
        }
        expect(groundOf(c.buildings, c.objects, c.paths).at(p.x, p.z), p.id).toBe(PARK_TOP);
      }
    }
  });
});

describe('pieces in their places', () => {
  for (const [name, c] of [['campus', campus], ['hub', hub]] as const) {
    it(`never stands one solid ${name} piece in another, or in a wall`, () => {
      const pieces = c.objects.map((o) => ({ o, b: placedBlocks(o) }));
      const walls = c.buildings.flatMap(wallSegments);
      const bad: string[] = [];
      pieces.forEach((A, i) => {
        for (const B of pieces.slice(i + 1)) if (A.b.some((a) => B.b.some((b) => overlaps(a, b, 0.05)))) bad.push(`${A.o.id} × ${B.o.id}`);
        if (A.b.some((a) => walls.some((w) => overlaps(a, w, 0.05)))) bad.push(`${A.o.id} in a wall`);
      });
      expect(bad).toEqual([]);
    });
  }

  it('keeps an aisle in from the game room and library doors', () => {
    for (const [room, depth] of [['game', 8], ['library', 8]] as const) {
      const b = campus.buildings.find((x) => x.id === room)!;
      const door = b.doors[0];
      const x = b.rect.x0 + door.at;
      const aisle = { x0: x - 1, x1: x + 1, z0: b.rect.z0, z1: b.rect.z0 + depth };
      expect(campus.objects.filter((o) => placedBlocks(o).some((r) => overlaps(r, aisle))).map((o) => o.id), room).toEqual([]);
    }
  });
});

describe('standing on things', () => {
  const ground = groundOf(campus.buildings, campus.objects);
  it('stands people on floors and rugs, not in them', () => {
    expect(ground.at(60.5, 45)).toBe(0); // the park
    expect(ground.at(48, 20)).toBeCloseTo(0.03, 3); // the hall's floor
    const rug = campus.objects.find((o) => o.id === 'lounge-rug-a')!;
    expect(ground.at(rug.x, rug.z)).toBe(RUG_TOP);
  });

  it('raises the stages, with steps up at the front', () => {
    const stage = campus.objects.find((o) => o.id === 'ah-stage')!;
    expect(ground.at(stage.x, stage.z)).toBe(STAGE_H);
    // Up the steps at the right-hand end: each tread higher, then the stage.
    const x = stage.x + (12 / 2 - 1.4);
    const front = stage.z + 3.5 / 2;
    const climb = [front + 0.75, front + 0.45, front + 0.15, front - 0.3].map((z) => ground.at(x, z));
    expect(climb[0]).toBeCloseTo(0.03, 3);
    expect(climb[1]).toBeGreaterThan(climb[0]);
    expect(climb[2]).toBeGreaterThan(climb[1]);
    expect(climb[3]).toBe(STAGE_H);
    // You get on it up the steps, not up its front.
    const map = walkMap({ width: campus.width, depth: campus.depth }, campusObstacles(campus), 0.5, 0.28);
    expect(isFree(map, stage.x, front - 0.06)).toBe(false);
    expect(findPath(map.grid, mapCell(map, 60.5, 20), mapCell(map, stage.x, stage.z))).not.toBeNull();
  });

  it('puts the podium and the panel chairs up on the auditorium stage', () => {
    const hg = groundOf(hub.buildings, hub.objects);
    const podium = hub.objects.find((o) => o.id === 'auditorium-podium')!;
    expect(hg.base(podium)).toBe(STAGE_H);
    const panel = campusSeats(hub).find((s) => s.id.startsWith('auditorium-panel-0'))!;
    expect(panel.y).toBeCloseTo(0.53 + STAGE_H, 3); // a mustard lounge chair
    // A seat in the audience: its chair on the hall's carpet.
    const seat = campusSeats(hub).find((s) => s.id.startsWith('auditorium-seat-c-0-0'))!;
    expect(seat.y).toBeCloseTo(0.51 + 0.03, 3);
  });
});
