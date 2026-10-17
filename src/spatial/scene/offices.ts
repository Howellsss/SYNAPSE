/**
 * Built 3D offices (Blender → GLB) that a space can use instead of the open floor.
 * Each layout is in the same metres as the floor and the network: x from 0 to width, z from 0
 * to depth, y up, with the back walls along x = 0 and z = 0 (the camera looks from +x/+z).
 * `obstacles` are furniture and wall footprints from the Blender scene, used for walking.
 */
import type { Floor } from './floor';
import type { Seat } from './seats';
import type { CampusLayout } from './campus/layout';

export interface Rect { x0: number; x1: number; z0: number; z1: number }

export type OfficeId = 'office-01' | 'office-02' | 'campus-01' | 'hub-01';

export interface OfficeLayout {
  id: OfficeId;
  name: string;
  /** Static file under public/. */
  url: string;
  floor: Floor;
  obstacles: Rect[];
  /** Where people appear (an open spot, kept clear of furniture). */
  spawn: { x: number; z: number };
  /** One line for the office picker. */
  blurb: string;
  /** A picture of the office from the space's own camera, for workspace cards. */
  picture: string;
  /**
   * Direction the sunlight comes from (towards the sun, y up). Offices with lighting baked into
   * their floor set it so live shadows (people) fall the same way as the baked ones.
   */
  sun?: { x: number; y: number; z: number };
  /** Chairs, sofa places and armchairs people can sit in (tap one to walk over and sit). */
  seats?: Seat[];
  /** Standing in front of the office door (on the left wall) opens the way to other spaces. */
  door?: { x: number; z: number };
  /**
   * A large world built from the kit around this office (SYNAPSE Campus). Its obstacles and seats
   * come from the layout (campusObstacles / campusSeats), filled in for each workspace.
   */
  campus?: CampusLayout;
}

const r = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });
const st = (id: string, x: number, z: number, rot: number, y: number, kind: Seat['kind'] = 'chair'): Seat => ({ id, x, z, rot, y, kind });

/** SYNAPSE Office 01: work area, glass meeting room, lounge and café (Blender project "SYNAPSE Office 01", revision 4). */
export const OFFICE_01: OfficeLayout = {
  id: 'office-01',
  name: 'SYNAPSE Office 01',
  url: '/assets/spatial/offices/office-01.glb',
  picture: '/assets/spatial/offices/office-01.jpg',
  floor: { width: 20, depth: 16 },
  spawn: { x: 10, z: 8 },
  door: { x: 0.75, z: 7.6 },
  blurb: 'A furnished 20 × 16 m office: work area, glass meeting room, lounge and café. You walk around the furniture.',
  obstacles: [
    // Walls (back z = 0, side x = 0) and the meeting room's glass walls (door gap x 5.64–6.95).
    r(0, 20, 0, 0.2), r(0, 0.2, 0, 16),
    r(6.95, 7.05, 0.2, 6.55), r(0.16, 5.64, 6.45, 6.55),
    // Planters along the open edges.
    r(0.2, 8.6, 15.45, 15.95), r(11.4, 19.95, 15.45, 15.95), r(19.45, 19.95, 7.4, 15.4), r(19.45, 19.95, 0.2, 1),
    // Plants.
    r(18.41, 19.43, 5.9, 6.73), r(10.56, 11.38, 0.43, 1.09), r(6.01, 6.83, 0.43, 1.09), r(6.87, 7.98, 14.17, 15.06),
    r(0.36, 1.18, 9.23, 9.89), r(18.43, 19.41, 8.92, 9.71), r(0.38, 0.72, 6.38, 6.72), r(10.03, 10.37, 0.53, 0.87), r(19.13, 19.47, 0.58, 0.92),
    // Work area: six desks with chairs and the divider.
    r(12.35, 17.85, 2.01, 4.84),
    // Meeting room: table and chairs, wall screen.
    r(1.48, 5.15, 2.18, 4.62), r(2.4, 4.8, 0.2, 0.29),
    // Lounge.
    r(0.69, 1.6, 10.2, 12.6), r(5.01, 6.2, 9.68, 10.93), r(5.01, 6.2, 11.87, 13.12), r(2.6, 3.8, 10.8, 12),
    r(0.53, 0.97, 13.18, 13.62), r(0.23, 0.61, 13.8, 15.8),
    // Coffee counter.
    r(7.55, 10.25, 0.2, 0.9),
    // Café tables and chairs.
    r(12.46, 14.49, 10.54, 12.74), r(15.66, 17.69, 12.14, 14.34),
  ],
};

/**
 * SYNAPSE Office 02: the realistic office. Oak floor, carpeted work, meeting and café areas, a
 * gold-ringed centre circle, on a dark plinth with shrub planters; soft overhead light and contact
 * shadows are baked into the floor in Blender
 * (Cycles). Blender project "SYNAPSE Office 01", revision 17. Every chair is its own footprint and
 * a seat people can sit in.
 */
export const OFFICE_02: OfficeLayout = {
  id: 'office-02',
  name: 'SYNAPSE Office 02',
  // ?v= changes with every new export, so browsers never show an old copy.
  url: '/assets/spatial/offices/office-02.glb?v=17',
  picture: '/assets/spatial/offices/office-02.jpg?v=17',
  floor: { width: 20, depth: 16 },
  spawn: { x: 10, z: 8 },
  door: { x: 0.75, z: 7.6 },
  blurb: 'Realistic lighting. A furnished 20 × 16 m office: six-desk work area, glass meeting room, lounge, coffee bar and café. Tap a chair or the sofa to sit.',
  sun: { x: 0.3491, y: 0.8479, z: 0.399 },
  seats: [
    // Work area: row facing the back wall, then the row facing the front.
    st('desk-1', 13.295, 2.28, 0.03, 0.48), st('desk-2', 15.142, 2.28, -0.017, 0.48), st('desk-3', 16.901, 2.28, 0.044, 0.48),
    st('desk-4', 13.268, 4.57, -3.135, 0.48), st('desk-5', 15.113, 4.57, -2.995, 0.48), st('desk-6', 16.859, 4.57, 3.043, 0.48),
    // Meeting room.
    st('meet-1', 2.592, 2.42, 0.135, 0.48), st('meet-2', 3.609, 2.42, -0.023, 0.48), st('meet-3', 4.619, 2.42, -0.017, 0.48),
    st('meet-4', 2.589, 4.38, 3.017, 0.48), st('meet-5', 3.603, 4.38, 3.031, 0.48), st('meet-6', 4.622, 4.38, 3.128, 0.48),
    st('meet-7', 1.6, 3.4, 1.571, 0.48),
    // Lounge: three places on the sofa, two armchairs.
    st('sofa-1', 0.85, 10.75, 1.571, 0.45, 'sofa'), st('sofa-2', 0.85, 11.4, 1.571, 0.45, 'sofa'), st('sofa-3', 0.85, 12.05, 1.571, 0.45, 'sofa'),
    st('armchair-1', 5.55, 10.3, -1.116, 0.42, 'armchair'), st('armchair-2', 5.55, 12.5, -2.026, 0.42, 'armchair'),
    // Café: three chairs round each table.
    st('cafe-1', 13.745, 11.932, -2.641, 0.49), st('cafe-2', 13.777, 10.687, -0.551, 0.49), st('cafe-3', 12.68, 11.277, 1.539, 0.49),
    st('cafe-4', 17.364, 11.448, -2.241, 0.49), st('cafe-5', 16.909, 10.288, -0.151, 0.49), st('cafe-6', 16.128, 11.259, 1.939, 0.49),
    st('cafe-7', 15.794, 13.593, -1.841, 0.49), st('cafe-8', 14.923, 12.702, 0.249, 0.49), st('cafe-9', 14.582, 13.9, 2.339, 0.49),
  ],
  obstacles: [
    // Walls with their window sills, and the meeting room's glass walls (door gap x 5.64–6.95).
    r(0, 20, 0, 0.22), r(10.35, 19.65, 0.2, 0.32), r(0, 0.22, 0, 16), r(0.2, 0.32, 8.95, 13.65),
    r(6.95, 7.05, 0.16, 6.54), r(0.16, 5.64, 6.45, 6.55),
    // Planters along the open edges, and the plants.
    r(0.15, 8.6, 15.4, 16), r(11.4, 20, 15.4, 16), r(19.41, 20, 7.4, 15.4), r(19.44, 20, 0.17, 1.07),
    r(6.24, 6.94, 0.17, 1.42), r(0.43, 1.47, 8.79, 9.97), r(7.14, 7.72, 14.4, 14.96), r(18.43, 19.39, 0.29, 1.42),
    r(18.67, 19.28, 6.02, 6.58), r(10.36, 11.34, 0.21, 1.4),
    // Work area: two rows of three desks with the divider, a chair at each, and the credenza.
    r(12.4, 17.8, 2.53, 4.32),
    r(12.99, 13.62, 1.93, 2.59), r(14.84, 15.47, 1.93, 2.59), r(16.59, 17.23, 1.93, 2.59),
    r(12.94, 13.57, 4.26, 4.91), r(14.79, 15.44, 4.27, 4.94), r(16.53, 17.17, 4.25, 4.93),
    r(14.2, 16, 0.33, 0.77),
    // Meeting room: table, seven chairs, credenza under the screen.
    r(1.95, 5.25, 2.83, 3.98),
    r(2.27, 2.92, 2.05, 2.72), r(3.3, 3.94, 2.07, 2.73), r(4.31, 4.95, 2.07, 2.73),
    r(2.26, 2.91, 4.06, 4.75), r(3.28, 3.92, 4.06, 4.74), r(4.3, 4.93, 4.07, 4.73), r(1.26, 1.91, 3.07, 3.71),
    r(2.35, 4.85, 0.21, 0.72),
    // Lounge: sofa, side table, arc lamp, coffee table, two armchairs, bookshelf.
    r(0.29, 1.21, 10.15, 12.65), r(0.41, 0.89, 12.91, 13.39), r(1.8, 2.41, 9.6, 10.08), r(2.68, 3.92, 10.78, 12.02),
    r(5.02, 6.14, 9.77, 10.87), r(5.02, 6.14, 11.93, 13.03), r(0.24, 0.6, 13.8, 15.8),
    // Coffee bar.
    r(7.45, 10.25, 0.19, 0.91),
    // Café: three tables, three chairs each.
    r(12.98, 13.82, 10.88, 11.72), r(16.38, 17.22, 10.58, 11.42), r(14.68, 15.52, 12.98, 13.82),
    r(13.54, 14, 11.72, 12.19), r(13.57, 14.04, 10.42, 10.9), r(12.47, 12.89, 11.07, 11.49),
    r(17.16, 17.63, 11.24, 11.72), r(16.7, 17.12, 10.06, 10.5), r(15.88, 16.34, 11.05, 11.5),
    r(15.58, 16.03, 13.38, 13.83), r(14.69, 15.13, 12.46, 12.91), r(14.31, 14.79, 13.69, 14.17),
  ],
};

/**
 * SYNAPSE Campus: a 120 × 190 m world in one workspace. The headquarters (Office 02 as built) plus
 * an all-hands hall, café and lounge, team areas, glass meeting rooms, focus booths, a garden with
 * a pond, a game room and a library around a central plaza. Built from the Office 02 kit
 * (campus/layout.ts); its layout, obstacles and seats are filled in per workspace (campusOffice).
 */
export const CAMPUS_01: OfficeLayout = {
  id: 'campus-01',
  name: 'SYNAPSE Campus',
  url: OFFICE_02.url,
  picture: '/assets/spatial/offices/campus-01.jpg',
  floor: { width: 120, depth: 190 },
  spawn: { x: 60.5, z: 56 },
  blurb: 'A whole campus in one workspace (120 × 190 m): headquarters, all-hands hall, café and lounge, team areas, meeting rooms, focus booths, garden, game room, library, and an airport with planes, cars and bikes. Room for 50+ people; you can add furniture.',
  sun: OFFICE_02.sun,
  obstacles: [],
  seats: [],
};

export const HUB_01: OfficeLayout = {
  id: 'hub-01',
  name: 'SYNAPSE Hub',
  url: OFFICE_02.url,
  picture: '/assets/spatial/offices/hub-01.jpg',
  floor: { width: 290, depth: 134 },
  spawn: { x: 36, z: 51 },
  blurb: 'Arrive in a garden courtyard with doorways all round it. Each doorway opens into its own place: auditorium, conference center, work studio, café & bar, lounge & library, garden terrace. You can add furniture.',
  sun: OFFICE_02.sun,
  obstacles: [],
  seats: [],
};

export const OFFICES: Record<OfficeId, OfficeLayout> = { 'hub-01': HUB_01, 'campus-01': CAMPUS_01, 'office-02': OFFICE_02, 'office-01': OFFICE_01 };

/** The office a space uses (space.config.scene), or null for the open floor. */
export function officeFor(id: string | null | undefined): OfficeLayout | null {
  return id && id in OFFICES ? OFFICES[id as OfficeId] : null;
}
