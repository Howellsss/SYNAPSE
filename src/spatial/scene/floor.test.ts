import { describe, expect, it } from 'vitest';
import { cellAt, clampToFloor, floorFor, keyDirection, moveKeyFor, pinRootMotion, spawnPoint, type MoveKey } from './floor';

const floor = floorFor('small');
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('floor', () => {
  it('sizes the floor by team size, small by default', () => {
    expect(floorFor('solo')).toEqual({ width: 12, depth: 10 });
    expect(floorFor(undefined)).toEqual(floorFor('small'));
  });
  it('keeps people on the floor', () => {
    expect(clampToFloor(floor, -5, 100)).toEqual({ x: 0.4, z: 15.6 });
    expect(clampToFloor(floor, 3, 4)).toEqual({ x: 3, z: 4 });
  });
  it('spawns near the middle', () => {
    for (const r of [0, 0.25, 0.5, 0.99]) {
      const p = spawnPoint(floor, () => r);
      expect(Math.hypot(p.x - 10, p.z - 8)).toBeLessThanOrEqual(2.5 + 1e-9);
      expect(Math.hypot(p.x - 10, p.z - 8)).toBeGreaterThanOrEqual(0.8 - 1e-9);
    }
  });
  it('maps positions to grid cells, inside the grid', () => {
    expect(cellAt(floor, 3.7, 0.2)).toEqual({ x: 3, z: 0 });
    expect(cellAt(floor, 20, 16)).toEqual({ x: 19, z: 15 });
  });
});

describe('keyboard walking', () => {
  it('recognises arrows and WASD', () => {
    expect(moveKeyFor({ key: 'ArrowUp', code: 'ArrowUp' })).toBe('up');
    expect(moveKeyFor({ key: 'a', code: 'KeyA' })).toBe('left');
    expect(moveKeyFor({ key: 'x', code: 'KeyX' })).toBeNull();
  });
  it('walks relative to the camera in the +x/+z corner', () => {
    const dir = (...k: MoveKey[]) => keyDirection(new Set(k))!;
    close(dir('up').x, -Math.SQRT1_2); close(dir('up').z, -Math.SQRT1_2);
    close(dir('right').x, Math.SQRT1_2); close(dir('right').z, -Math.SQRT1_2);
    close(dir('up', 'right').x, 0); close(dir('up', 'right').z, -1);
    expect(keyDirection(new Set())).toBeNull();
    expect(keyDirection(new Set<MoveKey>(['up', 'down']))).toBeNull();
  });
});

describe('pinRootMotion', () => {
  it('keeps height but removes horizontal travel', () => {
    const v = new Float32Array([1, 0.9, 2, 1.5, 1.0, 3, 2, 0.95, 4]);
    pinRootMotion(v);
    expect([...v]).toEqual([1, 0.9, 2, 1, 1.0, 2, 1, 0.95, 2].map(Math.fround));
  });
});
