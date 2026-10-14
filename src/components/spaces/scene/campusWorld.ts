/**
 * Draws SYNAPSE Campus (spatial/scene/campus/layout.ts) with three.js: the lawn, stone avenues,
 * the pond, buildings (raised floors with their finish, low navy walls with a gold cap, or glass),
 * the headquarters (Office 02 as built), every placed piece as instanced meshes (one draw per part,
 * however many desks or trees), and the names of places on the floor.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIT_BY_ID, isGlb, type Placed, type ProcItem, type ProcKind } from '@/spatial/scene/campus/kit';
import { WALL_T, wallSegments, type CampusLayout, type FloorFinish, type Zone } from '@/spatial/scene/campus/layout';

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4; shadow: boolean }

const GOLD = '#C9952F';
const NAVY_WALL = '#22314F';

// ---------------------------------------------------------------- textures

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Deterministic noise so the textures look the same for everyone. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function speckle(g: CanvasRenderingContext2D, s: number, colors: string[], n: number, size: [number, number], seed: number) {
  const rand = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rand() * colors.length)];
    const w = size[0] + rand() * (size[1] - size[0]);
    g.globalAlpha = 0.25 + rand() * 0.4;
    g.fillRect(rand() * s, rand() * s, w, w);
  }
  g.globalAlpha = 1;
}

const lawnTex = () => canvasTex(256, (g, s) => {
  g.fillStyle = '#5B8C3A';
  g.fillRect(0, 0, s, s);
  // Mowing stripes and blades of grass.
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)'; g.fillRect(0, (i * s) / 8, s, s / 8); }
  speckle(g, s, ['#4E7C30', '#6A9C45', '#557F35', '#77A84F'], 2600, [1, 2.5], 7);
}, 1);

/** Slate-blue pavers in a herringbone, with a few warm stones. */
const paverTex = () => canvasTex(256, (g, s) => {
  g.fillStyle = '#5E6878';
  g.fillRect(0, 0, s, s);
  const u = s / 8;
  const rand = rng(3);
  const stone = () => {
    const warm = rand() < 0.12;
    const v = Math.floor(rand() * 16);
    return warm ? `rgb(${150 + v},${118 + v},${84 + v})` : `rgb(${112 + v},${122 + v},${138 + v})`;
  };
  for (let row = -1; row < 9; row++) {
    for (let col = -1; col < 9; col++) {
      const x = col * u;
      const y = row * u;
      g.fillStyle = stone();
      if ((row + col) % 2 === 0) g.fillRect(x + 1.5, y + 1.5, u * 2 - 3, u - 3);
      else g.fillRect(x + 1.5, y + 1.5, u - 3, u * 2 - 3);
    }
  }
  speckle(g, s, ['#4C5566', '#8A94A6'], 900, [1, 2], 11);
}, 1);

function finishTex(f: FloorFinish): THREE.CanvasTexture {
  switch (f) {
    case 'oak':
    case 'walnut': {
      const base = f === 'oak' ? [196, 150, 98] : [126, 86, 56];
      return canvasTex(256, (g, s) => {
        const rand = rng(f === 'oak' ? 5 : 9);
        const plank = s / 8;
        for (let i = 0; i < 8; i++) {
          const v = (rand() - 0.5) * 26;
          g.fillStyle = `rgb(${base[0] + v},${base[1] + v * 0.8},${base[2] + v * 0.6})`;
          g.fillRect(0, i * plank, s, plank);
          g.fillStyle = 'rgba(0,0,0,0.18)';
          g.fillRect(0, i * plank, s, 1.5);
          const joint = rand() * s;
          g.fillRect(joint, i * plank, 1.5, plank);
          // grain
          g.strokeStyle = 'rgba(60,35,15,0.10)';
          for (let k = 0; k < 4; k++) { g.beginPath(); const y = i * plank + rand() * plank; g.moveTo(0, y); g.bezierCurveTo(s / 3, y + 3, (2 * s) / 3, y - 3, s, y); g.stroke(); }
        }
      });
    }
    case 'slate':
      return canvasTex(256, (g, s) => {
        g.fillStyle = '#4A5568';
        g.fillRect(0, 0, s, s);
        const t = s / 4;
        const rand = rng(13);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = Math.floor(rand() * 18); g.fillStyle = `rgb(${70 + v},${80 + v},${98 + v})`; g.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3); }
      });
    case 'terrazzo':
      return canvasTex(256, (g, s) => {
        g.fillStyle = '#8D97A8';
        g.fillRect(0, 0, s, s);
        speckle(g, s, ['#E2C27A', '#2C3E66', '#FFFFFF', '#5C6B84'], 1400, [1.5, 4], 17);
      });
    default: {
      const c = f === 'carpet_navy' ? '#25406E' : f === 'carpet_green' ? '#2E5E4A' : '#5A3A5E';
      return canvasTex(128, (g, s) => {
        g.fillStyle = c;
        g.fillRect(0, 0, s, s);
        speckle(g, s, ['rgba(255,255,255,0.5)', 'rgba(0,0,0,0.6)'], 1600, [1, 1.6], 19);
      });
    }
  }
}

// ---------------------------------------------------------------- pieces drawn in code

const M = {
  trunk: new THREE.MeshStandardMaterial({ color: '#6B4A2E', roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: '#4F8A3A', roughness: 0.85, flatShading: true }),
  leafDark: new THREE.MeshStandardMaterial({ color: '#3D7030', roughness: 0.85, flatShading: true }),
  pine: new THREE.MeshStandardMaterial({ color: '#2F6B3A', roughness: 0.85, flatShading: true }),
  blossom: new THREE.MeshStandardMaterial({ color: '#F2A7C3', roughness: 0.8, flatShading: true }),
  blossomDeep: new THREE.MeshStandardMaterial({ color: '#E27FA6', roughness: 0.8, flatShading: true }),
  stone: new THREE.MeshStandardMaterial({ color: '#9DA3AE', roughness: 0.85 }),
  stoneDark: new THREE.MeshStandardMaterial({ color: '#6F7684', roughness: 0.9 }),
  water: new THREE.MeshStandardMaterial({ color: '#3FA9D6', roughness: 0.08, metalness: 0.1, emissive: '#0E4F78', emissiveIntensity: 0.25 }),
  metal: new THREE.MeshStandardMaterial({ color: '#1C2333', roughness: 0.45, metalness: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: '#9A6B42', roughness: 0.7 }),
  glow: new THREE.MeshStandardMaterial({ color: '#FFE2A8', emissive: '#FFC861', emissiveIntensity: 1.2 }),
  soil: new THREE.MeshStandardMaterial({ color: '#4A3526', roughness: 1 }),
  petalA: new THREE.MeshStandardMaterial({ color: '#E8505B', roughness: 0.8 }),
  petalB: new THREE.MeshStandardMaterial({ color: '#F5C542', roughness: 0.8 }),
  petalC: new THREE.MeshStandardMaterial({ color: '#8E6CEF', roughness: 0.8 }),
  felt: new THREE.MeshStandardMaterial({ color: '#1F6B4F', roughness: 0.95 }),
  navy: new THREE.MeshStandardMaterial({ color: '#1B2A4A', roughness: 0.6 }),
  screen: new THREE.MeshStandardMaterial({ color: '#0B1426', emissive: '#2E5BB8', emissiveIntensity: 0.55, roughness: 0.3 }),
  stageTop: new THREE.MeshStandardMaterial({ color: '#2A2F3A', roughness: 0.55 }),
  bean: new THREE.MeshStandardMaterial({ color: '#C9952F', roughness: 0.9 }),
  arcade: new THREE.MeshStandardMaterial({ color: '#5B2A86', roughness: 0.5 }),
};

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cylLow: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  ico: new THREE.IcosahedronGeometry(0.5, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  goldRing: new THREE.TorusGeometry(3.0, 0.07, 8, 64),
};

const mx = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

function procParts(kind: ProcKind, item: ProcItem): Part[] {
  const P = (geo: THREE.BufferGeometry, mat: THREE.Material, local: THREE.Matrix4, shadow = true): Part => ({ geo, mat, local, shadow });
  switch (kind) {
    case 'tree':
      return [P(G.cyl, M.trunk, mx(0, 0.8, 0, 0.22, 1.6, 0.22)), P(G.ico, M.leaf, mx(0, 2.3, 0, 2.2, 1.8, 2.2)), P(G.ico, M.leafDark, mx(0.35, 2.9, -0.2, 1.4, 1.2, 1.4))];
    case 'blossom':
      return [P(G.cyl, M.trunk, mx(0, 0.75, 0, 0.2, 1.5, 0.2)), P(G.ico, M.blossom, mx(0, 2.2, 0, 2.3, 1.7, 2.3)), P(G.ico, M.blossomDeep, mx(-0.4, 2.7, 0.3, 1.3, 1.1, 1.3))];
    case 'pine':
      return [P(G.cyl, M.trunk, mx(0, 0.4, 0, 0.18, 0.8, 0.18)), P(G.cone, M.pine, mx(0, 1.5, 0, 1.6, 1.8, 1.6)), P(G.cone, M.pine, mx(0, 2.5, 0, 1.15, 1.5, 1.15))];
    case 'bush':
      return [P(G.ico, M.leaf, mx(0, 0.45, 0, 1.2, 0.9, 1.2)), P(G.ico, M.leafDark, mx(0.25, 0.65, 0.1, 0.7, 0.6, 0.7))];
    case 'hedge':
      return [P(G.box, M.leafDark, mx(0, 0.45, 0, item.w, 0.9, 0.7))];
    case 'flowers': {
      const parts = [P(G.box, M.soil, mx(0, 0.08, 0, 2.4, 0.16, 1.2), false)];
      const rand = rng(23);
      for (let i = 0; i < 18; i++) parts.push(P(G.sphere, [M.petalA, M.petalB, M.petalC][i % 3], mx(-1.05 + rand() * 2.1, 0.25, -0.45 + rand() * 0.9, 0.22, 0.18, 0.22), false));
      for (let i = 0; i < 8; i++) parts.push(P(G.ico, M.leaf, mx(-1.0 + rand() * 2, 0.2, -0.4 + rand() * 0.8, 0.35, 0.25, 0.35), false));
      return parts;
    }
    case 'lamp_post':
      return [P(G.cylLow, M.metal, mx(0, 1.4, 0, 0.09, 2.8, 0.09)), P(G.cylLow, M.metal, mx(0, 0.06, 0, 0.32, 0.12, 0.32)), P(G.sphere, M.glow, mx(0, 2.95, 0, 0.36, 0.36, 0.36), false), P(G.cylLow, M.gold, mx(0, 2.75, 0, 0.22, 0.06, 0.22))];
    case 'bench':
      return [
        P(G.box, M.wood, mx(0, 0.45, 0, 1.8, 0.07, 0.5)), P(G.box, M.wood, mx(0, 0.75, 0.24, 1.8, 0.35, 0.06)),
        P(G.box, M.metal, mx(-0.8, 0.22, 0, 0.06, 0.45, 0.5)), P(G.box, M.metal, mx(0.8, 0.22, 0, 0.06, 0.45, 0.5)),
      ];
    case 'fountain':
      return [
        P(G.cyl, M.stone, mx(0, 0.25, 0, 2.6, 0.5, 2.6)), P(G.cyl, M.water, mx(0, 0.47, 0, 2.3, 0.08, 2.3), false),
        P(G.cyl, M.stone, mx(0, 0.8, 0, 0.35, 1.1, 0.35)), P(G.cyl, M.stone, mx(0, 1.35, 0, 1.0, 0.15, 1.0)), P(G.sphere, M.water, mx(0, 1.5, 0, 0.7, 0.35, 0.7), false),
      ];
    case 'big_fountain':
      return [
        P(G.cyl, M.stoneDark, mx(0, 0.15, 0, 6.6, 0.3, 6.6)), P(G.cyl, M.stone, mx(0, 0.35, 0, 6.0, 0.5, 6.0)), P(G.cyl, M.water, mx(0, 0.58, 0, 5.5, 0.06, 5.5), false),
        P(G.goldRing, M.gold, mx(0, 0.62, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false),
        P(G.cyl, M.stone, mx(0, 1.0, 0, 0.6, 1.4, 0.6)), P(G.cyl, M.stone, mx(0, 1.65, 0, 2.4, 0.2, 2.4)), P(G.cyl, M.water, mx(0, 1.77, 0, 2.1, 0.06, 2.1), false),
        P(G.cyl, M.stone, mx(0, 2.15, 0, 0.3, 0.8, 0.3)), P(G.cyl, M.stone, mx(0, 2.55, 0, 1.0, 0.14, 1.0)), P(G.sphere, M.water, mx(0, 2.75, 0, 0.6, 0.45, 0.6), false),
      ];
    case 'boulder':
      return [P(G.ico, M.stoneDark, mx(0, 0.3, 0, 1.2, 0.7, 1.0)), P(G.ico, M.stone, mx(0.35, 0.25, 0.2, 0.6, 0.45, 0.55))];
    case 'rug':
      return [P(G.box, new THREE.MeshStandardMaterial({ color: item.color ?? '#1E3A6E', roughness: 1 }), mx(0, 0.012, 0, 3, 0.02, 2), false)];
    case 'stage':
      return [P(G.box, M.stageTop, mx(0, 0.18, 0, 8, 0.36, 3)), P(G.box, M.gold, mx(0, 0.37, 1.48, 8, 0.03, 0.05), false)];
    case 'big_screen':
      return [P(G.box, M.navy, mx(0, 2.0, 0, 6.2, 2.6, 0.12)), P(G.box, M.screen, mx(0, 2.0, 0.07, 5.9, 2.35, 0.02), false), P(G.box, M.gold, mx(0, 0.72, 0.02, 6.2, 0.04, 0.16), false)];
    case 'podium':
      return [P(G.box, M.navy, mx(0, 0.55, 0, 0.7, 1.1, 0.5)), P(G.box, M.gold, mx(0, 1.12, 0, 0.74, 0.04, 0.54), false)];
    case 'pool_table':
      return [P(G.box, M.wood, mx(0, 0.72, 0, 2.4, 0.16, 1.3)), P(G.box, M.felt, mx(0, 0.81, 0, 2.15, 0.02, 1.05), false), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => P(G.box, M.wood, mx(a * 1.05, 0.33, b * 0.5, 0.14, 0.66, 0.14)))];
    case 'arcade':
      return [P(G.box, M.arcade, mx(0, 0.85, 0, 0.8, 1.7, 0.7)), P(G.box, M.screen, mx(0, 1.25, 0.36, 0.6, 0.45, 0.02), false), P(G.box, M.gold, mx(0, 1.72, 0, 0.82, 0.06, 0.72), false)];
    case 'beanbag':
      return [P(G.sphere, M.bean, mx(0, 0.28, 0, 0.9, 0.55, 0.9))];
  }
}

// ---------------------------------------------------------------- the world

export interface CampusWorld {
  root: THREE.Group;
  /** Called when the office GLB has loaded (the HQ and the furniture kit). */
  attachKit(gltf: GLTF): void;
  /** Re-place the pieces (after build mode changes). */
  setObjects(objects: Placed[]): void;
  /** Keep the sun's shadow box over where the camera looks. */
  follow(target: THREE.Vector3, sun: THREE.DirectionalLight): void;
  dispose(): void;
}

export function createCampusWorld(layout: CampusLayout, { shadows }: { shadows: boolean }): CampusWorld {
  const root = new THREE.Group();
  root.name = 'campus';
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  // Lawn, past the edges of the screen.
  const lawn = keep(lawnTex());
  lawn.repeat.set(70, 70);
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(420, 420)), keep(new THREE.MeshStandardMaterial({ map: lawn, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(layout.width / 2, -0.02, layout.depth / 2);
  ground.receiveShadow = shadows;
  root.add(ground);

  // Avenues and paths: one merged mesh, texture in world metres.
  {
    const paver = keep(paverTex());
    const geos = layout.paths.map((p) => {
      const g = new THREE.BoxGeometry(p.x1 - p.x0, 0.05, p.z1 - p.z0);
      g.translate((p.x0 + p.x1) / 2, 0.0, (p.z0 + p.z1) / 2);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 3, pos.getZ(i) / 3);
      return g;
    });
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (merged) {
      const mesh = new THREE.Mesh(keep(merged), keep(new THREE.MeshStandardMaterial({ map: paver, roughness: 0.9 })));
      mesh.receiveShadow = shadows;
      root.add(mesh);
    }
  }

  // Water with a stone rim.
  for (const w of layout.water) {
    const rim = new THREE.Mesh(keep(new THREE.CylinderGeometry(1, 1, 0.3, 48)), M.stone);
    rim.scale.set(w.rx + 0.6, 1, w.rz + 0.6);
    rim.position.set(w.cx, 0.1, w.cz);
    rim.receiveShadow = shadows;
    const water = new THREE.Mesh(keep(new THREE.CylinderGeometry(1, 1, 0.05, 48)), M.water);
    water.scale.set(w.rx, 1, w.rz);
    water.position.set(w.cx, 0.24, w.cz);
    root.add(rim, water);
  }

  // Buildings: raised floor, walls.
  {
    const wallMat = keep(new THREE.MeshStandardMaterial({ color: NAVY_WALL, roughness: 0.7 }));
    const capMat = keep(new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.6 }));
    const glassMat = keep(new THREE.MeshPhysicalMaterial({ color: '#BFE0F5', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide }));
    const frameMat = keep(new THREE.MeshStandardMaterial({ color: '#1B2A4A', roughness: 0.5, metalness: 0.4 }));
    const finishes = new Map<FloorFinish, THREE.MeshStandardMaterial>();
    const wallGeos: THREE.BufferGeometry[] = [];
    const capGeos: THREE.BufferGeometry[] = [];
    const glassGeos: THREE.BufferGeometry[] = [];
    const frameGeos: THREE.BufferGeometry[] = [];
    const piece = (list: THREE.BufferGeometry[], x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      list.push(g);
    };
    for (const b of layout.buildings) {
      let mat = finishes.get(b.floor);
      if (!mat) {
        const t = keep(finishTex(b.floor));
        mat = keep(new THREE.MeshStandardMaterial({ map: t, roughness: b.floor.startsWith('carpet') ? 1 : 0.6 }));
        finishes.set(b.floor, mat);
      }
      const { x0, x1, z0, z1 } = b.rect;
      const fg = new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0);
      fg.translate((x0 + x1) / 2, 0.0, (z0 + z1) / 2);
      const uv = fg.attributes.uv as THREE.BufferAttribute;
      const pos = fg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 3, pos.getZ(i) / 3);
      const floor = new THREE.Mesh(keep(fg), mat);
      floor.receiveShadow = shadows;
      root.add(floor);
      for (const s of wallSegments(b)) {
        if (b.wall === 'solid') {
          piece(wallGeos, s.x0, s.x1, s.z0, s.z1, 0, 1.1);
          piece(capGeos, s.x0 - 0.02, s.x1 + 0.02, s.z0 - 0.02, s.z1 + 0.02, 1.1, 1.16);
        } else {
          const along = s.x1 - s.x0 > s.z1 - s.z0;
          const mid = along ? (s.z0 + s.z1) / 2 : (s.x0 + s.x1) / 2;
          if (along) piece(glassGeos, s.x0, s.x1, mid - 0.02, mid + 0.02, 0.1, 2.3);
          else piece(glassGeos, mid - 0.02, mid + 0.02, s.z0, s.z1, 0.1, 2.3);
          // Frame: base, top rail and posts every 2 m.
          piece(frameGeos, s.x0, s.x1, s.z0, s.z1, 0, 0.1);
          piece(frameGeos, s.x0, s.x1, s.z0, s.z1, 2.3, 2.38);
          const len = along ? s.x1 - s.x0 : s.z1 - s.z0;
          const posts = Math.max(1, Math.round(len / 2));
          for (let k = 0; k <= posts; k++) {
            const t = (along ? s.x0 : s.z0) + (len * k) / posts;
            if (along) piece(frameGeos, t - 0.04, t + 0.04, s.z0, s.z1, 0, 2.38);
            else piece(frameGeos, s.x0, s.x1, t - 0.04, t + 0.04, 0, 2.38);
          }
        }
      }
    }
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
    add(wallGeos, wallMat, true);
    add(capGeos, capMat, false);
    add(frameGeos, frameMat, true);
    add(glassGeos, glassMat, false);
    void WALL_T;
  }

  // Names of places, on the floor.
  // (A stage's name would sit under the stage: the hall's name covers it.)
  for (const z of layout.zones) if (z.type !== 'stage') root.add(zoneLabel(z, keep));

  // Pieces: instanced, one InstancedMesh per part of each kit item.
  const partsByKind = new Map<string, Part[]>();
  for (const item of KIT_BY_ID.values()) if (!isGlb(item)) partsByKind.set(item.id, procParts(item.proc, item));
  const pieces = new THREE.Group();
  root.add(pieces);
  let current: Placed[] = layout.objects;

  const place = () => {
    for (const child of [...pieces.children]) { pieces.remove(child); (child as THREE.InstancedMesh).dispose?.(); }
    const byKind = new Map<string, Placed[]>();
    for (const p of current) { const list = byKind.get(p.kind) ?? []; list.push(p); byKind.set(p.kind, list); }
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
  };
  place();

  return {
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
      place();
    },
    setObjects(objects) {
      current = objects;
      place();
    },
    follow(target, sun) {
      // A shadow box about 50 m across, centred on the view, moved in whole texels so edges don't shimmer.
      const step = 50 / 2048;
      const tx = Math.round(target.x / step) * step;
      const tz = Math.round(target.z / step) * step;
      sun.target.position.set(tx, 0, tz);
      sun.position.set(tx + 14, 30, tz + 16);
      sun.target.updateMatrixWorld();
    },
    dispose() {
      for (const child of [...pieces.children]) (child as THREE.InstancedMesh).dispose?.();
      disposables.forEach((d) => d.dispose());
    },
  };
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
  const height = z.type === 'meeting_room' || z.type === 'private_office' ? 0.6 : 0.95;
  const width = (height * c.width) / c.height;
  const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(width, height)), keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })));
  mesh.rotation.x = -Math.PI / 2;
  const { x0, x1, z0 } = z.rect;
  mesh.position.set((x0 + x1) / 2, 0.06, z0 + height * 0.5 + 0.45);
  mesh.renderOrder = 2;
  return mesh;
}
