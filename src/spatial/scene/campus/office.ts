/**
 * A workspace's campus: the layout with its team areas named after the account's departments,
 * plus the changes people made in build mode (pieces added, and layout pieces taken away).
 */
import { CAMPUS_01, type OfficeLayout } from '../offices';
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
export function readEdits(raw: unknown): CampusEdits {
  const v = (raw && typeof raw === 'object' ? raw : {}) as { added?: unknown; removed?: unknown };
  const num = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null);
  const added: Placed[] = [];
  for (const p of Array.isArray(v.added) ? v.added.slice(0, MAX_ADDED) : []) {
    const o = (p ?? {}) as Record<string, unknown>;
    const x = num(o.x, 0, CAMPUS_01.floor.width);
    const z = num(o.z, 0, CAMPUS_01.floor.depth);
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
