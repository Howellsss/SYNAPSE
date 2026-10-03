/**
 * Annotations on a shared screen, synced over LiveKit's data channel.
 *
 * Coordinates are normalised to the shared video frame (0–1 on both axes), so a mark lands on
 * the same spot for everyone, whatever their window size. Messages are validated on receipt and
 * the sender's identity comes from LiveKit, never from the message.
 */

export type DrawTool = 'pen' | 'highlighter';
export type Tool = 'none' | DrawTool | 'text' | 'laser' | 'eraser';

export type Point = [number, number];

export interface Stroke {
  kind: 'stroke';
  id: string;
  by: string;
  tool: DrawTool;
  color: string;
  /** Line width as a fraction of the frame width. */
  width: number;
  points: Point[];
}

export interface TextNote {
  kind: 'text';
  id: string;
  by: string;
  color: string;
  x: number;
  y: number;
  text: string;
}

export type Item = Stroke | TextNote;

export type AnnotMsg =
  | { t: 'begin'; id: string; tool: DrawTool; color: string; width: number; p: Point }
  | { t: 'pts'; id: string; pts: Point[] }
  | { t: 'text'; id: string; color: string; x: number; y: number; text: string }
  | { t: 'erase'; id: string }
  | { t: 'clear'; scope: 'all' | 'mine' }
  | { t: 'laser'; x: number; y: number }
  | { t: 'perm'; allowed: boolean }
  | { t: 'sync-req' }
  /** A copy of everything, in parts: the first part replaces, later parts append. */
  | { t: 'sync'; items: Item[]; allowed: boolean; first: boolean };

export const TOPIC = 'synapse.annotate';
export const COLORS = ['#E4A93C', '#EF4444', '#22C55E', '#3B82F6', '#FFFFFF', '#0D1C3B'];
export const WIDTHS: Record<DrawTool, number> = { pen: 0.004, highlighter: 0.018 };
export const MAX_ITEMS = 2000;
const MAX_POINTS_PER_STROKE = 5000;
const MAX_POINTS_PER_MSG = 300;
const MAX_TEXT = 200;

// ---------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
const id = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : null);
const point = (v: unknown): Point | null => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x = unit(v[0]); const y = unit(v[1]);
  return x === null || y === null ? null : [x, y];
};
const tool = (v: unknown): DrawTool | null => (v === 'pen' || v === 'highlighter' ? v : null);
const width = (v: unknown) => (typeof v === 'number' && v > 0 && v <= 0.05 ? v : null);

function parseItem(raw: unknown): Item | null {
  if (!isObj(raw)) return null;
  const by = typeof raw.by === 'string' && raw.by.length <= 64 ? raw.by : null;
  const i = id(raw.id);
  const c = color(raw.color);
  if (!by || !i || !c) return null;
  if (raw.kind === 'stroke') {
    const tl = tool(raw.tool); const w = width(raw.width);
    if (!tl || !w || !Array.isArray(raw.points)) return null;
    const points = raw.points.slice(0, MAX_POINTS_PER_STROKE).map(point).filter((p): p is Point => !!p);
    return points.length ? { kind: 'stroke', id: i, by, tool: tl, color: c, width: w, points } : null;
  }
  if (raw.kind === 'text') {
    const x = unit(raw.x); const y = unit(raw.y);
    const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT).trim() : '';
    return x !== null && y !== null && text ? { kind: 'text', id: i, by, color: c, x, y, text } : null;
  }
  return null;
}

export function parseMsg(raw: unknown): AnnotMsg | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'begin': {
      const i = id(raw.id); const tl = tool(raw.tool); const c = color(raw.color); const w = width(raw.width); const p = point(raw.p);
      return i && tl && c && w && p ? { t: 'begin', id: i, tool: tl, color: c, width: w, p } : null;
    }
    case 'pts': {
      const i = id(raw.id);
      if (!i || !Array.isArray(raw.pts)) return null;
      const pts = raw.pts.slice(0, MAX_POINTS_PER_MSG).map(point).filter((p): p is Point => !!p);
      return pts.length ? { t: 'pts', id: i, pts } : null;
    }
    case 'text': {
      const i = id(raw.id); const c = color(raw.color); const x = unit(raw.x); const y = unit(raw.y);
      const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT).trim() : '';
      return i && c && x !== null && y !== null && text ? { t: 'text', id: i, color: c, x, y, text } : null;
    }
    case 'erase': { const i = id(raw.id); return i ? { t: 'erase', id: i } : null; }
    case 'clear': return raw.scope === 'all' || raw.scope === 'mine' ? { t: 'clear', scope: raw.scope } : null;
    case 'laser': { const x = unit(raw.x); const y = unit(raw.y); return x !== null && y !== null ? { t: 'laser', x, y } : null; }
    case 'perm': return typeof raw.allowed === 'boolean' ? { t: 'perm', allowed: raw.allowed } : null;
    case 'sync-req': return { t: 'sync-req' };
    case 'sync': {
      if (!Array.isArray(raw.items) || typeof raw.allowed !== 'boolean') return null;
      return { t: 'sync', items: raw.items.slice(0, MAX_ITEMS).map(parseItem).filter((x): x is Item => !!x), allowed: raw.allowed, first: raw.first !== false };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- state

export interface AnnotState {
  items: Item[];
  /** Whether people other than the presenter may annotate. */
  allowed: boolean;
}

export const emptyState = (): AnnotState => ({ items: [], allowed: true });

export interface Roles {
  /** Who is sharing their screen (their annotations are always allowed). */
  presenter: string | null;
  host: string | null;
}

const canModerate = (who: string, roles: Roles) => who === roles.presenter || who === roles.host;

/** Whether `who` may draw right now. */
export function mayAnnotate(who: string, state: AnnotState, roles: Roles): boolean {
  return state.allowed || canModerate(who, roles);
}

/**
 * Apply a message from `from` (the LiveKit identity, trusted) to the state.
 * Laser and sync-req don't change state; the component handles them.
 */
export function reduce(state: AnnotState, msg: AnnotMsg, from: string, roles: Roles): AnnotState {
  switch (msg.t) {
    case 'begin': {
      if (!mayAnnotate(from, state, roles) || state.items.length >= MAX_ITEMS) return state;
      if (state.items.some((i) => i.id === msg.id)) return state;
      const s: Stroke = { kind: 'stroke', id: msg.id, by: from, tool: msg.tool, color: msg.color, width: msg.width, points: [msg.p] };
      return { ...state, items: [...state.items, s] };
    }
    case 'pts': {
      let changed = false;
      const items = state.items.map((i) => {
        if (i.kind !== 'stroke' || i.id !== msg.id || i.by !== from || i.points.length >= MAX_POINTS_PER_STROKE) return i;
        changed = true;
        return { ...i, points: [...i.points, ...msg.pts].slice(0, MAX_POINTS_PER_STROKE) };
      });
      return changed ? { ...state, items } : state;
    }
    case 'text': {
      if (!mayAnnotate(from, state, roles) || state.items.length >= MAX_ITEMS || state.items.some((i) => i.id === msg.id)) return state;
      return { ...state, items: [...state.items, { kind: 'text', id: msg.id, by: from, color: msg.color, x: msg.x, y: msg.y, text: msg.text }] };
    }
    case 'erase': {
      // You can erase your own marks; the presenter and host can erase anyone's.
      const items = state.items.filter((i) => !(i.id === msg.id && (i.by === from || canModerate(from, roles))));
      return items.length === state.items.length ? state : { ...state, items };
    }
    case 'clear': {
      if (msg.scope === 'all' && canModerate(from, roles)) return { ...state, items: [] };
      const items = state.items.filter((i) => i.by !== from);
      return items.length === state.items.length ? state : { ...state, items };
    }
    case 'perm':
      return from === roles.presenter && state.allowed !== msg.allowed ? { ...state, allowed: msg.allowed } : state;
    case 'sync':
      // Only the presenter's copy is authoritative.
      if (from !== roles.presenter) return state;
      return { items: msg.first ? msg.items : [...state.items, ...msg.items].slice(0, MAX_ITEMS), allowed: msg.allowed };
    default:
      return state;
  }
}

// ---------------------------------------------------------------- geometry

/** Where a video with object-fit: contain actually draws inside its box. */
export function contentRect(boxW: number, boxH: number, videoW: number, videoH: number) {
  if (!boxW || !boxH || !videoW || !videoH) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / videoW, boxH / videoH);
  const w = videoW * scale; const h = videoH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Distance from a point to a segment (all normalised). */
function segDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The topmost item under a point (for the eraser), within `tolerance`. */
export function hitTest(items: Item[], p: Point, tolerance = 0.015): Item | null {
  for (let k = items.length - 1; k >= 0; k--) {
    const i = items[k];
    if (i.kind === 'text') {
      if (Math.abs(p[0] - i.x - 0.03) < 0.05 + i.text.length * 0.004 && Math.abs(p[1] - i.y) < 0.03) return i;
      continue;
    }
    const tol = tolerance + i.width / 2;
    if (i.points.length === 1 && Math.hypot(p[0] - i.points[0][0], p[1] - i.points[0][1]) < tol) return i;
    for (let j = 1; j < i.points.length; j++) if (segDist(p, i.points[j - 1], i.points[j]) < tol) return i;
  }
  return null;
}

/** Split a sync into messages small enough for the data channel (~12 KB each). */
export function chunkSync(items: Item[], allowed: boolean, maxBytes = 12000): AnnotMsg[] {
  const out: AnnotMsg[] = [];
  let batch: Item[] = [];
  let size = 0;
  for (const it of items) {
    const n = JSON.stringify(it).length;
    if (batch.length && size + n > maxBytes) { out.push({ t: 'sync', items: batch, allowed, first: out.length === 0 }); batch = []; size = 0; }
    batch.push(it);
    size += n;
  }
  out.push({ t: 'sync', items: batch, allowed, first: out.length === 0 });
  return out;
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
