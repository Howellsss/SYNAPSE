import { describe, expect, it } from 'vitest';
import { characterNameFromFile, checkCharacterFileMeta, MAX_CHARACTER_BYTES, readGlbSummary } from './glb';

function glb(json: unknown, { magic = 0x46546c67, version = 2 } = {}): ArrayBuffer {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(20 + body.length);
  const view = new DataView(buf);
  view.setUint32(0, magic, true);
  view.setUint32(4, version, true);
  view.setUint32(8, buf.byteLength, true);
  view.setUint32(12, body.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf, 20).set(body);
  return buf;
}

const character = {
  accessors: [
    { count: 300 }, // positions
    { count: 900 }, // indices -> 300 triangles
    { count: 31, max: [1.25] }, // Walking times
    { count: 91, max: [3.75] }, // ymca times
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  skins: [{ joints: [0, 1, 2] }],
  animations: [
    { name: 'Walking', samplers: [{ input: 2 }, { input: 2 }] },
    { name: 'ymca_dance', samplers: [{ input: 3 }] },
    { samplers: [] },
  ],
};

describe('readGlbSummary', () => {
  it('lists clips with their lengths, bones and triangles', () => {
    const s = readGlbSummary(glb(character));
    expect(s.clips).toEqual([
      { name: 'Walking', duration: 1.25 },
      { name: 'ymca_dance', duration: 3.75 },
      { name: 'Clip 3', duration: 0 },
    ]);
    expect(s.bones).toBe(3);
    expect(s.triangles).toBe(300);
    expect(s.meshes).toBe(1);
  });

  it('counts non-indexed triangles from the positions', () => {
    const s = readGlbSummary(glb({ accessors: [{ count: 9 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] }));
    expect(s.triangles).toBe(3);
    expect(s.clips).toEqual([]);
  });

  it('rejects files that are not GLB 2.0', () => {
    expect(() => readGlbSummary(new TextEncoder().encode('{"asset":{}}  just some json!!').buffer as ArrayBuffer)).toThrow(/isn't a GLB/);
    expect(() => readGlbSummary(glb(character, { magic: 0x12345678 }))).toThrow(/isn't a GLB/);
    expect(() => readGlbSummary(glb(character, { version: 1 }))).toThrow(/glTF 2.0/);
  });

  it('rejects a damaged JSON chunk', () => {
    const buf = glb(character);
    new Uint8Array(buf)[20] = 0x7b + 1; // break the opening brace
    expect(() => readGlbSummary(buf)).toThrow(/damaged/);
  });
});

describe('checkCharacterFileMeta', () => {
  it('accepts a .glb up to 30 MB', () => {
    expect(checkCharacterFileMeta({ name: 'man.glb', size: MAX_CHARACTER_BYTES })).toBeNull();
    expect(checkCharacterFileMeta({ name: 'MAN.GLB', size: 1000 })).toBeNull();
  });
  it('explains what is wrong', () => {
    expect(checkCharacterFileMeta({ name: 'man.glb', size: MAX_CHARACTER_BYTES + 1 })).toMatch(/30\.0 MB.*up to 30 MB/);
    expect(checkCharacterFileMeta({ name: 'man.gltf', size: 1000 })).toMatch(/\.glb/);
    expect(checkCharacterFileMeta({ name: 'man.glb', size: 0 })).toMatch(/empty/);
  });
});

describe('characterNameFromFile', () => {
  it('turns the merged file name into a readable name', () => {
    expect(characterNameFromFile('Meshy_AI_Man_in_Yellow_Jacket__biped_all_animations.glb')).toBe('Meshy AI Man in Yellow Jacket biped');
    expect(characterNameFromFile('hero_optimized_2.glb')).toBe('hero');
    expect(characterNameFromFile('.glb')).toBe('Character');
  });
});
