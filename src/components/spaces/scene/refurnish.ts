/**
 * The built offices (Office 01, Office 02, the Campus HQ) refurnished with the prop models: their
 * old chairs, desks and screens, tables, sofa, armchairs, lamps and potted plants are taken out of
 * the office file and models put in the same places, facing the same way. Walls, floors, shelves,
 * counters and planters stay as built, so the footprints people walk round and the seats they sit
 * in are unchanged.
 */
import * as THREE from 'three';
import type { ModelPart } from '@/spatial/scene/campus/kit';
import { PROP_DIMS, type PropId } from '@/spatial/scene/campus/props';
import { loadItemParts } from './propModels';

interface Box { obj: THREE.Object3D; name: string; x: number; z: number; w: number; d: number; h: number }

const facing = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(to.x - from.x, to.z - from.z);
const nearest = (list: Box[], at: { x: number; z: number }) =>
  list.reduce<Box | null>((best, b) => (!best || Math.hypot(b.x - at.x, b.z - at.z) < Math.hypot(best.x - at.x, best.z - at.z) ? b : best), null);

const PLANTS: PropId[] = ['plant_monstera', 'plant_fiddle_leaf', 'plant_bird_of_paradise', 'plant_olive', 'plant_palm'];

/**
 * Take the old furniture out of an office scene (call before its meshes are merged) and return a
 * group the models appear in once they've loaded (in the office's own coordinates).
 */
export function refurnish(scene: THREE.Object3D): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'refurnished';
  const boxes: Box[] = [];
  const box3 = new THREE.Box3();
  for (const obj of scene.children) {
    if (!obj.name) continue;
    box3.setFromObject(obj);
    if (box3.isEmpty()) continue;
    boxes.push({
      obj, name: obj.name,
      x: (box3.min.x + box3.max.x) / 2, z: (box3.min.z + box3.max.z) / 2,
      w: box3.max.x - box3.min.x, d: box3.max.z - box3.min.z, h: box3.max.y - box3.min.y,
    });
  }
  const named = (re: RegExp) => boxes.filter((b) => re.test(b.name));
  const desks = named(/^FURN_desk_/);
  const deskChairs = named(/^FURN_chair_/);
  const meetTable = named(/^FURN_meet_table$/)[0];
  const cafeTables = named(/^FURN_cafe_table_/);
  const coffee = named(/^FURN_coffee_table$/)[0];
  const lounge = coffee ?? { x: 4, z: 11 };
  const parts: ModelPart[] = [];
  const gone: Box[] = [];
  const put = (b: Box, ...p: ModelPart[]) => { parts.push(...p); gone.push(b); };

  for (const b of deskChairs) {
    const desk = nearest(desks, b);
    put(b, { id: 'chair_office_ergonomic', x: b.x, z: b.z, rot: desk ? facing(b, desk) : 0, s: 0.85 });
  }
  for (const b of desks) {
    // The desk faces the way its person does; the screen faces them.
    const chair = nearest(deskChairs, b);
    const rot = chair ? facing(chair, b) : 0;
    const s = Math.max(b.w, b.d) / PROP_DIMS.desk_glass.w;
    const top = PROP_DIMS.desk_glass.h * s;
    put(b,
      { id: 'desk_glass', x: b.x, z: b.z, rot, s },
      { id: 'computer_retro', x: b.x + Math.sin(rot) * 0.08, z: b.z + Math.cos(rot) * 0.08, y: top, rot: rot + Math.PI, s: 0.85 },
    );
  }
  for (const b of named(/^FURN_meet_chair_/)) {
    put(b, { id: 'chair_office_highback', x: b.x, z: b.z, rot: meetTable ? facing(b, meetTable) : 0, s: 0.82 });
  }
  if (meetTable) {
    const long = Math.max(meetTable.w, meetTable.d);
    const short = Math.min(meetTable.w, meetTable.d);
    const s = long / PROP_DIMS.conference_table_oval.w;
    const top = 0.75;
    const alongZ = meetTable.d > meetTable.w;
    put(meetTable, {
      id: 'conference_table_oval', x: meetTable.x, z: meetTable.z, rot: alongZ ? Math.PI / 2 : 0, s,
      sy: top / (PROP_DIMS.conference_table_oval.h * s), sz: short / (PROP_DIMS.conference_table_oval.d * s),
    });
    // Laptops for the people on either side, instead of the old props.
    for (const props of named(/^FURN_meet_props$/)) gone.push(props);
    const along = alongZ ? [0, 1] : [1, 0];
    for (const k of [-1, 1]) {
      const x = meetTable.x + along[0] * k * long * 0.22 + along[1] * k * short * 0.18;
      const z = meetTable.z + along[1] * k * long * 0.22 + along[0] * k * short * 0.18;
      parts.push({ id: 'laptop', x, z, y: top - 0.005, rot: facing({ x, z }, meetTable) + Math.PI });
    }
  }
  for (const b of named(/^FURN_cafe_chair_/)) {
    const table = nearest(cafeTables, b);
    put(b, { id: 'chair_dining_teal', x: b.x, z: b.z, rot: table ? facing(b, table) : 0 });
  }
  for (const b of cafeTables) {
    const s = Math.max(b.w, b.d) / PROP_DIMS.coffee_table_terrazzo.w;
    put(b, { id: 'coffee_table_terrazzo', x: b.x, z: b.z, s, sy: 0.74 / (PROP_DIMS.coffee_table_terrazzo.h * s) });
  }
  if (coffee) {
    const s = Math.min(coffee.w, coffee.d) / PROP_DIMS.coffee_table_terrazzo.w;
    put(coffee, { id: 'coffee_table_terrazzo', x: coffee.x, z: coffee.z, s, sy: Math.max(1, 0.5 / (PROP_DIMS.coffee_table_terrazzo.h * s)) });
  }
  for (const b of named(/^FURN_side_table$/)) {
    const s = Math.max(b.w, b.d) / PROP_DIMS.coffee_table_terrazzo.w;
    put(b, { id: 'coffee_table_terrazzo', x: b.x, z: b.z, s, sy: 0.5 / (PROP_DIMS.coffee_table_terrazzo.h * s) });
  }
  for (const b of named(/^FURN_sofa$/)) {
    put(b, { id: 'sofa_navy', x: b.x, z: b.z, rot: facing(b, lounge), s: Math.max(b.w, b.d) / PROP_DIMS.sofa_navy.w });
  }
  for (const b of named(/^FURN_armchair_/)) {
    put(b, { id: 'armchair_yellow', x: b.x, z: b.z, rot: facing(b, lounge), s: 1.05 });
  }
  for (const b of named(/^FURN_(arc|floor)_lamp$/)) {
    put(b, { id: 'desk_lamp_brass', x: b.x, z: b.z, rot: facing(b, lounge) });
  }
  // Potted plants (not the long planters along the edges).
  named(/^DECO_(monstera_|meet_plant|plant_)/).forEach((b, i) => {
    const id = PLANTS[i % PLANTS.length];
    put(b, { id, x: b.x, z: b.z, rot: i * 1.3, s: Math.min(1.25, b.h / PROP_DIMS[id].h) });
  });
  for (const pot of named(/^DECO_snake_.*_pot$/)) {
    gone.push(...named(new RegExp(`^${pot.name.replace(/_pot$/, '')}_leaves$`)));
    put(pot, { id: 'plant_snake', x: pot.x, z: pot.z, rot: pot.x });
  }

  for (const b of gone) b.obj.removeFromParent();

  let disposed = false;
  if (parts.length) {
    void loadItemParts({ model: parts }).then((loaded) => {
      if (disposed || !loaded) return;
      for (const part of loaded) {
        const mesh = new THREE.Mesh(part.geo, part.mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.local);
        // The offices' furniture shadows are baked into their floors; these don't add more.
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    });
  }
  return { group, dispose: () => { disposed = true; } };
}
