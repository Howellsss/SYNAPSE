import { describe, expect, it } from 'vitest';
import { buildCampus, wallSegments } from './layout';
import { buildHub } from './hub';
import { KIT_BY_ID, pieceAt, placedBlocks } from './kit';
import type { Rect } from '../offices';

const touch = (a: Rect, b: Rect) => a.x0 < b.x1 - 0.05 && a.x1 > b.x0 + 0.05 && a.z0 < b.z1 - 0.05 && a.z1 > b.z0 + 0.05;

describe('the campus is tidy', () => {
  const c = buildCampus();
  // The airport forecourt is a paved plaza: its planters and benches belong on it.
  const forecourt = c.paths.find((p) => p.x0 === 40 && p.z0 === 101);

  it('nothing stands in a doorway or footpath (vehicles park on roads)', () => {
    const bad = c.objects.filter((p) => {
      const item = KIT_BY_ID.get(p.kind);
      if (!item || ('vehicle' in item && item.vehicle)) return false;
      return c.paths.some((path) => path !== forecourt && placedBlocks(p).some((b) => touch(b, path)));
    }).map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it('no piece sits in a wall', () => {
    const walls = c.buildings.flatMap((b) => wallSegments(b));
    expect(c.objects.filter((p) => placedBlocks(p).some((b) => walls.some((w) => touch(b, w)))).map((p) => p.id)).toEqual([]);
  });

  it('no two pieces grow into each other', () => {
    const all = c.objects.map((p) => ({ id: p.id, b: placedBlocks(p) })).filter((x) => x.b.length);
    const bad: string[] = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
      if (all[i].b.some((a) => all[j].b.some((b) => touch(a, b)))) bad.push(`${all[i].id} × ${all[j].id}`);
    expect(bad).toEqual([]);
  });

  it('the HQ doorway is clear', () => {
    expect(c.objects.some((p) => p.kind === 'lamp_post' && p.x > 18 && p.x < 22 && p.z > 22 && p.z < 30.5)).toBe(false);
  });

  it('clicking a parked plane finds it (to board it), but build mode cannot pick it', () => {
    const plane = c.objects.find((p) => p.kind === 'plane_jet')!;
    expect(pieceAt(c.objects, plane.x, plane.z, { vehicles: true })?.id).toBe(plane.id);
    expect(pieceAt(c.objects, plane.x, plane.z)?.kind).not.toBe('plane_jet');
  });
});

describe('the hub is tidy', () => {
  const c = buildHub();
  it('nothing stands in a footpath, and no two pieces grow into each other', () => {
    const bad = c.objects.filter((p) => c.paths.some((path) => placedBlocks(p).some((b) => touch(b, path)))).map((p) => p.id);
    const all = c.objects.map((p) => ({ id: p.id, b: placedBlocks(p) })).filter((x) => x.b.length);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
      if (all[i].b.some((a) => all[j].b.some((b) => touch(a, b)))) bad.push(`${all[i].id} × ${all[j].id}`);
    expect(bad).toEqual([]);
  });
});
