import { describe, expect, it } from 'vitest';
import { MoveSender, type LocalState } from './moveSender';
import { RemoteMover, lerpAngle, pointAlong } from './interpolation';
import { mergePresence, parseEmote, parseMove, parsePath, parsePresence, HEARTBEAT_MS, type MoveMsg, type PathMsg } from './protocol';
import { estimateVolume } from './volume';

function sender() {
  let now = 0;
  const moves: MoveMsg[] = [];
  const paths: PathMsg[] = [];
  const s = new MoveSender('u1', (m) => moves.push(m), (p) => paths.push(p), () => now);
  return { s, moves, paths, tick: (ms: number) => { now += ms; }, at: () => now };
}
const at = (x: number, z = 0, anim: LocalState['anim'] = 'walk'): LocalState => ({ x, z, rot: 0, anim });

describe('MoveSender', () => {
  it('sends at most 10 messages a second while moving, then the final position', () => {
    const { s, moves, tick } = sender();
    for (let i = 0; i < 60; i++) { s.update(at(i * 0.05)); tick(1000 / 60); } // one second at 60fps
    expect(moves.length).toBeGreaterThanOrEqual(9);
    expect(moves.length).toBeLessThanOrEqual(11);
    s.update(at(10, 0, 'idle')); tick(100); s.update(at(10, 0, 'idle'));
    expect(moves[moves.length - 1]).toMatchObject({ x: 10, anim: 'idle' });
    expect(moves.map((m) => m.seq)).toEqual([...moves.map((m) => m.seq)].sort((a, b) => a - b));
  });

  it('only sends a heartbeat every 5 s when standing still', () => {
    const { s, moves, tick } = sender();
    s.update(at(1, 1, 'idle'));
    const first = moves.length;
    for (let i = 0; i <= 601; i++) { s.update(at(1, 1, 'idle')); tick(1000 / 60); } // just over 10 s
    expect(moves.length - first).toBe(Math.floor(10000 / HEARTBEAT_MS));
  });

  it('sends a path once, then a correction a second', () => {
    const { s, moves, paths, tick } = sender();
    s.startPath([[0, 0], [10, 0]], 2);
    for (let i = 0; i < 180; i++) { s.update(at(i / 30)); tick(1000 / 60); } // 3 s
    expect(paths).toHaveLength(1);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves.length).toBeLessThanOrEqual(3);
  });
});

describe('RemoteMover', () => {
  const move = (seq: number, t: number, x: number, anim: MoveMsg['anim'] = 'walk'): MoveMsg => ({ userId: 'u2', x, z: 0, rot: Math.PI / 2, anim, seq, t });

  it('blends between snapshots, drawn 120 ms in the past', () => {
    const r = new RemoteMover(120);
    r.receiveMove(move(1, 1000, 0), 5000);
    r.receiveMove(move(2, 1100, 1), 5100);
    const p = r.sample(5170)!; // render time 5050 = halfway
    expect(p.x).toBeCloseTo(0.5);
    expect(p.anim).toBe('walk');
  });

  it('drops late and duplicate messages', () => {
    const r = new RemoteMover(0);
    r.receiveMove(move(2, 1000, 5), 1000);
    r.receiveMove(move(1, 900, 99), 1001);
    r.receiveMove(move(2, 1000, 99), 1002);
    expect(r.sample(2000)!.x).toBe(5);
  });

  it('holds the last position instead of guessing ahead', () => {
    const r = new RemoteMover(0);
    r.receiveMove(move(1, 0, 0), 0);
    r.receiveMove(move(2, 100, 1, 'idle'), 100);
    expect(r.sample(5000)!.x).toBe(1);
  });

  it('walks a broadcast path locally and sits at the end', () => {
    const r = new RemoteMover(0);
    r.receivePath({ userId: 'u2', points: [[0, 0], [4, 0], [4, 3]], speed: 2, sitAtEnd: true, seq: 1, t: 0 }, 0);
    expect(r.sample(1000)).toMatchObject({ x: 2, z: 0, anim: 'walk' });
    expect(r.sample(2500)!.z).toBeCloseTo(1);
    expect(r.sample(10000)).toMatchObject({ x: 4, z: 3, anim: 'sit' });
  });

  it('corrects drift during a path smoothly, and a later stop ends the path', () => {
    const r = new RemoteMover(0);
    r.receivePath({ userId: 'u2', points: [[0, 0], [10, 0]], speed: 1, sitAtEnd: false, seq: 1, t: 0 }, 0);
    r.receiveMove(move(2, 2000, 3), 2000); // they're 1 m further than expected
    const p = r.sample(2000)!;
    expect(p.x).toBeGreaterThan(2.5);
    expect(p.x).toBeLessThan(3.01);
    r.receiveMove(move(3, 20000, 10, 'idle'), 20000);
    expect(r.sample(20001)).toMatchObject({ x: 10, anim: 'idle' });
  });

  it('turns the short way round', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(pointAlong([[0, 0], [0, 2]], 1)).toMatchObject({ x: 0, z: 1, done: false });
  });
});

describe('protocol validation', () => {
  it('rejects malformed or out-of-range messages', () => {
    expect(parseMove({ userId: 'u', x: 1, z: 2, rot: 0, anim: 'walk', seq: 1, t: 5 })).not.toBeNull();
    expect(parseMove({ userId: 'u', x: Infinity, z: 2, rot: 0, seq: 1, t: 5 })).toBeNull();
    expect(parseMove({ userId: 'u', x: 1e9, z: 2, rot: 0, seq: 1, t: 5 })).toBeNull();
    expect(parseMove({ userId: 'u', x: 1, z: 2, rot: 0, anim: 'moonwalk', seq: 1, t: 5 })!.anim).toBe('idle');
    expect(parsePath({ userId: 'u', points: [[0, 0]], speed: 1, seq: 1, t: 1 })).toBeNull();
    expect(parsePath({ userId: 'u', points: [[0, 0], [1, 'x']], speed: 1, seq: 1, t: 1 })).toBeNull();
    expect(parseEmote({ userId: 'u', kind: 'wave', to: null, t: 1 })).not.toBeNull();
    expect(parseEmote({ userId: 'u', kind: 'explode', t: 1 })).toBeNull();
  });

  it('cleans presence and ignores entries filed under someone else\'s key', () => {
    expect(parsePresence({ userId: 'u', name: '  Ama  ', avatarUrl: 'javascript:alert(1)', status: 'weird' }))
      .toMatchObject({ name: 'Ama', avatarUrl: null, status: 'available', away: false });
    const merged = mergePresence({
      u1: [{ userId: 'u1', name: 'Ade', joinedAt: '1' }, { userId: 'u1', name: 'Ade', status: 'busy', joinedAt: '2' }],
      u2: [{ userId: 'u1', name: 'Impostor', joinedAt: '3' }],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: 'Ade', status: 'busy' });
  });
});

describe('message volume estimate', () => {
  it('matches a hand calculation for 25 people', () => {
    const v = estimateVolume({ users: 25, keyboardMovers: 0, pathWalkers: 0, heartbeatMs: 5000, presenceUpdatesPerHour: 0, emotesPerHour: 0 });
    expect(v.sentPerSecond).toBeCloseTo(5);
    expect(v.deliveredPerSecond).toBeCloseTo(5 * 24);
  });
});
