/**
 * The building kit for large worlds: furniture taken from SYNAPSE Office 02 (one GLB, every piece a
 * named node) plus pieces drawn in code (trees, lamps, benches, fountains…).
 *
 * GLB pieces are described in the office's own coordinates (metres, the floor's frame): the nodes
 * that make the piece, the point it turns around (`c`), the way it faces there (`rot0`, 0 = +z), what
 * blocks walking (`blocks`) and where people sit (`seats`). Placing a piece at (x, z) facing `rot`
 * moves all of that with it, so walls, chairs and seats always line up with what's drawn.
 */
import type { Rect } from '../offices';
import type { Seat, SeatKind } from '../seats';

export type KitCategory = 'desks' | 'meeting' | 'seating' | 'tables' | 'plants' | 'decor' | 'outdoor' | 'lighting';

/** Pieces drawn in code. */
export type ProcKind =
  | 'tree' | 'pine' | 'blossom' | 'bush' | 'flowers' | 'hedge' | 'lamp_post' | 'bench' | 'fountain'
  | 'big_fountain' | 'rug' | 'stage' | 'big_screen' | 'boulder' | 'pool_table' | 'arcade' | 'beanbag' | 'podium';

interface Base {
  id: string;
  name: string;
  category: KitCategory;
  /** Shown in the build catalog; hidden pieces are only used by the layouts. */
  hidden?: boolean;
}

export interface GlbItem extends Base {
  /** Root node names in office-02.glb that make the piece. */
  nodes: string[];
  /** Pivot in the office's coordinates. */
  c: [number, number];
  /** Facing in the office (0 = +z, π/2 = +x). */
  rot0: number;
  /** What blocks walking, in the office's coordinates. */
  blocks: Rect[];
  seats?: { x: number; z: number; rot: number; y: number; kind?: SeatKind }[];
}

export interface ProcItem extends Base {
  proc: ProcKind;
  /** Footprint when facing 0 (centred): width along x, depth along z. */
  w: number;
  d: number;
  /** Walkable over it (rugs, flower beds). */
  walkable?: boolean;
  color?: string;
  seats?: { x: number; z: number; rot: number; y: number; kind?: SeatKind }[];
}

export type KitItem = GlbItem | ProcItem;

export const isGlb = (i: KitItem): i is GlbItem => 'nodes' in i;

const r = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });
const HALF_PI = Math.PI / 2;

export const KIT: KitItem[] = [
  // Desks: a desk with its chair, the person facing the screen (+z).
  {
    id: 'workstation', name: 'Desk with chair', category: 'desks',
    nodes: ['FURN_desk_r0c0', 'FURN_chair_r0c0'], c: [13.3, 2.6], rot0: 0,
    blocks: [r(12.5, 14.1, 2.525, 3.275), r(12.98, 13.63, 1.93, 2.6)],
    seats: [{ x: 13.295, z: 2.28, rot: 0, y: 0.48 }],
  },
  {
    id: 'office_chair', name: 'Office chair', category: 'desks',
    nodes: ['FURN_chair_r0c0'], c: [13.3, 2.27], rot0: 0, blocks: [r(12.98, 13.63, 1.93, 2.6)],
    seats: [{ x: 13.295, z: 2.28, rot: 0, y: 0.48 }],
  },
  {
    id: 'divider', name: 'Desk divider', category: 'desks',
    nodes: ['FURN_divider'], c: [15.1, 3.425], rot0: 0, blocks: [r(12.4, 17.8, 3.39, 3.46)],
  },
  // Meeting: the boardroom table with seven chairs, and the screen with its console.
  {
    id: 'meeting_table', name: 'Meeting table (7 seats)', category: 'meeting',
    nodes: ['FURN_meet_table', 'FURN_meet_props', 'FURN_meet_chair_n0', 'FURN_meet_chair_n1', 'FURN_meet_chair_n2', 'FURN_meet_chair_s0', 'FURN_meet_chair_s1', 'FURN_meet_chair_s2', 'FURN_meet_chair_w'],
    c: [3.4, 3.4], rot0: 0,
    blocks: [r(1.95, 5.25, 2.825, 3.975), r(2.25, 4.95, 2.05, 2.75), r(2.25, 4.95, 4.05, 4.75), r(1.26, 1.91, 3.07, 3.71)],
    seats: [
      { x: 2.592, z: 2.42, rot: 0.135, y: 0.48 }, { x: 3.609, z: 2.42, rot: -0.023, y: 0.48 }, { x: 4.619, z: 2.42, rot: -0.017, y: 0.48 },
      { x: 2.589, z: 4.38, rot: 3.017, y: 0.48 }, { x: 3.603, z: 4.38, rot: 3.031, y: 0.48 }, { x: 4.622, z: 4.38, rot: 3.128, y: 0.48 },
      { x: 1.6, z: 3.4, rot: HALF_PI, y: 0.48 },
    ],
  },
  {
    id: 'screen_console', name: 'Wall screen and console', category: 'meeting',
    nodes: ['FURN_meet_screen', 'FURN_meet_credenza'], c: [3.6, 0.5], rot0: 0, blocks: [r(2.7, 4.5, 0.21, 0.72)],
  },
  // Seating.
  {
    id: 'sofa', name: 'Sofa (3 seats)', category: 'seating',
    nodes: ['FURN_sofa'], c: [0.75, 11.4], rot0: HALF_PI, blocks: [r(0.29, 1.21, 10.15, 12.65)],
    seats: [
      { x: 0.85, z: 10.75, rot: HALF_PI, y: 0.45, kind: 'sofa' }, { x: 0.85, z: 11.4, rot: HALF_PI, y: 0.45, kind: 'sofa' },
      { x: 0.85, z: 12.05, rot: HALF_PI, y: 0.45, kind: 'sofa' },
    ],
  },
  {
    id: 'armchair', name: 'Armchair', category: 'seating',
    nodes: ['FURN_armchair_a'], c: [5.58, 10.29], rot0: -1.116, blocks: [r(5.02, 6.14, 9.77, 10.87)],
    seats: [{ x: 5.55, z: 10.3, rot: -1.116, y: 0.42, kind: 'armchair' }],
  },
  {
    id: 'cafe_set', name: 'Café table (3 seats)', category: 'tables',
    nodes: ['FURN_cafe_table_0', 'FURN_cafe_chair_00', 'FURN_cafe_chair_01', 'FURN_cafe_chair_02'], c: [13.4, 11.3], rot0: 0,
    blocks: [r(12.98, 13.82, 10.88, 11.72), r(13.54, 14.0, 11.72, 12.19), r(13.57, 14.04, 10.42, 10.9), r(12.47, 12.89, 11.07, 11.49)],
    seats: [
      { x: 13.745, z: 11.932, rot: -2.641, y: 0.49 }, { x: 13.777, z: 10.687, rot: -0.551, y: 0.49 }, { x: 12.68, z: 11.277, rot: 1.539, y: 0.49 },
    ],
  },
  // Tables and storage.
  { id: 'coffee_table', name: 'Coffee table', category: 'tables', nodes: ['FURN_coffee_table'], c: [3.3, 11.4], rot0: 0, blocks: [r(2.68, 3.92, 10.78, 12.02)] },
  { id: 'side_table', name: 'Side table', category: 'tables', nodes: ['FURN_side_table'], c: [0.65, 13.15], rot0: 0, blocks: [r(0.41, 0.89, 12.91, 13.39)] },
  { id: 'credenza', name: 'Credenza', category: 'tables', nodes: ['FURN_credenza'], c: [15.1, 0.55], rot0: 0, blocks: [r(14.2, 16.0, 0.33, 0.77)] },
  { id: 'coffee_bar', name: 'Coffee bar', category: 'tables', nodes: ['FURN_counter'], c: [8.85, 0.55], rot0: 0, blocks: [r(7.45, 10.25, 0.19, 0.91)] },
  { id: 'bookshelf', name: 'Bookshelf', category: 'decor', nodes: ['FURN_bookshelf'], c: [0.42, 14.8], rot0: HALF_PI, blocks: [r(0.24, 0.6, 13.8, 15.8)] },
  { id: 'arc_lamp', name: 'Arc floor lamp', category: 'lighting', nodes: ['FURN_arc_lamp'], c: [2.25, 10.1], rot0: HALF_PI, blocks: [r(1.8, 2.3, 9.8, 10.3)] },
  // Plants.
  { id: 'monstera', name: 'Monstera plant', category: 'plants', nodes: ['DECO_monstera_lounge'], c: [0.81, 9.42], rot0: 0, blocks: [r(0.55, 1.1, 9.15, 9.7)] },
  { id: 'monstera_tall', name: 'Tall monstera', category: 'plants', nodes: ['DECO_monstera_lounge_tall'], c: [7.43, 14.71], rot0: 0, blocks: [r(7.15, 7.7, 14.43, 14.98)] },
  { id: 'palm_pot', name: 'Potted palm', category: 'plants', nodes: ['DECO_meet_plant'], c: [6.48, 0.74], rot0: 0, blocks: [r(6.2, 6.76, 0.46, 1.02)] },
  { id: 'planter_small', name: 'Small planter', category: 'plants', nodes: ['DECO_planter_right_b'], c: [19.7, 0.62], rot0: 0, blocks: [r(19.44, 19.96, 0.17, 1.07)] },
  { id: 'wall_art', name: 'Wall art', category: 'decor', nodes: ['DECO_art_meet_a'], c: [0.23, 2.3], rot0: HALF_PI, blocks: [] },

  // Drawn in code.
  { id: 'tree', name: 'Tree', category: 'outdoor', proc: 'tree', w: 1.0, d: 1.0 },
  { id: 'pine', name: 'Pine', category: 'outdoor', proc: 'pine', w: 0.9, d: 0.9 },
  { id: 'blossom', name: 'Blossom tree', category: 'outdoor', proc: 'blossom', w: 1.0, d: 1.0 },
  { id: 'bush', name: 'Bush', category: 'outdoor', proc: 'bush', w: 1.0, d: 1.0 },
  { id: 'flowers', name: 'Flower bed', category: 'outdoor', proc: 'flowers', w: 2.4, d: 1.2, walkable: false },
  { id: 'hedge', name: 'Hedge', category: 'outdoor', proc: 'hedge', w: 3.0, d: 0.7 },
  { id: 'bench', name: 'Park bench', category: 'outdoor', proc: 'bench', w: 1.8, d: 0.7, seats: [{ x: -0.45, z: -0.05, rot: 0, y: 0.45, kind: 'sofa' }, { x: 0.45, z: -0.05, rot: 0, y: 0.45, kind: 'sofa' }] },
  { id: 'fountain', name: 'Fountain', category: 'outdoor', proc: 'fountain', w: 2.6, d: 2.6 },
  { id: 'big_fountain', name: 'Grand fountain', category: 'outdoor', proc: 'big_fountain', w: 6.0, d: 6.0, hidden: true },
  { id: 'boulder', name: 'Boulder', category: 'outdoor', proc: 'boulder', w: 1.2, d: 1.0 },
  { id: 'lamp_post', name: 'Lamp post', category: 'lighting', proc: 'lamp_post', w: 0.4, d: 0.4 },
  { id: 'rug_navy', name: 'Navy rug', category: 'decor', proc: 'rug', w: 3.0, d: 2.0, walkable: true, color: '#1E3A6E' },
  { id: 'rug_gold', name: 'Gold rug', category: 'decor', proc: 'rug', w: 3.0, d: 2.0, walkable: true, color: '#C9952F' },
  { id: 'rug_green', name: 'Green rug', category: 'decor', proc: 'rug', w: 3.0, d: 2.0, walkable: true, color: '#2F6B4F' },
  { id: 'stage', name: 'Stage', category: 'decor', proc: 'stage', w: 8.0, d: 3.0, walkable: true, hidden: true },
  { id: 'big_screen', name: 'Big screen', category: 'decor', proc: 'big_screen', w: 6.0, d: 0.3 },
  { id: 'podium', name: 'Podium', category: 'decor', proc: 'podium', w: 0.7, d: 0.5 },
  { id: 'pool_table', name: 'Pool table', category: 'tables', proc: 'pool_table', w: 2.4, d: 1.3 },
  { id: 'arcade', name: 'Arcade machine', category: 'decor', proc: 'arcade', w: 0.8, d: 0.7 },
  { id: 'beanbag', name: 'Beanbag', category: 'seating', proc: 'beanbag', w: 0.9, d: 0.9, walkable: false, seats: [{ x: 0, z: 0, rot: 0, y: 0.3, kind: 'armchair' }] },
];

export const KIT_BY_ID: ReadonlyMap<string, KitItem> = new Map(KIT.map((i) => [i.id, i]));

export const KIT_CATEGORIES: { id: KitCategory; label: string }[] = [
  { id: 'desks', label: 'Desks' }, { id: 'meeting', label: 'Meeting' }, { id: 'seating', label: 'Seating' }, { id: 'tables', label: 'Tables' },
  { id: 'plants', label: 'Plants' }, { id: 'decor', label: 'Decor' }, { id: 'outdoor', label: 'Outdoor' }, { id: 'lighting', label: 'Lighting' },
];

/** Every GLB node the kit uses (loaded once from office-02.glb). */
export const KIT_NODES: string[] = [...new Set(KIT.filter(isGlb).flatMap((i) => i.nodes))];

// ---------------------------------------------------------------- placing

/** A piece in a world: which kit item, where its pivot is, and the way it faces. */
export interface Placed {
  /** Stable id (layouts use readable ids; the build mode uses random ones). */
  id: string;
  kind: string;
  x: number;
  z: number;
  rot: number;
}

/** Turn a point (dx, dz) around the origin by `a` the way three.js turns objects (rotation.y). */
export function turn(dx: number, dz: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [dx * c + dz * s, -dx * s + dz * c];
}

/** From the item's source frame to the world for a placement. */
function toWorld(item: KitItem, p: Placed, sx: number, sz: number): [number, number] {
  if (isGlb(item)) {
    const [dx, dz] = turn(sx - item.c[0], sz - item.c[1], p.rot - item.rot0);
    return [p.x + dx, p.z + dz];
  }
  const [dx, dz] = turn(sx, sz, p.rot);
  return [p.x + dx, p.z + dz];
}

function rectToWorld(item: KitItem, p: Placed, b: Rect): Rect {
  const pts = [toWorld(item, p, b.x0, b.z0), toWorld(item, p, b.x1, b.z0), toWorld(item, p, b.x0, b.z1), toWorld(item, p, b.x1, b.z1)];
  return { x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])), z0: Math.min(...pts.map((q) => q[1])), z1: Math.max(...pts.map((q) => q[1])) };
}

/** What a placed piece blocks for walking. */
export function placedBlocks(p: Placed): Rect[] {
  const item = KIT_BY_ID.get(p.kind);
  if (!item) return [];
  if (isGlb(item)) return item.blocks.map((b) => rectToWorld(item, p, b));
  if (item.walkable) return [];
  // Trees and posts block their trunk, not their whole canopy.
  const shrink = item.proc === 'tree' || item.proc === 'blossom' || item.proc === 'pine' || item.proc === 'lamp_post' ? 0.35 : 1;
  const hw = (item.w * shrink) / 2;
  const hd = (item.d * shrink) / 2;
  return [rectToWorld(item, p, { x0: -hw, x1: hw, z0: -hd, z1: hd })];
}

/** The seats a placed piece offers. */
export function placedSeats(p: Placed): Seat[] {
  const item = KIT_BY_ID.get(p.kind);
  if (!item?.seats) return [];
  return item.seats.map((s, i) => {
    const [x, z] = toWorld(item, p, s.x, s.z);
    const rot = s.rot + p.rot - (isGlb(item) ? item.rot0 : 0);
    return { id: `${p.id}:${i}`, x: +x.toFixed(3), z: +z.toFixed(3), rot: Math.atan2(Math.sin(rot), Math.cos(rot)), y: s.y, kind: s.kind ?? 'chair' };
  });
}

/** Footprint of a piece facing 0, for the build mode's preview. */
export function itemSize(item: KitItem, rot = 0): { w: number; d: number } {
  if (!isGlb(item)) {
    const b = rectToWorld(item, { id: '', kind: item.id, x: 0, z: 0, rot }, { x0: -item.w / 2, x1: item.w / 2, z0: -item.d / 2, z1: item.d / 2 });
    return { w: b.x1 - b.x0, d: b.z1 - b.z0 };
  }
  const all = item.blocks.length ? item.blocks : [{ x0: item.c[0] - 0.5, x1: item.c[0] + 0.5, z0: item.c[1] - 0.5, z1: item.c[1] + 0.5 }];
  const b = all.map((x) => rectToWorld(item, { id: '', kind: item.id, x: 0, z: 0, rot }, x));
  return { w: Math.max(...b.map((q) => q.x1)) - Math.min(...b.map((q) => q.x0)), d: Math.max(...b.map((q) => q.z1)) - Math.min(...b.map((q) => q.z0)) };
}
