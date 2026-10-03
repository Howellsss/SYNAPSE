import { describe, expect, it } from 'vitest';
import { chunkSync, contentRect, emptyState, hitTest, parseMsg, reduce, type AnnotState, type Item, type Roles } from './annotations';

const roles: Roles = { presenter: 'pres', host: 'host' };
const run = (state: AnnotState, from: string, raw: unknown) => { const m = parseMsg(raw); return m ? reduce(state, m, from, roles) : state; };

describe('annotation messages', () => {
  it('builds strokes from begin + points, attributed to the real sender', () => {
    let s = run(emptyState(), 'ama', { t: 'begin', id: 's1', tool: 'pen', color: '#EF4444', width: 0.004, p: [0.1, 0.1] });
    s = run(s, 'ama', { t: 'pts', id: 's1', pts: [[0.2, 0.2], [0.3, 0.25]] });
    s = run(s, 'kenji', { t: 'pts', id: 's1', pts: [[0.9, 0.9]] }); // someone else can't extend it
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ by: 'ama', points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.25]] });
  });

  it('clamps coordinates and rejects junk', () => {
    expect(parseMsg({ t: 'laser', x: 7, y: -2 })).toEqual({ t: 'laser', x: 1, y: 0 });
    expect(parseMsg({ t: 'begin', id: 'x', tool: 'spray', color: '#fff', width: 1, p: [0, 0] })).toBeNull();
    expect(parseMsg({ t: 'text', id: 't', color: 'red', x: 0, y: 0, text: 'hi' })).toBeNull();
    expect(parseMsg({ t: 'nope' })).toBeNull();
    expect(parseMsg('x')).toBeNull();
  });

  it('erase: your own marks, or anyone\'s if you present or host', () => {
    let s = run(emptyState(), 'ama', { t: 'text', id: 't1', color: '#FFFFFF', x: 0.5, y: 0.5, text: 'look' });
    s = run(s, 'kenji', { t: 'erase', id: 't1' });
    expect(s.items).toHaveLength(1);
    s = run(s, 'pres', { t: 'erase', id: 't1' });
    expect(s.items).toHaveLength(0);
  });

  it('clear all only from the presenter or host; clear mine for anyone', () => {
    let s = run(emptyState(), 'ama', { t: 'text', id: 'a', color: '#FFFFFF', x: 0, y: 0, text: 'a' });
    s = run(s, 'kenji', { t: 'text', id: 'k', color: '#FFFFFF', x: 0, y: 0, text: 'k' });
    s = run(s, 'ama', { t: 'clear', scope: 'all' });
    expect(s.items.map((i) => i.id)).toEqual(['k']);
    s = run(s, 'host', { t: 'clear', scope: 'all' });
    expect(s.items).toEqual([]);
  });

  it('the presenter can stop others annotating', () => {
    let s = run(emptyState(), 'ama', { t: 'perm', allowed: false });
    expect(s.allowed).toBe(true);
    s = run(s, 'pres', { t: 'perm', allowed: false });
    expect(s.allowed).toBe(false);
    s = run(s, 'ama', { t: 'begin', id: 's', tool: 'pen', color: '#EF4444', width: 0.004, p: [0, 0] });
    expect(s.items).toHaveLength(0);
    s = run(s, 'host', { t: 'begin', id: 'h', tool: 'pen', color: '#EF4444', width: 0.004, p: [0, 0] });
    expect(s.items).toHaveLength(1);
  });

  it('late joiners get the presenter\'s copy in parts', () => {
    const items: Item[] = Array.from({ length: 60 }, (_, i) => ({ kind: 'stroke', id: `s${i}`, by: 'pres', tool: 'pen', color: '#EF4444', width: 0.004, points: Array.from({ length: 30 }, (_, j) => [j / 30, i / 60] as [number, number]) }));
    const parts = chunkSync(items, true, 12000);
    expect(parts.length).toBeGreaterThan(1);
    let s = run(emptyState(), 'pres', { t: 'text', id: 'old', color: '#FFFFFF', x: 0, y: 0, text: 'stale' });
    for (const p of parts) s = run(s, 'pres', JSON.parse(JSON.stringify(p)));
    expect(s.items).toHaveLength(60);
    expect(run(emptyState(), 'ama', parts[0]).items).toHaveLength(0); // only the presenter's sync counts
  });
});

describe('geometry', () => {
  it('finds the picture inside a letterboxed video', () => {
    expect(contentRect(1600, 900, 1920, 1200)).toEqual({ x: 80, y: 0, w: 1440, h: 900 });
    expect(contentRect(800, 800, 1920, 1080)).toMatchObject({ x: 0, w: 800, h: 450, y: 175 });
  });

  it('hit-tests strokes for the eraser', () => {
    const items: Item[] = [{ kind: 'stroke', id: 'a', by: 'x', tool: 'pen', color: '#EF4444', width: 0.004, points: [[0.1, 0.1], [0.5, 0.1]] }];
    expect(hitTest(items, [0.3, 0.105])?.id).toBe('a');
    expect(hitTest(items, [0.3, 0.3])).toBeNull();
  });
});
