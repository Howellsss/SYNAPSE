/**
 * Built 3D offices (Blender → GLB) that a space can use instead of the open floor.
 * Each layout is in the same metres as the floor and the network: x from 0 to width, z from 0
 * to depth, y up, with the back walls along x = 0 and z = 0 (the camera looks from +x/+z).
 * `obstacles` are furniture and wall footprints from the Blender scene, used for walking.
 */
import type { Floor } from './floor';

export interface Rect { x0: number; x1: number; z0: number; z1: number }

export type OfficeId = 'office-01';

export interface OfficeLayout {
  id: OfficeId;
  name: string;
  /** Static file under public/. */
  url: string;
  floor: Floor;
  obstacles: Rect[];
  /** Where people appear (an open spot, kept clear of furniture). */
  spawn: { x: number; z: number };
}

const r = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });

/** SYNAPSE Office 01: work area, glass meeting room, lounge and café (Blender project "SYNAPSE Office 01", revision 4). */
export const OFFICE_01: OfficeLayout = {
  id: 'office-01',
  name: 'SYNAPSE Office 01',
  url: '/assets/spatial/offices/office-01.glb',
  floor: { width: 20, depth: 16 },
  spawn: { x: 10, z: 8 },
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

export const OFFICES: Record<OfficeId, OfficeLayout> = { 'office-01': OFFICE_01 };

/** The office a space uses (space.config.scene), or null for the open floor. */
export function officeFor(id: string | null | undefined): OfficeLayout | null {
  return id && id in OFFICES ? OFFICES[id as OfficeId] : null;
}
