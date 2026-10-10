/**
 * Shrinking a character .glb in the browser, so files straight from Meshy (often 35–50 MB, almost
 * all of it 4K PNG textures) fit the 30 MB limit without Blender.
 *
 * Only the embedded textures change: opaque ones are re-encoded as JPEG and, only if still needed,
 * scaled down. Meshes, skeleton, skin weights and animations are copied byte for byte.
 * Mirrors scripts/blender/optimize_meshy_glb.py, lightest change first.
 */
import { MAX_CHARACTER_BYTES, formatMb } from './glb';

/** Aim a little under the limit. */
export const SHRINK_TARGET_BYTES = 28 * 1024 * 1024;

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GltfJson = Record<string, any>;

export function splitGlb(buffer: ArrayBuffer): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("That file isn't a GLB (binary glTF) file.");
  let offset = 12;
  let json: GltfJson | null = null;
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > buffer.byteLength) throw new Error('That GLB file looks damaged.');
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === BIN_CHUNK) bin = new Uint8Array(buffer, start, length);
    offset = start + length;
  }
  if (!json) throw new Error('That GLB file looks damaged.');
  return { json, bin };
}

const pad4 = (n: number) => (n + 3) & ~3;

export function packGlb(json: GltfJson, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen); // JSON is padded with spaces
  if (bin.length) {
    const at = 20 + jsonLen;
    view.setUint32(at, binLen, true);
    view.setUint32(at + 4, BIN_CHUNK, true);
    bytes.set(bin, at + 8); // padding stays zero
  }
  return out;
}

/**
 * Swaps the bytes of some embedded images and lays out the binary chunk again. Every other
 * buffer view keeps its exact bytes; views start on 4-byte boundaries as glTF requires.
 * Returns new JSON (the input isn't changed) and the new binary chunk.
 */
export function replaceImages(json: GltfJson, bin: Uint8Array, replacements: Map<number, { bytes: Uint8Array; mimeType: string }>): { json: GltfJson; bin: Uint8Array } {
  const out: GltfJson = JSON.parse(JSON.stringify(json));
  const views: any[] = out.bufferViews ?? [];
  const newBytes = new Map<number, Uint8Array>();
  for (const [imageIndex, rep] of replacements) {
    const img = out.images?.[imageIndex];
    if (!img || img.bufferView === undefined) throw new Error(`Image ${imageIndex} isn't embedded in the file.`);
    newBytes.set(img.bufferView, rep.bytes);
    img.mimeType = rep.mimeType;
  }
  const parts: Uint8Array[] = views.map((v, i) => newBytes.get(i) ?? bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  let size = 0;
  for (const p of parts) size = pad4(size) + p.length;
  const result = new Uint8Array(pad4(size));
  let offset = 0;
  views.forEach((v, i) => {
    offset = pad4(offset);
    result.set(parts[i], offset);
    v.byteOffset = offset;
    v.byteLength = parts[i].length;
    if (v.buffer === undefined) v.buffer = 0;
    offset += parts[i].length;
  });
  if (out.buffers?.[0]) out.buffers[0].byteLength = result.length;
  return { json: out, bin: result };
}

/** Indexes of images used as normal maps (kept PNG until a stronger step allows JPEG). */
export function normalMapImages(json: GltfJson): Set<number> {
  const out = new Set<number>();
  for (const m of json.materials ?? []) {
    const t = m.normalTexture?.index;
    const src = t !== undefined ? json.textures?.[t]?.source : undefined;
    if (src !== undefined) out.add(src);
  }
  return out;
}

export interface ShrinkLevel {
  label: string;
  /** Longest side in pixels; null = keep. */
  maxSize: number | null;
  /** JPEG for normal maps too. */
  normalsJpeg: boolean;
  quality: number;
}

/** Lightest first, like the Blender script. */
export const SHRINK_LEVELS: ShrinkLevel[] = [
  { label: 'colour textures to JPEG, full size', maxSize: null, normalsJpeg: false, quality: 0.95 },
  { label: 'all opaque textures to JPEG, full size', maxSize: null, normalsJpeg: true, quality: 0.95 },
  { label: 'textures at most 2048 px', maxSize: 2048, normalsJpeg: true, quality: 0.92 },
  { label: 'textures at most 2048 px, JPEG 85', maxSize: 2048, normalsJpeg: true, quality: 0.85 },
  { label: 'textures at most 1024 px', maxSize: 1024, normalsJpeg: true, quality: 0.9 },
];

// ---------------------------------------------------------------- browser only

interface Decoded {
  bitmap: ImageBitmap;
  opaque: boolean;
  mimeType: string;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function decode(bytes: Uint8Array, mimeType: string): Promise<Decoded> {
  // Raw pixel values (no colour conversion), so data and normal maps aren't altered.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  let opaque = true;
  if (mimeType === 'image/png') {
    const c = canvasOf(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { opaque = false; break; }
  }
  return { bitmap, opaque, mimeType };
}

async function encode(d: Decoded, maxSize: number | null, type: 'image/jpeg' | 'image/png', quality: number): Promise<Uint8Array> {
  const scale = maxSize ? Math.min(1, maxSize / Math.max(d.bitmap.width, d.bitmap.height)) : 1;
  const c = canvasOf(Math.max(1, Math.round(d.bitmap.width * scale)), Math.max(1, Math.round(d.bitmap.height * scale)));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(d.bitmap, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));
  if (!blob) throw new Error("Your browser couldn't re-encode a texture.");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Returns the file as is when it already fits, else a smaller copy (lightest step that gets under
 * the target). Throws with a readable message when no step is enough.
 */
export async function shrinkGlbFile(file: File, onProgress?: (message: string) => void): Promise<File> {
  if (file.size <= SHRINK_TARGET_BYTES) return file;
  onProgress?.(`Shrinking ${formatMb(file.size)}…`);
  const { json, bin } = splitGlb(await file.arrayBuffer());
  const normals = normalMapImages(json);
  const images: { index: number; bytes: Uint8Array; mimeType: string }[] = [];
  (json.images ?? []).forEach((img: any, index: number) => {
    if (img.bufferView === undefined || !/^image\/(png|jpeg)$/.test(img.mimeType ?? '')) return;
    const v = json.bufferViews[img.bufferView];
    images.push({ index, bytes: bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), mimeType: img.mimeType });
  });
  if (!images.length) throw new Error(`That file is ${formatMb(file.size)} and has no textures SYNAPSE can shrink. Try lowering the polycount in Meshy.`);

  const decoded = new Map<number, Decoded>();
  for (const img of images) decoded.set(img.index, await decode(img.bytes, img.mimeType));
  try {
    let smallest = Infinity;
    for (const level of SHRINK_LEVELS) {
      onProgress?.(`Shrinking ${formatMb(file.size)}: ${level.label}…`);
      const reps = new Map<number, { bytes: Uint8Array; mimeType: string }>();
      for (const img of images) {
        const d = decoded.get(img.index)!;
        const toJpeg = d.opaque && (level.normalsJpeg || !normals.has(img.index));
        const big = level.maxSize !== null && Math.max(d.bitmap.width, d.bitmap.height) > level.maxSize;
        if (!toJpeg && !big) continue;
        if (!big && img.mimeType === 'image/jpeg') continue; // already JPEG at this size
        reps.set(img.index, { bytes: await encode(d, level.maxSize, toJpeg ? 'image/jpeg' : 'image/png', level.quality), mimeType: toJpeg ? 'image/jpeg' : 'image/png' });
      }
      const next = replaceImages(json, bin, reps);
      const out = packGlb(next.json, next.bin);
      smallest = Math.min(smallest, out.byteLength);
      if (out.byteLength <= SHRINK_TARGET_BYTES) {
        const name = file.name.replace(/\.glb$/i, '') + '_optimized.glb';
        return new File([out], name, { type: 'model/gltf-binary' });
      }
    }
    throw new Error(`Even with smaller textures this character is ${formatMb(smallest)}, over the ${formatMb(MAX_CHARACTER_BYTES)} limit. `
      + 'Most of its size is the 3D mesh: in Meshy, choose a lower polycount and download it again.');
  } finally {
    for (const d of decoded.values()) d.bitmap.close();
  }
}
