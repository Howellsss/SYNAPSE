/**
 * SYNAPSE Hub: one workspace made of separate places. You arrive in a walled courtyard (lawns,
 * shade trees, a fountain, lamps) with doorways all round it; each doorway takes you into its own
 * place, drawn on its own: an auditorium, a conference center, a work studio, a café and bar, a
 * lounge and library, and a garden terrace. Each place has a doorway back to the courtyard.
 *
 * Like the campus, this is pure data. The places sit far apart in one coordinate space (so the
 * network, walking and proximity work as everywhere else); the renderer shows only the place
 * you're in, and a doorway moves you straight to the other side.
 */
import type { Rect } from '../offices';
import type { Placed } from './kit';
import type { Building, CampusLayout, Portal, Side, Walk, Water, Wing, Zone } from './layout';

export const HUB_W = 290;
export const HUB_D = 134;

const PI = Math.PI;
const HALF = PI / 2;

interface Place { id: string; name: string; at: [number, number]; size: [number, number]; outdoor: boolean }

/** Where each place sits in the hub's coordinates (30 m apart, so they never show together). */
const PLACES: Place[] = [
  { id: 'court', name: 'Courtyard', at: [4, 4], size: [64, 52], outdoor: true },
  { id: 'auditorium', name: 'Auditorium', at: [100, 4], size: [44, 36], outdoor: false },
  { id: 'conference', name: 'Conference Center', at: [176, 4], size: [38, 34], outdoor: false },
  { id: 'terrace', name: 'Garden Terrace', at: [244, 4], size: [42, 40], outdoor: true },
  { id: 'studio', name: 'Work Studio', at: [4, 90], size: [48, 40], outdoor: false },
  { id: 'cafe', name: 'Café & Bar', at: [84, 90], size: [42, 34], outdoor: false },
  { id: 'lounge', name: 'Lounge & Library', at: [158, 90], size: [40, 34], outdoor: false },
];
const placeOf = (id: string) => PLACES.find((p) => p.id === id)!;

/**
 * The doorways between the courtyard and each place: where the door is on the courtyard's wall,
 * and where it is on the place's wall (side, and how far along it).
 */
const DOORS: { to: string; court: { side: Side; at: number }; place: { side: Side; at: number } }[] = [
  { to: 'auditorium', court: { side: 'n', at: 32 }, place: { side: 's', at: 22 } },
  { to: 'cafe', court: { side: 'n', at: 11 }, place: { side: 's', at: 21 } },
  { to: 'lounge', court: { side: 'n', at: 53 }, place: { side: 's', at: 20 } },
  { to: 'conference', court: { side: 'w', at: 26 }, place: { side: 's', at: 19 } },
  { to: 'studio', court: { side: 'e', at: 26 }, place: { side: 'n', at: 24 } },
  { to: 'terrace', court: { side: 's', at: 53 }, place: { side: 'n', at: 21 } },
];
const DOOR_W = 3;

export function buildHub(): CampusLayout {
  const objects: Placed[] = [];
  const buildings: Building[] = [];
  const zones: Zone[] = [];
  const paths: Rect[] = [];
  const water: Water[] = [];
  const walks: Walk[] = [];
  const plazas: { cx: number; cz: number; r: number }[] = [];
  const portals: Portal[] = [];
  const wings: Wing[] = PLACES.map((p) => ({ id: p.id, name: p.name, outdoor: p.outdoor, rect: { x0: p.at[0], x1: p.at[0] + p.size[0], z0: p.at[1], z1: p.at[1] + p.size[1] } }));

  /** Tools for one place, in its own coordinates (0, 0 = its north-west corner). */
  const inPlace = (id: string) => {
    const p = placeOf(id);
    const [ox, oz] = p.at;
    const R = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: ox + x0, x1: ox + x1, z0: oz + z0, z1: oz + z1 });
    return {
      R,
      add: (key: string, kind: string, x: number, z: number, rot = 0) => objects.push({ id: `${id}-${key}`, kind, x: +(ox + x).toFixed(3), z: +(oz + z).toFixed(3), rot }),
      zone: (key: string, name: string, type: Zone['type'], rect: Rect, lockable = false) => zones.push({ id: key ? `${id}-${key}` : id, name, type, rect, lockable }),
      building: (key: string, b: Omit<Building, 'id' | 'rect'> & { rect: Rect }) => buildings.push({ id: `${id}-${key}`, ...b }),
      path: (x0: number, x1: number, z0: number, z1: number) => paths.push(R(x0, x1, z0, z1)),
      pt: (x: number, z: number): [number, number] => [ox + x, oz + z],
      size: p.size,
    };
  };

  /** A point just inside a wall's doorway (local), and the way you face coming in. */
  const doorPoint = (size: [number, number], side: Side, at: number, inset: number): { x: number; z: number; rot: number } => {
    const [w, d] = size;
    if (side === 'n') return { x: at, z: inset, rot: 0 };
    if (side === 's') return { x: at, z: d - inset, rot: PI };
    if (side === 'w') return { x: inset, z: at, rot: HALF };
    return { x: w - inset, z: at, rot: -HALF };
  };
  /** The doorway's trigger: the gap in the wall and a step either side of it (local). */
  const doorRect = (size: [number, number], side: Side, at: number): [number, number, number, number] => {
    const [w, d] = size;
    const h = DOOR_W / 2;
    if (side === 'n') return [at - h, at + h, -1.2, 0.55];
    if (side === 's') return [at - h, at + h, d - 0.55, d + 1.2];
    if (side === 'w') return [-1.2, 0.55, at - h, at + h];
    return [w - 0.55, w + 1.2, at - h, at + h];
  };
  const placeDoorway = (id: string, side: Side, at: number) => {
    const P = inPlace(id);
    const [w, d] = P.size;
    const pos = side === 'n' ? [at, 0.1] : side === 's' ? [at, d - 0.1] : side === 'w' ? [0.1, at] : [w - 0.1, at];
    P.add(`door-${side}-${at}`, 'doorway', pos[0], pos[1], side === 'n' || side === 's' ? 0 : HALF);
  };

  // Every place has walls round it, with its doorways.
  const doorsOn = (id: string) => (id === 'court'
    ? DOORS.map((d) => ({ side: d.court.side, at: d.court.at, width: DOOR_W }))
    : DOORS.filter((d) => d.to === id).map((d) => ({ side: d.place.side, at: d.place.at, width: DOOR_W })));

  for (const d of DOORS) {
    const court = placeOf('court');
    const place = placeOf(d.to);
    const fromCourt = doorRect(court.size, d.court.side, d.court.at);
    const intoPlace = doorPoint(place.size, d.place.side, d.place.at, 4.5);
    const fromPlace = doorRect(place.size, d.place.side, d.place.at);
    const intoCourt = doorPoint(court.size, d.court.side, d.court.at, 4);
    portals.push({
      id: `to-${d.to}`, label: `→ ${place.name}`,
      rect: { x0: court.at[0] + fromCourt[0], x1: court.at[0] + fromCourt[1], z0: court.at[1] + fromCourt[2], z1: court.at[1] + fromCourt[3] },
      to: { x: place.at[0] + intoPlace.x, z: place.at[1] + intoPlace.z, rot: intoPlace.rot },
    });
    portals.push({
      id: `from-${d.to}`, label: '→ Courtyard',
      rect: { x0: place.at[0] + fromPlace[0], x1: place.at[0] + fromPlace[1], z0: place.at[1] + fromPlace[2], z1: place.at[1] + fromPlace[3] },
      to: { x: court.at[0] + intoCourt.x, z: court.at[1] + intoCourt.z, rot: intoCourt.rot },
    });
    placeDoorway('court', d.court.side, d.court.at);
    placeDoorway(d.to, d.place.side, d.place.at);
  }

  // ---------------------------------------------------------------- the courtyard
  {
    const C = inPlace('court');
    const [w, d] = C.size;
    C.building('walls', { rect: C.R(0, w, 0, d), wall: 'solid', height: 2.6, doors: doorsOn('court') });
    C.zone('', 'Courtyard', 'open_area', C.R(0, w, 0, d));
    // Paved avenues from every door to a round plaza with the fountain.
    C.path(29.5, 34.5, 0.2, 18);
    C.path(29.5, 34.5, 34, d - 0.2);
    C.path(0.2, 24, 23.5, 28.5);
    C.path(40, w - 0.2, 23.5, 28.5);
    plazas.push({ cx: C.pt(32, 26)[0], cz: C.pt(32, 26)[1], r: 8.5 });
    C.add('fountain', 'big_fountain', 32, 26);
    for (const [i, a] of [PI / 4, (3 * PI) / 4, (5 * PI) / 4, (7 * PI) / 4].entries()) {
      C.add(`bench-${i}`, 'bench', 32 + Math.sin(a) * 6.3, 26 + Math.cos(a) * 6.3, a + PI);
    }
    // Garden walks to the corner doors.
    walks.push({ width: 2.2, points: [C.pt(11, 0.4), C.pt(12.5, 6), C.pt(17, 12), C.pt(25.5, 20.5)] });
    walks.push({ width: 2.2, points: [C.pt(53, 0.4), C.pt(51.5, 6), C.pt(47, 12), C.pt(38.5, 20.5)] });
    walks.push({ width: 2.2, points: [C.pt(53, d - 0.4), C.pt(51.5, d - 6), C.pt(46, d - 13), C.pt(38.5, 31.5)] });
    // Shade trees, blossom, palms, flower beds, bushes, lamps.
    const trees: [string, number, number][] = [
      ['oak', 5, 9], ['blossom', 22, 5], ['tree', 4, 18], ['oak', 20, 16.5],
      ['oak', 59, 9], ['blossom', 42, 5], ['tree', 60, 18], ['oak', 44, 16.5],
      ['palm', 4, 33], ['oak', 12, 37], ['blossom', 22, 44], ['palm', 4, 47],
      ['palm', 60, 33], ['tree', 58, 40], ['blossom', 42, 46], ['palm', 60, 48],
    ];
    trees.forEach(([k, x, z], i) => C.add(`tree-${i}`, k, x, z, i * 1.3));
    ([[14, 20.5], [50, 20.5], [14, 31.5], [50, 31.5]] as const).forEach(([x, z], i) => C.add(`bed-${i}`, 'flowers_round', x, z));
    ([[8, 3.2], [16, 3.2], [48, 3.2], [56, 3.2], [3.2, 13], [60.8, 13], [3.2, 39], [60.8, 39]] as const)
      .forEach(([x, z], i) => C.add(`bush-${i}`, i % 2 ? 'bush_flower' : 'bush', x, z));
    // Lamps: one behind each bench round the fountain, a pair along each avenue, and one at the
    // edge of each side avenue (not in the middle of it).
    const behind = [PI / 4, (3 * PI) / 4, (5 * PI) / 4, (7 * PI) / 4].map((a): [number, number] => [32 + Math.sin(a) * 7.6, 26 + Math.cos(a) * 7.6]);
    ([...behind, [27, 8], [37, 8], [27, 44], [37, 44], [8, 22.6], [56, 22.6]] as const)
      .forEach(([x, z], i) => C.add(`lamp-${i}`, 'lamp_post', x, z));
    // A picnic lawn under string lights (south-west) and a gazebo (south-east).
    C.add('picnic-a', 'picnic', 13, 41);
    C.add('picnic-b', 'picnic', 19, 41);
    C.add('lights', 'string_lights', 16, 38.6);
    C.add('gazebo', 'gazebo', 46, 39);
    C.add('lights-b', 'string_lights', 32, 12.5);
    // By the entrance: a car park and a bike park. Walk to one, get in, and drive (or fly) to work.
    C.add('car-park', 'car_park', 13.7, 47.2, 0);
    ['car_flying', 'car_navy', 'car_red_super', 'car_yellow_coupe', 'car_white', 'car_olive_suv'].forEach((k, i) => C.add(`car-${i}`, k, 7.95 + i * 2.3, 47.2, 0));
    C.add('bike-park', 'bike_park', 43, 48.2, 0);
    ['bike_red', 'bike_teal', 'bike_gold', 'bike_navy', 'moto_cruiser'].forEach((k, i) => C.add(`bike-${i}`, k, 40.6 + i * 1.2, 48.2, 0));
  }

  // ---------------------------------------------------------------- the auditorium
  {
    const A = inPlace('auditorium');
    const [w, d] = A.size;
    A.building('hall', { rect: A.R(0, w, 0, d), floor: 'carpet_navy', wall: 'solid', height: 2.2, doors: doorsOn('auditorium') });
    A.building('stage-floor', { rect: A.R(13, 31, 0.3, 9.5), floor: 'walnut', wall: 'none', doors: [] });
    A.zone('', 'Auditorium', 'open_area', A.R(0, w, 0, d));
    A.zone('stage', 'Stage', 'stage', A.R(14, 30, 4, 9));
    A.add('stage', 'stage_large', 22, 6.5);
    A.add('led', 'led_wall', 22, 1.9);
    A.add('truss', 'truss', 22, 4.4);
    A.add('podium', 'podium', 28.5, 6.2, 0);
    for (const [i, x] of [18.6, 21.9, 25.2].entries()) A.add(`panel-${i}`, i === 1 ? 'chair_teal' : 'chair_mustard', x, 6.6, 0);
    // Three blocks of seats facing the stage: red, navy, green.
    for (let row = 0; row < 13; row++) {
      const z = 12.2 + row * 1.12;
      for (let k = 0; k < 7; k++) A.add(`seat-l-${row}-${k}`, 'seat_red', 4.4 + k * 0.7, z, PI);
      for (let k = 0; k < 13; k++) A.add(`seat-c-${row}-${k}`, 'seat_navy', 17.8 + k * 0.7, z, PI);
      for (let k = 0; k < 7; k++) A.add(`seat-r-${row}-${k}`, 'seat_green', 35.4 + k * 0.7, z, PI);
    }
    A.add('tree-a', 'potted_tree', 2, 2);
    A.add('tree-b', 'potted_tree', w - 2, 2);
    A.add('tree-c', 'potted_tree', 2, d - 2);
    A.add('tree-d', 'potted_tree', w - 2, d - 2);
    A.add('plant-a', 'monstera_tall', 12, 1.5);
    A.add('plant-b', 'monstera_tall', 32, 1.5);
  }

  // ---------------------------------------------------------------- the conference center
  {
    const F = inPlace('conference');
    const [w, d] = F.size;
    F.building('floor', { rect: F.R(0, w, 0, d), floor: 'herringbone', wall: 'solid', height: 2.2, doors: doorsOn('conference') });
    F.zone('', 'Conference Center', 'open_area', F.R(0, w, 0, d));
    const rooms: { key: string; name: string; rect: [number, number, number, number]; door: Side; floor: Building['floor']; table: string }[] = [
      { key: 'board', name: 'Boardroom', rect: [1.5, 17, 1.5, 14.5], door: 'e', floor: 'carpet_red', table: 'conf_red' },
      { key: 'a', name: 'Meeting Room A', rect: [21, 36.5, 1.5, 14.5], door: 'w', floor: 'carpet_teal', table: 'conf_teal' },
      { key: 'b', name: 'Meeting Room B', rect: [1.5, 17, 17.5, 29], door: 'e', floor: 'carpet_green', table: 'conf_green' },
      { key: 'c', name: 'Meeting Room C', rect: [21, 36.5, 17.5, 29], door: 'w', floor: 'carpet_navy', table: 'conference' },
    ];
    for (const r of rooms) {
      const [x0, x1, z0, z1] = r.rect;
      const rect = F.R(x0, x1, z0, z1);
      F.building(r.key, { rect, floor: r.floor, wall: 'glass', height: 2.3, doors: [{ side: r.door, at: (z1 - z0) / 2, width: 2.2 }] });
      F.zone(r.key, r.name, 'meeting_room', rect, true);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      F.add(`${r.key}-table`, r.table, cx, cz, HALF);
      // The screen on the wall away from the door, facing the table.
      const screenX = r.door === 'e' ? x0 + 0.35 : x1 - 0.35;
      F.add(`${r.key}-tv`, 'tv_wall', screenX, cz, r.door === 'e' ? HALF : -HALF);
      F.add(`${r.key}-plant`, 'potted_tree', r.door === 'e' ? x1 - 1.2 : x0 + 1.2, z0 + 1.2);
      F.add(`${r.key}-credenza`, 'credenza', cx, z0 + 0.5, 0);
    }
    // A waiting area by the entrance.
    F.add('rug', 'rug_large_navy', 19, 31.2, 0);
    F.add('sofa-a', 'sofa_navy', 12.5, 31.6, HALF);
    F.add('sofa-b', 'sofa_navy', 25.5, 31.6, -HALF);
    F.add('plant-a', 'potted_tree', 2, d - 2);
    F.add('plant-b', 'potted_tree', w - 2, d - 2);
  }

  // ---------------------------------------------------------------- the work studio
  {
    const S = inPlace('studio');
    const [w, d] = S.size;
    S.building('floor', { rect: S.R(0, w, 0, d), floor: 'oak', wall: 'solid', height: 2.2, doors: doorsOn('studio') });
    S.zone('', 'Work Studio', 'open_area', S.R(0, w, 0, d));
    let n = 0;
    for (const [cx, cz] of [[8, 11], [16, 11], [32, 11], [40, 11], [8, 22], [16, 22], [32, 22], [40, 22]] as const) {
      // A pod: three desks each side of a divider.
      for (let k = 0; k < 2; k++) {
        const x = cx + (k - 0.5) * 1.85;
        S.add(`desk-${n}-a${k}`, 'workstation', x, cz - 0.825, 0);
        S.add(`desk-${n}-b${k}`, 'workstation', x, cz + 0.825, PI);
      }
      S.add(`divider-${n}`, 'divider', cx, cz, 0);
      n++;
    }
    // A lounge island in the middle.
    S.add('rug', 'rug_xl_teal', 24, 17, 0);
    S.add('sofa', 'sofa_teal', 24, 15.4, 0);
    S.add('chair-a', 'chair_mustard', 21.6, 18, HALF);
    S.add('chair-b', 'chair_mustard', 26.4, 18, -HALF);
    S.add('table', 'coffee_table', 24, 17.6);
    // Focus booths along the south wall.
    for (let i = 0; i < 4; i++) {
      const x0 = 4 + i * 10.5;
      const rect = S.R(x0, x0 + 7, 31, d - 0.6);
      S.building(`booth-${i}`, { rect, floor: 'carpet_teal', wall: 'glass', height: 2.3, doors: [{ side: 'n', at: 3.5, width: 1.8 }] });
      S.zone(`booth-${i}`, `Focus Booth ${i + 1}`, 'private_office', rect, true);
      S.add(`booth-${i}-desk`, 'workstation', x0 + 3.5, 35.5, PI);
      S.add(`booth-${i}-chair`, 'chair_teal', x0 + 1.4, 37, HALF);
    }
    for (const [i, [x, z]] of ([[2, 2], [w - 2, 2], [2, 28], [w - 2, 28], [24, 27.5]] as const).entries()) S.add(`plant-${i}`, 'potted_tree', x, z);
    S.add('shelf-a', 'bookcase', 9, 0.45, 0);
    S.add('shelf-b', 'bookcase', 39, 0.45, 0);
  }

  // ---------------------------------------------------------------- the café and bar
  {
    const B = inPlace('cafe');
    const [w, d] = B.size;
    B.building('floor', { rect: B.R(0, w, 0, d), floor: 'oak', wall: 'solid', height: 2.2, doors: doorsOn('cafe') });
    B.zone('', 'Café & Bar', 'lounge', B.R(0, w, 0, d));
    B.add('bottles-a', 'bottle_wall', 15.6, 0.45, 0);
    B.add('bottles-b', 'bottle_wall', 26.4, 0.45, 0);
    B.add('bar-a', 'bar_counter', 15.6, 3.2, 0);
    B.add('bar-b', 'bar_counter', 26.4, 3.2, 0);
    for (let i = 0; i < 16; i++) B.add(`stool-${i}`, 'bar_stool', 13.6 + i * 0.95, 4.4, PI);
    // Two dining rooms either side, four tables on a big rug each.
    const sets = ['dining_green', 'dining_mustard', 'dining_navy'];
    let k = 0;
    for (const cx of [9.5, 32.5]) {
      B.add(`rug-${cx}`, 'rug_xl_rust', cx, 14.5, 0);
      for (const dz of [-1.8, 1.8]) for (const dx of [-2, 2]) B.add(`set-${k}`, sets[k++ % 3], cx + dx, 14.5 + dz);
    }
    // Lounge corners by the entrance.
    B.add('rug-c', 'rug_large_navy', 8, 27.6, 0);
    B.add('sofa-a', 'sofa_green', 8, 26, 0);
    B.add('chair-a', 'chair_rust', 5.4, 28.4, HALF);
    B.add('table-a', 'coffee_table', 8, 28);
    B.add('rug-d', 'rug_large_navy', 34, 27.5, 0);
    B.add('sofa-b', 'sofa_rust', 34, 26, 0);
    B.add('chair-b', 'chair_mustard', 36.6, 28.4, -HALF);
    B.add('table-b', 'coffee_table', 34, 28);
    for (const [i, [x, z]] of ([[2, 2], [w - 2, 2], [2, d - 2], [w - 2, d - 2], [21, 14]] as const).entries()) B.add(`plant-${i}`, 'potted_tree', x, z);
  }

  // ---------------------------------------------------------------- the lounge and library
  {
    const L = inPlace('lounge');
    const [w, d] = L.size;
    L.building('floor', { rect: L.R(0, w, 0, d), floor: 'walnut', wall: 'solid', height: 2.2, doors: doorsOn('lounge') });
    L.zone('library', 'Library', 'quiet_zone', L.R(0, 18, 0, d));
    L.zone('lounge', 'Lounge', 'lounge', L.R(18, w, 0, d));
    // Library: books along the walls, reading chairs, a study table.
    for (let i = 0; i < 6; i++) L.add(`books-w-${i}`, 'bookcase', 0.45, 3 + i * 4.6, HALF);
    for (let i = 0; i < 4; i++) L.add(`books-n-${i}`, 'bookcase', 3.5 + i * 3.4, 0.45, 0);
    // A reading room on a big rug: chairs in pairs round low tables, lamps.
    L.add('rug-lib', 'rug_xl_navy', 9.6, 9.5, 0);
    for (const [i, [x, z]] of ([[6.6, 7.4], [12.6, 7.4], [6.6, 11.8], [12.6, 11.8]] as const).entries()) {
      L.add(`read-${i}a`, i % 2 ? 'chair_rust' : 'chair_teal', x - 1.1, z, HALF);
      L.add(`read-${i}b`, i % 2 ? 'chair_teal' : 'chair_rust', x + 1.1, z, -HALF);
      L.add(`read-${i}t`, 'side_table', x, z);
    }
    L.add('lib-lamp-a', 'arc_lamp', 14.6, 6, -HALF);
    L.add('lib-lamp-b', 'arc_lamp', 4.6, 13.4, HALF);
    // Free-standing shelves and study tables.
    for (const [i, z] of [17, 23.5].entries()) for (const [k, x] of [5, 9.6, 14.2].entries()) L.add(`stack-${i}-${k}`, 'bookcase', x, z, 0);
    L.add('study', 'dining_navy', 6.5, 20.4);
    L.add('study-b', 'dining_navy', 12.5, 20.4);
    L.add('study-c', 'dining_mustard', 6.5, 27.6);
    L.add('study-d', 'dining_mustard', 12.5, 27.6);
    // Lounge: a fireplace with sofas round a rug.
    L.add('fire', 'fireplace', 29, 0.7, 0);
    L.add('rug-lounge', 'rug_xl_rust', 29, 6.4, 0);
    L.add('sofa-a', 'sofa_rust', 29, 9.2, PI);
    L.add('chair-a', 'chair_mustard', 25.4, 5.8, HALF);
    L.add('chair-b', 'chair_mustard', 32.6, 5.8, -HALF);
    L.add('coffee', 'coffee_table', 29, 6.2);
    // Games.
    L.add('pingpong', 'ping_pong', 24, 21, HALF);
    L.add('pool', 'pool_table', 33, 18.5, 0);
    L.add('arcade-a', 'arcade', w - 0.6, 24, -HALF);
    L.add('arcade-b', 'arcade', w - 0.6, 26, -HALF);
    L.add('rug-games', 'rug_xl_teal', 29, 23, 0);
    L.add('sofa-games', 'sofa_teal', 24.2, 28.4, 0);
    L.add('beanbag-a', 'beanbag', 33, 26);
    L.add('beanbag-b', 'beanbag', 35, 28);
    for (const [i, [x, z]] of ([[19.5, 2], [w - 2, 2], [w - 2, d - 2], [17, d - 2]] as const).entries()) L.add(`plant-${i}`, 'potted_tree', x, z);
  }

  // ---------------------------------------------------------------- the garden terrace
  {
    const T = inPlace('terrace');
    const [w, d] = T.size;
    T.building('walls', { rect: T.R(0, w, 0, d), wall: 'solid', height: 1.1, doors: doorsOn('terrace') });
    T.building('deck', { rect: T.R(4, 38, 23, 37), floor: 'deck', wall: 'none', doors: [] });
    T.zone('', 'Garden Terrace', 'open_area', T.R(0, w, 0, d));
    T.path(19.5, 22.5, 0.3, 6);
    const [pcx, pcz] = T.pt(21, 13.5);
    water.push({ id: 'terrace-pond', cx: pcx, cz: pcz, rx: 8, rz: 4.6 });
    T.add('lilies-a', 'lilies', 17.5, 12.6);
    T.add('lilies-b', 'lilies', 24.5, 14.6);
    for (const [i, [x, z]] of ([[12.6, 11.6], [12.8, 15.6], [29.4, 11.4], [29.2, 15.4]] as const).entries()) T.add(`reeds-${i}`, 'reeds', x, z);
    walks.push({ width: 1.8, points: [T.pt(21, 6), T.pt(13, 7.6), T.pt(9.6, 13.5), T.pt(12, 19.5), T.pt(21, 21.5), T.pt(30, 19.5), T.pt(32.4, 13.5), T.pt(29, 7.6), T.pt(21, 6)] });
    // The deck: umbrella tables, a pergola, string lights.
    T.add('umb-a', 'umbrella_teal', 8.5, 27);
    T.add('umb-b', 'umbrella_gold', 14.5, 33);
    T.add('umb-c', 'umbrella_navy', 27.5, 33);
    T.add('umb-d', 'umbrella_teal', 33.5, 27);
    T.add('pergola', 'pergola', 21, 29.5, 0);
    T.add('lights-a', 'string_lights', 21, 24.2, 0);
    T.add('lights-b', 'string_lights', 21, 36, 0);
    // Round the pond: trees, flowers, a fire pit with chairs, a gazebo.
    for (const [i, [k, x, z]] of ([['palm', 2.5, 2.5], ['palm', w - 2.5, 2.5], ['palm', 2.5, d - 2.5], ['palm', w - 2.5, d - 2.5], ['oak', 5, 10], ['blossom', 6, 18], ['oak', 37, 10], ['blossom', 36, 18]] as const).entries()) T.add(`tree-${i}`, k, x, z, i);
    T.add('fire', 'fire_pit', 9, 4.5);
    T.add('fire-chair-a', 'chair_rust', 6.8, 4.5, HALF);
    T.add('fire-chair-b', 'chair_mustard', 11.2, 4.5, -HALF);
    T.add('gazebo', 'gazebo', 33, 4.6);
    T.add('bed-a', 'flowers_round', 14, 21.2);
    T.add('bed-b', 'flowers_round', 28, 21.2);
    T.add('bush-a', 'bush_flower', 2.2, 12);
    T.add('bush-b', 'bush_flower', w - 2.2, 12);
    T.add('lamp-a', 'lamp_post', 17.5, 5);
    T.add('lamp-b', 'lamp_post', 24.5, 5);
  }

  const court = placeOf('court');
  return {
    width: HUB_W, depth: HUB_D, hq: null, buildings, zones, paths, water, objects,
    spawn: { x: court.at[0] + 32, z: court.at[1] + 47 },
    walks, plazas, wings, portals,
  };
}
