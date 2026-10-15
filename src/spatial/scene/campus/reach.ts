/**
 * Checks for places people can't get to: open floor (not furniture or walls) that no route from
 * the arrival point reaches. Used by the tests for every large world.
 */
import type { NavGrid } from '../pathfinding';
import type { Rect } from '../offices';

/** Every cell reachable from `start` (8 directions, no cutting corners), as a 0/1 array. */
export function reachable(grid: NavGrid, start: { x: number; z: number }): Uint8Array {
  const seen = new Uint8Array(grid.width * grid.depth);
  const free = (x: number, z: number) => x >= 0 && z >= 0 && x < grid.width && z < grid.depth && grid.blocked[z * grid.width + x] === 0;
  if (!free(start.x, start.z)) return seen;
  const queue = [start.z * grid.width + start.x];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % grid.width;
    const z = (i - x) / grid.width;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (!free(nx, nz) || seen[nz * grid.width + nx]) continue;
      if (dx && dz && (!free(x + dx, z) || !free(x, z + dz))) continue;
      seen[nz * grid.width + nx] = 1;
      queue.push(nz * grid.width + nx);
    }
  }
  return seen;
}

/**
 * Open patches inside `area` that can't be reached, at least `minCells` cells big (smaller ones
 * are the gaps between chairs round a table). Each is reported by a cell in it, in metres.
 */
export function strandedPatches(grid: NavGrid, seen: Uint8Array, cell: number, area: Rect, minCells = 6): { x: number; z: number; cells: number }[] {
  const done = new Uint8Array(seen.length);
  const out: { x: number; z: number; cells: number }[] = [];
  const x0 = Math.max(0, Math.floor(area.x0 / cell));
  const x1 = Math.min(grid.width - 1, Math.floor(area.x1 / cell) - 1);
  const z0 = Math.max(0, Math.floor(area.z0 / cell));
  const z1 = Math.min(grid.depth - 1, Math.floor(area.z1 / cell) - 1);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const i = z * grid.width + x;
    if (grid.blocked[i] || seen[i] || done[i]) continue;
    // Flood this stranded patch.
    let n = 0;
    const stack = [i];
    done[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      n++;
      const jx = j % grid.width;
      const jz = (j - jx) / grid.width;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = jx + dx;
        const nz = jz + dz;
        if (nx < x0 || nz < z0 || nx > x1 || nz > z1) continue;
        const k = nz * grid.width + nx;
        if (grid.blocked[k] || seen[k] || done[k]) continue;
        done[k] = 1;
        stack.push(k);
      }
    }
    if (n >= minCells) out.push({ x: (x + 0.5) * cell, z: (z + 0.5) * cell, cells: n });
  }
  return out;
}

/**
 * Whether you can walk a full circle round (cx, cz), staying between radii r0 and r1: every one of
 * `sectors` slices of the ring is reached from the first, through the ring only.
 */
export function canCircle(grid: NavGrid, cell: number, cx: number, cz: number, r0: number, r1: number, sectors = 16): boolean {
  const inRing = (x: number, z: number) => {
    const d = Math.hypot((x + 0.5) * cell - cx, (z + 0.5) * cell - cz);
    return d >= r0 && d <= r1 && x >= 0 && z >= 0 && x < grid.width && z < grid.depth && grid.blocked[z * grid.width + x] === 0;
  };
  const cells: number[] = [];
  for (let z = Math.floor((cz - r1) / cell); z <= Math.ceil((cz + r1) / cell); z++) for (let x = Math.floor((cx - r1) / cell); x <= Math.ceil((cx + r1) / cell); x++) if (inRing(x, z)) cells.push(z * grid.width + x);
  if (!cells.length) return false;
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % grid.width;
    const z = (i - x) / grid.width;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (z + dz) * grid.width + x + dx;
      if (!seen.has(k) && inRing(x + dx, z + dz)) { seen.add(k); stack.push(k); }
    }
  }
  const hit = new Set<number>();
  for (const i of seen) {
    const x = i % grid.width;
    const z = (i - x) / grid.width;
    const a = Math.atan2((z + 0.5) * cell - cz, (x + 0.5) * cell - cx);
    hit.add(Math.floor(((a + Math.PI) / (Math.PI * 2)) * sectors) % sectors);
  }
  return hit.size === sectors;
}
