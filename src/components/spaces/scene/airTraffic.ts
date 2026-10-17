/**
 * Planes over SYNAPSE Campus: the airliner holds at the end of the runway, takes off, climbs out,
 * turns back over the campus, lands, rolls out and taxis round to go again; the private jet flies
 * a wide, higher circuit. Where each plane is comes from the clock alone, so everyone sees the
 * same plane in the same place, and nothing is sent over the network.
 *
 * Each plane carries its lights: red on the left wingtip, green on the right, a white strobe on
 * the tail, and a landing light at the nose low down.
 */
import * as THREE from 'three';
import { PROP_DIMS, type PropId } from '@/spatial/scene/campus/props';
import type { Airport } from '@/spatial/scene/campus/layout';
import { glowing, markGlow } from './kitParts';
import { loadProp } from './propModels';

/** A point the plane passes: where, how fast (m/s), and how long it waits there (s). */
interface Way { x: number; y: number; z: number; v: number; hold?: number }

/** The path sampled finely: position and attitude at each sample, and the time it's reached. */
interface Track { n: number; t: Float64Array; p: Float32Array; period: number }

function buildTrack(way: Way[]): Track {
  const curve = new THREE.CatmullRomCurve3(way.map((w) => new THREE.Vector3(w.x, w.y, w.z)), true, 'centripetal');
  const per = 48;
  const xs: number[] = [];
  const ts: number[] = [];
  const a = new THREE.Vector3();
  let prev: THREE.Vector3 | null = null;
  let prevV = way[0].v;
  let time = 0;
  for (let i = 0; i < way.length; i++) {
    const v0 = way[i].v;
    const v1 = way[(i + 1) % way.length].v;
    for (let k = 0; k < per; k++) {
      const u = k / per;
      curve.getPoint((i + u) / way.length, a);
      a.y = Math.max(0, a.y);
      const v = v0 + (v1 - v0) * u;
      if (prev) time += a.distanceTo(prev) / Math.max(1.5, (v + prevV) / 2);
      xs.push(a.x, a.y, a.z, 0, 0, 0);
      ts.push(time);
      prev = a.clone();
      prevV = v;
      if (k === 0 && way[i].hold) {
        time += way[i].hold!;
        xs.push(a.x, a.y, a.z, 0, 0, 0);
        ts.push(time);
      }
    }
  }
  // Back to the start.
  time += prev!.distanceTo(new THREE.Vector3(xs[0], xs[1], xs[2])) / Math.max(1.5, (prevV + way[0].v) / 2);
  const n = ts.length;
  const p = new Float32Array(xs);
  // Heading along the path (kept while standing still), nose up or down with the climb, and a
  // bank into turns.
  let yaw = 0;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const dx = p[j * 6] - p[k * 6];
    const dy = p[j * 6 + 1] - p[k * 6 + 1];
    const dz = p[j * 6 + 2] - p[k * 6 + 2];
    const flat = Math.hypot(dx, dz);
    if (flat > 0.05) {
      let next = Math.atan2(dx, dz);
      while (next - yaw > Math.PI) next -= Math.PI * 2;
      while (next - yaw < -Math.PI) next += Math.PI * 2;
      yaw = next;
      p[k * 6 + 4] = -Math.atan2(dy, flat) * 0.9;
    }
    p[k * 6 + 3] = yaw;
  }
  for (let k = 0; k < n; k++) {
    const j = (k + 3) % n;
    const dt = (j > k ? ts[j] - ts[k] : time - ts[k] + ts[j]) || 1;
    const rate = (p[j * 6 + 3] - p[k * 6 + 3]) / dt;
    p[k * 6 + 5] = p[k * 6 + 1] > 0.5 ? Math.max(-0.55, Math.min(0.55, -rate * 1.6)) : 0;
  }
  return { n, t: Float64Array.from(ts), p, period: time };
}

const _q = new THREE.Euler(0, 0, 0, 'YXZ');

function poseAt(track: Track, seconds: number, obj: THREE.Object3D) {
  const s = ((seconds % track.period) + track.period) % track.period;
  let lo = 0;
  let hi = track.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.t[mid] <= s) lo = mid; else hi = mid - 1;
  }
  const k = lo;
  const j = (k + 1) % track.n;
  const t1 = j === 0 ? track.period : track.t[j];
  const f = t1 > track.t[k] ? (s - track.t[k]) / (t1 - track.t[k]) : 0;
  const P = track.p;
  const lerp = (o: number) => P[k * 6 + o] + (P[j * 6 + o] - P[k * 6 + o]) * f;
  obj.position.set(lerp(0), lerp(1), lerp(2));
  let yawB = P[j * 6 + 3];
  const yawA = P[k * 6 + 3];
  while (yawB - yawA > Math.PI) yawB -= Math.PI * 2;
  while (yawB - yawA < -Math.PI) yawB += Math.PI * 2;
  _q.set(lerp(4), yawA + (yawB - yawA) * f, lerp(5));
  obj.rotation.copy(_q);
}

interface Plane {
  group: THREE.Group;
  track: Track;
  offset: number;
  strobe: THREE.Object3D[];
  landing: THREE.Object3D | null;
}

/** The plane's extreme points (wingtips, tail, nose), for its lights. */
function extremes(parts: { geo: THREE.BufferGeometry; local: THREE.Matrix4 }[]) {
  const v = new THREE.Vector3();
  const out = { left: v.clone().set(-Infinity, 0, 0), right: v.clone().set(Infinity, 0, 0), tail: v.clone().set(0, 0, Infinity), nose: v.clone().set(0, 0, -Infinity) };
  for (const part of parts) {
    const pos = part.geo.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(part.local);
      if (v.x > out.left.x) out.left.copy(v);
      if (v.x < out.right.x) out.right.copy(v);
      if (v.z < out.tail.z) out.tail.copy(v);
      if (v.z > out.nose.z) out.nose.copy(v);
    }
  }
  return out;
}

export function createAirTraffic(airport: Airport, shadows: boolean): { root: THREE.Group; update(nowMs: number): void; dispose(): void } {
  const root = new THREE.Group();
  root.name = 'air-traffic';
  const { x0, x1, z: R } = airport.runway;
  const T = airport.taxiZ;
  const mid = (x0 + x1) / 2;
  // The airliner: hold, take off east, climb, turn left (north) over the campus, fly west, turn
  // left again onto the approach, land, roll out, and taxi back along the taxiway.
  const airliner = buildTrack([
    { x: x0 + 9, y: 0, z: R, v: 0, hold: 7 },
    { x: x0 + 30, y: 0, z: R, v: 16 },
    { x: x1 - 22, y: 0.4, z: R, v: 30 },
    { x: x1 + 25, y: 9, z: R - 2, v: 34 },
    { x: x1 + 75, y: 17, z: R - 40, v: 34 },
    { x: x1 + 55, y: 20, z: R - 105, v: 34 },
    { x: mid, y: 21, z: R - 118, v: 34 },
    { x: x0 - 55, y: 20, z: R - 105, v: 34 },
    { x: x0 - 80, y: 14, z: R - 45, v: 32 },
    { x: x0 - 45, y: 6, z: R - 1, v: 30 },
    { x: x0 + 14, y: 0.3, z: R, v: 26 },
    { x: mid + 10, y: 0, z: R, v: 12 },
    { x: x1 - 14, y: 0, z: R, v: 5 },
    { x: x1 - 6, y: 0, z: (R + T) / 2, v: 4 },
    { x: x1 - 14, y: 0, z: T, v: 6 },
    { x: x0 + 14, y: 0, z: T, v: 8 },
    { x: x0 + 4, y: 0, z: (R + T) / 2, v: 4 },
  ]);
  // The jet: a wide, higher circuit round the whole campus.
  const jet = buildTrack([
    { x: mid, y: 30, z: R + 20, v: 30 },
    { x: x1 + 70, y: 30, z: R - 40, v: 30 },
    { x: x1 + 40, y: 32, z: -30, v: 30 },
    { x: mid, y: 33, z: -55, v: 30 },
    { x: x0 - 40, y: 32, z: -30, v: 30 },
    { x: x0 - 70, y: 30, z: R - 40, v: 30 },
  ]);

  const red = glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1), toneMapped: false }));
  const green = glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 3, 0.4), toneMapped: false }));
  const white = glowing(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 3.4, 3.2), toneMapped: false }));
  const lightGeo = new THREE.SphereGeometry(1, 10, 8);
  const planes: Plane[] = [];
  let disposed = false;

  const add = (id: PropId, scale: number, track: Track, offset: number) => {
    void loadProp(id).then((parts) => {
      if (disposed) return;
      const group = new THREE.Group();
      group.name = `plane-${id}`;
      const body = new THREE.Group();
      body.scale.setScalar(scale);
      for (const part of parts) {
        const m = new THREE.Mesh(part.geo, part.mat);
        m.matrixAutoUpdate = false;
        m.matrix.copy(part.local);
        m.castShadow = shadows;
        body.add(m);
      }
      group.add(body);
      const at = extremes(parts);
      const lamp = (mat: THREE.Material, p: THREE.Vector3, r: number) => {
        const m = new THREE.Mesh(lightGeo, mat);
        m.position.copy(p).multiplyScalar(scale);
        m.scale.setScalar(r);
        group.add(m);
        return m;
      };
      const size = PROP_DIMS[id].w * scale;
      const r = Math.max(0.12, size * 0.009);
      lamp(red, at.left, r);
      lamp(green, at.right, r);
      const strobe = [lamp(white, at.tail, r * 1.2)];
      const landing = lamp(white, at.nose.clone().setY(at.nose.y * 0.6), r * 1.4);
      markGlow(group);
      root.add(group);
      planes.push({ group, track, offset, strobe, landing });
    });
  };
  add('airliner', 0.85, airliner, 0);
  add('private_jet', 1, jet, jet.period * 0.35);

  return {
    root,
    update(nowMs) {
      const s = nowMs / 1000;
      for (const p of planes) {
        poseAt(p.track, s + p.offset, p.group);
        const flash = (s % 1.3) < 0.08;
        p.strobe.forEach((o) => { o.visible = flash; });
        if (p.landing) p.landing.visible = p.group.position.y < 12;
      }
    },
    dispose() {
      disposed = true;
      lightGeo.dispose();
      [red, green, white].forEach((m) => m.dispose());
    },
  };
}
