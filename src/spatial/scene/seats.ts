/**
 * Seats in a built office: chairs, sofa places and armchairs people can sit in.
 * Positions are in the floor's metres (the same as the network). A seat's `rot` is the way
 * someone sitting in it faces (0 = facing +z, like the network's `rot`).
 */
import { freeSpot, isFree, type WalkMap } from './floor';

export type SeatKind = 'chair' | 'sofa' | 'armchair';

export interface Seat {
  id: string;
  x: number;
  z: number;
  rot: number;
  /** Height of the seat cushion, metres. */
  y: number;
  kind: SeatKind;
}

/** How close to a seat's centre a tap or a broadcast position counts as that seat. */
export const SEAT_RADIUS = 0.36;
/** Sitting people are drawn this far back from the seat's centre, so their knees clear the front. */
export const SIT_BACK = 0.06;

/** The seat whose centre is closest to (x, z), within `radius`. */
export function seatAt(seats: readonly Seat[], x: number, z: number, radius = SEAT_RADIUS): Seat | null {
  let best: Seat | null = null;
  let bestD = radius;
  for (const s of seats) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d <= bestD) { best = s; bestD = d; }
  }
  return best;
}

/**
 * The seat a tap points at. The camera looks down at an angle, so the tap's ray is followed
 * down to each seat's cushion height and compared with that seat there (not on the floor,
 * where the ray lands well behind the chair).
 */
export function seatOnRay(
  seats: readonly Seat[],
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  radius = SEAT_RADIUS,
): Seat | null {
  if (dir.y >= 0) return null;
  let best: Seat | null = null;
  let bestD = radius;
  for (const s of seats) {
    const t = (s.y - origin.y) / dir.y;
    if (t < 0) continue;
    const d = Math.hypot(origin.x + dir.x * t - s.x, origin.z + dir.z * t - s.z);
    if (d <= bestD) { best = s; bestD = d; }
  }
  return best;
}

/** Unit vector a seat faces. */
export function seatForward(seat: Pick<Seat, 'rot'>): { x: number; z: number } {
  return { x: Math.sin(seat.rot), z: Math.cos(seat.rot) };
}

/**
 * Where to walk to before sitting down (and where you stand up to): behind a chair (its front
 * is under a desk or table), in front of a sofa or armchair (their backs are against a wall or
 * face away). Falls back to the other side, then to the nearest free spot.
 */
export function seatApproach(map: WalkMap, seat: Seat): { x: number; z: number } {
  const f = seatForward(seat);
  const sides = seat.kind === 'chair' ? [-1, 1] : [1, -1];
  for (const side of sides) {
    for (const dist of [0.7, 0.85, 1.0]) {
      const x = seat.x + f.x * dist * side;
      const z = seat.z + f.z * dist * side;
      if (isFree(map, x, z)) return { x, z };
    }
  }
  return freeSpot(map, seat.x - f.x * 0.7, seat.z - f.z * 0.7);
}

/** Where a sitting person's feet point is drawn: the seat, a little back from its centre. */
export function sittingSpot(seat: Seat): { x: number; z: number } {
  const f = seatForward(seat);
  return { x: seat.x - f.x * SIT_BACK, z: seat.z - f.z * SIT_BACK };
}
