/**
 * The walkable floor of a space until the 3D art kit brings rooms and furniture: an open floor
 * sized to the team, in metres, from (0, 0) to (width, depth). Positions shared over the network
 * use the same units (1 tile = 1 metre).
 */
import type { SizeBand } from '@/types';
import { makeGrid, type Cell, type NavGrid } from './pathfinding';

export interface Floor {
  width: number;
  depth: number;
}

export const FLOOR_SIZES: Record<SizeBand, Floor> = {
  solo: { width: 12, depth: 10 },
  small: { width: 20, depth: 16 },
  medium: { width: 28, depth: 22 },
  large: { width: 36, depth: 28 },
  xl: { width: 44, depth: 34 },
};

/** Walking speed, metres per second. */
export const WALK_SPEED = 2.4;
/** Keep this far from the edge. */
export const EDGE_MARGIN = 0.4;

export function floorFor(band: SizeBand | null | undefined): Floor {
  return FLOOR_SIZES[band ?? 'small'] ?? FLOOR_SIZES.small;
}

export function clampToFloor(floor: Floor, x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(floor.width - EDGE_MARGIN, Math.max(EDGE_MARGIN, x)),
    z: Math.min(floor.depth - EDGE_MARGIN, Math.max(EDGE_MARGIN, z)),
  };
}

/** Where someone appears: near the middle, spread out a little so people don't stack. */
export function spawnPoint(floor: Floor, random: () => number = Math.random): { x: number; z: number } {
  const angle = random() * Math.PI * 2;
  const r = 0.8 + random() * 1.7;
  return clampToFloor(floor, floor.width / 2 + Math.cos(angle) * r, floor.depth / 2 + Math.sin(angle) * r);
}

/** One cell per metre; the open floor has no obstacles yet. */
export function floorGrid(floor: Floor): NavGrid {
  return makeGrid(Math.ceil(floor.width), Math.ceil(floor.depth));
}

export function cellAt(floor: Floor, x: number, z: number): Cell {
  return {
    x: Math.min(Math.ceil(floor.width) - 1, Math.max(0, Math.floor(x))),
    z: Math.min(Math.ceil(floor.depth) - 1, Math.max(0, Math.floor(z))),
  };
}

export type MoveKey = 'up' | 'down' | 'left' | 'right';

/** Arrow keys and WASD. */
export function moveKeyFor(e: Pick<KeyboardEvent, 'key' | 'code'>): MoveKey | null {
  switch (e.code || e.key) {
    case 'ArrowUp': case 'KeyW': return 'up';
    case 'ArrowDown': case 'KeyS': return 'down';
    case 'ArrowLeft': case 'KeyA': return 'left';
    case 'ArrowRight': case 'KeyD': return 'right';
    default: return null;
  }
}

/**
 * Direction on the floor for the held keys, as seen from the camera, which looks at the floor
 * from the +x/+z corner (so "up" on screen walks towards -x/-z). Unit length, or null.
 */
export function keyDirection(held: ReadonlySet<MoveKey>): { x: number; z: number } | null {
  const sx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  const sy = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
  if (!sx && !sy) return null;
  // Screen right = (+1, -1)/√2 on the floor, screen up = (-1, -1)/√2.
  const x = (sx - sy) / Math.SQRT2;
  const z = (-sx - sy) / Math.SQRT2;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

/** Facing angle for walking in a direction (0 = facing +z, like the network's `rot`). */
export function facing(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/**
 * Keeps an animation in place: the root bone's horizontal travel is removed, so a walk or dance
 * clip with root motion doesn't drift the avatar away from where the network says it is.
 * `values` are xyz triples of the root bone's position track; changed in place.
 */
export function pinRootMotion(values: Float32Array | number[]): void {
  if (values.length < 3) return;
  const x0 = values[0];
  const z0 = values[2];
  for (let i = 0; i + 2 < values.length; i += 3) {
    values[i] = x0;
    values[i + 2] = z0;
  }
}
