/**
 * SYNAPSE Campus: one large world (120 × 190 m) inside a single workspace. Walk from the
 * headquarters (Office 02) along the avenues to the all-hands hall, the café and lounge, the team
 * areas, glass meeting rooms, focus booths, the garden with its pond, the game room and the
 * library, and south across the boulevard to the airport: all one space, no loading between places.
 *
 * Everything here is data (no three.js): buildings with their doorways, areas (zones) with their
 * sound rules, paths, water and every placed piece. The renderer draws it; walking, sitting and
 * proximity use the same numbers.
 */
import type { RoomType } from '@/types';
import type { Rect } from '../offices';
import { OFFICE_02 } from '../offices';
import type { Seat } from '../seats';
import { groundOf } from './ground';
import { placedBlocks, placedSeats, type Placed } from './kit';

export const CAMPUS_W = 120;
export const CAMPUS_D = 190;

export type FloorFinish = 'oak' | 'walnut' | 'carpet_navy' | 'carpet_green' | 'carpet_plum' | 'slate' | 'terrazzo'
  | 'marble' | 'herringbone' | 'carpet_red' | 'carpet_teal' | 'deck';
/** Solid walls, glass walls, or none (an open deck or terrace). */
export type WallKind = 'solid' | 'glass' | 'none';
export type Side = 'n' | 's' | 'e' | 'w';

/** A walled area with a raised floor; doorways are gaps in its walls. */
export interface Building {
  id: string;
  rect: Rect;
  /** No floor: walls standing on the ground (a courtyard's walls). */
  floor?: FinishOrNone;
  wall: WallKind;
  /** Gaps: on which side, centre along that side (metres from its start), width. */
  doors: { side: Side; at: number; width: number }[];
  /** Wall height (default 1.6 m: low enough to see in from above). */
  height?: number;
}
type FinishOrNone = FloorFinish;

/** A named place: shown on the floor, in the location bar, and used for who hears whom. */
export interface Zone {
  id: string;
  name: string;
  type: RoomType;
  rect: Rect;
  /** Lockable by admins (meeting rooms, focus booths). */
  lockable?: boolean;
}

export interface Water { id: string; cx: number; cz: number; rx: number; rz: number }

/** A winding garden walk (drawn only: lawns are walkable anyway). */
export interface Walk { points: [number, number][]; width: number }

/**
 * SYNAPSE Hub: separate places in one workspace. Each wing is drawn on its own (only the one
 * you're in shows), and doorways (portals) take you from one to another.
 */
export interface Wing { id: string; name: string; rect: Rect; outdoor: boolean }
export interface Portal {
  id: string;
  /** Step in here… */
  rect: Rect;
  /** …to arrive here, facing this way. */
  to: { x: number; z: number; rot: number };
  /** Shown over the doorway. */
  label: string;
}

/** An airport's runway (centre line from x0 to x1 at z) and the taxiway beside it, for the planes. */
export interface Airport { runway: { x0: number; x1: number; z: number }; taxiZ: number }

export interface CampusLayout {
  width: number;
  depth: number;
  /** Where the HQ (Office 02 as built) stands: its (0, 0) corner. Null for worlds without it. */
  hq: { x: number; z: number } | null;
  buildings: Building[];
  zones: Zone[];
  paths: Rect[];
  water: Water[];
  objects: Placed[];
  spawn: { x: number; z: number };
  walks?: Walk[];
  /** Round paved areas. */
  plazas?: { cx: number; cz: number; r: number }[];
  wings?: Wing[];
  portals?: Portal[];
  airport?: Airport;
}

const r = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });
const PI = Math.PI;
const HALF = PI / 2;

/** Default names for the team areas when the account has no departments yet. */
export const DEFAULT_TEAM_NAMES = ['Team Area 1', 'Team Area 2', 'Team Area 3', 'Team Area 4'];

/**
 * The campus. `teamNames` names the four team areas (the account's departments, in order);
 * `extra` are pieces people added in build mode.
 */
export function buildCampus(teamNames: string[] = DEFAULT_TEAM_NAMES, extra: Placed[] = []): CampusLayout {
  const objects: Placed[] = [];
  const add = (id: string, kind: string, x: number, z: number, rot = 0) => objects.push({ id, kind, x: +x.toFixed(3), z: +z.toFixed(3), rot });
  const buildings: Building[] = [];
  const zones: Zone[] = [];
  const names = DEFAULT_TEAM_NAMES.map((d, i) => teamNames[i]?.trim() || d);

  // ---- avenues and plaza
  const paths: Rect[] = [
    r(2, 118, 30, 33.5), r(2, 118, 60, 63.5), // east–west avenues
    r(40, 43.5, 2, 97.5), r(77.5, 81, 2, 97.5), // north–south avenues, down to the boulevard
    r(2, 118, 97.5, 101), // the boulevard, along the airport
    r(18.8, 21.2, 23, 30), // HQ entrance: the gap in its front planters
    r(58, 63, 26, 30), // to the all-hands hall
    r(98, 102, 26, 30), // to the café & lounge
    r(20, 23, 47, 48.5), // between the team areas
  ];

  // ---- headquarters: Office 02 as built, entered through the gap in its front planters
  const hq = { x: 10, z: 7 };
  zones.push({ id: 'hq', name: 'Headquarters', type: 'open_area', rect: r(hq.x, hq.x + 20, hq.z, hq.z + 16) });
  zones.push({ id: 'hq-meet', name: 'HQ Meeting Room', type: 'meeting_room', rect: r(hq.x + 0.2, hq.x + 6.95, hq.z + 0.2, hq.z + 6.5), lockable: true });

  // ---- all-hands hall: a stage, a big screen and rows of chairs facing it
  {
    const b = r(45, 76, 4, 26);
    buildings.push({ id: 'allhands', rect: b, floor: 'walnut', wall: 'solid', doors: [{ side: 's', at: 15.5, width: 4 }] });
    zones.push({ id: 'allhands-stage', name: 'All-Hands Stage', type: 'stage', rect: r(52.5, 68.5, 5.5, 9) });
    zones.push({ id: 'allhands', name: 'All-Hands Hall', type: 'open_area', rect: b });
    add('ah-stage', 'stage', 60.5, 7.25);
    add('ah-screen', 'big_screen', 60.5, 4.6);
    add('ah-podium', 'podium', 64, 8);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 12; col++) {
        if (col === 5 || col === 6) continue; // centre aisle
        add(`ah-chair-${row}-${col}`, 'office_chair', 50.5 + col * 1.85, 12.5 + row * 2.2, PI);
      }
    }
    for (let i = 0; i < 4; i++) add(`ah-runner-${i}`, 'rug_gold', 60.5, 12.6 + i * 3, HALF);
    add('ah-plant-a', 'monstera_tall', 46.5, 5.5);
    add('ah-plant-b', 'monstera_tall', 74.5, 5.5);
    add('ah-plant-c', 'palm_pot', 46.5, 24.5);
    add('ah-plant-d', 'palm_pot', 74.5, 24.5);
  }

  // ---- café & lounge
  {
    const b = r(84, 117, 4, 26);
    buildings.push({ id: 'cafe', rect: b, floor: 'oak', wall: 'solid', doors: [{ side: 's', at: 16, width: 4 }, { side: 'w', at: 18.2, width: 3 }] });
    zones.push({ id: 'cafe', name: 'Café', type: 'lounge', rect: r(84, 100, 4, 26) });
    zones.push({ id: 'lounge', name: 'Lounge', type: 'lounge', rect: r(100, 117, 4, 26) });
    add('cafe-bar-a', 'coffee_bar', 88.5, 4.75);
    add('cafe-bar-b', 'coffee_bar', 92.5, 4.75);
    add('cafe-plant-bar', 'palm_pot', 95.6, 5.3);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) add(`cafe-set-${i}-${j}`, 'cafe_set', 87.5 + i * 4.2, 10 + j * 4.6, j % 2 ? 0.6 : 0);
    add('cafe-plant-a', 'monstera', 85.2, 24.8);
    add('cafe-plant-b', 'planter_small', 98.8, 5.2);
    // A soft line of plants between the café and the lounge (stopping short of the door).
    for (let i = 0; i < 3; i++) add(`cafe-divide-${i}`, i % 2 ? 'monstera' : 'planter_small', 100, 9 + i * 4.2);
    // Lounge: two sofa groups around coffee tables, armchairs, lamps, books.
    add('lounge-rug-a', 'rug_navy', 108, 10, 0);
    add('lounge-sofa-a', 'sofa', 105.1, 10, HALF);
    add('lounge-table-a', 'coffee_table', 107.7, 10);
    add('lounge-arm-a', 'armchair', 110.4, 9, -HALF);
    add('lounge-arm-b', 'armchair', 110.4, 11.2, -HALF);
    add('lounge-lamp-a', 'arc_lamp', 105.4, 7.4, HALF);
    add('lounge-rug-b', 'rug_gold', 108, 19.5, 0);
    add('lounge-sofa-b', 'sofa', 108, 22.6, PI);
    add('lounge-table-b', 'coffee_table', 108, 19.6);
    add('lounge-sofa-c', 'sofa', 108, 16.8, 0);
    add('lounge-shelf-a', 'bookshelf', 116.4, 9, -HALF);
    add('lounge-shelf-b', 'bookshelf', 116.4, 13, -HALF);
    add('lounge-side', 'side_table', 105.2, 12.7);
    add('lounge-plant-a', 'monstera_tall', 115.5, 24.5);
    add('lounge-plant-b', 'monstera', 101.5, 5.5);
  }

  // ---- team areas: two pods of six desks each, a credenza and plants
  {
    const areas = [r(3, 20, 35, 46.5), r(23, 40, 35, 46.5), r(3, 20, 48.5, 59.5), r(23, 40, 48.5, 59.5)];
    const finishes: FloorFinish[] = ['carpet_navy', 'carpet_green', 'carpet_plum', 'carpet_navy'];
    areas.forEach((a, n) => {
      const id = `team-${n + 1}`;
      const doorSide: Side = n % 2 === 0 ? 'e' : 'w';
      // The side door opens onto the walkway in front of the desks, not into a row of them.
      const end: Side = n < 2 ? 'n' : 's';
      const sideAt = end === 'n' ? 2.6 : a.z1 - a.z0 - 2.6;
      buildings.push({ id, rect: a, floor: finishes[n], wall: 'glass', doors: [{ side: doorSide, at: sideAt, width: 2.6 }, { side: end, at: 8.5, width: 3 }] });
      zones.push({ id, name: names[n], type: 'open_area', rect: a });
      const cz = (a.z0 + a.z1) / 2 + 0.3;
      for (const [p, cx] of [[0, a.x0 + 4.75], [1, a.x0 + 12.25]] as const) {
        for (let k = 0; k < 3; k++) {
          const x = cx + (k - 1) * 1.85;
          add(`${id}-desk-${p}a${k}`, 'workstation', x, cz - 0.825, 0);
          add(`${id}-desk-${p}b${k}`, 'workstation', x, cz + 0.825, PI);
        }
        add(`${id}-divider-${p}`, 'divider', cx, cz, 0);
      }
      // The credenza against the wall without a door.
      if (end === 'n') add(`${id}-credenza`, 'credenza', (a.x0 + a.x1) / 2, a.z1 - 0.55, PI);
      else add(`${id}-credenza`, 'credenza', (a.x0 + a.x1) / 2, a.z0 + 0.55, 0);
      add(`${id}-plant-a`, 'monstera', a.x0 + 1.1, a.z0 + 1.1);
      add(`${id}-plant-b`, 'palm_pot', a.x1 - 1.1, a.z1 - 1.1);
    });
  }

  // ---- glass meeting rooms
  {
    const rooms = [r(84, 99.5, 35, 46.5), r(101.5, 117, 35, 46.5), r(84, 99.5, 48.5, 59.5), r(101.5, 117, 48.5, 59.5)];
    rooms.forEach((a, n) => {
      const id = `meet-${n + 1}`;
      buildings.push({ id, rect: a, floor: n % 2 ? 'slate' : 'terrazzo', wall: 'glass', doors: [{ side: 'w', at: (a.z1 - a.z0) / 2, width: 2 }] });
      zones.push({ id, name: `Meeting Room ${n + 1}`, type: 'meeting_room', rect: a, lockable: true });
      const cx = (a.x0 + a.x1) / 2;
      add(`${id}-table`, 'meeting_table', cx, (a.z0 + a.z1) / 2 + 0.6);
      add(`${id}-screen`, 'screen_console', cx, a.z0 + 0.5);
      add(`${id}-plant-a`, 'palm_pot', a.x1 - 1, a.z0 + 1);
      add(`${id}-plant-b`, 'monstera', a.x1 - 1.1, a.z1 - 1.1);
    });
  }

  // ---- focus booths (private): a desk each
  {
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 4; i++) {
        const a = r(4 + i * 9, 12 + i * 9, 66 + row * 10, 73 + row * 10);
        const id = `focus-${row * 4 + i + 1}`;
        buildings.push({ id, rect: a, floor: 'oak', wall: 'solid', doors: [{ side: row === 0 ? 'n' : 's', at: 4, width: 2 }] });
        zones.push({ id, name: `Focus Booth ${row * 4 + i + 1}`, type: 'private_office', rect: a, lockable: true });
        add(`${id}-desk`, 'workstation', (a.x0 + a.x1) / 2, row === 0 ? a.z1 - 1.7 : a.z0 + 1.7, row === 0 ? 0 : PI);
        add(`${id}-plant`, 'planter_small', a.x0 + 0.7, row === 0 ? a.z1 - 0.8 : a.z0 + 0.8);
        add(`${id}-shelf`, 'bookshelf', a.x1 - 0.45, (a.z0 + a.z1) / 2, -HALF);
      }
    }
    paths.push(r(4, 39, 73.5, 75.5));
    paths.push(r(21, 22, 63.5, 73.5)); // the gap between booths 2 and 3
    zones.push({ id: 'focus', name: 'Focus Booths', type: 'quiet_zone', rect: r(3, 40, 64, 94) });
  }

  // ---- game room and library
  {
    const game = r(84, 99.5, 66, 92);
    buildings.push({ id: 'game', rect: game, floor: 'carpet_plum', wall: 'solid', doors: [{ side: 'n', at: 7.75, width: 3 }] });
    zones.push({ id: 'game', name: 'Game Room', type: 'lounge', rect: game });
    // An aisle in from the door, the two pool tables either side of it, arcades along the far
    // wall, and beanbags round a rug in the corner.
    add('game-pool-a', 'pool_table', 88, 73.5);
    add('game-pool-b', 'pool_table', 95.5, 73.5);
    for (let i = 0; i < 4; i++) add(`game-arcade-${i}`, 'arcade', 86 + i * 1.2, 91.2, PI);
    add('game-rug', 'rug_gold', 95.2, 85.6);
    for (const [i, [x, z, rot]] of ([[93.9, 84.9, HALF], [93.9, 86.4, HALF], [96.5, 84.9, -HALF], [96.5, 86.4, -HALF]] as const).entries()) add(`game-bean-${i}`, 'beanbag', x, z, rot);
    add('game-plant', 'monstera_tall', 98.3, 67.3);
    add('game-plant-b', 'monstera', 85.2, 67.3);

    const lib = r(101.5, 117, 66, 92);
    buildings.push({ id: 'library', rect: lib, floor: 'walnut', wall: 'solid', doors: [{ side: 'n', at: 7.75, width: 3 }] });
    zones.push({ id: 'library', name: 'Library', type: 'quiet_zone', rect: lib });
    for (let i = 0; i < 5; i++) add(`lib-shelf-e-${i}`, 'bookshelf', 116.4, 69 + i * 4.6, -HALF);
    for (let i = 0; i < 4; i++) add(`lib-shelf-w-${i}`, 'bookshelf', 102.1, 72 + i * 4.8, HALF);
    // Reading corners either side of an aisle in from the door, staggered: two chairs facing on a rug.
    for (const [i, [cx, z]] of ([[105.6, 72], [112.9, 76.5], [105.6, 81], [112.9, 85.5]] as const).entries()) {
      add(`lib-rug-${i}`, i % 2 ? 'rug_green' : 'rug_navy', cx, z, 0);
      add(`lib-arm-${i}a`, 'armchair', cx - 1.6, z, HALF);
      add(`lib-arm-${i}b`, 'armchair', cx + 1.6, z, -HALF);
      add(`lib-side-${i}`, 'side_table', cx, z - 0.9);
    }
    add('lib-lamp', 'arc_lamp', 103.5, 90, HALF);
    paths.push(r(81, 117, 63.5, 66));
  }

  // ---- garden with a pond
  const water: Water[] = [{ id: 'pond', cx: 60.5, cz: 79, rx: 9, rz: 5.5 }];
  {
    zones.push({ id: 'garden', name: 'Garden', type: 'open_area', rect: r(43.5, 77.5, 63.5, 94) });
    const ring = 14;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * PI * 2;
      const x = 60.5 + Math.cos(a) * 13.5;
      const z = 79 + Math.sin(a) * 9.5;
      if (z < 66.5 || z > 92.5) continue;
      add(`garden-tree-${i}`, i % 3 === 0 ? 'pine' : i % 3 === 1 ? 'blossom' : 'oak', x, z);
    }
    add('garden-bench-n', 'bench', 60.5, 72.6, 0);
    add('garden-bench-s', 'bench', 60.5, 85.4, PI);
    add('garden-bench-w', 'bench', 49.4, 79, HALF);
    add('garden-bench-e', 'bench', 71.6, 79, -HALF);
    add('garden-flowers-a', 'flowers_round', 52, 70);
    add('garden-flowers-b', 'bush_flower', 66.5, 70);
    add('garden-flowers-c', 'flowers_round', 54.5, 89);
    add('garden-flowers-d', 'flowers_round', 66.5, 89);
    add('garden-rock-a', 'boulder', 67.4, 75.7, 0.6);
    add('garden-rock-b', 'boulder', 54, 83.6, 2.1);
    add('garden-fountain', 'fountain', 60.5, 67.2);
    paths.push(r(59, 62, 63.5, 72));
    // Water lilies and reeds; a pergola over the west bench; umbrella tables; a fire pit.
    add('garden-lilies-a', 'lilies', 56.4, 77.4);
    add('garden-lilies-b', 'lilies', 64.6, 80.6);
    add('garden-lilies-c', 'lilies', 59.6, 82.2);
    for (const [i, [x, z]] of ([[52.4, 76.6], [52.6, 81.6], [68.6, 76.8], [68.4, 82.2]] as const).entries()) add(`garden-reeds-${i}`, 'reeds', x, z);
    add('garden-pergola', 'pergola', 48.6, 79, HALF);
    add('garden-umbrella-a', 'umbrella_teal', 72.6, 70.4);
    add('garden-umbrella-b', 'umbrella_gold', 72.6, 88.2);
    add('garden-fire', 'fire_pit', 48.2, 89.6);
    add('garden-fire-bench-a', 'bench', 48.2, 87.2, 0);
    add('garden-fire-bench-b', 'bench', 45.8, 89.6, HALF);
    add('garden-lights', 'string_lights', 69.4, 66.2);
  }

  // ---- Central Park: a round plaza with the grand fountain, lawns, winding walks and a loop,
  // shade trees, flower beds, a gazebo and a picnic lawn under string lights.
  const walks: Walk[] = [];
  const plazas: { cx: number; cz: number; r: number }[] = [];
  {
    const cx = 60.5;
    const cz = 46.75;
    zones.push({ id: 'plaza', name: 'Central Park', type: 'open_area', rect: r(43.5, 77.5, 33.5, 60) });
    plazas.push({ cx, cz, r: 7 });
    add('plaza-fountain', 'big_fountain', cx, cz);
    for (const [i, a] of [0, HALF, PI, -HALF].entries()) {
      // Benches round the fountain, facing it, between the walks.
      const b = a + PI / 4;
      add(`plaza-bench-${i}`, 'bench', cx + Math.sin(b) * 6.6, cz + Math.cos(b) * 6.6, b + PI);
    }
    // Walks out to the avenues, gently winding, and a loop round the park.
    walks.push({ width: 2.4, points: [[cx, cz - 7], [cx - 1.2, cz - 9.5], [cx + 0.6, cz - 11.5], [cx, 33.4]] });
    walks.push({ width: 2.4, points: [[cx, cz + 7], [cx + 1.3, cz + 9.2], [cx - 0.8, cz + 11.3], [cx, 60.1]] });
    walks.push({ width: 2.4, points: [[cx - 7, cz], [cx - 9.8, cz - 1.4], [cx - 13, cz + 0.8], [43.4, cz - 0.5]] });
    walks.push({ width: 2.4, points: [[cx + 7, cz], [cx + 9.8, cz + 1.4], [cx + 13, cz - 0.8], [77.6, cz + 0.5]] });
    const loop: [number, number][] = [];
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * PI * 2; loop.push([cx + Math.cos(a) * 11, cz + Math.sin(a) * 8.6]); }
    walks.push({ width: 1.8, points: loop });
    // Shade trees round the outside of the loop, avoiding the walks.
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) / 16) * PI * 2;
      const kind = i % 4 === 1 ? 'blossom' : i % 4 === 3 ? 'tree' : 'oak';
      add(`park-tree-${i}`, kind, cx + Math.cos(a) * 14.6, cz + Math.sin(a) * 11.4, a);
    }
    // Flower beds and bushes on the lawns inside the loop.
    for (const [i, a] of [PI / 4, (3 * PI) / 4, (5 * PI) / 4, (7 * PI) / 4].entries()) {
      add(`park-bed-${i}`, 'flowers_round', cx + Math.cos(a) * 9.6, cz + Math.sin(a) * 7.4);
      add(`park-bush-${i}`, i % 2 ? 'bush_flower' : 'bush', cx + Math.cos(a) * 12.6, cz + Math.sin(a) * 9.8);
    }
    // Lamps along the loop.
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * PI * 2;
      add(`plaza-lamp-${i}`, 'lamp_post', cx + Math.cos(a) * 12.4, cz + Math.sin(a) * 9.9);
    }
    // A gazebo on the south-east lawn, a picnic lawn under string lights to the north-west.
    add('park-gazebo', 'gazebo', 72.6, 56.2);
    add('park-picnic-a', 'picnic', 46.2, 36.6);
    add('park-picnic-b', 'picnic', 50, 36.6);
    add('park-lights', 'string_lights', 48.1, 35.2);
    add('park-bench-ne', 'bench', 74.5, 36.6, -HALF);
    // Cars and bikes by the park: click one to ride somewhere (the flying car flies).
    add('park-bike-park', 'bike_park', 67, 58.8, 0);
    ['bike_plum', 'bike_red', 'bike_teal', 'kick_scooter', 'bike_gold'].forEach((k, i) => add(`park-bike-${i}`, k, 64.6 + i * 1.2, 58.8, 0));
    add('park-car-park', 'car_park', 50, 57.6, 0);
    ['car_flying', 'car_teal', 'car_orange_super', 'car_blue', 'car_purple_muscle', 'car_silver_coupe'].forEach((k, i) => add(`park-car-${i}`, k, 44.25 + i * 2.3, 57.6, 0));
    add('park-palm-b', 'palm', 75.8, 34.8);
  }

  // ---- along the avenues: lamps, never in a doorway or the middle of a way in
  {
    const ways = paths.filter((p) => Math.min(p.x1 - p.x0, p.z1 - p.z0) < 4);
    const doorways = buildings.flatMap((b) => b.doors.map((d) => {
      const { x0, x1, z0, z1 } = b.rect;
      const h = d.width / 2 + 0.4;
      if (d.side === 'n') return r(x0 + d.at - h, x0 + d.at + h, z0 - 3, z0);
      if (d.side === 's') return r(x0 + d.at - h, x0 + d.at + h, z1, z1 + 3);
      if (d.side === 'w') return r(x0 - 3, x0, z0 + d.at - h, z0 + d.at + h);
      return r(x1, x1 + 3, z0 + d.at - h, z0 + d.at + h);
    }));
    const clear = (x: number, z: number) => ![...ways, ...doorways].some((b) => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3);
    const lamp = (id: string, x: number, z: number) => {
      const at = [x, x - 2.4, x + 2.4].find((t) => clear(t, z));
      if (at !== undefined) add(id, 'lamp_post', at, z);
    };
    for (let x = 8; x < 116; x += 12) {
      if (Math.abs(x - 41.75) < 3 || Math.abs(x - 79.25) < 3) continue;
      if (x === 20) {
        // A pair either side of the HQ's way in, not one in the middle of it.
        add('lamp-n-20', 'lamp_post', 17.6, 29.4);
        add('lamp-n-20b', 'lamp_post', 22.4, 29.4);
      } else lamp(`lamp-n-${x}`, x, 29.4);
      lamp(`lamp-s-${x}`, x, 64.1);
    }
  }

  // ---- the airport, across the boulevard: car parks and bike parks by the road, the terminal
  // with a plane at a stand on each side, then the taxiway and the runway.
  const runway = { x0: 6, x1: 114, z: 180 };
  const taxiZ = 167;
  {
    zones.push({ id: 'airport', name: 'Airport', type: 'open_area', rect: r(2, 118, 101, 188) });
    zones.push({ id: 'terminal', name: 'Airport Terminal', type: 'open_area', rect: r(32.4, 87.6, 109, 154.5) });
    zones.push({ id: 'runway', name: 'Runway', type: 'open_area', rect: r(6, 114, 164.5, 186) });
    add('ap-terminal', 'airport_terminal', 60, 131.75, 0);
    // Planes at their stands, nose to the runway: walk up to one and board it.
    add('ap-plane-airliner', 'plane_airliner', 17.5, 136, 0);
    add('ap-plane-jet', 'plane_jet', 103, 138, 0);
    add('ap-taxiway', 'taxiway', 60, taxiZ, 0);
    add('ap-runway', 'runway', 60, runway.z, 0);
    const lots: [number, string[]][] = [
      [17, ['car_navy', 'car_red', 'car_gold', 'car_white', 'car_black_muscle', 'car_cyber_pickup']],
      [103, ['car_olive_suv', 'car_orange_track', 'car_red_super', 'car_white_track', 'car_yellow_coupe', 'car_flying']],
    ];
    for (const [i, [x, cars]] of lots.entries()) {
      add(`ap-car-park-${i}`, 'car_park', x, 104.8, 0);
      cars.forEach((k, j) => add(`ap-car-${i}-${j}`, k, x - 5.75 + j * 2.3, 104.8, 0));
    }
    const bikes: [number, string[]][] = [
      [33, ['bike_navy', 'moto_cruiser', 'bike_red', 'bike_gold', 'kick_scooter']],
      [87, ['bike_teal', 'bike_plum', 'moto_cruiser', 'bike_red', 'bike_navy']],
    ];
    for (const [i, [x, list]] of bikes.entries()) {
      add(`ap-bike-park-${i}`, 'bike_park', x, 104.2, 0);
      list.forEach((k, j) => add(`ap-bike-${i}-${j}`, k, x - 2.4 + j * 1.2, 104.2, 0));
    }
    // A paved forecourt from the boulevard to the terminal, with planters and benches.
    paths.push(r(40, 80, 101, 109));
    for (const [i, x] of [44, 52, 68, 76].entries()) add(`ap-planter-${i}`, 'planter_box', x, 107.9);
    add('ap-bench-a', 'bench_stone', 56.5, 107.9, PI);
    add('ap-bench-b', 'bench_stone', 63.5, 107.9, PI);
    // Lamps along the boulevard, between the trees.
    for (const x of [13, 25, 37, 49, 61, 73, 85, 97, 109]) add(`ap-lamp-${x}`, 'lamp_post', x, 96.9);
  }

  // ---- trees around the edge of the campus
  {
    let n = 0;
    const kinds = ['oak', 'tree', 'pine', 'tree', 'blossom', 'oak'];
    const tree = (x: number, z: number) => add(`edge-tree-${n}`, kinds[n++ % kinds.length], x, z, n * 1.7);
    for (let x = 4; x <= 116; x += 6) { tree(x, 1.4); if (Math.abs(x - 41.75) > 3 && Math.abs(x - 79.25) > 3) tree(x, 94.6); }
    for (let z = 8; z <= 88; z += 6) {
      if (Math.abs(z - 31.75) < 3 || Math.abs(z - 61.75) < 3) continue;
      tree(1.4, z);
      tree(118.6, z);
    }
    // Round the airport, and along its far side.
    for (let z = 106; z <= 160; z += 6) { tree(1.4, z); tree(118.6, z); }
    for (let x = 4; x <= 116; x += 6) tree(x, 197); // past the runway, clear of the wingtips
    // Hedges along the north side of the HQ grounds.
    add('hq-hedge-a', 'hedge', 34, 27.5, 0);
    add('hq-bush-a', 'bush', 32, 5);
    add('hq-bush-b', 'bush', 36, 9);
    add('hq-tree-a', 'blossom', 35, 17);
  }

  const all = [...objects, ...extra.filter((p) => !objects.some((o) => o.id === p.id))];
  return { width: CAMPUS_W, depth: CAMPUS_D, hq, buildings, zones, paths, water, objects: all, spawn: { x: 60.5, z: 56 }, walks, plazas, airport: { runway, taxiZ } };
}

// ---------------------------------------------------------------- walls, walking, sitting

export const WALL_T = 0.2;

/** Wall pieces of a building (with gaps for its doorways). */
export function wallSegments(b: Building): Rect[] {
  if (b.wall === 'none') return [];
  const { x0, x1, z0, z1 } = b.rect;
  const out: Rect[] = [];
  const side = (s: Side, from: number, to: number, mk: (a: number, c: number) => Rect) => {
    const gaps = b.doors.filter((d) => d.side === s).map((d) => [from + d.at - d.width / 2, from + d.at + d.width / 2]).sort((a, c) => a[0] - c[0]);
    let cur = from;
    for (const [g0, g1] of gaps) {
      if (g0 > cur) out.push(mk(cur, g0));
      cur = Math.max(cur, g1);
    }
    if (cur < to) out.push(mk(cur, to));
  };
  side('n', x0, x1, (a, c) => r(a, c, z0, z0 + WALL_T));
  side('s', x0, x1, (a, c) => r(a, c, z1 - WALL_T, z1));
  side('w', z0, z1, (a, c) => r(x0, x0 + WALL_T, a, c));
  side('e', z0, z1, (a, c) => r(x1 - WALL_T, x1, a, c));
  return out;
}

/** Ellipse water as a few strips, for walking. */
function waterBlocks(w: Water): Rect[] {
  const out: Rect[] = [];
  const strips = 8;
  for (let i = 0; i < strips; i++) {
    const t0 = -1 + (2 * i) / strips;
    const t1 = -1 + (2 * (i + 1)) / strips;
    const half = w.rx * Math.sqrt(Math.max(0, 1 - Math.max(t0 * t0, t1 * t1)));
    const halfMid = w.rx * Math.sqrt(Math.max(0, 1 - ((t0 + t1) / 2) ** 2));
    const hw = Math.max(half, halfMid * 0.92);
    out.push(r(w.cx - hw, w.cx + hw, w.cz + t0 * w.rz, w.cz + t1 * w.rz));
  }
  return out;
}

/** Everything that blocks walking: the HQ's own furniture and walls, building walls, water, pieces. */
export function campusObstacles(c: CampusLayout): Rect[] {
  const at = c.hq;
  const shift = (o: Rect): Rect => (at ? { x0: o.x0 + at.x, x1: o.x1 + at.x, z0: o.z0 + at.z, z1: o.z1 + at.z } : o);
  // The HQ's walls, planters and furniture (its open sides, front and right, stay open).
  const hq = at ? OFFICE_02.obstacles.filter((o) => o.x1 <= 20.2 && o.z1 <= 16.2).map(shift) : [];
  return [
    ...hq,
    ...c.buildings.flatMap(wallSegments),
    ...c.water.flatMap(waterBlocks),
    ...c.objects.flatMap(placedBlocks),
  ];
}

export function campusSeats(c: CampusLayout): Seat[] {
  const at = c.hq;
  const hq = at ? (OFFICE_02.seats ?? []).map((s) => ({ ...s, id: `hq-${s.id}`, x: s.x + at.x, z: s.z + at.z })) : [];
  // A seat is as high as its chair plus what the chair stands on (a floor, a rug, a stage).
  const ground = groundOf(c.buildings, c.objects);
  return [...hq, ...c.objects.flatMap((p) => {
    const base = ground.base(p);
    return placedSeats(p).map((s) => (base ? { ...s, y: +(s.y + base).toFixed(3) } : s));
  })];
}

/** The most specific zone at a point (smallest area wins: a stage inside a hall). */
export function zoneAt(zones: Zone[], x: number, z: number): Zone | null {
  let best: Zone | null = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    const { x0, x1, z0, z1 } = zone.rect;
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    const area = (x1 - x0) * (z1 - z0);
    if (area < bestArea) { best = zone; bestArea = area; }
  }
  return best;
}

/** The Hub wing a point is in (null outside every wing, or in a world without wings). */
export function wingAt(c: Pick<CampusLayout, 'wings'>, x: number, z: number): Wing | null {
  return c.wings?.find((w) => x >= w.rect.x0 && x <= w.rect.x1 && z >= w.rect.z0 && z <= w.rect.z1) ?? null;
}

/** The doorway a point stands in, if any. */
export function portalAt(c: Pick<CampusLayout, 'portals'>, x: number, z: number): Portal | null {
  return c.portals?.find((p) => x >= p.rect.x0 && x <= p.rect.x1 && z >= p.rect.z0 && z <= p.rect.z1) ?? null;
}
