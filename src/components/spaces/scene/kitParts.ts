/**
 * Pieces drawn in code for the large worlds (SYNAPSE Campus and SYNAPSE Hub): trees, palms, flower
 * beds, lamps, string lights, pergolas, and the furniture of the Hub's rooms (theatre seats, a bar,
 * sofas, booths…). Each kind is a few parts (geometry + material + placement); the world draws every
 * part of a kind as one instanced mesh, however many of them stand around.
 *
 * Plants and fabric use vertex colours, so a tree is two draws (bark, leaves) with dozens of shades
 * in it. Lights use HDR colours (above 1) on unlit materials: the bloom pass makes them glow.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProcItem, ProcKind } from '@/spatial/scene/campus/kit';

export interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4; shadow: boolean }

export const GOLD = '#C9952F';

// ---------------------------------------------------------------- helpers

/** Deterministic noise so everything looks the same for everyone. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

export function speckle(g: CanvasRenderingContext2D, s: number, colors: string[], n: number, size: [number, number], seed: number, alpha: [number, number] = [0.25, 0.65]) {
  const rand = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rand() * colors.length)];
    const w = size[0] + rand() * (size[1] - size[0]);
    g.globalAlpha = alpha[0] + rand() * (alpha[1] - alpha[0]);
    g.fillRect(rand() * s, rand() * s, w, w);
  }
  g.globalAlpha = 1;
}

export const mx = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

const P = (geo: THREE.BufferGeometry, mat: THREE.Material, local = new THREE.Matrix4(), shadow = true): Part => ({ geo, mat, local, shadow });

/** A number in 0..1 from three integers (the same for the same point). */
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Builds one vertex-coloured geometry from many shapes. `shade` darkens the lower part of each
 * shape (soft self-shadowing), `jitter` varies the colour a little per vertex.
 */
class Painter {
  private geos: THREE.BufferGeometry[] = [];
  private c = new THREE.Color();
  constructor(private rand: () => number) {}
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, { jitter = 0.06, shade = 0.35, hdr = 1, bump = 0 } = {}) {
    let g = geo.clone().applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    g.computeBoundingBox();
    if (bump > 0) {
      // Leafy, uneven surface: push each point in or out by noise of where it is (shared corners
      // move together, so nothing cracks), then shade it faceted like clumps of leaves.
      const c = g.boundingBox!.getCenter(new THREE.Vector3());
      const size = g.boundingBox!.getSize(new THREE.Vector3());
      const r = Math.min(size.x, size.y, size.z) / 2;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = hash3(Math.round(v.x * 200), Math.round(v.y * 200), Math.round(v.z * 200));
        const dir = v.clone().sub(c).normalize();
        v.addScaledVector(dir, (n - 0.45) * bump * r);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      g.computeBoundingBox();
    }
    const y0 = g.boundingBox!.min.y;
    const h = Math.max(1e-3, g.boundingBox!.max.y - y0);
    const col = new Float32Array(pos.count * 3);
    const base = new THREE.Color(color);
    for (let i = 0; i < pos.count; i++) {
      const up = (pos.getY(i) - y0) / h;
      const k = (1 - shade + shade * up) * (1 + (this.rand() - 0.5) * 2 * jitter);
      this.c.copy(base).multiplyScalar(k * hdr);
      col[i * 3] = this.c.r; col[i * 3 + 1] = this.c.g; col[i * 3 + 2] = this.c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
    return this;
  }
  done(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos) ?? new THREE.BufferGeometry();
    this.geos.forEach((g) => g.dispose());
    this.geos = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

// ---------------------------------------------------------------- textures

const woodTex = (base: [number, number, number], seed: number) => canvasTex(256, (g, s) => {
  const rand = rng(seed);
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, s, s);
  for (let k = 0; k < 90; k++) {
    g.strokeStyle = `rgba(${40 + rand() * 30},${22 + rand() * 18},${10},${0.06 + rand() * 0.1})`;
    g.lineWidth = 0.6 + rand() * 1.8;
    g.beginPath();
    const y = rand() * s;
    g.moveTo(0, y);
    g.bezierCurveTo(s * 0.3, y + (rand() - 0.5) * 10, s * 0.7, y + (rand() - 0.5) * 10, s, y + (rand() - 0.5) * 4);
    g.stroke();
  }
});

/** Soft round light on the ground under a lamp. */
const glowTex = () => canvasTex(128, (g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,200,120,0.85)');
  grad.addColorStop(0.35, 'rgba(255,180,90,0.35)');
  grad.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});

/** A big screen's picture: soft waves of colour. */
const screenTex = () => canvasTex(512, (g, s) => {
  const bg = g.createLinearGradient(0, 0, s, s * 0.6);
  bg.addColorStop(0, '#1B2C6B');
  bg.addColorStop(0.5, '#3D63D8');
  bg.addColorStop(1, '#0E1A44');
  g.fillStyle = bg;
  g.fillRect(0, 0, s, s);
  const waves: [string, number, number][] = [['#F29B4B', 0.55, 0.9], ['#F45B8B', 0.62, 0.7], ['#F6C557', 0.7, 0.55], ['#52C7E8', 0.45, 0.6]];
  for (const [c, yk, a] of waves) {
    g.globalAlpha = a;
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, s);
    for (let x = 0; x <= s; x += 8) g.lineTo(x, s * yk + Math.sin((x / s) * Math.PI * 2 + yk * 9) * s * 0.08);
    g.lineTo(s, s);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
}, 1);

const booksTex = () => canvasTex(256, (g, s) => {
  const rand = rng(41);
  g.fillStyle = '#3A2A1E';
  g.fillRect(0, 0, s, s);
  const shelves = 4;
  const sh = s / shelves;
  const colors = ['#8B2E2E', '#1F3F6E', '#2F6B4F', '#C9952F', '#5A3A5E', '#B85C38', '#2C2C34', '#7A8B5A'];
  for (let r = 0; r < shelves; r++) {
    let x = 4;
    while (x < s - 6) {
      const w = 5 + rand() * 9;
      const h = sh * (0.62 + rand() * 0.3);
      g.fillStyle = colors[Math.floor(rand() * colors.length)];
      g.fillRect(x, r * sh + sh - h - 4, w - 1, h);
      x += w;
    }
    g.fillStyle = '#5C4330';
    g.fillRect(0, r * sh + sh - 4, s, 4);
  }
});

const bottlesTex = () => canvasTex(256, (g, s) => {
  const rand = rng(57);
  g.fillStyle = '#20160F';
  g.fillRect(0, 0, s, s);
  const rows = 3;
  const rh = s / rows;
  for (let r = 0; r < rows; r++) {
    // Backlight.
    const grad = g.createLinearGradient(0, r * rh, 0, r * rh + rh);
    grad.addColorStop(0, 'rgba(255,190,110,0.15)');
    grad.addColorStop(1, 'rgba(255,170,80,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, r * rh, s, rh - 5);
    let x = 6;
    while (x < s - 8) {
      const w = 7 + rand() * 6;
      const h = rh * (0.45 + rand() * 0.35);
      g.fillStyle = ['#6B3A1E', '#2E5B3A', '#8C7A3A', '#3A2F5E', '#B5682A', '#C9C2A0'][Math.floor(rand() * 6)];
      g.fillRect(x, r * rh + rh - 5 - h, w, h);
      g.fillRect(x + w * 0.35, r * rh + rh - 5 - h - 7, w * 0.3, 7);
      x += w + 3 + rand() * 4;
    }
    g.fillStyle = '#C9952F';
    g.fillRect(0, r * rh + rh - 5, s, 3);
  }
});

const boothTex = (color: string) => canvasTex(256, (g, s) => {
  g.fillStyle = color;
  g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.arc(s * 0.8, s * 0.2, s * 0.45, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, s * 0.78, s, s * 0.22);
  g.fillStyle = '#F4C66B';
  g.fillRect(s * 0.1, s * 0.2, s * 0.4, s * 0.05);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(s * 0.1, s * 0.3, s * 0.55, s * 0.025);
  g.fillRect(s * 0.1, s * 0.35, s * 0.45, s * 0.025);
});

// ---------------------------------------------------------------- shared materials and shapes

let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  const glow = glowTex();
  const screen = screenTex();
  return {
    M: {
      leaves: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
      fabric: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
      gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 }),
      leafSheet: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }),
      bulbs: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      glowDecal: new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.6 }),
      bark: new THREE.MeshStandardMaterial({ color: '#5E4330', roughness: 0.95 }),
      wood: new THREE.MeshStandardMaterial({ map: woodTex([150, 102, 62], 3), roughness: 0.55 }),
      woodDark: new THREE.MeshStandardMaterial({ map: woodTex([92, 60, 38], 7), roughness: 0.5 }),
      woodLight: new THREE.MeshStandardMaterial({ map: woodTex([190, 142, 92], 11), roughness: 0.55 }),
      metal: new THREE.MeshStandardMaterial({ color: '#1E2430', roughness: 0.35, metalness: 0.75 }),
      brass: new THREE.MeshStandardMaterial({ color: '#C9952F', roughness: 0.28, metalness: 0.85 }),
      stone: new THREE.MeshStandardMaterial({ color: '#B49A74', roughness: 0.75 }),
      stoneDark: new THREE.MeshStandardMaterial({ color: '#5D5A55', roughness: 0.9 }),
      soil: new THREE.MeshStandardMaterial({ color: '#3E2C1F', roughness: 1 }),
      water: new THREE.MeshStandardMaterial({ color: '#2C8FB0', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.88 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#CFE6F2', roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false }),
      navy: new THREE.MeshStandardMaterial({ color: '#1B2A4A', roughness: 0.55 }),
      felt: new THREE.MeshStandardMaterial({ color: '#1F6B4F', roughness: 0.95 }),
      blueTop: new THREE.MeshStandardMaterial({ color: '#1F4F8C', roughness: 0.6 }),
      screen: new THREE.MeshBasicMaterial({ map: screen, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }),
      screenDim: new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }),
      books: new THREE.MeshStandardMaterial({ map: booksTex(), roughness: 0.8 }),
      bottles: new THREE.MeshBasicMaterial({ map: bottlesTex(), toneMapped: false, color: new THREE.Color(1.35, 1.25, 1.1) }),
      fire: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 0.5), toneMapped: false }),
      arcade: new THREE.MeshStandardMaterial({ color: '#4A2A7A', roughness: 0.45 }),
    },
    G: {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
      cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      taper: new THREE.CylinderGeometry(0.35, 0.5, 1, 9),
      blob: new THREE.IcosahedronGeometry(0.5, 2),
      blobLow: new THREE.IcosahedronGeometry(0.5, 1),
      cone: new THREE.ConeGeometry(0.5, 1, 10),
      sphere: new THREE.SphereGeometry(0.5, 16, 12),
      bulb: new THREE.SphereGeometry(0.5, 8, 6),
      disc: new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2),
      plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      pad: new THREE.CircleGeometry(0.5, 14, 0.4, Math.PI * 2 - 0.8).rotateX(-Math.PI / 2),
      ring: new THREE.TorusGeometry(0.5, 0.06, 8, 40).rotateX(Math.PI / 2),
      rounded: roundedBox(1, 1, 1, 0.12),
    },
  };
}

function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + d - r); shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  shape.lineTo(x + r, y + d); shape.quadraticCurveTo(x, y + d, x, y + d - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

export function kitShared() {
  shared ??= makeShared();
  return shared;
}

// ---------------------------------------------------------------- nature

/** Light to dark. */
const GREENS = ['#7BB04C', '#6BA544', '#5E9A3C', '#4C8A34', '#3E7A2E', '#356B2A', '#2F5F27'];
const AUTUMN = ['#A9BC52', '#8FB04A', '#76A443', '#5E9A3C', '#4C8A34', '#3E7A2E'];

/** A broadleaf tree: a tapering trunk and branches under a crown of leaf clusters. */
function broadleaf(seed: number, { height = 3.2, crown = 2.0, clusters = 9, palette = GREENS, flowers = null as string[] | null } = {}): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const bark = new Painter(rand);
  bark.add(G.taper, mx(0, height * 0.32, 0, 0.26, height * 0.64, 0.26), '#5E4330', { shade: 0.3, jitter: 0.04 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand();
    bark.add(G.taper, mx(Math.cos(a) * 0.32, height * 0.62, Math.sin(a) * 0.32, 0.11, 1.1, 0.11, 0, Math.cos(a) * 0.6, -Math.sin(a) * 0.6), '#5A3F2C', { shade: 0.2 });
  }
  const leaves = new Painter(rand);
  const cy = height * 0.62 + crown * 0.55;
  leaves.add(G.blob, mx(0, cy + crown * 0.1, 0, crown * 1.3, crown * 1.05, crown * 1.3), palette[palette.length - 1], { shade: 0.5, jitter: 0.08, bump: 0.35 });
  const n = clusters + 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 2.4 + rand() * 0.8;
    const up = rand();
    const r = crown * (0.5 + rand() * 0.32) * (1 - up * 0.35);
    const y = cy - crown * 0.25 + up * crown * 0.75;
    const s = crown * (0.42 + rand() * 0.3);
    // Lighter on top where the sun catches it.
    const shade = palette[Math.min(palette.length - 1, Math.floor((1 - up) * palette.length * 0.6 + rand() * palette.length * 0.4))];
    leaves.add(G.blob, mx(Math.cos(a) * r, y, Math.sin(a) * r, s, s * (0.72 + rand() * 0.2), s), shade, { shade: 0.45, jitter: 0.12, bump: 0.45 });
  }
  if (flowers) {
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2;
      const up = rand();
      const r = crown * (0.6 + up * 0.15) * Math.sqrt(1 - (up * 0.8) ** 2) + 0.1;
      leaves.add(G.blobLow, mx(Math.cos(a) * r * 1.05, cy + up * crown * 0.65, Math.sin(a) * r * 1.05, 0.28, 0.22, 0.28), flowers[i % flowers.length], { shade: 0.1, jitter: 0.05 });
    }
  }
  return [P(bark.done(), M.bark), P(leaves.done(), M.leaves)];
}

function pine(seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const bark = new Painter(rand).add(G.taper, mx(0, 0.7, 0, 0.2, 1.4, 0.2), '#4E3626').done();
  const n = new Painter(rand);
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const w = 2.0 * (1 - t * 0.75);
    n.add(G.cone, mx(0, 1.0 + i * 0.62, 0, w, 1.15, w, rand() * 3), ['#2C5E33', '#2F6838', '#26532D'][i % 3], { shade: 0.55, jitter: 0.08 });
  }
  return [P(bark, M.bark), P(n.done(), M.leaves)];
}

function palm(seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const trunk = new Painter(rand);
  const segs = 9;
  const height = 4.4;
  const lean = 0.5;
  let top = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const x = lean * t * t;
    const y = (i + 0.5) * (height / segs);
    trunk.add(G.cyl8, mx(x, y, 0, 0.3 - t * 0.08, height / segs + 0.02, 0.3 - t * 0.08, 0, 0, -lean * t * 0.5), i % 2 ? '#8A6B48' : '#76593B', { shade: 0.2, jitter: 0.05 });
    top = new THREE.Vector3(lean, height, 0);
  }
  const fronds = new Painter(rand);
  const leaf = new THREE.PlaneGeometry(0.55, 2.6, 1, 8);
  // Bend each frond down along its length and narrow it to a point.
  const p = leaf.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = (p.getY(i) + 1.3) / 2.6; // 0 at the base, 1 at the tip
    p.setX(i, p.getX(i) * (1 - v * 0.85) * (0.4 + Math.sin(v * Math.PI) * 0.9));
    p.setZ(i, -v * v * 1.3);
  }
  leaf.translate(0, 1.3, 0);
  leaf.rotateX(-Math.PI / 2);
  leaf.computeVertexNormals();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rand() * 0.3;
    const tilt = 0.25 + rand() * 0.35;
    fronds.add(leaf, new THREE.Matrix4().compose(top, new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, a, 0, 'YXZ')), new THREE.Vector3(1, 1, 1)), ['#3F7F2E', '#4F9136', '#356E27'][i % 3], { shade: -0.2, jitter: 0.1 });
  }
  for (let i = 0; i < 3; i++) fronds.add(G.blobLow, mx(top.x + Math.cos(i * 2.1) * 0.18, top.y - 0.15, Math.sin(i * 2.1) * 0.18, 0.2, 0.2, 0.2), '#5B4224');
  leaf.dispose();
  return [P(trunk.done(), M.bark), P(fronds.done(), M.leafSheet)];
}

function bush(seed: number, palette = GREENS, blooms: string[] | null = null): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const b = new Painter(rand);
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.35;
    const s = 0.55 + rand() * 0.4;
    b.add(G.blob, mx(Math.cos(a) * r, 0.32 + rand() * 0.25, Math.sin(a) * r, s, s * 0.85, s), palette[Math.floor(rand() * palette.length)], { shade: 0.55, jitter: 0.12, bump: 0.45 });
  }
  if (blooms) for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    b.add(G.blobLow, mx(Math.cos(a) * (0.35 + rand() * 0.2), 0.45 + rand() * 0.35, Math.sin(a) * (0.35 + rand() * 0.2), 0.12, 0.1, 0.12), blooms[i % blooms.length], { shade: 0, jitter: 0.04 });
  }
  return [P(b.done(), M.leaves)];
}

const BLOOMS = ['#E8505B', '#F5C542', '#9C6CEF', '#F28AB2', '#F4F1E6', '#F08A3C'];

function flowerBed(w: number, d: number, seed: number, round = false): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const edge = new Painter(rand);
  if (round) edge.add(G.cyl, mx(0, 0.14, 0, w, 0.28, d), '#9C8463', { shade: 0.25, jitter: 0.03 });
  else edge.add(G.rounded, mx(0, 0.14, 0, w, 0.28, d), '#9C8463', { shade: 0.25, jitter: 0.03 });
  const soil = new Painter(rand).add(round ? G.cyl : G.box, mx(0, 0.285, 0, w - 0.16, 0.02, d - 0.16), '#3E2C1F', { shade: 0, jitter: 0.1 }).done();
  const plants = new Painter(rand);
  const n = Math.round(w * d * 9);
  for (let i = 0; i < n; i++) {
    let x = (rand() - 0.5) * (w - 0.35);
    let z = (rand() - 0.5) * (d - 0.35);
    if (round && Math.hypot(x / (w / 2), z / (d / 2)) > 0.82) { x *= 0.7; z *= 0.7; }
    const s = 0.22 + rand() * 0.22;
    plants.add(G.blobLow, mx(x, 0.36 + s * 0.3, z, s, s * 0.8, s), GREENS[Math.floor(rand() * GREENS.length)], { shade: 0.5, jitter: 0.1 });
    if (rand() < 0.75) {
      const c = BLOOMS[Math.floor(rand() * BLOOMS.length)];
      for (let k = 0; k < 3; k++) plants.add(G.blobLow, mx(x + (rand() - 0.5) * s, 0.42 + s * 0.6 + rand() * 0.06, z + (rand() - 0.5) * s, 0.09, 0.07, 0.09), c, { shade: 0, jitter: 0.05 });
    }
  }
  return [P(edge.done(), M.fabric), P(soil, M.fabric, undefined, false), P(plants.done(), M.leaves)];
}

function hedge(w: number, seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const h = new Painter(rand);
  h.add(G.rounded, mx(0, 0.42, 0, w, 0.84, 0.7), '#2F6328', { shade: 0.5, jitter: 0.05 });
  const n = Math.ceil(w / 0.45);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.25 + (i * (w - 0.5)) / Math.max(1, n - 1);
    h.add(G.blob, mx(x, 0.82 + rand() * 0.06, (rand() - 0.5) * 0.15, 0.55, 0.3, 0.62), GREENS[Math.floor(rand() * 4)], { shade: 0.3, jitter: 0.12, bump: 0.5 });
  }
  return [P(h.done(), M.leaves)];
}

function reeds(seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const r = new Painter(rand);
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * 0.4;
    const h = 0.7 + rand() * 0.7;
    r.add(G.cone, mx(Math.cos(a) * d, h / 2, Math.sin(a) * d, 0.06, h, 0.06, 0, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3), ['#5E7A35', '#7A8B45', '#4F6B2E'][i % 3], { shade: 0.4 });
    if (rand() < 0.3) r.add(G.cyl8, mx(Math.cos(a) * d, h * 0.92, Math.sin(a) * d, 0.05, 0.18, 0.05), '#5A3A22');
  }
  return [P(r.done(), M.leaves)];
}

function lilies(seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const l = new Painter(rand);
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * 1.2;
    const s = 0.35 + rand() * 0.3;
    l.add(G.pad, mx(Math.cos(a) * d, 0, Math.sin(a) * d, s, 1, s, rand() * 6), ['#3F7F2E', '#4F8F38', '#5C9A3E'][i % 3], { shade: 0, jitter: 0.06 });
    if (rand() < 0.4) l.add(G.blobLow, mx(Math.cos(a) * d, 0.06, Math.sin(a) * d, 0.16, 0.1, 0.16), rand() < 0.5 ? '#F2A0C0' : '#F6E7EE', { shade: 0 });
  }
  return [P(l.done(), M.leaves, mx(0, 0.27, 0), false)];
}

/** A lamp post: a warm lantern that glows, with a soft pool of light on the ground. */
function lampPost(): Part[] {
  const { M, G } = kitShared();
  const lantern = new Painter(rng(1)).add(G.sphere, mx(0, 3.05, 0, 0.34, 0.42, 0.34), new THREE.Color(1, 0.72, 0.4), { shade: 0, jitter: 0, hdr: 3.2 }).done();
  return [
    P(G.cyl8, M.metal, mx(0, 1.55, 0, 0.1, 3.1, 0.1)),
    P(G.cyl, M.metal, mx(0, 0.12, 0, 0.36, 0.24, 0.36)),
    P(G.cyl, M.brass, mx(0, 2.82, 0, 0.26, 0.06, 0.26), false),
    P(G.cone, M.metal, mx(0, 3.36, 0, 0.5, 0.22, 0.5), false),
    P(lantern, M.bulbs, undefined, false),
    P(G.plane, M.glowDecal, mx(0, 0.03, 0, 5, 1, 5), false),
  ];
}

/** Festoon lights strung between two posts (the piece's width). */
function stringLights(w: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(5);
  const bulbs = new Painter(rand);
  const wire: THREE.BufferGeometry[] = [];
  const n = Math.round(w * 2);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = -w / 2 + t * w;
    const y = 2.9 - Math.sin(t * Math.PI) * 0.55;
    bulbs.add(G.bulb, mx(x, y - 0.1, 0, 0.13, 0.16, 0.13), new THREE.Color(1, 0.75, 0.42), { shade: 0, jitter: 0.05, hdr: 3.5 });
    if (i < n) {
      const x2 = -w / 2 + ((i + 1) / n) * w;
      const y2 = 2.9 - Math.sin(((i + 1) / n) * Math.PI) * 0.55;
      const len = Math.hypot(x2 - x, y2 - y);
      const g = new THREE.CylinderGeometry(0.012, 0.012, len, 4);
      g.rotateZ(Math.PI / 2 + Math.atan2(y2 - y, x2 - x));
      g.translate((x + x2) / 2, (y + y2) / 2, 0);
      wire.push(g);
    }
  }
  const wireGeo = mergeGeometries(wire) ?? new THREE.BufferGeometry();
  wire.forEach((g) => g.dispose());
  return [
    P(G.cyl8, M.woodDark, mx(-w / 2, 1.5, 0, 0.12, 3.0, 0.12)), P(G.cyl8, M.woodDark, mx(w / 2, 1.5, 0, 0.12, 3.0, 0.12)),
    P(wireGeo, M.metal, undefined, false), P(bulbs.done(), M.bulbs, undefined, false),
  ];
}

function pergola(w: number, d: number, seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const parts: Part[] = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(P(G.box, M.woodDark, mx((x * (w - 0.2)) / 2, 1.3, (z * (d - 0.2)) / 2, 0.16, 2.6, 0.16)));
  parts.push(P(G.box, M.woodDark, mx(0, 2.62, -(d - 0.2) / 2, w + 0.3, 0.16, 0.12)), P(G.box, M.woodDark, mx(0, 2.62, (d - 0.2) / 2, w + 0.3, 0.16, 0.12)));
  const slats = Math.round(w / 0.45);
  for (let i = 0; i <= slats; i++) parts.push(P(G.box, M.wood, mx(-w / 2 + (i * w) / slats, 2.75, 0, 0.07, 0.1, d + 0.3), false));
  const vines = new Painter(rand);
  for (let i = 0; i < 26; i++) {
    const s = 0.35 + rand() * 0.35;
    vines.add(G.blobLow, mx((rand() - 0.5) * w, 2.85 + rand() * 0.1, (rand() - 0.5) * d, s, s * 0.45, s), GREENS[Math.floor(rand() * GREENS.length)], { shade: 0.3, jitter: 0.1 });
    if (rand() < 0.4) vines.add(G.blobLow, mx((rand() - 0.5) * w, 2.95, (rand() - 0.5) * d, 0.12, 0.08, 0.12), rand() < 0.5 ? '#C36BC9' : '#F28AB2');
  }
  for (const [x, z] of [[-1, -1], [1, 1]]) for (let k = 0; k < 5; k++) vines.add(G.blobLow, mx((x * (w - 0.2)) / 2 + (rand() - 0.5) * 0.2, 0.5 + k * 0.45, (z * (d - 0.2)) / 2 + (rand() - 0.5) * 0.2, 0.3, 0.4, 0.3), GREENS[k % 4]);
  parts.push(P(vines.done(), M.leaves));
  return parts;
}

/** A round table under an umbrella, with chairs around it. */
function umbrellaSet(color: string, seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const fabric = new Painter(rand);
  const canopy = new THREE.ConeGeometry(1.35, 0.55, 8, 1, true);
  fabric.add(canopy, mx(0, 2.35, 0), color, { shade: -0.3, jitter: 0.03 });
  canopy.dispose();
  const chairs = new Painter(rand);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 0.85;
    const z = Math.sin(a) * 0.85;
    const face = Math.atan2(-x, -z);
    chairs.add(G.rounded, mx(x, 0.45, z, 0.46, 0.07, 0.46, face), '#6B4A2E', { shade: 0.1 });
    chairs.add(G.rounded, mx(x - Math.sin(face) * 0.22, 0.72, z - Math.cos(face) * 0.22, 0.46, 0.5, 0.06, face), '#6B4A2E', { shade: 0.1 });
  }
  return [
    P(G.cyl, M.woodLight, mx(0, 0.74, 0, 0.9, 0.05, 0.9)), P(G.cyl8, M.metal, mx(0, 0.37, 0, 0.08, 0.74, 0.08)),
    P(G.cyl8, M.metal, mx(0, 1.55, 0, 0.05, 1.6, 0.05)), P(fabric.done(), M.fabric), P(chairs.done(), M.fabric),
  ];
}

function gazebo(seed: number): Part[] {
  const { M, G } = kitShared();
  const rand = rng(seed);
  const parts: Part[] = [P(new THREE.CylinderGeometry(2.3, 2.4, 0.2, 6), M.woodLight, mx(0, 0.1, 0))];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(P(G.cyl8, M.woodDark, mx(Math.cos(a) * 2.05, 1.4, Math.sin(a) * 2.05, 0.13, 2.6, 0.13)));
  }
  const roof = new Painter(rand).add(new THREE.ConeGeometry(2.8, 1.3, 6), mx(0, 3.3, 0), '#5B3A2A', { shade: -0.2, jitter: 0.04 }).done();
  parts.push(P(roof, M.fabric));
  const bench = new Painter(rand);
  for (let i = 0; i < 5; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    bench.add(G.box, mx(Math.cos(a) * 1.75, 0.45, Math.sin(a) * 1.75, 1.6, 0.08, 0.45, -a + Math.PI / 2), '#8A6240');
  }
  parts.push(P(bench.done(), M.fabric));
  // A lantern hanging inside.
  parts.push(P(new Painter(rand).add(G.sphere, mx(0, 2.4, 0, 0.3, 0.36, 0.3), new THREE.Color(1, 0.72, 0.4), { shade: 0, jitter: 0, hdr: 3 }).done(), M.bulbs, undefined, false));
  parts.push(P(G.plane, M.glowDecal, mx(0, 0.22, 0, 4.2, 1, 4.2), false));
  return parts;
}

function picnic(): Part[] {
  const { M, G } = kitShared();
  return [
    P(G.box, M.wood, mx(0, 0.74, 0, 1.8, 0.06, 0.8)),
    P(G.box, M.wood, mx(0, 0.45, -0.62, 1.8, 0.05, 0.3)), P(G.box, M.wood, mx(0, 0.45, 0.62, 1.8, 0.05, 0.3)),
    ...[-0.75, 0.75].map((x) => P(G.box, M.woodDark, mx(x, 0.37, 0, 0.08, 0.74, 1.5))),
  ];
}

function firePit(): Part[] {
  const { M, G } = kitShared();
  const rand = rng(9);
  const ring = new Painter(rand);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ring.add(G.blobLow, mx(Math.cos(a) * 0.7, 0.16, Math.sin(a) * 0.7, 0.42, 0.32, 0.36, -a), ['#6F6A62', '#5D5A55', '#807A70'][i % 3], { shade: 0.3 });
  }
  const fire = new Painter(rand);
  for (let i = 0; i < 6; i++) fire.add(G.cone, mx((rand() - 0.5) * 0.4, 0.38, (rand() - 0.5) * 0.4, 0.22, 0.5 + rand() * 0.3, 0.22), new THREE.Color(1, 0.45 + rand() * 0.3, 0.12), { shade: -0.6, jitter: 0, hdr: 4 });
  return [P(ring.done(), M.fabric), P(fire.done(), M.bulbs, undefined, false), P(G.plane, M.glowDecal, mx(0, 0.03, 0, 4.5, 1, 4.5), false)];
}

/** A round raised planter with a tree, flowers around it and a stone seat edge. */
function planterTree(seed: number): Part[] {
  const { M, G } = kitShared();
  const tree = broadleaf(seed, { height: 3.6, crown: 2.0, clusters: 10 }).map((p) => ({ ...p, local: mx(0, 0.5, 0) }));
  const bed = flowerBed(3.6, 3.6, seed + 1, true).map((p) => ({ ...p, local: mx(0, 0.22, 0) }));
  return [P(G.cyl, M.stone, mx(0, 0.25, 0, 4.2, 0.5, 4.2)), P(G.ring, M.brass, mx(0, 0.5, 0, 4.2, 1, 4.2), false), ...bed, ...tree];
}

function fountain(big: boolean): Part[] {
  const { M, G } = kitShared();
  const s = big ? 1 : 0.45;
  const parts: Part[] = [
    P(G.cyl, M.stoneDark, mx(0, 0.15 * s + 0.05, 0, 6.6 * s, 0.3 * s + 0.1, 6.6 * s)),
    P(G.cyl, M.stone, mx(0, 0.4 * s + 0.1, 0, 6.0 * s, 0.5 * s, 6.0 * s)),
    P(G.cyl, M.water, mx(0, 0.62 * s + 0.12, 0, 5.5 * s, 0.05, 5.5 * s), false),
    P(G.ring, M.brass, mx(0, 0.66 * s + 0.12, 0, 6.0 * s, 1, 6.0 * s), false),
    P(G.cyl, M.stone, mx(0, 1.0 * s + 0.2, 0, 0.6 * s, 1.4 * s, 0.6 * s)),
    P(G.cyl, M.stone, mx(0, 1.7 * s + 0.2, 0, 2.4 * s, 0.2 * s, 2.4 * s)),
    P(G.cyl, M.water, mx(0, 1.82 * s + 0.2, 0, 2.1 * s, 0.05, 2.1 * s), false),
    P(G.cyl, M.stone, mx(0, 2.2 * s + 0.2, 0, 0.3 * s, 0.8 * s, 0.3 * s)),
  ];
  // Spray: bright droplets catching the light.
  const spray = new Painter(rng(3));
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const t = (i % 5) / 5;
    const r = (0.2 + t * 1.0) * s;
    spray.add(G.bulb, mx(Math.cos(a) * r, (2.7 + Math.sin(t * Math.PI) * 0.7) * s + 0.2, Math.sin(a) * r, 0.07 * s + 0.03, 0.12 * s + 0.04, 0.07 * s + 0.03), new THREE.Color(0.75, 0.9, 1), { shade: 0, jitter: 0.1, hdr: 1.4 });
  }
  parts.push(P(spray.done(), M.bulbs, undefined, false));
  return parts;
}

// ---------------------------------------------------------------- the Hub's interiors

/** A padded seat in rows (auditoriums, conference rooms), facing +z. */
function theatreSeat(color: string): Part[] {
  const { M, G } = kitShared();
  const p = new Painter(rng(2));
  p.add(G.rounded, mx(0, 0.44, 0.02, 0.56, 0.14, 0.5), color, { shade: 0.3, jitter: 0.03 });
  p.add(G.rounded, mx(0, 0.82, -0.24, 0.56, 0.62, 0.12, 0, -0.12), color, { shade: 0.35, jitter: 0.03 });
  return [P(p.done(), M.fabric), ...[-0.3, 0.3].map((x) => P(G.box, M.metal, mx(x, 0.33, -0.02, 0.05, 0.66, 0.55)))];
}

/** A sofa in any colour, seats along +z side. */
function sofa(color: string, w: number): Part[] {
  const { M, G } = kitShared();
  const p = new Painter(rng(4));
  p.add(G.rounded, mx(0, 0.24, 0, w, 0.3, 0.9), color, { shade: 0.35, jitter: 0.03 });
  const n = Math.max(1, Math.round(w / 0.75));
  for (let i = 0; i < n; i++) p.add(G.rounded, mx(-w / 2 + 0.12 + ((i + 0.5) * (w - 0.24)) / n, 0.47, 0.06, (w - 0.24) / n - 0.04, 0.16, 0.66), color, { shade: 0.2, jitter: 0.04 });
  p.add(G.rounded, mx(0, 0.72, -0.34, w, 0.62, 0.22), color, { shade: 0.35, jitter: 0.03 });
  p.add(G.rounded, mx(-w / 2 + 0.1, 0.55, 0, 0.2, 0.42, 0.9), color, { shade: 0.35 });
  p.add(G.rounded, mx(w / 2 - 0.1, 0.55, 0, 0.2, 0.42, 0.9), color, { shade: 0.35 });
  // Cushions in gold.
  p.add(G.rounded, mx(-w / 2 + 0.45, 0.7, -0.18, 0.4, 0.36, 0.12, 0.3, -0.2), '#C9952F', { shade: 0.2 });
  p.add(G.rounded, mx(w / 2 - 0.45, 0.7, -0.18, 0.4, 0.36, 0.12, -0.3, -0.2), '#C9952F', { shade: 0.2 });
  return [P(p.done(), M.fabric), ...[-1, 1].map((x) => P(G.cyl8, M.brass, mx(x * (w / 2 - 0.15), 0.05, 0, 0.05, 0.1, 0.05), false))];
}

function loungeChair(color: string): Part[] {
  const { M, G } = kitShared();
  const p = new Painter(rng(6));
  p.add(G.rounded, mx(0, 0.26, 0, 0.82, 0.3, 0.82), color, { shade: 0.35 });
  p.add(G.rounded, mx(0, 0.47, 0.06, 0.6, 0.14, 0.62), color, { shade: 0.2 });
  p.add(G.rounded, mx(0, 0.68, -0.32, 0.82, 0.58, 0.2, 0, -0.1), color, { shade: 0.35 });
  p.add(G.rounded, mx(-0.36, 0.52, 0, 0.14, 0.36, 0.8), color, { shade: 0.35 });
  p.add(G.rounded, mx(0.36, 0.52, 0, 0.14, 0.36, 0.8), color, { shade: 0.35 });
  return [P(p.done(), M.fabric)];
}

/** A round café table with chairs around it. */
function diningSet(color: string, seats: number): Part[] {
  const { M, G } = kitShared();
  const p = new Painter(rng(8));
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2;
    const x = Math.sin(a) * 0.72;
    const z = Math.cos(a) * 0.72;
    const face = a + Math.PI;
    p.add(G.rounded, mx(x, 0.46, z, 0.44, 0.08, 0.44, face), color, { shade: 0.2 });
    p.add(G.rounded, mx(x + Math.sin(a) * 0.2, 0.72, z + Math.cos(a) * 0.2, 0.44, 0.44, 0.07, face), color, { shade: 0.25 });
  }
  return [P(G.cyl, M.woodLight, mx(0, 0.74, 0, 0.9, 0.05, 0.9)), P(G.cyl8, M.brass, mx(0, 0.37, 0, 0.07, 0.74, 0.07)), P(G.cyl, M.brass, mx(0, 0.02, 0, 0.5, 0.04, 0.5), false), P(p.done(), M.fabric)];
}

function barCounter(w: number): Part[] {
  const { M, G } = kitShared();
  const strip = new Painter(rng(1)).add(G.box, mx(0, 0.12, 0.33, w, 0.04, 0.02), new THREE.Color(1, 0.7, 0.35), { shade: 0, jitter: 0, hdr: 3 }).done();
  return [
    P(G.box, M.woodDark, mx(0, 0.52, 0, w, 1.04, 0.6)),
    P(G.box, M.stone, mx(0, 1.07, 0.04, w + 0.1, 0.06, 0.78)),
    P(G.box, M.brass, mx(0, 0.2, 0.31, w, 0.04, 0.02), false),
    P(strip, M.bulbs, undefined, false),
  ];
}

function barStool(color: string): Part[] {
  const { M, G } = kitShared();
  const seat = new Painter(rng(3)).add(G.cyl, mx(0, 0.78, 0, 0.42, 0.1, 0.42), color, { shade: 0.3 }).done();
  return [P(seat, M.fabric), P(G.cyl8, M.brass, mx(0, 0.38, 0, 0.06, 0.76, 0.06)), P(G.ring, M.brass, mx(0, 0.3, 0, 0.36, 1, 0.36), false), P(G.cyl, M.metal, mx(0, 0.02, 0, 0.4, 0.04, 0.4), false)];
}

/** Backlit shelves of bottles on the wall behind a bar (faces +z). */
function bottleWall(w: number): Part[] {
  const { M, G } = kitShared();
  return [P(G.box, M.woodDark, mx(0, 1.25, 0, w + 0.2, 2.5, 0.4)), P(G.plane, M.bottles, mx(0, 1.3, 0.21, w, 1, 2.0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false)];
}

function fireplace(): Part[] {
  const { M, G } = kitShared();
  const fire = new Painter(rng(5));
  for (let i = 0; i < 9; i++) fire.add(G.cone, mx(-0.9 + i * 0.22, 0.42, 0.1, 0.2, 0.32 + (i % 3) * 0.1, 0.2), new THREE.Color(1, 0.5 + (i % 3) * 0.12, 0.15), { shade: -0.6, jitter: 0.05, hdr: 4 });
  return [
    P(G.box, M.stone, mx(0, 0.75, -0.1, 3.0, 1.5, 0.6)),
    P(G.box, M.stoneDark, mx(0, 0.45, 0.08, 2.2, 0.55, 0.3), false),
    P(G.box, M.woodDark, mx(0, 1.55, 0, 3.2, 0.1, 0.8)),
    P(fire.done(), M.bulbs, undefined, false),
    P(G.plane, M.glowDecal, mx(0, 0.08, 1.2, 4, 1, 2.8), false),
  ];
}

/** The stage's big LED wall (faces +z). */
function ledWall(w: number): Part[] {
  const { M, G } = kitShared();
  const h = w * 0.42;
  return [
    P(G.box, M.metal, mx(0, 0.5 + h / 2, 0, w + 0.3, h + 0.3, 0.25)),
    P(G.plane, M.screen, mx(0, 0.5 + h / 2, 0.14, w, 1, h).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false),
    // A big stage screen lights the floor in front of it.
    ...(w > 6 ? [P(G.plane, M.glowDecal, mx(0, 0.06, 1.8, w * 1.1, 1, 3.6), false)] : []),
  ];
}

/** A lighting truss over a stage, with warm spots. */
function truss(w: number): Part[] {
  const { M, G } = kitShared();
  const spots = new Painter(rng(2));
  const n = Math.round(w / 1.6);
  for (let i = 0; i < n; i++) spots.add(G.cyl8, mx(-w / 2 + 0.6 + (i * (w - 1.2)) / Math.max(1, n - 1), 4.0, 0.15, 0.2, 0.22, 0.2), new THREE.Color(1, 0.85, 0.6), { shade: 0, jitter: 0, hdr: 3.5 });
  return [
    P(G.box, M.metal, mx(0, 4.25, 0, w, 0.12, 0.12), false), P(G.box, M.metal, mx(0, 4.45, 0, w, 0.12, 0.12), false),
    P(G.box, M.metal, mx(-w / 2, 2.2, 0, 0.16, 4.4, 0.16)), P(G.box, M.metal, mx(w / 2, 2.2, 0, 0.16, 4.4, 0.16)),
    P(spots.done(), M.bulbs, undefined, false),
  ];
}

/** An expo booth: a coloured backdrop with a screen, a counter and a stool (faces +z). */
function booth(color: string): Part[] {
  const { M, G } = kitShared();
  const mat = new THREE.MeshStandardMaterial({ map: boothTex(color), roughness: 0.6 });
  const side = new Painter(rng(3));
  side.add(G.box, mx(-1.45, 1.1, 0.5, 0.08, 2.2, 1.0), color, { shade: 0.2 });
  side.add(G.box, mx(1.45, 1.1, 0.5, 0.08, 2.2, 1.0), color, { shade: 0.2 });
  return [
    P(G.box, mat, mx(0, 1.25, 0, 3.0, 2.5, 0.1)),
    P(side.done(), M.fabric),
    P(G.plane, M.screenDim, mx(0.55, 1.45, 0.07, 1.2, 1, 0.7).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false),
    P(G.box, M.woodLight, mx(-0.3, 0.52, 1.1, 1.4, 1.04, 0.5)),
    P(G.box, M.brass, mx(-0.3, 1.06, 1.1, 1.44, 0.04, 0.54), false),
    ...barStool('#1B2A4A').map((p) => ({ ...p, local: mx(0.85, 0, 1.4).multiply(p.local) })),
  ];
}

function reception(w: number): Part[] {
  const { M, G } = kitShared();
  const strip = new Painter(rng(1)).add(G.box, mx(0, 0.1, 0.42, w, 0.04, 0.02), new THREE.Color(1, 0.72, 0.38), { shade: 0, hdr: 3 }).done();
  return [
    P(roundedBoxPart(w, 1.05, 0.8), M.woodLight, mx(0, 0.52, 0)),
    P(G.box, M.stone, mx(0, 1.08, 0, w + 0.1, 0.06, 0.9)),
    P(G.box, M.brass, mx(0, 0.75, 0.41, w * 0.6, 0.12, 0.02), false),
    P(strip, M.bulbs, undefined, false),
  ];
}
const roundedBoxPart = (w: number, h: number, d: number) => roundedBox(w, h, d, 0.08);

/** Floor-to-ceiling books (faces +z). */
function bookcase(w: number): Part[] {
  const { M, G } = kitShared();
  return [P(G.box, M.woodDark, mx(0, 1.2, 0, w + 0.1, 2.4, 0.42)), P(G.plane, M.books, mx(0, 1.2, 0.22, w, 1, 2.25).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false)];
}

/** A long meeting table with chairs down both sides and a screen at the head. */
function conference(seats: number, color: string): Part[] {
  const { M, G } = kitShared();
  const len = Math.max(2.4, (seats / 2) * 0.8 + 0.6);
  const chairs = new Painter(rng(4));
  const per = Math.ceil(seats / 2);
  for (let i = 0; i < per; i++) for (const side of [-1, 1]) {
    const z = -len / 2 + 0.5 + (i * (len - 1)) / Math.max(1, per - 1);
    const x = side * 0.95;
    chairs.add(G.rounded, mx(x, 0.46, z, 0.48, 0.1, 0.48), color, { shade: 0.25 });
    chairs.add(G.rounded, mx(x + side * 0.24, 0.76, z, 0.08, 0.5, 0.48), color, { shade: 0.3 });
  }
  return [
    P(G.rounded, M.woodLight, mx(0, 0.74, 0, 1.2, 0.06, len)),
    ...[-1, 1].map((k) => P(G.box, M.metal, mx(0, 0.37, k * (len / 2 - 0.4), 0.7, 0.72, 0.08))),
    P(chairs.done(), M.fabric),
  ];
}

function pingPong(): Part[] {
  const { M, G } = kitShared();
  return [
    P(G.box, M.blueTop, mx(0, 0.76, 0, 1.52, 0.04, 2.74)),
    P(G.box, M.metal, mx(0, 0.86, 0, 1.6, 0.15, 0.02), false),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => P(G.box, M.metal, mx(a * 0.6, 0.37, b * 1.1, 0.06, 0.74, 0.06))),
  ];
}

/** An indoor tree in a big pot. */
function pottedTree(seed: number): Part[] {
  const { M, G } = kitShared();
  return [P(G.cyl, M.navy, mx(0, 0.35, 0, 0.75, 0.7, 0.75)), P(G.ring, M.brass, mx(0, 0.7, 0, 0.75, 1, 0.75), false), ...broadleaf(seed, { height: 2.0, crown: 0.95, clusters: 7 }).map((p) => ({ ...p, local: mx(0, 0.62, 0) }))];
}

const rugPattern = (color: string, accent: string, seed: number) => canvasTex(256, (g, s) => {
  g.fillStyle = color;
  g.fillRect(0, 0, s, s);
  speckle(g, s, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.07)'], 2600, [1, 2], seed);
  g.strokeStyle = accent;
  g.lineWidth = 12;
  g.strokeRect(14, 14, s - 28, s - 28);
  g.lineWidth = 3;
  g.strokeRect(34, 34, s - 68, s - 68);
  g.globalAlpha = 0.5;
  g.lineWidth = 4;
  g.beginPath();
  g.ellipse(s / 2, s / 2, s * 0.22, s * 0.22, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(s / 2, s * 0.2); g.lineTo(s * 0.8, s / 2); g.lineTo(s / 2, s * 0.8); g.lineTo(s * 0.2, s / 2); g.closePath();
  g.stroke();
  g.globalAlpha = 1;
});

function rug(color: string, w: number, d: number, seed: number): Part[] {
  const { G } = kitShared();
  const accent = color.toUpperCase() === '#1E3A6E' || color.toUpperCase() === '#1B2A4A' ? GOLD : '#E9C27A';
  const mat = new THREE.MeshStandardMaterial({ map: rugPattern(color, accent, seed), roughness: 1 });
  // Just above a building's floor.
  return [P(G.box, mat, mx(0, 0.072, 0, w, 0.02, d), false)];
}

/** A doorway to another place: a framed opening filled with warm light. */
const doorGlowTex = () => canvasTex(64, (g, s) => {
  const grad = g.createLinearGradient(0, s, 0, 0);
  grad.addColorStop(0, 'rgba(255,205,120,0.95)');
  grad.addColorStop(0.6, 'rgba(255,190,100,0.35)');
  grad.addColorStop(1, 'rgba(255,180,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});
let doorGlow: THREE.Material | null = null;
function doorway(w: number): Part[] {
  const { M, G } = kitShared();
  doorGlow ??= new THREE.MeshBasicMaterial({ map: doorGlowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const h = 2.9;
  return [
    P(G.box, M.woodDark, mx(-w / 2 - 0.2, h / 2, 0, 0.4, h, 0.6)), P(G.box, M.woodDark, mx(w / 2 + 0.2, h / 2, 0, 0.4, h, 0.6)),
    P(G.box, M.woodDark, mx(0, h + 0.2, 0, w + 0.8, 0.4, 0.6)),
    P(G.box, M.brass, mx(0, h - 0.02, 0.31, w + 0.1, 0.06, 0.02), false), P(G.box, M.brass, mx(0, h - 0.02, -0.31, w + 0.1, 0.06, 0.02), false),
    P(new THREE.PlaneGeometry(w, h), doorGlow, mx(0, h / 2, 0), false),
    P(G.plane, M.glowDecal, mx(0, 0.07, 0, w + 1.5, 1, 3.2), false),
  ];
}

// ---------------------------------------------------------------- vehicles

/** A small electric car (faces +z), about 2 × 4 m. */
export function carParts(color: string): Part[] {
  const { M, G } = kitShared();
  const body = new Painter(rng(3));
  // An open-top car, so whoever drives shows from above.
  body.add(G.rounded, mx(0, 0.45, 0, 1.8, 0.45, 3.9), color, { shade: 0.35, jitter: 0.02 });
  body.add(G.rounded, mx(0, 0.75, 1.3, 1.7, 0.22, 1.2), color, { shade: 0.2, jitter: 0.02 });
  body.add(G.rounded, mx(0, 0.75, -1.45, 1.7, 0.22, 0.9), color, { shade: 0.2, jitter: 0.02 });
  for (const x of [-0.42, 0.42]) {
    body.add(G.rounded, mx(x, 0.62, -0.25, 0.62, 0.14, 0.6), '#3A2A22', { shade: 0.2 });
    body.add(G.rounded, mx(x, 0.95, -0.6, 0.62, 0.6, 0.14, 0, -0.15), '#3A2A22', { shade: 0.25 });
  }
  const glass = new Painter(rng(4));
  glass.add(G.box, mx(0, 1.02, 0.66, 1.5, 0.42, 0.04, 0, -0.45), '#2C3E52', { shade: 0 });
  glass.add(G.cyl8, mx(-0.38, 0.95, 0.35, 0.36, 0.05, 0.36, 0, -0.9), '#15171C', { shade: 0 });
  const lights = new Painter(rng(5));
  for (const x of [-0.6, 0.6]) {
    lights.add(G.box, mx(x, 0.62, 1.95, 0.32, 0.1, 0.04), new THREE.Color(1, 0.95, 0.8), { shade: 0, hdr: 2.6 });
    lights.add(G.box, mx(x, 0.62, -1.95, 0.32, 0.08, 0.04), new THREE.Color(1, 0.15, 0.1), { shade: 0, hdr: 2.2 });
  }
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18).rotateZ(Math.PI / 2);
  const wheels = new Painter(rng(6));
  for (const [x, z] of [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.25], [0.85, -1.25]]) wheels.add(wheel, mx(x, 0.36, z), '#15171C', { shade: 0.1 });
  wheel.dispose();
  return [P(body.done(), M.gloss), P(glass.done(), M.gloss, undefined, false), P(lights.done(), M.bulbs, undefined, false), P(wheels.done(), M.fabric)];
}

/** A city bike (faces +z), about 0.6 × 1.8 m. */
export function bikeParts(color: string): Part[] {
  const { M, G } = kitShared();
  const frame = new Painter(rng(7));
  const tube = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.035) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
    frame.add(g, new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1)), color, { shade: 0.1 });
    g.dispose();
  };
  tube(0, 0.36, -0.55, 0, 0.75, -0.1); tube(0, 0.36, -0.55, 0, 0.42, 0.25); tube(0, 0.42, 0.25, 0, 0.82, 0.45);
  tube(0, 0.75, -0.1, 0, 0.82, 0.45); tube(0, 0.82, 0.45, 0, 0.36, 0.6); tube(0, 0.36, -0.55, 0, 0.75, -0.18);
  tube(-0.28, 1.0, 0.42, 0.28, 1.0, 0.42, 0.025); tube(0, 0.82, 0.45, 0, 1.0, 0.42);
  frame.add(G.rounded, mx(0, 0.82, -0.14, 0.18, 0.06, 0.28), '#2A2420', { shade: 0.1 });
  const wheel = new THREE.TorusGeometry(0.33, 0.03, 6, 24).rotateY(Math.PI / 2);
  const wheels = new Painter(rng(8));
  for (const z of [-0.55, 0.6]) wheels.add(wheel, mx(0, 0.36, z), '#15171C', { shade: 0 });
  wheel.dispose();
  const lamp = new Painter(rng(9)).add(G.bulb, mx(0, 0.95, 0.52, 0.09, 0.09, 0.09), new THREE.Color(1, 0.95, 0.8), { shade: 0, hdr: 2.6 }).done();
  return [P(frame.done(), M.gloss), P(wheels.done(), M.fabric), P(lamp, M.bulbs, undefined, false)];
}

// ---------------------------------------------------------------- the rest

function bench(): Part[] {
  const { M, G } = kitShared();
  const slats: Part[] = [];
  // The seat, and the back behind whoever sits (people face +z).
  for (let i = 0; i < 4; i++) slats.push(P(G.box, M.wood, mx(0, 0.45, 0.18 - i * 0.12, 1.8, 0.05, 0.1)));
  for (let i = 0; i < 3; i++) slats.push(P(G.box, M.wood, mx(0, 0.62 + i * 0.12, -0.26, 1.8, 0.09, 0.04, 0, 0.18)));
  return [...slats, P(G.box, M.metal, mx(-0.8, 0.4, -0.02, 0.06, 0.8, 0.55)), P(G.box, M.metal, mx(0.8, 0.4, -0.02, 0.06, 0.8, 0.55))];
}

function stage(w: number, d: number): Part[] {
  const { M, G } = kitShared();
  return [
    // Low, so people walking on it stand on it rather than in it.
    P(G.box, M.woodDark, mx(0, 0.09, 0, w, 0.18, d)),
    P(G.box, M.brass, mx(0, 0.185, d / 2 - 0.03, w, 0.02, 0.06), false),
    P(G.box, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.5, 0.7), toneMapped: false }), mx(0, 0.06, d / 2 + 0.005, w, 0.03, 0.01), false),
  ];
}

export function procParts(kind: ProcKind, item: ProcItem): Part[] {
  const { M, G } = kitShared();
  const seed = [...item.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const color = item.color ?? '#1E3A6E';
  switch (kind) {
    case 'tree': return broadleaf(seed, { height: 3.4, crown: 1.9 });
    case 'oak': return broadleaf(seed, { height: 4.0, crown: 2.7, clusters: 14, palette: AUTUMN });
    case 'blossom': return broadleaf(seed, { height: 3.2, crown: 1.9, palette: ['#F6C6D6', '#F2B3CA', '#E99AB8', '#D97FA3', '#C46A8E'], flowers: ['#FBE3EC', '#F07AA5'] });
    case 'pine': return pine(seed);
    case 'palm': return palm(seed);
    case 'bush': return bush(seed);
    case 'bush_flower': return bush(seed, GREENS, ['#F07AA5', '#F5C542', '#E8505B']);
    case 'flowers': return flowerBed(item.w, item.d, seed);
    case 'flowers_round': return flowerBed(item.w, item.d, seed, true);
    case 'hedge': return hedge(item.w, seed);
    case 'reeds': return reeds(seed);
    case 'lilies': return lilies(seed);
    case 'lamp_post': return lampPost();
    case 'string_lights': return stringLights(item.w);
    case 'pergola': return pergola(item.w, item.d, seed);
    case 'umbrella_set': return umbrellaSet(color, seed);
    case 'gazebo': return gazebo(seed);
    case 'picnic': return picnic();
    case 'fire_pit': return firePit();
    case 'planter_tree': return planterTree(seed);
    case 'bench': return bench();
    case 'fountain': return fountain(false);
    case 'big_fountain': return fountain(true);
    case 'boulder': {
      const b = new Painter(rng(seed));
      b.add(G.blobLow, mx(0, 0.3, 0, 1.2, 0.7, 1.0), '#6F6A62', { shade: 0.4 }).add(G.blobLow, mx(0.35, 0.22, 0.2, 0.6, 0.45, 0.55), '#8A847A', { shade: 0.4 });
      return [P(b.done(), M.fabric)];
    }
    case 'rug': return rug(color, item.w, item.d, seed);
    case 'stage': return stage(item.w, item.d);
    case 'big_screen': return ledWall(item.w);
    case 'led_wall': return ledWall(item.w);
    case 'truss': return truss(item.w);
    case 'podium': return [P(G.box, M.woodDark, mx(0, 0.55, 0, 0.7, 1.1, 0.5)), P(G.box, M.brass, mx(0, 1.12, 0, 0.74, 0.04, 0.54), false)];
    case 'pool_table': return [P(G.box, M.woodDark, mx(0, 0.72, 0, 2.4, 0.16, 1.3)), P(G.box, M.felt, mx(0, 0.81, 0, 2.15, 0.02, 1.05), false), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => P(G.box, M.woodDark, mx(a * 1.05, 0.33, b * 0.5, 0.14, 0.66, 0.14)))];
    case 'arcade': return [P(G.box, M.arcade, mx(0, 0.85, 0, 0.8, 1.7, 0.7)), P(G.plane, M.screenDim, mx(0, 1.25, 0.36, 0.6, 1, 0.45).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), false), P(G.box, M.brass, mx(0, 1.72, 0, 0.82, 0.06, 0.72), false)];
    case 'beanbag': return [P(new Painter(rng(seed)).add(G.blob, mx(0, 0.28, 0, 0.9, 0.55, 0.9), color === '#1E3A6E' ? '#C9952F' : color, { shade: 0.4 }).done(), M.fabric)];
    case 'theatre_seat': return theatreSeat(color);
    case 'sofa_p': return sofa(color, item.w);
    case 'lounge_chair': return loungeChair(color);
    case 'dining_set': return diningSet(color, 4);
    case 'bar_counter': return barCounter(item.w);
    case 'bar_stool': return barStool(color);
    case 'bottle_wall': return bottleWall(item.w);
    case 'fireplace': return fireplace();
    case 'booth': return booth(color);
    case 'reception': return reception(item.w);
    case 'bookcase': return bookcase(item.w);
    case 'conference': return conference(10, color);
    case 'ping_pong': return pingPong();
    case 'potted_tree': return pottedTree(seed);
    case 'doorway': return doorway(item.w);
    case 'car': return carParts(color);
    case 'bike': return bikeParts(color);
  }
}

/** Grass tufts scattered over a lawn: a few blades, dark at the root and light at the tip. */
export function grassTuft(): THREE.BufferGeometry {
  const rand = rng(77);
  const p = new Painter(rand);
  const blade = new THREE.ConeGeometry(0.035, 1, 3, 1);
  blade.translate(0, 0.5, 0);
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const h = 0.18 + rand() * 0.16;
    p.add(blade, mx(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05, 1, h, 1, 0, (rand() - 0.5) * 0.7, (rand() - 0.5) * 0.7), ['#5E9A3C', '#6BA544', '#4C8A34'][i % 3], { shade: 0.7, jitter: 0.1 });
  }
  blade.dispose();
  return p.done();
}
