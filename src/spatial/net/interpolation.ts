import { INTERPOLATION_DELAY_MS, type AnimName, type MoveMsg, type PathMsg } from './protocol';

export interface Pose {
  x: number;
  z: number;
  rot: number;
  anim: AnimName;
}

interface Snapshot extends Pose {
  /** Local receive-clock time this snapshot represents. */
  at: number;
}

/** Shortest-way angle blend. */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Position along a polyline after walking `dist` metres; also the facing angle. */
export function pointAlong(points: [number, number][], dist: number): { x: number; z: number; rot: number; done: boolean } {
  let left = Math.max(0, dist);
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(bx - ax, bz - az);
    if (left <= len || i === points.length - 1) {
      const k = len === 0 ? 1 : Math.min(1, left / len);
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, rot, done: i === points.length - 1 && left >= len };
    }
    left -= len;
  }
  const [x, z] = points[points.length - 1];
  return { x, z, rot: 0, done: true };
}

/**
 * Smooth movement for one remote person.
 *
 * Snapshots are placed on the local clock using the best (lowest) observed sender→receiver
 * offset, then drawn INTERPOLATION_DELAY_MS in the past so there's usually a snapshot on both
 * sides to blend between. Broadcast paths are walked locally; position messages that arrive
 * during a path nudge it back if it drifted.
 */
export class RemoteMover {
  private snaps: Snapshot[] = [];
  private lastSeq = -1;
  private offset: number | null = null;
  private path: { points: [number, number][]; speed: number; start: number; sitAtEnd: boolean } | null = null;
  /** Correction applied on top of the path, decays to zero. */
  private drift = { x: 0, z: 0 };

  constructor(private delay = INTERPOLATION_DELAY_MS) {}

  private localTime(senderT: number, now: number): number {
    const sample = now - senderT;
    // The smallest offset seen is the closest to pure clock difference (least network delay).
    if (this.offset === null || sample < this.offset) this.offset = sample;
    return senderT + this.offset;
  }

  receiveMove(m: MoveMsg, now: number) {
    if (m.seq <= this.lastSeq) return; // late or duplicate
    this.lastSeq = m.seq;
    const at = this.localTime(m.t, now);
    if (this.path) {
      // During a path, a position message is a correction: compare with where we think they are.
      const expected = this.pathPose(at);
      if (expected && !expected.done) {
        this.drift = { x: m.x - expected.x, z: m.z - expected.z };
        return;
      }
      this.path = null;
      this.drift = { x: 0, z: 0 };
    }
    this.snaps.push({ x: m.x, z: m.z, rot: m.rot, anim: m.anim, at });
    if (this.snaps.length > 30) this.snaps.splice(0, this.snaps.length - 30);
  }

  receivePath(p: PathMsg, now: number) {
    if (p.seq <= this.lastSeq) return;
    this.lastSeq = p.seq;
    const start = this.localTime(p.t, now);
    this.path = { points: p.points, speed: p.speed, start, sitAtEnd: p.sitAtEnd };
    this.drift = { x: 0, z: 0 };
    this.snaps = [];
  }

  private pathPose(time: number) {
    if (!this.path) return null;
    const walked = Math.max(0, (time - this.path.start) / 1000) * this.path.speed;
    return pointAlong(this.path.points, walked);
  }

  /** Where to draw them at local time `now`. Null until anything has arrived. */
  sample(now: number): Pose | null {
    const t = now - this.delay;
    if (this.path) {
      const p = this.pathPose(t)!;
      // Corrections fade out over ~half a second instead of snapping.
      this.drift.x *= 0.9;
      this.drift.z *= 0.9;
      if (p.done) {
        return { x: p.x, z: p.z, rot: p.rot, anim: this.path.sitAtEnd ? 'sit' : 'idle' };
      }
      return { x: p.x + this.drift.x, z: p.z + this.drift.z, rot: p.rot, anim: 'walk' };
    }
    const s = this.snaps;
    if (!s.length) return null;
    if (t <= s[0].at) return { ...s[0] };
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i].at) {
        const a = s[i - 1];
        const b = s[i];
        const k = (t - a.at) / Math.max(1, b.at - a.at);
        const moving = Math.hypot(b.x - a.x, b.z - a.z) > 0.01;
        return {
          x: a.x + (b.x - a.x) * k,
          z: a.z + (b.z - a.z) * k,
          rot: lerpAngle(a.rot, b.rot, k),
          anim: moving ? 'walk' : b.anim,
        };
      }
    }
    // No newer snapshot yet: hold the last one (no guessing ahead, so no overshoot through walls).
    const last = s[s.length - 1];
    // Drop snapshots we'll never blend from again.
    if (s.length > 2) this.snaps = s.slice(-2);
    return { ...last };
  }
}
