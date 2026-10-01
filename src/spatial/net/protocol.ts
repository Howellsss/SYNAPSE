/**
 * What travels over a space's realtime channel (`space:<spaceId>`).
 *
 * Presence = who is here and what they've chosen (slow-changing, server keeps it).
 * Broadcast = what they're doing right now (fast, fire-and-forget):
 *   'move'  – a position snapshot while moving, or a heartbeat
 *   'path'  – a click-to-walk route, sent once; receivers walk it themselves
 *   'emote' – wave, cheer, heart, raise/lower hand
 *
 * Everything received is validated here, because any client on the channel can send anything
 * (see "Spoofing" in docs/ARCHITECTURE.md).
 */

export type PresenceStatus = 'available' | 'busy' | 'focus' | 'dnd';
export const STATUSES: PresenceStatus[] = ['available', 'busy', 'focus', 'dnd'];

export interface PresenceMeta {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Hash of the avatar config; receivers fetch the config when it changes. Null until avatars exist. */
  avatarHash: string | null;
  status: PresenceStatus;
  /** True after 5 minutes hidden or idle. Shown as "Away" whatever the chosen status. */
  away: boolean;
  zoneId: string | null;
  deskId: string | null;
  /** People in this person's conversation circle (proximity video fills this). */
  conversation: string[];
  joinedAt: string;
}

export type AnimName = 'idle' | 'walk' | 'sit' | 'wave' | 'cheer' | 'raise_hand';
const ANIMS: AnimName[] = ['idle', 'walk', 'sit', 'wave', 'cheer', 'raise_hand'];

export interface MoveMsg {
  userId: string;
  x: number;
  z: number;
  /** Facing, radians. */
  rot: number;
  anim: AnimName;
  /** Increases with every message from this sender; older ones are dropped. */
  seq: number;
  /** Sender's clock, ms. */
  t: number;
}

export interface PathMsg {
  userId: string;
  /** Waypoints in metres, starting where they are now. */
  points: [number, number][];
  /** Metres per second. */
  speed: number;
  /** Sit when they arrive (they clicked a chair). */
  sitAtEnd: boolean;
  seq: number;
  t: number;
}

export type EmoteKind = 'wave' | 'cheer' | 'heart' | 'raise_hand' | 'lower_hand';
export const EMOTES: EmoteKind[] = ['wave', 'cheer', 'heart', 'raise_hand', 'lower_hand'];

export interface EmoteMsg {
  userId: string;
  kind: EmoteKind;
  /** Aimed at one person (a wave from the people panel), or everyone. */
  to: string | null;
  t: number;
}

// ---------------------------------------------------------------- limits

/** At most this many move messages a second per person. */
export const MAX_MOVES_PER_SECOND = 10;
/** A standing person re-sends their position this often, so late joiners and drift catch up. */
export const HEARTBEAT_MS = 5000;
/** While walking a broadcast path, send a correction this often. */
export const PATH_CORRECTION_MS = 1000;
/** Hidden or idle this long = away. */
export const AWAY_AFTER_MS = 5 * 60 * 1000;
/** Remote avatars are drawn this far in the past, so there's always a next snapshot to blend to. */
export const INTERPOLATION_DELAY_MS = 120;

/** Largest floor we accept positions for (metres), and the longest path. */
const MAX_COORD = 2000;
const MAX_PATH_POINTS = 200;
const MAX_NAME = 80;

// ---------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, max = MAX_COORD) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : null);
const str = (v: unknown, max = 64) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export function parseMove(raw: unknown): MoveMsg | null {
  if (!isObj(raw)) return null;
  const userId = str(raw.userId);
  const x = num(raw.x);
  const z = num(raw.z);
  const rot = num(raw.rot, 100);
  const seq = num(raw.seq, Number.MAX_SAFE_INTEGER);
  const t = num(raw.t, Number.MAX_SAFE_INTEGER);
  const anim = ANIMS.includes(raw.anim as AnimName) ? (raw.anim as AnimName) : 'idle';
  if (!userId || x === null || z === null || rot === null || seq === null || t === null) return null;
  return { userId, x, z, rot, anim, seq, t };
}

export function parsePath(raw: unknown): PathMsg | null {
  if (!isObj(raw) || !Array.isArray(raw.points)) return null;
  const userId = str(raw.userId);
  const speed = num(raw.speed, 20);
  const seq = num(raw.seq, Number.MAX_SAFE_INTEGER);
  const t = num(raw.t, Number.MAX_SAFE_INTEGER);
  if (!userId || speed === null || speed <= 0 || seq === null || t === null) return null;
  if (raw.points.length < 2 || raw.points.length > MAX_PATH_POINTS) return null;
  const points: [number, number][] = [];
  for (const p of raw.points) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const x = num(p[0]);
    const z = num(p[1]);
    if (x === null || z === null) return null;
    points.push([x, z]);
  }
  return { userId, points, speed, sitAtEnd: raw.sitAtEnd === true, seq, t };
}

export function parseEmote(raw: unknown): EmoteMsg | null {
  if (!isObj(raw)) return null;
  const userId = str(raw.userId);
  const kind = EMOTES.includes(raw.kind as EmoteKind) ? (raw.kind as EmoteKind) : null;
  const t = num(raw.t, Number.MAX_SAFE_INTEGER);
  const to = raw.to === null || raw.to === undefined ? null : str(raw.to);
  if (!userId || !kind || t === null || (raw.to != null && !to)) return null;
  return { userId, kind, to, t };
}

export function parsePresence(raw: unknown): PresenceMeta | null {
  if (!isObj(raw)) return null;
  const userId = str(raw.userId);
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
  if (!userId || !name) return null;
  const status = STATUSES.includes(raw.status as PresenceStatus) ? (raw.status as PresenceStatus) : 'available';
  const optStr = (v: unknown, max = 64) => (v === null || v === undefined ? null : str(v, max));
  const avatarUrl = optStr(raw.avatarUrl, 2048);
  return {
    userId,
    name,
    avatarUrl: avatarUrl && /^https:\/\//.test(avatarUrl) ? avatarUrl : null,
    avatarHash: optStr(raw.avatarHash),
    status,
    away: raw.away === true,
    zoneId: optStr(raw.zoneId),
    deskId: optStr(raw.deskId),
    conversation: Array.isArray(raw.conversation) ? raw.conversation.filter((c): c is string => typeof c === 'string').slice(0, 50) : [],
    joinedAt: typeof raw.joinedAt === 'string' ? raw.joinedAt : '',
  };
}

/**
 * One row per person from a presence state. Someone with two tabs open appears once
 * (their most recently joined tab). Entries whose key doesn't match their userId are dropped,
 * so a client can't list itself under someone else's presence key.
 */
export function mergePresence(state: Record<string, unknown[]>): PresenceMeta[] {
  const byUser = new Map<string, PresenceMeta>();
  for (const [key, entries] of Object.entries(state)) {
    for (const raw of entries ?? []) {
      const p = parsePresence(raw);
      if (!p || p.userId !== key) continue;
      const prev = byUser.get(p.userId);
      if (!prev || p.joinedAt > prev.joinedAt) byUser.set(p.userId, p);
    }
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}
