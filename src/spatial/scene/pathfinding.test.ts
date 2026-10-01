import { describe, expect, it } from 'vitest';
import { findPath, gridFromRows, hasLineOfSight, isWalkable, makeGrid, nearestWalkable, pathLength, smoothPath, type Cell } from './pathfinding';

const steps = (path: Cell[]) => path.slice(1).map((c, i) => Math.max(Math.abs(c.x - path[i].x), Math.abs(c.z - path[i].z)));

describe('findPath', () => {
  it('walks straight across an empty room', () => {
    const path = findPath(makeGrid(10, 10), { x: 0, z: 0 }, { x: 9, z: 0 })!;
    expect(path[0]).toEqual({ x: 0, z: 0 });
    expect(path[path.length - 1]).toEqual({ x: 9, z: 0 });
    expect(path).toHaveLength(10);
  });

  it('takes the diagonal when it is shorter', () => {
    const path = findPath(makeGrid(6, 6), { x: 0, z: 0 }, { x: 5, z: 5 })!;
    expect(pathLength(path)).toBeCloseTo(5 * Math.SQRT2);
  });

  it('goes around a wall through the door', () => {
    const grid = gridFromRows([
      '..........',
      '..........',
      '#####.####',
      '..........',
    ]);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 0, z: 3 })!;
    expect(path.some((c) => c.x === 5 && c.z === 2)).toBe(true);
    expect(path.every((c) => isWalkable(grid, c))).toBe(true);
    expect(steps(path).every((s) => s === 1)).toBe(true);
  });

  it('never cuts a blocked corner diagonally', () => {
    const grid = gridFromRows([
      '.#',
      '..',
    ]);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 1, z: 1 })!;
    expect(path).toEqual([{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]);
  });

  it('returns null when the goal is walled off', () => {
    const grid = gridFromRows([
      '...#...',
      '...#...',
      '...#...',
    ]);
    expect(findPath(grid, { x: 0, z: 1 }, { x: 6, z: 1 })).toBeNull();
  });

  it('walks to the nearest free spot when the target is a desk', () => {
    const grid = gridFromRows([
      '.....',
      '..#..',
      '.....',
    ]);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 2, z: 1 })!;
    const end = path[path.length - 1]!;
    expect(isWalkable(grid, end)).toBe(true);
    expect(Math.max(Math.abs(end.x - 2), Math.abs(end.z - 1))).toBe(1);
  });

  it('handles start = goal and out-of-bounds goals', () => {
    expect(findPath(makeGrid(3, 3), { x: 1, z: 1 }, { x: 1, z: 1 })).toEqual([{ x: 1, z: 1 }]);
    expect(findPath(makeGrid(3, 3), { x: 0, z: 0 }, { x: 40, z: 40 })).toBeNull();
  });

  it('is fast enough for a 120 × 120 m floor', () => {
    const rows = Array.from({ length: 120 }, (_, z) => Array.from({ length: 120 }, (_, x) => (x % 10 === 5 && z % 20 !== 3 ? '#' : '.')).join(''));
    const grid = gridFromRows(rows);
    const t = performance.now();
    const path = findPath(grid, { x: 0, z: 0 }, { x: 119, z: 119 });
    expect(path).not.toBeNull();
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe('nearestWalkable', () => {
  it('returns the cell itself when free, null when nothing is free nearby', () => {
    expect(nearestWalkable(makeGrid(3, 3), { x: 1, z: 1 })).toEqual({ x: 1, z: 1 });
    expect(nearestWalkable(gridFromRows(['###', '###', '###']), { x: 1, z: 1 }, 3)).toBeNull();
  });
});

describe('smoothPath', () => {
  it('keeps only the corners of an L-shaped walk', () => {
    const grid = gridFromRows([
      '.....',
      '####.',
      '.....',
    ]);
    const path = findPath(grid, { x: 0, z: 0 }, { x: 0, z: 2 })!;
    const smooth = smoothPath(grid, path);
    expect(smooth.length).toBeLessThan(path.length);
    expect(smooth[0]).toEqual({ x: 0, z: 0 });
    expect(smooth[smooth.length - 1]).toEqual({ x: 0, z: 2 });
    for (let i = 1; i < smooth.length; i++) expect(hasLineOfSight(grid, smooth[i - 1], smooth[i])).toBe(true);
  });

  it('turns an open-floor path into a single straight line', () => {
    const grid = makeGrid(10, 10);
    const smooth = smoothPath(grid, findPath(grid, { x: 0, z: 0 }, { x: 9, z: 4 })!);
    expect(smooth).toEqual([{ x: 0, z: 0 }, { x: 9, z: 4 }]);
  });
});
