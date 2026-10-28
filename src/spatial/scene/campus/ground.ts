/**
 * How high the ground is anywhere in a large world: a building's floor, a rug on it, a stage and
 * its steps. People stand on it (their feet on the rug, not in it) and pieces stand on it (a chair
 * on a stage is up on the stage), and a seat is as high as its chair plus what the chair stands on.
 *
 * Pure numbers, matching what the renderer draws: a building's floor is a slab 6 cm thick centred
 * on y = 0 (a room inside another a few millimetres higher), a rug a 2 cm mat on top of that.
 */
import type { Rect } from '../offices';
import { isGlb, KIT_BY_ID, placedBounds, STAGE_H, STAGE_STEPS, stageStepXs, turn, type Placed } from './kit';
import type { Building } from './layout';

/** The top of a building's floor slab (a room inside another sits a little higher). */
export const floorTop = (nested: number) => 0.03 + nested * 0.006;
/** The top of a rug. */
export const RUG_TOP = 0.082;
/** The top of the paving (avenues and walks' slabs are 5 cm, centred on y = 0). */
export const PAVING_TOP = 0.025;
/** The top of a car, bike or plane park: a little above the paving, so the two never flicker where they meet. */
export const PARK_TOP = 0.04;

/** Flat things that lie on the ground themselves (drawn at their own height, never lifted). */
const FLAT = new Set(['rug', 'stage', 'runway', 'taxiway', 'car_park', 'bike_park', 'plane_park', 'doorway', 'lilies']);
const PARKS = new Set(['car_park', 'bike_park', 'plane_park']);

interface Patch { rect: Rect; h: number }

export interface Ground {
  /** The height to stand at here. */
  at(x: number, z: number): number;
  /** The height a piece stands at (what's under its middle: a floor, a rug, a stage). */
  base(p: Placed): number;
}

const inside = (a: Rect, o: Rect) => a !== o && a.x0 >= o.x0 && a.x1 <= o.x1 && a.z0 >= o.z0 && a.z1 <= o.z1;

export function groundOf(buildings: Building[], objects: Placed[], paths: Rect[] = []): Ground {
  const patches: Patch[] = paths.map((rect) => ({ rect, h: PAVING_TOP }));
  for (const b of buildings) {
    if (!b.floor) continue;
    const nested = buildings.filter((o) => o.floor && inside(b.rect, o.rect)).length;
    patches.push({ rect: b.rect, h: floorTop(nested) });
  }
  for (const p of objects) {
    const item = KIT_BY_ID.get(p.kind);
    if (!item || isGlb(item)) continue;
    if (item.proc === 'rug' || PARKS.has(item.proc)) {
      const rect = placedBounds(p);
      if (rect) patches.push({ rect, h: item.proc === 'rug' ? RUG_TOP : PARK_TOP });
    } else if (item.proc === 'stage') {
      const rect = placedBounds(p);
      if (rect) patches.push({ rect, h: STAGE_H });
      // The treads in front, each a step lower than the one behind it.
      const { w, d, n } = STAGE_STEPS;
      for (const sx of stageStepXs(item.w)) {
        for (let k = 0; k < n; k++) {
          const z0 = item.d / 2 + k * d;
          const corners = [[sx - w / 2, z0], [sx + w / 2, z0], [sx - w / 2, z0 + d], [sx + w / 2, z0 + d]]
            .map(([lx, lz]) => { const [dx, dz] = turn(lx, lz, p.rot); return [p.x + dx, p.z + dz]; });
          patches.push({
            rect: { x0: Math.min(...corners.map((q) => q[0])), x1: Math.max(...corners.map((q) => q[0])), z0: Math.min(...corners.map((q) => q[1])), z1: Math.max(...corners.map((q) => q[1])) },
            h: (STAGE_H * (n - k)) / (n + 1),
          });
        }
      }
    }
  }
  const at = (x: number, z: number) => {
    let h = 0;
    for (const { rect: b, h: ph } of patches) if (ph > h && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) h = ph;
    return h;
  };
  return {
    at,
    base(p) {
      const item = KIT_BY_ID.get(p.kind);
      if (!item || (!isGlb(item) && (FLAT.has(item.proc) || item.vehicle))) return 0;
      return at(p.x, p.z);
    },
  };
}
