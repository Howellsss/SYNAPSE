import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { beginPose, endPose, feminineGait, findRig, relaxPosture } from './posture';

/** A small Mixamo-like skeleton in a T-pose, facing +z. */
function tPose() {
  const bone = (name: string, x: number, y: number, z: number, parent?: THREE.Object3D) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent?.add(b);
    return b;
  };
  const root = new THREE.Group();
  const hips = bone('mixamorig:Hips', 0, 1, 0);
  root.add(hips);
  const spine = bone('mixamorig:Spine', 0, 0.2, 0, hips);
  const chest = bone('mixamorig:Spine2', 0, 0.3, 0, spine);
  for (const s of [1, -1]) {
    const L = s > 0 ? 'Left' : 'Right';
    const sh = bone(`mixamorig:${L}Shoulder`, s * 0.08, 0.1, 0, chest);
    const arm = bone(`mixamorig:${L}Arm`, s * 0.12, 0, 0, sh);
    const fore = bone(`mixamorig:${L}ForeArm`, s * 0.28, 0, 0, arm);
    bone(`mixamorig:${L}Hand`, s * 0.25, 0, 0, fore);
    const up = bone(`mixamorig:${L}UpLeg`, s * 0.1, -0.05, 0, hips);
    const leg = bone(`mixamorig:${L}Leg`, 0, -0.45, 0, up);
    bone(`mixamorig:${L}Foot`, 0, -0.45, 0, leg);
  }
  root.updateMatrixWorld(true);
  return root;
}

const world = (root: THREE.Object3D, name: string) => root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());

describe('posture', () => {
  it('finds hips, spine, shoulders, arms and legs', () => {
    const rig = findRig(tPose())!;
    expect(rig.hips?.name).toBe('mixamorig:Hips');
    expect(rig.spine?.name).toBe('mixamorig:Spine');
    expect(rig.arms).toHaveLength(2);
    expect(rig.shoulders.map((s) => s?.name)).toEqual(['mixamorig:LeftShoulder', 'mixamorig:RightShoulder']);
  });

  it('brings T-pose arms down by the sides', () => {
    const body = tPose();
    const rig = findRig(body)!;
    expect(world(body, 'mixamorig:LeftHand').y).toBeCloseTo(1.6, 1); // arms straight out
    beginPose(rig);
    relaxPosture(rig, body, 'still');
    endPose(rig);
    body.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) {
      const shoulder = world(body, `mixamorig:${side}Arm`);
      const hand = world(body, `mixamorig:${side}Hand`);
      expect(hand.y).toBeLessThan(shoulder.y - 0.35); // hanging down
      expect(Math.abs(hand.x)).toBeLessThan(0.45); // close to the body
    }
  });

  it('lowers raised shoulders', () => {
    const body = tPose();
    const rig = findRig(body)!;
    rig.shoulders[0]!.rotation.z = 0.5; // shrugged
    body.updateMatrixWorld(true);
    const before = world(body, 'mixamorig:LeftArm').y;
    beginPose(rig);
    relaxPosture(rig, body, 'stand');
    endPose(rig);
    expect(world(body, 'mixamorig:LeftArm').y).toBeLessThan(before - 0.02);
  });

  it('walks with narrower steps and a hip sway, and never piles up frame after frame', () => {
    const body = tPose();
    const rig = findRig(body)!;
    const feet = () => Math.abs(world(body, 'mixamorig:LeftFoot').x - world(body, 'mixamorig:RightFoot').x);
    const wide = feet();
    beginPose(rig);
    feminineGait(rig, body, 0.25);
    endPose(rig);
    const narrow = feet();
    expect(narrow).toBeLessThan(wide - 0.05);
    expect(rig.hips!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.05);
    // No clip touches these bones here: the same frame again gives the same pose, not twice the sway.
    for (let i = 0; i < 5; i++) { beginPose(rig); feminineGait(rig, body, 0.25); endPose(rig); }
    expect(feet()).toBeCloseTo(narrow, 4);
  });
});
