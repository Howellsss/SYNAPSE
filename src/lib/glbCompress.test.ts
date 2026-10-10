import { describe, expect, it } from 'vitest';
import { normalMapImages, packGlb, replaceImages, splitGlb } from './glbCompress';
import { readGlbSummary } from './glb';

// A tiny character-like GLB: vertex data, an animation track and two embedded images.
function sample() {
  const positions = new Uint8Array(36).map((_, i) => i + 1); // view 0
  const anim = new Uint8Array(10).map((_, i) => 200 + i); // view 1 (odd length → next view must realign)
  const png = new Uint8Array(50).fill(7); // view 2: base colour
  const normal = new Uint8Array(30).fill(9); // view 3: normal map
  const parts = [positions, anim, png, normal];
  const bin = new Uint8Array(160);
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let at = 0;
  for (const p of parts) { at = (at + 3) & ~3; bin.set(p, at); bufferViews.push({ buffer: 0, byteOffset: at, byteLength: p.length }); at += p.length; }
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5121, count: 10, type: 'SCALAR', max: [2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    animations: [{ name: 'Walking', samplers: [{ input: 1, output: 1 }], channels: [] }],
    images: [{ bufferView: 2, mimeType: 'image/png' }, { bufferView: 3, mimeType: 'image/png' }],
    textures: [{ source: 0 }, { source: 1 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 1 } }],
  };
  return { json, bin, positions, anim, normal };
}

describe('GLB repacking', () => {
  it('round-trips a GLB unchanged', () => {
    const { json, bin } = sample();
    const again = splitGlb(packGlb(json, bin));
    expect(again.json).toEqual(json);
    expect([...again.bin]).toEqual([...bin]);
  });

  it('swaps an image and keeps every other byte, aligned to 4 bytes', () => {
    const { json, bin, positions, anim, normal } = sample();
    const jpeg = new Uint8Array(13).fill(3);
    const out = replaceImages(json, bin, new Map([[0, { bytes: jpeg, mimeType: 'image/jpeg' }]]));
    const file = splitGlb(packGlb(out.json, out.bin));
    const view = (i: number) => { const v = file.json.bufferViews[i]; return [...file.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength)]; };
    expect(view(0)).toEqual([...positions]);
    expect(view(1)).toEqual([...anim]);
    expect(view(2)).toEqual([...jpeg]);
    expect(view(3)).toEqual([...normal]);
    for (const v of file.json.bufferViews) expect(v.byteOffset % 4).toBe(0);
    expect(file.json.images[0].mimeType).toBe('image/jpeg');
    expect(file.json.buffers[0].byteLength).toBe(file.bin.length);
    expect(json.images[0].mimeType).toBe('image/png'); // input untouched
    // Still a readable character with its clip.
    expect(readGlbSummary(packGlb(out.json, out.bin)).clips.map((c) => c.name)).toEqual(['Walking']);
  });

  it('finds normal maps', () => {
    expect([...normalMapImages(sample().json)]).toEqual([1]);
  });
});
