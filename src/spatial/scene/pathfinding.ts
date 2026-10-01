/**
 * Grid pathfinding for walking around a space.
 *
 * The navigation grid (built from walls and blocking furniture by navGrid.ts) splits the floor
 * into square cells. Cells are addressed by integer (x, z); 1 cell = `cellSize` metres.
 */

export interface NavGrid {
  /** Cells across (x) and deep (z). */
  width: number;
  depth: number;
  /** 1 = blocked, 0 = walkable; index = z * width + x. */
  blocked: Uint8Array;
}

export interface Cell {
  x: number;
  z: number;
}

export function makeGrid(width: number, depth: number, blockedCells: Cell[] = []): NavGrid {
  const blocked = new Uint8Array(width * depth);
  for (const c of blockedCells) if (inBounds({ width, depth, blocked }, c)) blocked[c.z * width + c.x] = 1;
  return { width, depth, blocked };
}

/** Builds a grid from rows of text: '#' blocked, anything else walkable. Handy for tests and debugging. */
export function gridFromRows(rows: string[]): NavGrid {
  const depth = rows.length;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const cells: Cell[] = [];
  rows.forEach((row, z) => [...row].forEach((ch, x) => { if (ch === '#') cells.push({ x, z }); }));
  return makeGrid(width, depth, cells);
}

export function inBounds(grid: NavGrid, c: Cell): boolean {
  return c.x >= 0 && c.z >= 0 && c.x < grid.width && c.z < grid.depth;
}

export function isWalkable(grid: NavGrid, c: Cell): boolean {
  return inBounds(grid, c) && grid.blocked[c.z * grid.width + c.x] === 0;
}

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Octile distance: exact cost on an 8-direction grid with no obstacles. */
function heuristic(a: Cell, b: Cell): number {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
}

/** Minimal binary heap keyed on f-score. */
class Heap {
  private items: number[] = [];
  constructor(private score: Float64Array) {}
  get size() { return this.items.length; }
  push(i: number) {
    const a = this.items;
    a.push(i);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[n]]) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1;
        let m = n;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top;
  }
}

/**
 * The closest walkable cell to `c` (itself if walkable), searching outward ring by ring.
 * Used when someone taps on a desk or wall: walk to the nearest spot beside it.
 */
export function nearestWalkable(grid: NavGrid, c: Cell, maxRadius = 8): Cell | null {
  const start = { x: Math.round(c.x), z: Math.round(c.z) };
  if (isWalkable(grid, start)) return start;
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const n = { x: start.x + dx, z: start.z + dz };
        if (!isWalkable(grid, n)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * A* from `start` to `goal`, 8 directions, never cutting a blocked corner.
 * Returns the cells to walk through (start and goal included), or null when there's no way.
 * A blocked goal is replaced with the nearest walkable cell.
 */
export function findPath(grid: NavGrid, start: Cell, goal: Cell): Cell[] | null {
  const s = nearestWalkable(grid, start, 2);
  const g = nearestWalkable(grid, goal);
  if (!s || !g) return null;
  if (s.x === g.x && s.z === g.z) return [s];

  const W = grid.width;
  const N = W * grid.depth;
  const gScore = new Float64Array(N).fill(Infinity);
  const fScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const startI = s.z * W + s.x;
  const goalI = g.z * W + g.x;
  gScore[startI] = 0;
  fScore[startI] = heuristic(s, g);
  const open = new Heap(fScore);
  open.push(startI);

  while (open.size) {
    const cur = open.pop();
    if (cur === goalI) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W;
    const cz = (cur - cx) / W;
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!isWalkable(grid, { x: nx, z: nz })) continue;
      // Diagonal moves need both side cells free, so avatars don't clip through corners.
      if (dx && dz && (!isWalkable(grid, { x: cx + dx, z: cz }) || !isWalkable(grid, { x: cx, z: cz + dz }))) continue;
      const ni = nz * W + nx;
      if (closed[ni]) continue;
      const tentative = gScore[cur] + cost;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        fScore[ni] = tentative + heuristic({ x: nx, z: nz }, g);
        came[ni] = cur;
        open.push(ni);
      }
    }
  }

  if (came[goalI] === -1) return null;
  const path: Cell[] = [];
  for (let i = goalI; i !== -1; i = came[i]) path.push({ x: i % W, z: Math.floor(i / W) });
  return path.reverse();
}

/** True when a straight walk between two cells only crosses walkable cells (supercover line). */
export function hasLineOfSight(grid: NavGrid, a: Cell, b: Cell): boolean {
  let x = a.x, z = a.z;
  const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
  const sx = Math.sign(b.x - a.x), sz = Math.sign(b.z - a.z);
  let err = dx - dz;
  for (let n = dx + dz; n >= 0; n--) {
    if (!isWalkable(grid, { x, z })) return false;
    const e2 = 2 * err;
    if (e2 > -dz && e2 < dx) {
      // Moving diagonally: both neighbouring cells must be free as well.
      if (!isWalkable(grid, { x: x + sx, z }) || !isWalkable(grid, { x, z: z + sz })) return false;
      err -= dz; x += sx; err += dx; z += sz; n--;
    } else if (e2 > -dz) { err -= dz; x += sx; }
    else { err += dx; z += sz; }
  }
  return true;
}

/** Drops waypoints that can be skipped in a straight line, so walking looks natural, not zig-zag. */
export function smoothPath(grid: NavGrid, path: Cell[]): Cell[] {
  if (path.length <= 2) return path;
  const out: Cell[] = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i++) {
    if (!hasLineOfSight(grid, path[anchor], path[i])) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Length of a path in cells (diagonals count √2). */
export function pathLength(path: Cell[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return total;
}
