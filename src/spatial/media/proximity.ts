/**
 * Who hears and sees whom inside a space. Pure functions: positions and zones in, links out.
 * The hook (useProximity) runs this every position update and at least every 500 ms, then
 * subscribes to exactly those LiveKit tracks.
 *
 * Rules
 * - Open floor (open areas, lounges, breakouts, or no zone): within 4 tiles you're in range;
 *   you stay in range until you're more than 5 tiles apart (hysteresis, so it doesn't flicker).
 * - Closed rooms (meeting rooms, private offices): everyone in the same room hears and sees each
 *   other, nobody outside. Lockable rooms can be locked by admins; others knock to enter.
 * - Stage: whoever stands on the stage is heard and seen by everyone in the space (except people
 *   in closed rooms or quiet zones). People on the stage hear the audience only by proximity.
 * - Quiet zone: chat only, no audio or video in or out.
 */
import type { RoomType } from '@/types';

export const ENTER_RANGE = 4;
export const EXIT_RANGE = 5;
/** Full volume at or below this distance. */
export const FULL_VOLUME_RANGE = 1.5;
/** Volume at the edge of range. */
export const EDGE_VOLUME = 0.2;
export const RECONCILE_MS = 500;
/** Above this many people, neighbours are found with a spatial hash instead of checking every pair. */
export const SPATIAL_HASH_THRESHOLD = 30;
export const DATA_SAVER_MAX_VIDEOS = 2;

export type ZoneRule = 'open' | 'closed' | 'stage' | 'quiet';

/** How each room type behaves for sound and video. */
export function zoneRule(type: RoomType | null | undefined): ZoneRule {
  switch (type) {
    case 'meeting_room':
    case 'private_office':
      return 'closed';
    case 'stage':
      return 'stage';
    case 'quiet_zone':
      return 'quiet';
    default:
      return 'open';
  }
}

export interface ProxPerson {
  id: string;
  /** Position in tiles; null when unknown (not placed yet). */
  pos: { x: number; z: number } | null;
  /** Zone they're standing in, or null for the open floor. */
  zoneId: string | null;
}

export type ZoneRules = ReadonlyMap<string, ZoneRule>;

export interface Link {
  audio: boolean;
  video: boolean;
  /** 0–1 playback volume. */
  volume: number;
  reason: 'nearby' | 'same-room' | 'stage';
  /** Tiles apart, or null when not by position. */
  distance: number | null;
}

const dist = (a: ProxPerson, b: ProxPerson) =>
  a.pos && b.pos ? Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) : null;

const ruleOf = (p: ProxPerson, zones: ZoneRules): ZoneRule => (p.zoneId ? zones.get(p.zoneId) ?? 'open' : 'open');

/** Open-floor range with hysteresis: enter at ≤ 4, leave at > 5. */
export function inRange(distance: number | null, wasInRange: boolean): boolean {
  if (distance === null) return false;
  return distance <= (wasInRange ? EXIT_RANGE : ENTER_RANGE);
}

/** Full at ≤ 1.5 tiles, falling linearly to 20% at the edge of range. */
export function volumeAt(distance: number | null): number {
  if (distance === null || distance <= FULL_VOLUME_RANGE) return 1;
  if (distance >= ENTER_RANGE) return EDGE_VOLUME;
  const k = (distance - FULL_VOLUME_RANGE) / (ENTER_RANGE - FULL_VOLUME_RANGE);
  return 1 - k * (1 - EDGE_VOLUME);
}

/**
 * Whether `a` and `b` are in a conversation (symmetric): same closed room, or near each other
 * on the open floor / stage. Stage broadcast is one-way and handled in `linkFor`.
 */
export function conversing(a: ProxPerson, b: ProxPerson, zones: ZoneRules, wasLinked: boolean): { linked: boolean; reason: Link['reason'] | null; distance: number | null } {
  const ra = ruleOf(a, zones);
  const rb = ruleOf(b, zones);
  const d = dist(a, b);
  if (ra === 'quiet' || rb === 'quiet') return { linked: false, reason: null, distance: d };
  if (ra === 'closed' || rb === 'closed') {
    const same = !!a.zoneId && a.zoneId === b.zoneId;
    return { linked: same, reason: same ? 'same-room' : null, distance: d };
  }
  // Open floor and stage mix by distance.
  const near = inRange(d, wasLinked);
  return { linked: near, reason: near ? 'nearby' : null, distance: d };
}

/** What `me` should receive from `other`. */
export function linkFor(me: ProxPerson, other: ProxPerson, zones: ZoneRules, wasLinked: boolean): Link | null {
  const c = conversing(me, other, zones, wasLinked);
  if (c.linked) {
    return { audio: true, video: true, volume: c.reason === 'same-room' ? 1 : volumeAt(c.distance), reason: c.reason!, distance: c.distance };
  }
  // Someone on stage reaches everyone who isn't shut in a closed room or a quiet zone.
  const mine = ruleOf(me, zones);
  if (ruleOf(other, zones) === 'stage' && mine !== 'closed' && mine !== 'quiet') {
    return { audio: true, video: true, volume: 1, reason: 'stage', distance: c.distance };
  }
  return null;
}

/** Pairs worth checking: all pairs, or neighbours from a spatial hash when there are many people. */
export function candidatePairs(people: ProxPerson[], cell = EXIT_RANGE): [number, number][] {
  const pairs: [number, number][] = [];
  if (people.length <= SPATIAL_HASH_THRESHOLD) {
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) pairs.push([i, j]);
    return pairs;
  }
  const grid = new Map<string, number[]>();
  const unplaced: number[] = [];
  const zoned = new Map<string, number[]>();
  people.forEach((p, i) => {
    if (p.zoneId) zoned.set(p.zoneId, [...(zoned.get(p.zoneId) ?? []), i]);
    if (!p.pos) { unplaced.push(i); return; }
    const key = `${Math.floor(p.pos.x / cell)},${Math.floor(p.pos.z / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), i]);
  });
  const seen = new Set<string>();
  const add = (i: number, j: number) => {
    const a = Math.min(i, j), b = Math.max(i, j);
    const k = `${a},${b}`;
    if (a !== b && !seen.has(k)) { seen.add(k); pairs.push([a, b]); }
  };
  for (const [key, list] of grid) {
    const [cx, cz] = key.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const other = grid.get(`${cx + dx},${cz + dz}`);
        if (!other) continue;
        for (const i of list) for (const j of other) add(i, j);
      }
    }
  }
  // Same-room pairs don't depend on distance.
  for (const list of zoned.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) add(list[x], list[y]);
  return pairs;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface ProximityState {
  /** Linked pairs from the last run, for hysteresis. */
  pairs: Set<string>;
}

export interface Group {
  ids: string[];
  /** Floor circle under the group (tiles). Null for a closed room (the room itself is the boundary). */
  circle: { x: number; z: number; r: number } | null;
}

export interface ProximityResult {
  /** What I receive from each person (only people I hear or see). */
  links: Map<string, Link>;
  /** Everyone's conversation groups (2+ people). */
  groups: Group[];
  /** My group's other members. */
  myGroup: string[];
  /** Who to receive video from (all linked, or the nearest few in data-saver mode). */
  videoIds: string[];
  state: ProximityState;
}

/** Connected groups and their floor circles. */
function buildGroups(people: ProxPerson[], edges: [number, number][], zones: ZoneRules): Group[] {
  const parent = people.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const byRoot = new Map<number, number[]>();
  people.forEach((_, i) => { const r = find(i); byRoot.set(r, [...(byRoot.get(r) ?? []), i]); });
  const groups: Group[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const ps = members.map((i) => people[i]);
    const inClosedRoom = ps.every((p) => p.zoneId && ruleOf(p, zones) === 'closed' && p.zoneId === ps[0].zoneId);
    const placed = ps.filter((p) => p.pos);
    let circle: Group['circle'] = null;
    if (!inClosedRoom && placed.length >= 2) {
      const cx = placed.reduce((s, p) => s + p.pos!.x, 0) / placed.length;
      const cz = placed.reduce((s, p) => s + p.pos!.z, 0) / placed.length;
      const r = Math.max(...placed.map((p) => Math.hypot(p.pos!.x - cx, p.pos!.z - cz))) + 1;
      circle = { x: cx, z: cz, r };
    }
    groups.push({ ids: ps.map((p) => p.id).sort(), circle });
  }
  return groups;
}

/**
 * One reconciliation: who I hear and see, everyone's groups, and which videos to receive.
 * Pass the previous `state` back in next time (hysteresis).
 */
export function computeProximity(
  meId: string,
  people: ProxPerson[],
  zones: ZoneRules,
  prev: ProximityState | null,
  opts: { dataSaver?: boolean; maxVideos?: number } = {},
): ProximityResult {
  const was = prev?.pairs ?? new Set<string>();
  const pairs = new Set<string>();
  const edges: [number, number][] = [];
  for (const [i, j] of candidatePairs(people)) {
    const a = people[i], b = people[j];
    const k = pairKey(a.id, b.id);
    if (conversing(a, b, zones, was.has(k)).linked) { pairs.add(k); edges.push([i, j]); }
  }

  const me = people.find((p) => p.id === meId);
  const links = new Map<string, Link>();
  if (me) {
    for (const other of people) {
      if (other.id === meId) continue;
      const l = linkFor(me, other, zones, was.has(pairKey(meId, other.id)));
      if (l) links.set(other.id, l);
    }
  }

  const groups = buildGroups(people, edges, zones);
  const mine = groups.find((g) => g.ids.includes(meId));
  const myGroup = mine ? mine.ids.filter((id) => id !== meId) : [];

  // Video: everyone linked; in data saver only the nearest few (stage and same-room count as near).
  let videoIds = [...links.entries()].filter(([, l]) => l.video).map(([id]) => id);
  const max = opts.dataSaver ? opts.maxVideos ?? DATA_SAVER_MAX_VIDEOS : opts.maxVideos;
  if (max !== undefined && videoIds.length > max) {
    const rank = (id: string) => { const l = links.get(id)!; return l.reason === 'stage' ? -1 : l.distance ?? 0; };
    videoIds = videoIds.sort((a, b) => rank(a) - rank(b)).slice(0, max);
  }
  return { links, groups, myGroup, videoIds, state: { pairs } };
}

// ---------------------------------------------------------------- locked rooms

/** Whether someone may walk into a zone. Admins always can; locked rooms need a knock answered. */
export function canEnterZone(rule: ZoneRule, locked: boolean, isAdmin: boolean, admitted: boolean): boolean {
  if (rule !== 'closed' || !locked) return true;
  return isAdmin || admitted;
}
