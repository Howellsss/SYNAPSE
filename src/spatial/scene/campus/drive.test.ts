import { describe, expect, it } from 'vitest';
import { buildCampus, campusObstacles } from './layout';
import { KIT_BY_ID } from './kit';
import { isFree, walkMap } from '../floor';

describe('driving out of a bay', () => {
  const c = buildCampus();
  const floor = { width: c.width, depth: c.depth };
  const vehicles = c.objects.filter((o) => { const item = KIT_BY_ID.get(o.kind); return !!item && 'vehicle' in item && !!item.vehicle; });

  it('a parked vehicle blocks its bay, and the bay opens once someone takes it out', () => {
    expect(vehicles.length).toBeGreaterThan(10);
    const all = walkMap(floor, campusObstacles(c), 0.5, 0.28);
    for (const v of vehicles) {
      const out = walkMap(floor, campusObstacles({ ...c, objects: c.objects.filter((o) => o.id !== v.id) }), 0.5, 0.28);
      expect(isFree(all, v.x, v.z), `${v.id} parked`).toBe(false);
      expect(isFree(out, v.x, v.z), `${v.id} taken out`).toBe(true);
    }
  });
});
