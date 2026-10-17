/**
 * Draws SYNAPSE Campus (spatial/scene/campus/layout.ts) with three.js: the lawn, stone avenues,
 * the pond, buildings (raised floors with their finish, low navy walls with a gold cap, or glass),
 * the headquarters (Office 02 as built), every placed piece as instanced meshes (one draw per part,
 * however many desks or trees), and the names of places on the floor.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIT_BY_ID, isGlb, placedBounds, type Placed } from '@/spatial/scene/campus/kit';
import { applyRealSurface, type RealSurface } from './realSurfaces';
import { canvasTex, glowing, grassTuft, kitShared, markGlow, procParts, rng, speckle, type Part } from './kitParts';
import { loadItemParts, variantOf, vehicleLightParts } from './propModels';
import type { Rect } from '@/spatial/scene/offices';
import { WALL_T, wallSegments, type CampusLayout, type FloorFinish, type Zone } from '@/spatial/scene/campus/layout';

// ---------------------------------------------------------------- textures

/** Lawn: patches of lighter and darker grass, mowing stripes and blades. Repeats every 8 m. */
const lawnTex = () => canvasTex(512, (g, s) => {
  g.fillStyle = '#4F8A33';
  g.fillRect(0, 0, s, s);
  const rand = rng(7);
  for (let i = 0; i < 60; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const r = 30 + rand() * 90;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() < 0.5;
    grad.addColorStop(0, light ? 'rgba(140,190,80,0.22)' : 'rgba(30,70,20,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,240,0.035)' : 'rgba(0,30,0,0.04)'; g.fillRect(0, (i * s) / 4, s, s / 4); }
  for (let i = 0; i < 9000; i++) {
    const x = rand() * s;
    const y = rand() * s;
    g.strokeStyle = ['#3E7428', '#5E9A3C', '#6FAE45', '#467F2E', '#82B85A'][Math.floor(rand() * 5)];
    g.globalAlpha = 0.35 + rand() * 0.4;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
    g.stroke();
  }
  g.globalAlpha = 1;
});

/** Warm sandstone pavers in a running bond, each stone its own shade. Repeats every 3 m. */
const paverTex = () => canvasTex(512, (g, s) => {
  g.fillStyle = '#7D6A52';
  g.fillRect(0, 0, s, s);
  const rand = rng(3);
  const rows = 8;
  const h = s / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? h : 0;
    for (let x = -off; x < s; x += h * 2) {
      const v = (rand() - 0.5) * 22;
      const warm = rand() < 0.2 ? 14 : 0;
      g.fillStyle = `rgb(${186 + v + warm},${160 + v},${124 + v - warm})`;
      g.fillRect(x + 2, r * h + 2, h * 2 - 4, h - 4);
      g.fillStyle = 'rgba(255,240,210,0.08)';
      g.fillRect(x + 2, r * h + 2, h * 2 - 4, 3);
    }
  }
  speckle(g, s, ['#6E5B45', '#D9C29C', '#8C7658'], 2500, [1, 2.2], 11, [0.1, 0.35]);
});

/** Irregular flagstones for garden walks. */
const flagTex = () => canvasTex(512, (g, s) => {
  g.fillStyle = '#5D6B3E';
  g.fillRect(0, 0, s, s);
  const rand = rng(19);
  for (let i = 0; i < 70; i++) {
    const cx = rand() * s;
    const cy = rand() * s;
    const r = 26 + rand() * 30;
    const v = (rand() - 0.5) * 24;
    g.fillStyle = `rgb(${170 + v},${152 + v},${120 + v})`;
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rand() * 0.4;
      const rr = r * (0.75 + rand() * 0.3);
      if (k === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  }
  speckle(g, s, ['#7A6650', '#C9B48C'], 1500, [1, 2], 23, [0.1, 0.3]);
});

/** Metres per unit of a floor's UVs. */
const finishUV = (f: FloorFinish) => (f === 'marble' ? 2.4 : f === 'herringbone' ? 2.6 : 3.2);
/** The photographed surface for each floor (carpets keep their drawn colours and patterns). */
const REAL_FINISH: Partial<Record<FloorFinish, RealSurface>> = {
  oak: 'oak', walnut: 'walnut', deck: 'deck', herringbone: 'parquet', marble: 'marble', slate: 'slate', terrazzo: 'terrazzo',
};

function finishTex(f: FloorFinish): THREE.CanvasTexture {
  switch (f) {
    case 'oak':
    case 'walnut':
    case 'deck': {
      const base = f === 'oak' ? [196, 150, 98] : f === 'deck' ? [150, 108, 70] : [118, 80, 52];
      return canvasTex(512, (g, s) => {
        const rand = rng(f === 'oak' ? 5 : f === 'deck' ? 13 : 9);
        const plank = s / (f === 'deck' ? 6 : 10);
        for (let i = 0; i * plank < s; i++) {
          let x = -rand() * s;
          while (x < s) {
            const len = s * (0.35 + rand() * 0.5);
            const v = (rand() - 0.5) * 30;
            g.fillStyle = `rgb(${base[0] + v},${base[1] + v * 0.8},${base[2] + v * 0.6})`;
            g.fillRect(x, i * plank, len, plank);
            g.strokeStyle = 'rgba(50,28,12,0.12)';
            for (let k = 0; k < 5; k++) { g.beginPath(); const y = i * plank + rand() * plank; g.moveTo(x, y); g.bezierCurveTo(x + len / 3, y + 2, x + (2 * len) / 3, y - 2, x + len, y); g.stroke(); }
            g.fillStyle = 'rgba(30,15,5,0.35)';
            g.fillRect(x, i * plank, 1.5, plank);
            x += len;
          }
          g.fillStyle = f === 'deck' ? 'rgba(20,10,0,0.55)' : 'rgba(30,15,5,0.3)';
          g.fillRect(0, i * plank, s, f === 'deck' ? 3 : 1.5);
        }
      });
    }
    case 'herringbone':
      return canvasTex(512, (g, s) => {
        const rand = rng(31);
        g.fillStyle = '#5A3A22';
        g.fillRect(0, 0, s, s);
        const u = s / 16;
        for (let row = -2; row < 18; row++) for (let col = -2; col < 18; col++) {
          const v = (rand() - 0.5) * 14;
          g.fillStyle = `rgb(${150 + v},${104 + v * 0.8},${66 + v * 0.6})`;
          const x = col * u;
          const y = row * u;
          if ((row + col) % 2 === 0) g.fillRect(x + 1, y + 1, u * 2 - 2, u - 2);
          else g.fillRect(x + 1, y + 1, u - 2, u * 2 - 2);
        }
      });
    case 'marble':
      return canvasTex(512, (g, s) => {
        const rand = rng(37);
        const t = s / 2;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const v = (rand() - 0.5) * 10;
          g.fillStyle = `rgb(${205 + v},${184 + v},${150 + v})`;
          g.fillRect(i * t, j * t, t, t);
        }
        for (let k = 0; k < 26; k++) {
          g.strokeStyle = `rgba(${120 + rand() * 40},${96 + rand() * 30},${70},${0.12 + rand() * 0.2})`;
          g.lineWidth = 0.6 + rand() * 1.6;
          g.beginPath();
          let x = rand() * s;
          let y = rand() * s;
          g.moveTo(x, y);
          for (let n = 0; n < 8; n++) { x += (rand() - 0.3) * 70; y += (rand() - 0.5) * 50; g.lineTo(x, y); }
          g.stroke();
        }
        g.fillStyle = 'rgba(90,70,45,0.45)';
        g.fillRect(0, t - 1, s, 2);
        g.fillRect(t - 1, 0, 2, s);
      });
    case 'slate':
      return canvasTex(256, (g, s) => {
        g.fillStyle = '#3D4452';
        g.fillRect(0, 0, s, s);
        const t = s / 4;
        const rand = rng(13);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = Math.floor(rand() * 18); g.fillStyle = `rgb(${70 + v},${78 + v},${92 + v})`; g.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3); }
      });
    case 'terrazzo':
      return canvasTex(512, (g, s) => {
        g.fillStyle = '#9C8E78';
        g.fillRect(0, 0, s, s);
        speckle(g, s, ['#E2C27A', '#2C3E66', '#6B5A45', '#C9B48C'], 5000, [2, 6], 17);
      });
    default: {
      const c = f === 'carpet_navy' ? '#26406B' : f === 'carpet_green' ? '#2E5E4A' : f === 'carpet_red' ? '#6E2A2A' : f === 'carpet_teal' ? '#245E63' : '#553A5C';
      return canvasTex(256, (g, s) => {
        g.fillStyle = c;
        g.fillRect(0, 0, s, s);
        speckle(g, s, ['rgba(255,255,255,0.35)', 'rgba(0,0,0,0.5)'], 6000, [1, 1.6], 19, [0.1, 0.3]);
        // A faint woven grid.
        g.strokeStyle = 'rgba(0,0,0,0.12)';
        for (let i = 0; i < s; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
      });
    }
  }
}

/** Ripples for water: a normal map made from a few crossing waves. */
function rippleNormals(): THREE.CanvasTexture {
  const s = 256;
  const h = new Float32Array(s * s);
  const rand = rng(29);
  const waves = Array.from({ length: 7 }, () => ({ kx: Math.round((rand() - 0.5) * 8), ky: Math.round((rand() - 0.5) * 8) || 1, ph: rand() * 6, a: 0.5 + rand() }));
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let v = 0;
    for (const w of waves) v += Math.sin(((w.kx * x + w.ky * y) / s) * Math.PI * 2 + w.ph) * w.a;
    h[y * s + x] = v;
  }
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const img = g.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = h[y * s + ((x + 1) % s)] - h[y * s + ((x + s - 1) % s)];
    const dy = h[((y + 1) % s) * s + x] - h[((y + s - 1) % s) * s + x];
    const n = new THREE.Vector3(-dx * 0.6, -dy * 0.6, 1).normalize();
    const i = (y * s + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255;
    img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
    img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Texture coordinates in world metres (one repeat every `size` m), for flat ground pieces. */
function worldUV(g: THREE.BufferGeometry, size: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  const pos = g.attributes.position as THREE.BufferAttribute;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / size, pos.getZ(i) / size);
}

/** A flat ribbon along a winding walk. */
function ribbon(points: [number, number][], width: number, y: number): THREE.BufferGeometry {
  // Smooth the corners with a curve through the points.
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
  const n = Math.max(8, Math.round(curve.getLength() * 2));
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    const t = curve.getTangent(i / n);
    const nx = -t.z;
    const nz = t.x;
    const l = Math.hypot(nx, nz) || 1;
    pos.push(p.x + (nx / l) * width / 2, y, p.z + (nz / l) * width / 2, p.x - (nx / l) * width / 2, y, p.z - (nz / l) * width / 2);
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  worldUV(g, 2.5);
  return g;
}

// ---------------------------------------------------------------- the world

export interface CampusWorld {
  root: THREE.Group;
  /** Called when the office GLB has loaded (the HQ and the furniture kit). */
  attachKit(gltf: GLTF): void;
  /** Re-place the pieces (after build mode changes). */
  setObjects(objects: Placed[]): void;
  /** Pieces not to draw (a parked car someone is driving). */
  setHidden(ids: ReadonlySet<string>): void;
  /** Build mode: a see-through preview of a piece, gold where it fits and red where it doesn't. */
  setGhost(p: Placed | null, ok: boolean): void;
  /** Build mode: outline the chosen piece's footprint. */
  setSelected(bounds: Rect | null): void;
  /** Keep the sun's shadow box over where the camera looks, and turn the place signs to face the camera. */
  follow(target: THREE.Vector3, sun: THREE.DirectionalLight, camera: THREE.Camera): void;
  /** Every frame: ripples on the water. */
  update(dt: number): void;
  dispose(): void;
}

export interface WorldOptions {
  shadows: boolean;
  /** Draw grass tufts over the lawns (off on Low quality). */
  grass?: boolean;
  /** Only this part of the layout (a wing of the Hub); the ground is sized to it. */
  bounds?: Rect;
  /** Outdoors: a lawn all round. Indoors: a dark floor beyond the room. */
  outdoor?: boolean;
}

export function createCampusWorld(layout: CampusLayout, { shadows, grass = true, bounds, outdoor = true }: WorldOptions): CampusWorld {
  const root = new THREE.Group();
  root.name = 'campus';
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const area = bounds ?? { x0: 0, x1: layout.width, z0: 0, z1: layout.depth };
  const cx = (area.x0 + area.x1) / 2;
  const cz = (area.z0 + area.z1) / 2;
  const span = Math.max(area.x1 - area.x0, area.z1 - area.z0);

  // The ground, past the edges of the screen.
  {
    const size = bounds ? span + 140 : 420;
    let mat: THREE.Material;
    if (outdoor) {
      const lawn = keep(lawnTex());
      lawn.repeat.set(size / 8, size / 8);
      const lawnMat = keep(new THREE.MeshStandardMaterial({ map: lawn, roughness: 1 }));
      keep(applyRealSurface(lawnMat, 'grass', size, 0.6));
      mat = lawnMat;
    } else {
      mat = keep(new THREE.MeshStandardMaterial({ color: '#1C1611', roughness: 1 }));
    }
    const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(size, size)), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, cz);
    ground.receiveShadow = shadows;
    root.add(ground);
  }

  // Avenues, round plazas and winding walks: merged meshes, textures in world metres.
  {
    const geos: THREE.BufferGeometry[] = layout.paths.map((p) => {
      const g = new THREE.BoxGeometry(p.x1 - p.x0, 0.05, p.z1 - p.z0);
      g.translate((p.x0 + p.x1) / 2, 0.0, (p.z0 + p.z1) / 2);
      worldUV(g, 3);
      return g;
    });
    for (const c of layout.plazas ?? []) {
      const g = new THREE.CylinderGeometry(c.r, c.r, 0.06, 64);
      g.translate(c.cx, 0.005, c.cz);
      worldUV(g, 3);
      geos.push(g);
    }
    const merged = geos.length ? mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))) : null;
    geos.forEach((g) => g.dispose());
    if (merged) {
      const paveMat = keep(new THREE.MeshStandardMaterial({ map: keep(paverTex()), roughness: 0.85 }));
      keep(applyRealSurface(paveMat, 'paving', 3));
      const mesh = new THREE.Mesh(keep(merged), paveMat);
      mesh.receiveShadow = shadows;
      root.add(mesh);
    }
    const walks = (layout.walks ?? []).map((w) => ribbon(w.points, w.width, 0.012));
    const walkGeo = walks.length ? mergeGeometries(walks) : null;
    walks.forEach((g) => g.dispose());
    if (walkGeo) {
      const walkMat = keep(new THREE.MeshStandardMaterial({ map: keep(flagTex()), roughness: 0.9 }));
      keep(applyRealSurface(walkMat, 'brick', 2.5));
      const mesh = new THREE.Mesh(keep(walkGeo), walkMat);
      mesh.receiveShadow = shadows;
      root.add(mesh);
    }
  }

  // Ponds: a dark bed, a stone edge, and a surface that ripples and reflects the sky.
  const ripples = keep(rippleNormals());
  ripples.repeat.set(0.25, 0.25);
  const waterMat = keep(new THREE.MeshStandardMaterial({
    color: '#2A8095', roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.86, normalMap: ripples, normalScale: new THREE.Vector2(0.55, 0.55),
  }));
  {
    const { M, G } = kitShared();
    for (const w of layout.water) {
      const bed = new THREE.Mesh(G.disc, keep(new THREE.MeshStandardMaterial({ color: '#173C3A', roughness: 1 })));
      bed.scale.set(w.rx * 2, 1, w.rz * 2);
      bed.position.set(w.cx, 0.02, w.cz);
      const surface = new THREE.Mesh(keep(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2)), waterMat);
      surface.scale.set(w.rx, 1, w.rz);
      surface.position.set(w.cx, 0.2, w.cz);
      surface.receiveShadow = shadows;
      // Stones all round the edge.
      const rand = rng(w.id.length * 97 + 13);
      const stones: THREE.BufferGeometry[] = [];
      const perimeter = Math.PI * (w.rx + w.rz);
      const n = Math.round(perimeter / 0.55);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const s = 0.5 + rand() * 0.3;
        const g = G.blobLow.clone().applyMatrix4(new THREE.Matrix4().compose(
          new THREE.Vector3(w.cx + Math.cos(a) * (w.rx + 0.2), 0.12, w.cz + Math.sin(a) * (w.rz + 0.2)),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6),
          new THREE.Vector3(s * 1.3, 0.38 + rand() * 0.15, s)));
        const nonIdx = g.index ? g.toNonIndexed() : g;
        const col = new Float32Array(nonIdx.attributes.position.count * 3);
        c.set(['#8A847A', '#9C9384', '#6F6A62', '#A89C86'][i % 4]);
        for (let k = 0; k < col.length; k += 3) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
        nonIdx.setAttribute('color', new THREE.BufferAttribute(col, 3));
        nonIdx.deleteAttribute('uv');
        stones.push(nonIdx);
        if (nonIdx !== g) g.dispose();
      }
      const rim = new THREE.Mesh(keep(mergeGeometries(stones) ?? new THREE.BufferGeometry()), M.fabric);
      stones.forEach((g) => g.dispose());
      rim.castShadow = shadows;
      rim.receiveShadow = shadows;
      root.add(bed, surface, rim);
    }
  }

  // Buildings: a raised floor with its finish, walls with a wooden cap, warm sconces inside.
  {
    const wallMat = keep(new THREE.MeshStandardMaterial({ color: '#B59C78', roughness: 0.85 }));
    const capMat = keep(new THREE.MeshStandardMaterial({ color: '#4E3524', roughness: 0.5 }));
    const baseMat = keep(new THREE.MeshStandardMaterial({ color: '#2E2620', roughness: 0.7 }));
    const glassMat = keep(new THREE.MeshPhysicalMaterial({ color: '#8FB8CC', transparent: true, opacity: 0.14, roughness: 0.04, metalness: 0, envMapIntensity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    const frameMat = keep(new THREE.MeshStandardMaterial({ color: '#2B2620', roughness: 0.4, metalness: 0.6 }));
    const finishes = new Map<FloorFinish, THREE.MeshStandardMaterial>();
    const lists = { wall: [] as THREE.BufferGeometry[], cap: [] as THREE.BufferGeometry[], base: [] as THREE.BufferGeometry[], glass: [] as THREE.BufferGeometry[], frame: [] as THREE.BufferGeometry[] };
    const sconces = new THREE.Group();
    const bulbGeos: THREE.BufferGeometry[] = [];
    const piece = (list: THREE.BufferGeometry[], x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      list.push(g);
    };
    const inside = (a: Rect, o: Rect) => a !== o && a.x0 >= o.x0 && a.x1 <= o.x1 && a.z0 >= o.z0 && a.z1 <= o.z1;
    for (const b of layout.buildings) {
      const { x0, x1, z0, z1 } = b.rect;
      if (b.floor) {
        const finish = b.floor;
        let mat = finishes.get(finish);
        if (!mat) {
          const t = keep(finishTex(finish));
          const finishMat = keep(new THREE.MeshStandardMaterial({ map: t, roughness: finish.startsWith('carpet') ? 1 : finish === 'marble' ? 0.25 : 0.55 }));
          const real = REAL_FINISH[finish];
          if (real) keep(applyRealSurface(finishMat, real, finishUV(finish)));
          mat = finishMat;
          finishes.set(finish, mat);
        }
        // A room inside another sits a hair higher, so the two floors never flicker.
        const nested = layout.buildings.filter((o) => o.floor && inside(b.rect, o.rect)).length;
        const fg = new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0);
        fg.translate((x0 + x1) / 2, nested * 0.006, (z0 + z1) / 2);
        worldUV(fg, finishUV(finish));
        const floor = new THREE.Mesh(keep(fg), mat);
        floor.receiveShadow = shadows;
        root.add(floor);
      }
      const h = b.height ?? 1.6;
      for (const s of wallSegments(b)) {
        if (b.wall === 'solid') {
          piece(lists.base, s.x0 - 0.01, s.x1 + 0.01, s.z0 - 0.01, s.z1 + 0.01, 0, 0.12);
          piece(lists.wall, s.x0, s.x1, s.z0, s.z1, 0.12, h);
          piece(lists.cap, s.x0 - 0.03, s.x1 + 0.03, s.z0 - 0.03, s.z1 + 0.03, h, h + 0.07);
        } else {
          const along = s.x1 - s.x0 > s.z1 - s.z0;
          const mid = along ? (s.z0 + s.z1) / 2 : (s.x0 + s.x1) / 2;
          const gh = Math.max(h, 2.3);
          if (along) piece(lists.glass, s.x0, s.x1, mid - 0.02, mid + 0.02, 0.1, gh);
          else piece(lists.glass, mid - 0.02, mid + 0.02, s.z0, s.z1, 0.1, gh);
          piece(lists.frame, s.x0, s.x1, s.z0, s.z1, 0, 0.1);
          piece(lists.frame, s.x0, s.x1, s.z0, s.z1, gh, gh + 0.06);
          const len = along ? s.x1 - s.x0 : s.z1 - s.z0;
          const posts = Math.max(1, Math.round(len / 1.5));
          for (let k = 0; k <= posts; k++) {
            const t = (along ? s.x0 : s.z0) + (len * k) / posts;
            if (along) piece(lists.frame, t - 0.03, t + 0.03, s.z0, s.z1, 0, gh + 0.06);
            else piece(lists.frame, s.x0, s.x1, t - 0.03, t + 0.03, 0, gh + 0.06);
          }
        }
      }
      // Warm sconces along the inside of solid walls, every 4 m.
      if (b.wall === 'solid') {
        for (const s of wallSegments(b)) {
          const along = s.x1 - s.x0 > s.z1 - s.z0;
          const len = along ? s.x1 - s.x0 : s.z1 - s.z0;
          if (len < 2.5) continue;
          const n = Math.max(1, Math.floor(len / 4));
          for (let k = 0; k < n; k++) {
            const t = (along ? s.x0 : s.z0) + (len * (k + 0.5)) / n;
            // Inward: towards the building's middle.
            const inX = along ? t : (s.x0 + s.x1) / 2 + ((s.x0 + s.x1) / 2 < (x0 + x1) / 2 ? 0.13 : -0.13);
            const inZ = along ? (s.z0 + s.z1) / 2 + ((s.z0 + s.z1) / 2 < (z0 + z1) / 2 ? 0.13 : -0.13) : t;
            const g = new THREE.SphereGeometry(0.11, 8, 6);
            g.scale(along ? 1.6 : 0.7, 0.8, along ? 0.7 : 1.6);
            g.translate(inX, h - 0.3, inZ);
            bulbGeos.push(g);
          }
        }
      }
    }
    void sconces;
    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, castShadow: boolean) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(keep(merged), mat);
      mesh.castShadow = shadows && castShadow;
      mesh.receiveShadow = shadows;
      root.add(mesh);
    };
    add(lists.base, baseMat, false);
    add(lists.wall, wallMat, true);
    add(lists.cap, capMat, false);
    add(lists.frame, frameMat, true);
    add(lists.glass, glassMat, false);
    add(bulbGeos, keep(glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.2), toneMapped: false }))), false);
    void WALL_T;
  }

  // Grass: thousands of little tufts over the open lawn.
  if (outdoor && grass) {
    const tuft = keep(grassTuft());
    const mat = kitShared().M.leaves;
    const rand = rng(101);
    // Not indoors (the HQ), nor under paving, car parks, the runway or big pieces like the terminal.
    const hq = layout.hq;
    const covered = layout.objects.flatMap((p) => {
      const item = KIT_BY_ID.get(p.kind);
      if (!item || isGlb(item) || !(item.walkable || item.w * item.d > 20)) return [];
      const b = placedBounds(p);
      return b ? [b] : [];
    });
    const blocked = (x: number, z: number) =>
      (!!hq && x > hq.x - 0.4 && x < hq.x + 20.4 && z > hq.z - 0.4 && z < hq.z + 16.4)
      || covered.some((b) => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3)
      || layout.paths.some((p) => x > p.x0 - 0.3 && x < p.x1 + 0.3 && z > p.z0 - 0.3 && z < p.z1 + 0.3)
      || layout.buildings.some((b) => !!b.floor && x > b.rect.x0 - 0.3 && x < b.rect.x1 + 0.3 && z > b.rect.z0 - 0.3 && z < b.rect.z1 + 0.3)
      || layout.water.some((w) => ((x - w.cx) / (w.rx + 0.9)) ** 2 + ((z - w.cz) / (w.rz + 0.9)) ** 2 < 1)
      || (layout.plazas ?? []).some((c) => Math.hypot(x - c.cx, z - c.cz) < c.r + 0.3);
    const margin = 14;
    const x0 = area.x0 - margin;
    const z0 = area.z0 - margin;
    const w = area.x1 - area.x0 + margin * 2;
    const d = area.z1 - area.z0 + margin * 2;
    const want = Math.min(9000, Math.round(w * d * 0.55));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < want * 1.6 && mats.length < want; i++) {
      // Clumps: most tufts near another one.
      const x = x0 + rand() * w;
      const z = z0 + rand() * d;
      if (blocked(x, z)) continue;
      const k = 0.7 + rand() * 0.9;
      mats.push(m.compose(v.set(x, 0, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28), sc.set(k, k * (0.8 + rand() * 0.6), k)).clone());
    }
    const inst = new THREE.InstancedMesh(tuft, mat, mats.length);
    mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = shadows;
    inst.computeBoundingSphere();
    root.add(inst);
    disposables.push({ dispose: () => inst.dispose() });
  }

  // Names of places, on the floor.
  // (A stage's name would sit under the stage: the hall's name covers it.)
  const signs = layout.zones.filter((z) => z.type !== 'stage').map((z) => zoneLabel(z, keep));
  signs.forEach((m) => root.add(m));

  // Pieces: instanced, one InstancedMesh per part of each kit item.
  const partsByKind = new Map<string, Part[]>();
  for (const item of KIT_BY_ID.values()) if (!isGlb(item)) partsByKind.set(item.id, procParts(item.proc, item));
  const pieces = new THREE.Group();
  root.add(pieces);
  let current: Placed[] = layout.objects;
  let hidden: ReadonlySet<string> = new Set();
  let disposed = false;

  // Pieces with prop models: drawn in code until the model arrives, then from the model (each
  // piece choosing between a kind's models by its id, so a row of plants isn't all the same).
  const keyOf = (p: Placed): string => {
    const item = KIT_BY_ID.get(p.kind);
    if (!item?.model) return p.kind;
    const key = `${p.kind}#${variantOf(item, p.id)}`;
    return partsByKind.has(key) ? key : p.kind;
  };
  const asked = new Set<string>();
  let placeSoon: ReturnType<typeof setTimeout> | null = null;
  const loadModels = (list: Placed[]) => {
    for (const p of list) {
      const item = KIT_BY_ID.get(p.kind);
      if (!item?.model) continue;
      const v = variantOf(item, p.id);
      const key = `${p.kind}#${v}`;
      if (asked.has(key)) continue;
      asked.add(key);
      void loadItemParts(item, v).then((parts) => {
        if (disposed || !parts) return;
        // Parked cars and bikes show their (unlit) head and tail lights.
        partsByKind.set(key, !isGlb(item) && item.vehicle ? [...parts, ...vehicleLightParts(item, false)] : parts);
        if (ghostKind === p.kind) ghostKind = null;
        if (placeSoon) return;
        placeSoon = setTimeout(() => { placeSoon = null; if (!disposed) { place(); ghostAgain?.(); } }, 120);
      });
    }
  };
  let ghostAgain: (() => void) | null = null;

  const place = () => {
    for (const child of [...pieces.children]) { pieces.remove(child); (child as THREE.InstancedMesh).dispose?.(); }
    const byKind = new Map<string, Placed[]>();
    for (const p of current) {
      if (hidden.has(p.id)) continue;
      const key = keyOf(p);
      const list = byKind.get(key) ?? [];
      list.push(p);
      byKind.set(key, list);
    }
    const world = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    for (const [kind, list] of byKind) {
      const parts = partsByKind.get(kind);
      if (!parts) continue; // a GLB piece before the kit has loaded
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((p, i) => {
          world.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1));
          inst.setMatrixAt(i, tmp.multiplyMatrices(world, part.local));
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = shadows && part.shadow;
        inst.receiveShadow = shadows;
        inst.computeBoundingSphere();
        pieces.add(inst);
      }
    }
    markGlow(pieces);
  };
  loadModels(current);
  place();

  // Build mode: the preview and the selection outline.
  const ghostOk = keep(new THREE.MeshBasicMaterial({ color: '#E9B949', transparent: true, opacity: 0.55, depthWrite: false }));
  const ghostBad = keep(new THREE.MeshBasicMaterial({ color: '#D9483B', transparent: true, opacity: 0.55, depthWrite: false }));
  const ghost = new THREE.Group();
  ghost.renderOrder = 3;
  root.add(ghost);
  let ghostKind: string | null = null;
  const outlineMat = keep(new THREE.MeshBasicMaterial({ color: '#F4C66B', depthTest: false, transparent: true }));
  const outline = new THREE.Group();
  outline.renderOrder = 4;
  root.add(outline);
  const bar = keep(new THREE.BoxGeometry(1, 0.04, 1));
  markGlow(root);

  const api: CampusWorld = {
    root,
    attachKit(gltf) {
      gltf.scene.updateMatrixWorld(true);
      for (const item of KIT_BY_ID.values()) {
        if (!isGlb(item)) continue;
        // From the office's coordinates to the piece's own: pivot to the origin, facing +z.
        const toLocal = new THREE.Matrix4().makeRotationY(-item.rot0).multiply(new THREE.Matrix4().makeTranslation(-item.c[0], 0, -item.c[1]));
        const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
        for (const name of item.nodes) {
          const node = gltf.scene.getObjectByName(name);
          node?.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            let geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(toLocal);
            for (const a of Object.keys(geo.attributes)) if (a !== 'position' && a !== 'normal') geo.deleteAttribute(a);
            if (geo.index) geo = geo.toNonIndexed();
            const mat = mesh.material as THREE.Material;
            const list = byMat.get(mat) ?? [];
            list.push(geo);
            byMat.set(mat, list);
          });
        }
        const parts: Part[] = [];
        for (const [mat, geos] of byMat) {
          const merged = mergeGeometries(geos);
          geos.forEach((g) => g.dispose());
          if (merged) parts.push({ geo: keep(merged), mat, local: new THREE.Matrix4(), shadow: !mat.transparent });
        }
        partsByKind.set(item.id, parts);
      }
      ghostKind = null;
      place();
    },
    setObjects(objects) {
      current = objects;
      loadModels(current);
      place();
    },
    setHidden(ids) {
      if (ids.size === hidden.size && [...ids].every((id) => hidden.has(id))) return;
      hidden = new Set(ids);
      place();
    },
    setGhost(p, ok) {
      ghostAgain = null;
      if (!p) { ghost.visible = false; return; }
      loadModels([p]);
      ghostAgain = () => api.setGhost(p, ok);
      if (ghostKind !== p.kind) {
        ghost.clear();
        ghostKind = p.kind;
        for (const part of partsByKind.get(keyOf(p)) ?? []) {
          const m = new THREE.Mesh(part.geo, ghostOk);
          m.matrixAutoUpdate = false;
          m.matrix.copy(part.local);
          ghost.add(m);
        }
      }
      for (const m of ghost.children as THREE.Mesh[]) m.material = ok ? ghostOk : ghostBad;
      ghost.position.set(p.x, 0.01, p.z);
      ghost.rotation.y = p.rot;
      ghost.visible = true;
    },
    setSelected(b) {
      outline.clear();
      if (!b) return;
      const t = 0.08;
      const y = 0.12;
      const w = b.x1 - b.x0 + 0.3;
      const d = b.z1 - b.z0 + 0.3;
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      for (const [x, z, sx, sz] of [[cx, cz - d / 2, w, t], [cx, cz + d / 2, w, t], [cx - w / 2, cz, t, d], [cx + w / 2, cz, t, d]]) {
        const m = new THREE.Mesh(bar, outlineMat);
        m.position.set(x, y, z);
        m.scale.set(sx, 1, sz);
        outline.add(m);
      }
    },
    follow(target, sun, camera) {
      for (const m of signs) m.quaternion.copy(camera.quaternion);
      // A shadow box about 50 m across, centred on the view, moved in whole texels so edges don't shimmer.
      const step = 50 / 2048;
      const tx = Math.round(target.x / step) * step;
      const tz = Math.round(target.z / step) * step;
      sun.target.position.set(tx, 0, tz);
      // Late-afternoon sun from the front right: long, soft shadows.
      sun.position.set(tx + 20, 24, tz + 15);
      sun.target.updateMatrixWorld();
    },
    update(dt) {
      ripples.offset.x += dt * 0.012;
      ripples.offset.y += dt * 0.008;
    },
    dispose() {
      disposed = true;
      if (placeSoon) clearTimeout(placeSoon);
      for (const child of [...pieces.children]) (child as THREE.InstancedMesh).dispose?.();
      disposables.forEach((d) => d.dispose());
    },
  };
  return api;
}

function zoneLabel(z: Zone, keep: <T extends { dispose(): void }>(x: T) => T): THREE.Mesh {
  const text = z.name;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '600 64px Inter, system-ui, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 72;
  c.width = w;
  c.height = 104;
  g.font = font;
  g.fillStyle = 'rgba(13,28,59,0.78)';
  const rad = 44;
  g.beginPath();
  g.moveTo(rad, 4); g.lineTo(w - rad, 4); g.quadraticCurveTo(w - 4, 4, w - 4, rad); g.lineTo(w - 4, 100 - rad); g.quadraticCurveTo(w - 4, 100, w - rad, 100);
  g.lineTo(rad, 100); g.quadraticCurveTo(4, 100, 4, 100 - rad); g.lineTo(4, rad); g.quadraticCurveTo(4, 4, rad, 4);
  g.fill();
  g.fillStyle = '#F4C66B';
  g.textBaseline = 'middle';
  g.fillText(text, 36, 54);
  const tex = keep(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const height = z.type === 'meeting_room' || z.type === 'private_office' ? 0.7 : 1.05;
  const width = (height * c.width) / c.height;
  const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(width, height)), keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })));
  // A sign hanging above the room's back wall, facing the camera (see follow), so furniture never covers it.
  const { x0, x1, z0 } = z.rect;
  mesh.position.set((x0 + x1) / 2, 2.7, z0 + 2.6);
  mesh.renderOrder = 2;
  return mesh;
}

/** The part of a layout inside `rect` (by where each thing's middle is). */
function within(layout: CampusLayout, rect: Rect): CampusLayout {
  const inside = (x: number, z: number) => x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
  const mid = (r: Rect) => inside((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
  return {
    ...layout,
    buildings: layout.buildings.filter((b) => mid(b.rect)),
    zones: layout.zones.filter((z) => mid(z.rect)),
    paths: layout.paths.filter(mid),
    water: layout.water.filter((w) => inside(w.cx, w.cz)),
    objects: layout.objects.filter((o) => inside(o.x, o.z)),
    walks: (layout.walks ?? []).filter((w) => inside(w.points[0][0], w.points[0][1])),
    plazas: (layout.plazas ?? []).filter((c) => inside(c.cx, c.cz)),
  };
}

export interface World extends CampusWorld {
  /** Show only this wing (the Hub), or everything (null). */
  showWing(id: string | null): void;
}

/**
 * The world for a layout: one piece for the Campus, or one per wing for the Hub, where only the
 * wing you're in is drawn.
 */
export function createWorld(layout: CampusLayout, opts: WorldOptions): World {
  const wings = layout.wings ?? [];
  if (!wings.length) return { ...createCampusWorld(layout, opts), showWing: () => {} };
  const root = new THREE.Group();
  root.name = 'hub';
  // Each place is built when it's first shown (the one you arrive in straight away), and the rest
  // one at a time just after, so arriving doesn't wait for every place to be built.
  const parts = wings.map((wing) => ({ wing, world: null as CampusWorld | null }));
  let kit: GLTF | null = null;
  let objects = layout.objects;
  let hiddenIds: ReadonlySet<string> = new Set();
  let shown: string | null | undefined; // undefined: not chosen yet, so everything shows
  const holder = (x: number, z: number) => parts.find((p) => x >= p.wing.rect.x0 && x <= p.wing.rect.x1 && z >= p.wing.rect.z0 && z <= p.wing.rect.z1);
  const visible = (p: (typeof parts)[number]) => shown == null || p.wing.id === shown;
  const built = () => parts.filter((p) => p.world) as { wing: (typeof parts)[number]['wing']; world: CampusWorld }[];
  const build = (p: (typeof parts)[number]): CampusWorld => {
    if (p.world) return p.world;
    const w = createCampusWorld(within(layout, p.wing.rect), { ...opts, bounds: p.wing.rect, outdoor: p.wing.outdoor });
    p.world = w;
    if (kit) w.attachKit(kit);
    if (objects !== layout.objects) w.setObjects(objects.filter((o) => holder(o.x, o.z) === p));
    if (hiddenIds.size) w.setHidden(hiddenIds);
    w.root.visible = visible(p);
    root.add(w.root);
    return w;
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const buildNext = () => {
    timer = null;
    const next = parts.find((p) => !p.world);
    if (!next) return;
    build(next);
    timer = setTimeout(buildNext, 120);
  };
  timer = setTimeout(buildNext, 1500);
  return {
    root,
    attachKit: (gltf) => { kit = gltf; built().forEach((p) => p.world.attachKit(gltf)); },
    setObjects: (next) => { objects = next; built().forEach((p) => p.world.setObjects(next.filter((o) => holder(o.x, o.z) === p))); },
    setHidden: (ids) => { hiddenIds = ids; built().forEach((p) => p.world.setHidden(ids)); },
    setGhost: (g, ok) => { const at = g ? holder(g.x, g.z) : undefined; if (at) build(at); built().forEach((p) => p.world.setGhost(p === at ? g : null, ok)); },
    setSelected: (b) => { const at = b ? holder((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) : undefined; built().forEach((p) => p.world.setSelected(p === at ? b : null)); },
    follow: (target, sun, camera) => built().forEach((p) => { if (p.world.root.visible) p.world.follow(target, sun, camera); }),
    update: (dt) => built().forEach((p) => { if (p.world.root.visible) p.world.update(dt); }),
    showWing: (id) => {
      shown = id;
      parts.forEach((p) => { if (visible(p)) build(p); if (p.world) p.world.root.visible = visible(p); });
    },
    dispose: () => { if (timer) clearTimeout(timer); built().forEach((p) => p.world.dispose()); },
  };
}
