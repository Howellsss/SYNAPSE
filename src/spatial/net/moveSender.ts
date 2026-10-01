import { HEARTBEAT_MS, MAX_MOVES_PER_SECOND, PATH_CORRECTION_MS, type AnimName, type MoveMsg, type PathMsg } from './protocol';

export interface LocalState {
  x: number;
  z: number;
  rot: number;
  anim: AnimName;
}

const MIN_GAP = 1000 / MAX_MOVES_PER_SECOND;
/** Smaller changes than these don't count as moving (avoids sending float noise). */
const POS_EPSILON = 0.01;
const ROT_EPSILON = 0.02;

const changed = (a: LocalState | null, b: LocalState) =>
  !a || a.anim !== b.anim || Math.abs(a.x - b.x) > POS_EPSILON || Math.abs(a.z - b.z) > POS_EPSILON || Math.abs(a.rot - b.rot) > ROT_EPSILON;

/**
 * Decides when to send the local avatar's position.
 *
 * - While moving with the keyboard: at most 10 messages a second, plus one trailing message so
 *   the final resting position always arrives.
 * - While walking a broadcast path: receivers walk the path themselves, so only a correction
 *   once a second.
 * - Standing still: a heartbeat every 5 seconds.
 *
 * Call `update` every frame with the current state; it sends through `send` when needed.
 */
export class MoveSender {
  private seq = 0;
  private lastSent: LocalState | null = null;
  private lastSentAt = -Infinity;
  private pending: LocalState | null = null;
  private followingPath = false;

  constructor(
    private userId: string,
    private sendMove: (m: MoveMsg) => void,
    private sendPath: (m: PathMsg) => void,
    private now: () => number = () => Date.now(),
  ) {}

  /** Click-to-walk: send the route once. */
  startPath(points: [number, number][], speed: number, sitAtEnd = false) {
    if (points.length < 2) return;
    const t = this.now();
    this.sendPath({ userId: this.userId, points, speed, sitAtEnd, seq: ++this.seq, t });
    this.followingPath = true;
    this.lastSentAt = t;
  }

  /** The route finished or was interrupted (keyboard, a new click). */
  endPath() {
    this.followingPath = false;
  }

  update(state: LocalState) {
    const t = this.now();
    const since = t - this.lastSentAt;
    const isChange = changed(this.lastSent, state);

    if (this.followingPath) {
      if (since >= PATH_CORRECTION_MS) this.emit(state, t);
      return;
    }
    if (isChange) {
      if (since >= MIN_GAP) this.emit(state, t);
      else this.pending = state;
      return;
    }
    if (this.pending && since >= MIN_GAP) {
      // Stopped moving: make sure the last position goes out.
      this.emit(this.pending, t);
      return;
    }
    if (since >= HEARTBEAT_MS) this.emit(state, t);
  }

  /** Send now regardless of limits (e.g. right after joining, or after a reconnect). */
  flush(state: LocalState) {
    this.emit(state, this.now());
  }

  private emit(state: LocalState, t: number) {
    this.sendMove({ userId: this.userId, ...state, seq: ++this.seq, t });
    this.lastSent = { ...state };
    this.lastSentAt = t;
    this.pending = null;
  }
}
