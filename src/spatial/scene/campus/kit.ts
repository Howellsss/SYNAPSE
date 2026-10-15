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

export type KitCategory = 'desks' | 'meeting' | 'seating' | 'tables' | 'plants' | 'decor' | 'outdoor' | 'lighting' | 'events' | 'transport';

/** Pieces drawn in code. */
export type ProcKind =
  | 'tree' | 'pine' | 'blossom' | 'bush' | 'flowers' | 'hedge' | 'lamp_post' | 'bench' | 'fountain'
  | 'big_fountain' | 'rug' | 'stage' | 'big_screen' | 'boulder' | 'pool_table' | 'arcade' | 'beanbag' | 'podium'
  | 'oak' | 'palm' | 'bush_flower' | 'flowers_round' | 'reeds' | 'lilies' | 'string_lights' | 'pergola' | 'umbrella_set'
  | 'gazebo' | 'picnic' | 'fire_pit' | 'planter_tree' | 'led_wall' | 'truss' | 'theatre_seat' | 'sofa_p' | 'lounge_chair'
  | 'dining_set' | 'bar_counter' | 'bar_stool' | 'bottle_wall' | 'fireplace' | 'booth' | 'reception' | 'bookcase'
  | 'conference' | 'ping_pong' | 'potted_tree' | 'doorway' | 'car' | 'bike' | 'car_park' | 'bike_park';

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
  { id: 'rug_gold', name: 'Gold rug', category: 'decor', proc: 'rug', w: 3.0, d: 2.0, walkable: true, color: '#B5832A' },
  { id: 'rug_green', name: 'Green rug', category: 'decor', proc: 'rug', w: 3.0, d: 2.0, walkable: true, color: '#2F6B4F' },
  { id: 'stage', name: 'Stage', category: 'decor', proc: 'stage', w: 12.0, d: 3.5, walkable: true, hidden: true },
  { id: 'big_screen', name: 'Big screen', category: 'decor', proc: 'big_screen', w: 6.0, d: 0.3 },
  { id: 'podium', name: 'Podium', category: 'decor', proc: 'podium', w: 0.7, d: 0.5 },
  { id: 'pool_table', name: 'Pool table', category: 'tables', proc: 'pool_table', w: 2.4, d: 1.3 },
  { id: 'arcade', name: 'Arcade machine', category: 'decor', proc: 'arcade', w: 0.8, d: 0.7 },
  { id: 'beanbag', name: 'Beanbag', category: 'seating', proc: 'beanbag', w: 0.9, d: 0.9, walkable: false, seats: [{ x: 0, z: 0, rot: 0, y: 0.3, kind: 'armchair' }] },

  // Nature.
  { id: 'oak', name: 'Oak tree', category: 'outdoor', proc: 'oak', w: 1.2, d: 1.2 },
  { id: 'palm', name: 'Palm tree', category: 'outdoor', proc: 'palm', w: 0.9, d: 0.9 },
  { id: 'bush_flower', name: 'Flowering bush', category: 'outdoor', proc: 'bush_flower', w: 1.0, d: 1.0 },
  { id: 'flowers_round', name: 'Round flower bed', category: 'outdoor', proc: 'flowers_round', w: 2.4, d: 2.4 },
  { id: 'reeds', name: 'Reeds', category: 'outdoor', proc: 'reeds', w: 0.9, d: 0.9 },
  { id: 'lilies', name: 'Water lilies', category: 'outdoor', proc: 'lilies', w: 2.4, d: 2.4, walkable: true, hidden: true },
  { id: 'planter_tree', name: 'Tree planter', category: 'plants', proc: 'planter_tree', w: 4.2, d: 4.2 },
  { id: 'potted_tree', name: 'Indoor tree', category: 'plants', proc: 'potted_tree', w: 0.8, d: 0.8 },
  // Outdoor living.
  { id: 'string_lights', name: 'String lights', category: 'lighting', proc: 'string_lights', w: 8, d: 0.3, walkable: true },
  { id: 'pergola', name: 'Pergola', category: 'outdoor', proc: 'pergola', w: 4, d: 3, walkable: true },
  { id: 'gazebo', name: 'Gazebo', category: 'outdoor', proc: 'gazebo', w: 4.8, d: 4.8, walkable: true },
  { id: 'fire_pit', name: 'Fire pit', category: 'outdoor', proc: 'fire_pit', w: 1.8, d: 1.8 },
  { id: 'picnic', name: 'Picnic table', category: 'outdoor', proc: 'picnic', w: 1.8, d: 1.6, seats: [-0.45, 0.45].flatMap((x) => [{ x, z: -0.62, rot: 0, y: 0.45 }, { x, z: 0.62, rot: Math.PI, y: 0.45 }]) },
  ...([['umbrella_teal', 'Umbrella table (teal)', '#2F7F86'], ['umbrella_gold', 'Umbrella table (gold)', '#C9952F'], ['umbrella_navy', 'Umbrella table (navy)', '#24406E']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'outdoor', proc: 'umbrella_set', w: 2.2, d: 2.2, color,
    seats: [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; const x = Math.cos(a) * 0.85; const z = Math.sin(a) * 0.85; return { x, z, rot: Math.atan2(-x, -z), y: 0.45 }; }),
  })),
  // Events.
  { id: 'led_wall', name: 'LED wall', category: 'events', proc: 'led_wall', w: 10, d: 0.4 },
  // Transport: click one to ride it somewhere.
  { id: 'car_park', name: 'Car park', category: 'transport', proc: 'car_park', w: 11.4, d: 3.4, walkable: true },
  { id: 'bike_park', name: 'Scooter park', category: 'transport', proc: 'bike_park', w: 5.4, d: 2.2, walkable: true },
  ...([['car_navy', 'Car (navy)', '#24406E'], ['car_red', 'Car (red)', '#B8443A'], ['car_gold', 'Car (gold)', '#D9A43A'], ['car_white', 'Car (pearl)', '#DCE0E6'], ['car_teal', 'Car (teal)', '#2F8A8F'], ['car_blue', 'Car (blue)', '#3A6FD0']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'transport', proc: 'car', w: 1.4, d: 2.35, color,
  })),
  ...([['bike_teal', 'Scooter (teal)', '#2F8A8F'], ['bike_red', 'Scooter (red)', '#B8443A'], ['bike_navy', 'Scooter (navy)', '#24406E'], ['bike_gold', 'Scooter (gold)', '#D9A43A'], ['bike_plum', 'Scooter (plum)', '#7A4FA0']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'transport', proc: 'bike', w: 0.5, d: 1.5, color,
  })),
  { id: 'stage_large', name: 'Large stage', category: 'events', proc: 'stage', w: 16, d: 5, walkable: true, hidden: true },
  { id: 'tv_wall', name: 'Wall screen', category: 'meeting', proc: 'led_wall', w: 3.2, d: 0.3 },
  { id: 'doorway', name: 'Doorway', category: 'decor', proc: 'doorway', w: 3, d: 0.5, walkable: true, hidden: true },
  { id: 'truss', name: 'Lighting truss', category: 'events', proc: 'truss', w: 12, d: 0.3, walkable: true, hidden: true },
  ...([['seat_navy', 'Seat (navy)', '#24406E'], ['seat_red', 'Seat (red)', '#8E2B2B'], ['seat_green', 'Seat (green)', '#2F6B4F'], ['seat_gold', 'Seat (gold)', '#B5832A'], ['seat_blue', 'Seat (blue)', '#2F5D9F']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'events', proc: 'theatre_seat', w: 0.6, d: 0.6, color, seats: [{ x: 0, z: 0.02, rot: 0, y: 0.5 }],
  })),
  ...([['booth_navy', 'Expo booth (navy)', '#24406E'], ['booth_teal', 'Expo booth (teal)', '#2F7F86'], ['booth_red', 'Expo booth (red)', '#9C3434'], ['booth_green', 'Expo booth (green)', '#3E7A4E']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'events', proc: 'booth', w: 3.1, d: 1.0, color,
  })),
  // Rooms.
  ...([['sofa_teal', 'Sofa (teal)', '#2F6F73'], ['sofa_navy', 'Sofa (navy)', '#24406E'], ['sofa_rust', 'Sofa (rust)', '#A0522D'], ['sofa_green', 'Sofa (green)', '#3E6B48']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'seating', proc: 'sofa_p', w: 2.2, d: 0.95, color, seats: [-0.65, 0, 0.65].map((x) => ({ x, z: 0.1, rot: 0, y: 0.52, kind: 'sofa' as const })),
  })),
  ...([['chair_mustard', 'Lounge chair (mustard)', '#C08A2E'], ['chair_teal', 'Lounge chair (teal)', '#2F6F73'], ['chair_rust', 'Lounge chair (rust)', '#A0522D']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'seating', proc: 'lounge_chair', w: 0.85, d: 0.85, color, seats: [{ x: 0, z: 0.06, rot: 0, y: 0.52, kind: 'armchair' }],
  })),
  ...([['dining_green', 'Café table (green)', '#3E6B48'], ['dining_mustard', 'Café table (mustard)', '#C08A2E'], ['dining_navy', 'Café table (navy)', '#24406E']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'tables', proc: 'dining_set', w: 1.9, d: 1.9, color,
    seats: [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2; return { x: Math.sin(a) * 0.72, z: Math.cos(a) * 0.72, rot: a + Math.PI, y: 0.5 }; }),
  })),
  { id: 'bar_counter', name: 'Bar counter', category: 'tables', proc: 'bar_counter', w: 5, d: 0.8 },
  { id: 'bar_stool', name: 'Bar stool', category: 'seating', proc: 'bar_stool', w: 0.45, d: 0.45, color: '#24406E', seats: [{ x: 0, z: 0, rot: 0, y: 0.82 }] },
  { id: 'bottle_wall', name: 'Bar shelves', category: 'decor', proc: 'bottle_wall', w: 5, d: 0.45 },
  { id: 'fireplace', name: 'Fireplace', category: 'decor', proc: 'fireplace', w: 3.2, d: 0.9 },
  { id: 'reception', name: 'Reception desk', category: 'tables', proc: 'reception', w: 3.5, d: 0.9 },
  { id: 'bookcase', name: 'Bookcase wall', category: 'decor', proc: 'bookcase', w: 3, d: 0.45 },
  ...([['conference', 'Conference table (navy)', '#24406E'], ['conf_teal', 'Conference table (teal)', '#2F6F73'], ['conf_red', 'Conference table (red)', '#8E2B2B'], ['conf_green', 'Conference table (green)', '#2F6B4F']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'meeting', proc: 'conference', w: 2.4, d: 4.6, color,
    seats: [0, 1, 2, 3, 4].flatMap((i) => [{ x: -0.95, z: -1.8 + 0.9 * i, rot: Math.PI / 2, y: 0.5 }, { x: 0.95, z: -1.8 + 0.9 * i, rot: -Math.PI / 2, y: 0.5 }]),
  })),
  { id: 'ping_pong', name: 'Ping-pong table', category: 'tables', proc: 'ping_pong', w: 1.6, d: 2.8 },
  ...([['rug_xl_rust', 'Room rug (rust)', '#7E3B2C'], ['rug_xl_navy', 'Room rug (navy)', '#1E3A6E'], ['rug_xl_teal', 'Room rug (teal)', '#245E63'], ['rug_xl_green', 'Room rug (green)', '#2F5E4A']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'decor', proc: 'rug', w: 8, d: 7, walkable: true, color,
  })),
  ...([['rug_large_navy', 'Large rug (navy)', '#1E3A6E'], ['rug_large_rust', 'Large rug (rust)', '#8B3A2A'], ['rug_large_green', 'Large rug (green)', '#2F5E4A']] as const).map(([id, name, color]): ProcItem => ({
    id, name, category: 'decor', proc: 'rug', w: 5, d: 3.5, walkable: true, color,
  })),
];

export const KIT_BY_ID: ReadonlyMap<string, KitItem> = new Map(KIT.map((i) => [i.id, i]));

export const KIT_CATEGORIES: { id: KitCategory; label: string }[] = [
  { id: 'desks', label: 'Desks' }, { id: 'meeting', label: 'Meeting' }, { id: 'seating', label: 'Seating' }, { id: 'tables', label: 'Tables' },
  { id: 'plants', label: 'Plants' }, { id: 'decor', label: 'Decor' }, { id: 'outdoor', label: 'Outdoor' }, { id: 'lighting', label: 'Lighting' }, { id: 'events', label: 'Events' }, { id: 'transport', label: 'Transport' },
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

/** Pieces that are round from above: they block a circle, not a square. */
const ROUND: ProcKind[] = ['fountain', 'big_fountain', 'fire_pit', 'flowers_round', 'planter_tree', 'umbrella_set', 'dining_set', 'beanbag'];

/**
 * A rectangle of the piece, in the world. Turned square to the floor it's one box; turned at an
 * angle, its box would be far bigger than the piece (a bench at 45° would block a square 1.8 m
 * across), so it's cut into short pieces along its length, each boxed on its own.
 */
function blockRects(item: KitItem, p: Placed, b: Rect): Rect[] {
  const a = (((p.rot - (isGlb(item) ? item.rot0 : 0)) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  const square = a < 0.02 || a > Math.PI / 2 - 0.02;
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  if (square || Math.max(w, d) < 0.6) return [rectToWorld(item, p, b)];
  const out: Rect[] = [];
  const along = w >= d;
  const short = Math.max(0.25, along ? d : w);
  const n = Math.ceil((along ? w : d) / short);
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    out.push(rectToWorld(item, p, along
      ? { x0: b.x0 + w * t0, x1: b.x0 + w * t1, z0: b.z0, z1: b.z1 }
      : { x0: b.x0, x1: b.x1, z0: b.z0 + d * t0, z1: b.z0 + d * t1 }));
  }
  return out;
}

/** A circle as a few strips (for walking). */
function circleRects(cx: number, cz: number, r: number): Rect[] {
  const out: Rect[] = [];
  const n = Math.max(3, Math.ceil(r / 0.35));
  for (let i = 0; i < n; i++) {
    const z0 = -r + (2 * r * i) / n;
    const z1 = -r + (2 * r * (i + 1)) / n;
    const zm = Math.min(Math.abs(z0), Math.abs(z1)) * (z0 * z1 < 0 ? 0 : 1);
    const hw = Math.sqrt(Math.max(0, r * r - zm * zm));
    out.push({ x0: cx - hw, x1: cx + hw, z0: cz + z0, z1: cz + z1 });
  }
  return out;
}

/** What a placed piece blocks for walking. */
export function placedBlocks(p: Placed): Rect[] {
  const item = KIT_BY_ID.get(p.kind);
  if (!item) return [];
  if (isGlb(item)) return item.blocks.flatMap((b) => blockRects(item, p, b));
  if (item.walkable) return [];
  if (ROUND.includes(item.proc)) return circleRects(p.x, p.z, Math.min(item.w, item.d) / 2);
  // Trees and posts block their trunk, not their whole canopy.
  const shrink = ['tree', 'blossom', 'pine', 'lamp_post', 'oak', 'palm', 'potted_tree'].includes(item.proc) ? 0.4 : 1;
  const hw = (item.w * shrink) / 2;
  const hd = (item.d * shrink) / 2;
  return blockRects(item, p, { x0: -hw, x1: hw, z0: -hd, z1: hd });
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

/** The ground a placed piece covers (its whole footprint, rugs and canopies included). */
export function placedBounds(p: Placed): Rect | null {
  const item = KIT_BY_ID.get(p.kind);
  if (!item) return null;
  const parts = isGlb(item)
    ? (item.blocks.length ? item.blocks : [r(item.c[0] - 0.5, item.c[0] + 0.5, item.c[1] - 0.5, item.c[1] + 0.5)]).map((b) => rectToWorld(item, p, b))
    : [rectToWorld(item, p, r(-item.w / 2, item.w / 2, -item.d / 2, item.d / 2))];
  return r(Math.min(...parts.map((b) => b.x0)), Math.max(...parts.map((b) => b.x1)), Math.min(...parts.map((b) => b.z0)), Math.max(...parts.map((b) => b.z1)));
}

/** Build mode: the piece under a point (the smallest, so a lamp beats the rug it stands on). Layout-only pieces can't be picked. */
export function pieceAt(objects: Placed[], x: number, z: number): Placed | null {
  let best: Placed | null = null;
  let bestArea = Infinity;
  for (const p of objects) {
    if (KIT_BY_ID.get(p.kind)?.hidden) continue;
    const b = placedBounds(p);
    if (!b || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const area = (b.x1 - b.x0) * (b.z1 - b.z0);
    if (area < bestArea) { best = p; bestArea = area; }
  }
  return best;
}

/** Build mode: whether a piece can go here (inside the grounds, clear of walls, water and other furniture). */
export function fitsAt(obstacles: Rect[], p: Placed, width: number, depth: number): boolean {
  const b = placedBounds(p);
  if (!b || b.x0 < 0.5 || b.z0 < 0.5 || b.x1 > width - 0.5 || b.z1 > depth - 0.5) return false;
  const mine = placedBlocks(p);
  return !mine.some((m) => obstacles.some((o) => m.x0 < o.x1 - 0.02 && m.x1 > o.x0 + 0.02 && m.z0 < o.z1 - 0.02 && m.z1 > o.z0 + 0.02));
}
