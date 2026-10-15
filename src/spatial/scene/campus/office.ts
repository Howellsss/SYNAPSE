/**
 * A workspace's campus: the layout with its team areas named after the account's departments,
 * plus the changes people made in build mode (pieces added, and layout pieces taken away).
 */
import { CAMPUS_01, HUB_01, type OfficeLayout } from '../offices';
import { buildHub } from './hub';
import type { Placed } from './kit';
import { KIT_BY_ID } from './kit';
import { buildCampus, campusObstacles, campusSeats, type CampusLayout } from './layout';

export interface CampusEdits {
  added: Placed[];
  /** Ids of layout pieces taken away. */
  removed: string[];
}

export const NO_EDITS: CampusEdits = { added: [], removed: [] };
export const MAX_ADDED = 600;

/** Saved edits, checked (they come from the database, written by people in the account). */
export function readEdits(raw: unknown, floor: { width: number; depth: number } = CAMPUS_01.floor): CampusEdits {
  const v = (raw && typeof raw === 'object' ? raw : {}) as { added?: unknown; removed?: unknown };
  const num = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null);
  const added: Placed[] = [];
  for (const p of Array.isArray(v.added) ? v.added.slice(0, MAX_ADDED) : []) {
    const o = (p ?? {}) as Record<string, unknown>;
    const x = num(o.x, 0, floor.width);
    const z = num(o.z, 0, floor.depth);
    const rot = num(o.rot, -Math.PI * 2, Math.PI * 2);
    if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(o.id) || typeof o.kind !== 'string' || !KIT_BY_ID.has(o.kind) || x === null || z === null || rot === null) continue;
    added.push({ id: o.id, kind: o.kind, x, z, rot });
  }
  const removed = (Array.isArray(v.removed) ? v.removed : []).filter((id): id is string => typeof id === 'string' && id.length <= 60).slice(0, 2000);
  return { added, removed };
}

export function applyEdits(layout: CampusLayout, edits: CampusEdits): CampusLayout {
  if (!edits.added.length && !edits.removed.length) return layout;
  const gone = new Set(edits.removed);
  return { ...layout, objects: [...layout.objects.filter((o) => !gone.has(o.id)), ...edits.added.filter((o) => !gone.has(o.id))] };
}

/** The campus office for a workspace (team areas named after its departments). */
export function campusOffice(teamNames: string[] = []): OfficeLayout {
  const campus = buildCampus(teamNames);
  return { ...CAMPUS_01, campus, obstacles: campusObstacles(campus), seats: campusSeats(campus) };
}

/** A new id for a piece someone adds (safe in readEdits). */
export function newPieceId(): string {
  return `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Build mode: add a piece. */
export function addPiece(e: CampusEdits, p: Placed): CampusEdits {
  return { added: [...e.added, p].slice(-MAX_ADDED), removed: e.removed };
}

/** Build mode: take a piece away (one someone added is forgotten; a layout piece is remembered as removed). */
export function removePiece(e: CampusEdits, id: string): CampusEdits {
  if (e.added.some((p) => p.id === id)) return { added: e.added.filter((p) => p.id !== id), removed: e.removed };
  return e.removed.includes(id) ? e : { added: e.added, removed: [...e.removed, id] };
}

/** Build mode: put a piece somewhere else, or turn it (a layout piece becomes an added copy). */
export function movePiece(e: CampusEdits, layoutObjects: Placed[], id: string, to: { x: number; z: number; rot: number }, copyId = newPieceId()): CampusEdits {
  const own = e.added.find((p) => p.id === id);
  if (own) return { added: e.added.map((p) => (p.id === id ? { ...p, ...to } : p)), removed: e.removed };
  const base = layoutObjects.find((p) => p.id === id);
  if (!base) return e;
  return addPiece(removePiece(e, id), { id: copyId, kind: base.kind, ...to });
}

/** SYNAPSE Hub: the courtyard and the places its doorways lead to. */
export function hubOffice(): OfficeLayout {
  const campus = buildHub();
  return { ...HUB_01, campus, obstacles: campusObstacles(campus), seats: campusSeats(campus) };
}

/** The large world for an office id (with the account's team names), or the office as it is. */
export function worldOffice(base: OfficeLayout | null, teamNames: string[]): OfficeLayout | null {
  if (base?.id === 'campus-01') return campusOffice(teamNames);
  if (base?.id === 'hub-01') return hubOffice();
  return base;
}
