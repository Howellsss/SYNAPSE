/**
 * Bodies in a space: finding a character's legs, arms, hips and shoulders, and fixing up how it
 * holds itself after its clips have played.
 *
 * - Standing: shoulders level (never hunched up) and arms down by the sides. A character without
 *   a standing clip would otherwise stand in its file's pose, often a T or A with the arms out;
 *   one whose clip lifts the shoulders or holds the arms wide is brought back within a natural range.
 * - Walking with the feminine style: narrower steps towards the centre line, a gentle sway of the
 *   hips with the shoulders turning against them, and softer arms.
 */
import * as THREE from 'three';

export interface Limb { root: THREE.Object3D; mid: THREE.Object3D; end: THREE.Object3D }
export interface Rig {
  legs: Limb[];
  arms: Limb[];
  /** The bone above both legs (hips / pelvis), and the first spine bone above it. */
  hips: THREE.Object3D | null;
  spine: THREE.Object3D | null;
  /** Each arm's collar bone (shoulder / clavicle), when the rig has them. */
  shoulders: (THREE.Object3D | null)[];
  /** Every bone's natural (standing) pose, from the file. */
  rest: { bone: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[];
  /** Bones changed after the clips last frame: what the clips left, and what was written over it. */
  written: Map<THREE.Object3D, { before: THREE.Quaternion; after: THREE.Quaternion }>;
}

const isBone = (o: THREE.Object3D | null | undefined): o is THREE.Object3D => !!o && !!(o as THREE.Bone).isBone;

/** Legs, arms, hips and shoulders of a rigged character, found by the usual bone names (Mixamo, Meshy, Blender). */
export function findRig(model: THREE.Object3D): Rig | null {
  const legs: Limb[] = [];
  const arms: Limb[] = [];
  const rest: Rig['rest'] = [];
  const firstBone = (o: THREE.Object3D) => o.children.find(isBone);
  model.traverse((o) => {
    if (!isBone(o)) return;
    rest.push({ bone: o, q: o.quaternion.clone(), p: o.position.clone() });
    if (/twist|roll/i.test(o.name)) return;
    if (/up_?leg|thigh|upper_?leg/i.test(o.name)) {
      const mid = firstBone(o);
      const end = mid && firstBone(mid);
      if (mid && end) legs.push({ root: o, mid, end });
    } else if (/hand$/i.test(o.name.replace(/[._-]?[lr]$/i, '').replace(/^.*[:|]/, '')) || /(^|[^a-z])hand([^a-z]|$)/i.test(o.name)) {
      // Hand → forearm → upper arm.
      const mid = o.parent;
      const root = mid?.parent;
      if (isBone(mid) && isBone(root) && arms.every((a) => a.end !== o)) arms.push({ root, mid, end: o });
    }
  });
  if (legs.length !== 2) return null;
  const hips = legs[0].root.parent === legs[1].root.parent && isBone(legs[0].root.parent) ? legs[0].root.parent : null;
  const spine = hips ? hips.children.find((c) => isBone(c) && /spine|chest|torso/i.test(c.name)) ?? null : null;
  const goodArms = arms.length === 2 ? arms : [];
  const shoulders = goodArms.map((a) => (isBone(a.root.parent) && /shoulder|clavicle|collar/i.test(a.root.parent.name) ? a.root.parent : null));
  return { legs, arms: goodArms, hips, spine, shoulders, rest, written: new Map() };
}

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();

/** The rig being adjusted this frame (see beginPose). */
let active: Rig | null = null;
const remember = (bone: THREE.Object3D) => {
  if (active && !active.written.has(bone)) active.written.set(bone, { before: bone.quaternion.clone(), after: new THREE.Quaternion() });
};

/**
 * Call after the clips have played and before any adjustment. A bone no clip animates keeps what
 * was written last frame: it's put back first, so adjustments never pile up.
 */
export function beginPose(rig: Rig) {
  for (const [bone, w] of rig.written) if (bone.quaternion.equals(w.after)) bone.quaternion.copy(w.before);
  rig.written.clear();
  active = rig;
}

/** Call when the frame's adjustments are done. */
export function endPose(rig: Rig) {
  for (const [bone, w] of rig.written) w.after.copy(bone.quaternion);
  active = null;
}

/** Turns `bone` so the direction to `child` points along `want` (world space, unit length). */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, want: THREE.Vector3) {
  if (!bone.parent) return;
  remember(bone);
  bone.getWorldPosition(_va);
  child.getWorldPosition(_vb);
  const cur = _vb.sub(_va);
  if (cur.lengthSq() < 1e-10) return;
  cur.normalize();
  _qa.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(_qb);
  bone.parent.getWorldQuaternion(_qc);
  bone.quaternion.copy(_qc.invert().multiply(_qa.multiply(_qb)));
  bone.updateMatrixWorld(true);
}

/** Turns `bone` by `angle` about a world-space axis. */
export function turnBone(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-5) return;
  remember(bone);
  _qa.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_qb);
  bone.parent.getWorldQuaternion(_qc);
  bone.quaternion.copy(_qc.invert().multiply(_qa.multiply(_qb)));
  bone.updateMatrixWorld(true);
}

const dir = (from: THREE.Object3D, to: THREE.Object3D, out: THREE.Vector3) => {
  from.getWorldPosition(_va);
  to.getWorldPosition(out);
  return out.sub(_va).normalize();
};

const UP = new THREE.Vector3(0, 1, 0);
const fwd = new THREE.Vector3();
const side = new THREE.Vector3();
const cur = new THREE.Vector3();
const want = new THREE.Vector3();
const tmp = new THREE.Vector3();
const hipsAt = new THREE.Vector3();

/**
 * Brings `cur` (a unit direction) to within `maxAngle` of `target`, by turning it the shortest way.
 * Returns null when it's already within range.
 */
function limitTo(curDir: THREE.Vector3, target: THREE.Vector3, maxAngle: number, out: THREE.Vector3): THREE.Vector3 | null {
  const angle = curDir.angleTo(target);
  if (angle <= maxAngle + 1e-4) return null;
  _qa.setFromUnitVectors(curDir, target);
  _qb.identity().slerp(_qa, (angle - maxAngle) / angle);
  return out.copy(curDir).applyQuaternion(_qb).normalize();
}

export type Stance = 'stand' | 'walk' | 'still';

/**
 * After the clips: shoulders level and arms within a natural range of hanging down.
 * `still` = standing with no clip at all (the file's pose): arms placed fully down, elbows soft.
 */
export function relaxPosture(rig: Rig, body: THREE.Object3D, stance: Stance) {
  if (!rig.arms.length) return;
  body.updateMatrixWorld(true);
  const yaw = body.getWorldQuaternion(_qc).clone();
  fwd.set(0, 0, 1).applyQuaternion(yaw).setY(0).normalize();
  (rig.hips ?? rig.legs[0].root).getWorldPosition(hipsAt);
  rig.arms.forEach((arm, i) => {
    // Which side this arm is on.
    arm.root.getWorldPosition(tmp);
    side.set(tmp.x - hipsAt.x, 0, tmp.z - hipsAt.z);
    side.addScaledVector(fwd, -side.dot(fwd));
    if (side.lengthSq() < 1e-8) return;
    side.normalize();
    // Shoulders: the collar bone runs out to the side, never up towards the ear.
    const sh = rig.shoulders[i];
    if (sh) {
      dir(sh, arm.root, cur);
      if (cur.y > 0.06) aimBone(sh, arm.root, want.set(cur.x, 0, cur.z).normalize().add(tmp.set(0, -0.03, 0)).normalize());
    }
    // Upper arm: down by the side, a little out and forward.
    want.set(0, -1, 0).addScaledVector(side, stance === 'still' ? 0.16 : 0.12).addScaledVector(fwd, 0.05).normalize();
    dir(arm.root, arm.mid, cur);
    const limit = stance === 'still' ? 0 : stance === 'walk' ? 0.62 : 0.42;
    const next = limitTo(cur, want, limit, tmp);
    if (next) aimBone(arm.root, arm.mid, next.clone());
    // No clip: soft elbows, forearms slightly forward.
    if (stance === 'still') {
      dir(arm.root, arm.mid, cur);
      aimBone(arm.mid, arm.end, want.copy(cur).addScaledVector(fwd, 0.32).addScaledVector(side, -0.05).normalize());
    }
  });
}

/**
 * The feminine walk, laid over the walk clip: `phase` runs 0..1 over one full stride (two steps).
 * Also used gently while standing (a relaxed weight shift) with `amount` < 1.
 */
export function feminineGait(rig: Rig, body: THREE.Object3D, phase: number, amount = 1) {
  if (!rig.hips) return;
  body.updateMatrixWorld(true);
  body.getWorldQuaternion(_qc);
  fwd.set(0, 0, 1).applyQuaternion(_qc).setY(0).normalize();
  const a = phase * Math.PI * 2;
  const sway = Math.sin(a) * amount;
  // Hips roll and turn with each step; the chest turns back so the shoulders stay calm.
  turnBone(rig.hips, fwd, sway * 0.075);
  turnBone(rig.hips, UP, sway * 0.09);
  if (rig.spine) {
    turnBone(rig.spine, fwd, -sway * 0.06);
    turnBone(rig.spine, UP, -sway * 0.13);
  }
  // Narrower steps: each thigh reaches a little towards the centre line.
  rig.hips.getWorldPosition(hipsAt);
  for (const leg of rig.legs) {
    leg.root.getWorldPosition(tmp);
    side.set(tmp.x - hipsAt.x, 0, tmp.z - hipsAt.z);
    side.addScaledVector(fwd, -side.dot(fwd));
    if (side.lengthSq() < 1e-8) continue;
    side.normalize();
    dir(leg.root, leg.mid, cur);
    aimBone(leg.root, leg.mid, cur.addScaledVector(side, -0.075 * amount).normalize().clone());
  }
  // Softer arms: closer to the body, a smaller swing.
  rig.arms.forEach((arm) => {
    arm.root.getWorldPosition(tmp);
    side.set(tmp.x - hipsAt.x, 0, tmp.z - hipsAt.z);
    side.addScaledVector(fwd, -side.dot(fwd));
    if (side.lengthSq() < 1e-8) return;
    side.normalize();
    want.set(0, -1, 0).addScaledVector(side, 0.08).normalize();
    dir(arm.root, arm.mid, cur);
    aimBone(arm.root, arm.mid, cur.lerp(want, 0.35 * amount).normalize().clone());
  });
}
