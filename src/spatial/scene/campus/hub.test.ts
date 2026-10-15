import { describe, expect, it } from 'vitest';
import { isFree, mapCell, walkMap } from '../floor';
import { findPath } from '../pathfinding';
import { buildHub, HUB_D, HUB_W } from './hub';
import { campusObstacles, campusSeats, portalAt, wingAt, zoneAt } from './layout';

const hub = buildHub();
const map = walkMap({ width: HUB_W, depth: HUB_D }, campusObstacles(hub), 0.5, 0.28);
const reach = (a: { x: number; z: number }, b: { x: number; z: number }) => !!findPath(map.grid, mapCell(map, a.x, a.z), mapCell(map, b.x, b.z));
/** A free point inside a doorway's trigger. */
const doorCell = (r: { x0: number; x1: number; z0: number; z1: number }) => {
  for (let x = r.x0 + 0.25; x < r.x1; x += 0.25) for (let z = r.z0 + 0.1; z < r.z1; z += 0.1) {
    if (isFree(map, x, z)) return { x, z };
  }
  return null;
};

describe('SYNAPSE Hub', () => {
  it('has a courtyard and six places, each with a way in and a way back', () => {
    expect(hub.wings?.map((w) => w.id)).toEqual(['court', 'auditorium', 'conference', 'terrace', 'studio', 'cafe', 'lounge']);
    expect(hub.portals).toHaveLength(12);
    for (const p of hub.portals!) {
      const from = wingAt(hub, (p.rect.x0 + p.rect.x1) / 2, (p.rect.z0 + p.rect.z1) / 2);
      const to = wingAt(hub, p.to.x, p.to.z);
      expect(to, p.id).not.toBeNull();
      expect(to?.id).not.toBe(from?.id);
      // You don't arrive standing in another doorway (that would send you straight on).
      expect(portalAt(hub, p.to.x, p.to.z), p.id).toBeNull();
    }
  });

  it('keeps the places far apart, so only one shows at a time', () => {
    const wings = hub.wings!;
    for (const a of wings) for (const b of wings) {
      if (a === b) continue;
      const gap = Math.max(b.rect.x0 - a.rect.x1, a.rect.x0 - b.rect.x1, b.rect.z0 - a.rect.z1, a.rect.z0 - b.rect.z1);
      expect(gap, `${a.id}/${b.id}`).toBeGreaterThanOrEqual(25);
    }
  });

  it('lets you walk from where you arrive to every doorway of that place', () => {
    const spawn = hub.spawn;
    expect(wingAt(hub, spawn.x, spawn.z)?.id).toBe('court');
    for (const p of hub.portals!) {
      const cell = doorCell(p.rect);
      expect(cell, `${p.id} has a free cell`).not.toBeNull();
      const from = p.id.startsWith('to-') ? spawn : hub.portals!.find((q) => q.id === `to-${p.id.slice(5)}`)!.to;
      expect(reach(from, cell!), `${p.id} reachable`).toBe(true);
    }
  });

  it('lets you reach the far side of every place', () => {
    const spots: Record<string, [number, number]> = {
      auditorium: [122, 34], conference: [195, 33.5], studio: [10, 116], cafe: [110, 118], lounge: [190, 121], terrace: [265, 40],
    };
    for (const [id, [x, z]] of Object.entries(spots)) {
      const arrival = hub.portals!.find((p) => p.id === `to-${id}`)!.to;
      expect(wingAt(hub, x, z)?.id).toBe(id);
      expect(reach(arrival, { x, z }), id).toBe(true);
    }
  });

  it('names every place and has plenty of seats', () => {
    expect(zoneAt(hub.zones, 122, 20)?.name).toBe('Auditorium');
    expect(zoneAt(hub.zones, 122, 10)?.name).toBe('Stage');
    expect(zoneAt(hub.zones, 185, 10)?.name).toBe('Boardroom');
    expect(zoneAt(hub.zones, 165, 100)?.name).toBe('Library');
    expect(campusSeats(hub).length).toBeGreaterThan(500);
  });
});
