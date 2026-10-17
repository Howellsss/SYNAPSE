/**
 * Prop models (public/assets/spatial/props, made in Meshy, baked to real sizes facing +z): loaded
 * once per page and shared by every world, piece and rider. A model becomes a few parts (one per
 * material), so the world can draw every copy of it as one instanced mesh.
 *
 * Also the lights that make a vehicle read as one: head and tail lights placed on the body itself
 * (found by casting rays at the model), a soft pool of headlight on the road, and the little jets
 * of flame under the flying car's wheels.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROP_DIMS, propUrl, type PropId } from '@/spatial/scene/campus/props';
import type { ModelPart, ProcItem } from '@/spatial/scene/campus/kit';
import { canvasTex, glowing, kitShared, type Part } from './kitParts';

/**
 * A copy with plain float attributes. The files store positions and normals compressed (small
 * integers scaled by the node's transform); moving them into place as they are would clip them.
 */
function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = src.clone();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized && !(a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return geo;
}

let loader: GLTFLoader | null = null;
const loading = new Map<PropId, Promise<Part[]>>();
const ready = new Map<PropId, Part[]>();

/** A model's parts, loading it the first time. Kept for the page's life (shared, never disposed). */
export function loadProp(id: PropId): Promise<Part[]> {
  let p = loading.get(id);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(propUrl(id)).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geo = floatGeometry(mesh.geometry).applyMatrix4(mesh.matrixWorld);
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const list = byMat.get(mat) ?? [];
          list.push(geo);
          byMat.set(mat, list);
        }
      });
      const parts: Part[] = [];
      for (const [mat, geos] of byMat) {
        const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
        if (merged) parts.push({ geo: merged, mat, local: new THREE.Matrix4(), shadow: !mat.transparent });
        else geos.forEach((geo) => parts.push({ geo, mat, local: new THREE.Matrix4(), shadow: !mat.transparent }));
      }
      ready.set(id, parts);
      return parts;
    });
    // A failed download is tried again the next time it's asked for.
    p.catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

/** The parts if the model has already loaded (no waiting). */
export const propNow = (id: PropId): Part[] | undefined => ready.get(id);

/** What a piece is drawn from: its parts, each placed in the piece's own frame. */
export function itemModels(item: ProcItem, variant = 0): ModelPart[] {
  const s = item.scale ?? 1;
  const m = item.model;
  if (!m) return [];
  if (typeof m === 'string') return [{ id: m, s }];
  if (typeof m[0] === 'string') return [{ id: (m as PropId[])[variant % m.length], s }];
  return (m as ModelPart[]).map((p) => ({ ...p, s: (p.s ?? 1) * s }));
}

/** How many models a piece chooses between (1 for most). */
export const variantCount = (item: ProcItem) => (Array.isArray(item.model) && typeof item.model[0] === 'string' ? item.model.length : 1);

/** Which of its models a placed piece shows (the same everywhere, from its id). */
export function variantOf(item: ProcItem, pieceId: string): number {
  const n = variantCount(item);
  if (n < 2) return 0;
  let h = 7;
  for (const c of pieceId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % n;
}

/** Load everything a piece is drawn from, and place it (null if a model couldn't load). */
export async function loadItemParts(item: ProcItem, variant = 0): Promise<Part[] | null> {
  const models = itemModels(item, variant);
  try {
    const loaded = await Promise.all(models.map((m) => loadProp(m.id)));
    return models.flatMap((m, i) => {
      const at = new THREE.Matrix4().compose(
        new THREE.Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.rot ?? 0),
        new THREE.Vector3(m.s ?? 1, m.s ?? 1, m.s ?? 1),
      );
      return loaded[i].map((p) => ({ ...p, local: at.clone().multiply(p.local) }));
    });
  } catch {
    return null;
  }
}

/** The same, if every model it needs has already loaded. */
export function itemPartsNow(item: ProcItem, variant = 0): Part[] | null {
  const models = itemModels(item, variant);
  if (!models.length || models.some((m) => !ready.has(m.id))) return null;
  return models.flatMap((m) => {
    const at = new THREE.Matrix4().compose(
      new THREE.Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.rot ?? 0),
      new THREE.Vector3(m.s ?? 1, m.s ?? 1, m.s ?? 1),
    );
    return ready.get(m.id)!.map((p) => ({ ...p, local: at.clone().multiply(p.local) }));
  });
}

/** A vehicle's size as drawn. */
export function vehicleSize(item: ProcItem): { w: number; d: number; h: number } {
  const m = typeof item.model === 'string' ? PROP_DIMS[item.model] : { w: item.w, d: item.d, h: 1 };
  const s = item.scale ?? 1;
  return { w: m.w * s, d: m.d * s, h: m.h * s };
}

// ---------------------------------------------------------------- vehicle lights

interface LightSpot { x: number; y: number; z: number }
const spots = new Map<string, { head: LightSpot[]; tail: LightSpot[] }>();
const ray = new THREE.Raycaster();

/**
 * Where the head and tail lights go on a vehicle (in its frame, as drawn): rays cast at the body
 * from in front and behind, at headlight height, find its surface, so the lights sit on it
 * whatever its shape.
 */
function lightSpots(item: ProcItem): { head: LightSpot[]; tail: LightSpot[] } | null {
  const known = spots.get(item.id);
  if (known) return known;
  const parts = itemPartsNow(item);
  if (!parts) return null;
  const { w, d, h } = vehicleSize(item);
  const moto = item.vehicle?.lights === 'moto';
  const meshes = parts.map((p) => {
    const m = new THREE.Mesh(p.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false;
    m.matrix.copy(p.local);
    m.matrixWorld.copy(p.local);
    return m;
  });
  const surface = (x: number, y: number, front: boolean): number | null => {
    ray.set(new THREE.Vector3(x, y, front ? d : -d), new THREE.Vector3(0, 0, front ? -1 : 1));
    ray.far = d * 2;
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? hit.point.z : null;
  };
  // Try a few heights and keep the first that meets the body near its end.
  const find = (x: number, front: boolean, ys: number[]): LightSpot | null => {
    for (const y of ys) {
      const z = surface(x, y, front);
      if (z !== null && Math.abs(z) > d / 2 - (moto ? 0.6 : 0.45)) return { x, y, z: z + (front ? 0.012 : -0.012) };
    }
    return null;
  };
  const tall = h > 1.15;
  const headYs = moto ? [0.68, 0.62, 0.74, 0.56].map((f) => f * h) : (tall ? [0.55, 0.5, 0.6, 0.45] : [0.44, 0.4, 0.48, 0.36, 0.52]).map((f) => f * h);
  const tailYs = moto ? [0.6, 0.55, 0.66, 0.5].map((f) => f * h) : (tall ? [0.6, 0.55, 0.5, 0.65] : [0.55, 0.5, 0.6, 0.46]).map((f) => f * h);
  const xs = moto ? [0] : [-w * 0.32, w * 0.32];
  const head = xs.map((x) => find(x, true, headYs)).filter((s): s is LightSpot => !!s);
  const tail = xs.map((x) => find(x, false, tailYs)).filter((s): s is LightSpot => !!s);
  meshes.forEach((m) => (m.material as THREE.Material).dispose());
  const out = { head, tail };
  spots.set(item.id, out);
  return out;
}

let lightMats: Record<'headOn' | 'tailOn' | 'headOff' | 'tailOff', THREE.Material> | null = null;
const lightMaterials = () => (lightMats ??= {
  headOn: glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.1, 2.8), toneMapped: false })),
  tailOn: glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 0.18, 0.12), toneMapped: false })),
  headOff: new THREE.MeshBasicMaterial({ color: '#C9D2DC' }),
  tailOff: new THREE.MeshBasicMaterial({ color: '#7E1B16' }),
});

/** The head and tail lights of a vehicle as parts: lit (driven) or just their lenses (parked). */
export function vehicleLightParts(item: ProcItem, lit: boolean): Part[] {
  const at = item.vehicle ? lightSpots(item) : null;
  if (!at) return [];
  const { G } = kitShared();
  const { w } = vehicleSize(item);
  const moto = item.vehicle?.lights === 'moto';
  const M = lightMaterials();
  // Rounded lenses, half set into the body where the rays met it.
  const lens = (s: LightSpot, sx: number, sy: number, out: number) => new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z - out * 0.012), new THREE.Quaternion(), new THREE.Vector3(sx, sy, 0.05));
  return [
    ...at.head.map((s) => ({ geo: G.sphere, mat: lit ? M.headOn : M.headOff, local: lens(s, moto ? 0.1 : w * 0.15, moto ? 0.08 : 0.055, 1), shadow: false })),
    ...at.tail.map((s) => ({ geo: G.sphere, mat: lit ? M.tailOn : M.tailOff, local: lens(s, moto ? 0.08 : w * 0.17, moto ? 0.045 : 0.05, -1), shadow: false })),
  ];
}

let beamTex: THREE.Texture | null = null;
/** A soft pool of headlight on the road ahead of a driven vehicle. */
export function headlightPool(item: ProcItem): THREE.Mesh {
  beamTex ??= canvasTex(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s * 0.15, 0, s / 2, s * 0.15, s * 0.85);
    grad.addColorStop(0, 'rgba(255,244,220,0.9)');
    grad.addColorStop(0.45, 'rgba(255,236,200,0.35)');
    grad.addColorStop(1, 'rgba(255,236,200,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  const { w, d } = vehicleSize(item);
  const moto = item.vehicle?.lights === 'moto';
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(moto ? 1.4 : w * 1.5, moto ? 2.4 : 3.4),
    new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.035, d / 2 + (moto ? 1.1 : 1.6));
  mesh.renderOrder = 1;
  return mesh;
}

// ---------------------------------------------------------------- the flying car's flames

let flameGeo: THREE.BufferGeometry | null = null;
let flameMats: THREE.Material[] | null = null;
let washTex: THREE.Texture | null = null;
/**
 * Small jets of flame under each wheel, pointing down (an orange flame round a hot blue-white
 * core), and their soft glow on the ground below. A group whose parts flicker each frame; hidden
 * on the ground.
 */
export function wheelFlames(item: ProcItem): THREE.Group {
  flameGeo ??= new THREE.ConeGeometry(1, 1, 16, 1, true).rotateX(Math.PI).translate(0, -0.5, 0);
  flameMats ??= [
    glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.55, 0.12), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })),
    glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.9, 3.0), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })),
  ];
  washTex ??= canvasTex(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,190,120,0.75)');
    grad.addColorStop(0.35, 'rgba(255,140,60,0.32)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  const { w, d } = vehicleSize(item);
  const group = new THREE.Group();
  const jets = new THREE.Group();
  for (const x of [-w * 0.42, w * 0.42]) {
    for (const z of [-d * 0.31, d * 0.3]) {
      const jet = new THREE.Group();
      jet.position.set(x, 0.1, z);
      const outer = new THREE.Mesh(flameGeo, flameMats[0]);
      outer.scale.set(0.16, 0.78, 0.16);
      const core = new THREE.Mesh(flameGeo, flameMats[1]);
      core.scale.set(0.075, 0.42, 0.075);
      jet.add(outer, core);
      jets.add(jet);
    }
  }
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 1.9, d * 1.25),
    new THREE.MeshBasicMaterial({ map: washTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  wash.rotation.x = -Math.PI / 2;
  wash.renderOrder = 1;
  group.add(jets, wash);
  group.visible = false;
  return group;
}

/**
 * Flicker the flames, and show them only in the air, growing as the car lifts; the glow stays on
 * the ground below (`height`: how far the car is above it).
 */
export function flickerFlames(flames: THREE.Group, height: number, now: number) {
  const k = Math.min(1, Math.max(0, (height - 0.15) / 0.9));
  flames.visible = k > 0.02;
  if (!flames.visible) return;
  const [jets, wash] = flames.children as [THREE.Group, THREE.Mesh];
  jets.children.forEach((jet, i) => {
    const f = 0.82 + 0.18 * Math.sin(now / 37 + i * 1.9) + 0.08 * Math.sin(now / 13 + i * 4.1);
    jet.scale.set(k, k * f, k);
  });
  wash.position.y = -height + 0.04;
  (wash.material as THREE.MeshBasicMaterial).opacity = k * (0.8 + 0.12 * Math.sin(now / 53));
}
