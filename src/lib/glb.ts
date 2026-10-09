/**
 * Reading a character .glb (binary glTF 2.0) in the browser before it is uploaded: is it a real
 * GLB, is it small enough, and which animation clips does it carry.
 */

/** Characters can be up to 30 MB (the storage bucket enforces the same limit). */
export const MAX_CHARACTER_BYTES = 30 * 1024 * 1024;

export interface GlbClip {
  name: string;
  /** Length in seconds. */
  duration: number;
}

export interface GlbSummary {
  clips: GlbClip[];
  bones: number;
  triangles: number;
  meshes: number;
}

const JSON_CHUNK = 0x4e4f534a;

export function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A first check on the file itself, before reading it. Returns an error message or null. */
export function checkCharacterFileMeta(file: { name: string; size: number }): string | null {
  if (!/\.glb$/i.test(file.name)) return 'Please choose a .glb file (binary glTF).';
  if (file.size > MAX_CHARACTER_BYTES) return `That file is ${formatMb(file.size)}. Characters can be up to 30 MB.`;
  if (file.size < 20) return 'That file is empty or damaged.';
  return null;
}

/** Reads the GLB header and scene description. Throws an Error with a readable message. */
export function readGlbSummary(buffer: ArrayBuffer): GlbSummary {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    throw new Error("That file isn't a GLB (binary glTF) file.");
  }
  if (view.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 files are supported.');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + jsonLength > buffer.byteLength) {
    throw new Error('That GLB file looks damaged.');
  }
  let gltf: GltfJson;
  try {
    gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as GltfJson;
  } catch {
    throw new Error('That GLB file looks damaged.');
  }
  return summarise(gltf);
}

interface GltfAccessor { count: number; max?: number[] }
interface GltfJson {
  accessors?: GltfAccessor[];
  meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number; mode?: number }[] }[];
  skins?: { joints?: number[] }[];
  animations?: { name?: string; samplers?: { input: number }[] }[];
}

function summarise(gltf: GltfJson): GlbSummary {
  const accessors = gltf.accessors ?? [];
  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if ((prim.mode ?? 4) !== 4) continue;
      const acc = prim.indices !== undefined ? accessors[prim.indices] : accessors[prim.attributes?.POSITION ?? -1];
      triangles += Math.floor((acc?.count ?? 0) / 3);
    }
  }
  const bones = new Set((gltf.skins ?? []).flatMap((s) => s.joints ?? [])).size;
  const clips = (gltf.animations ?? []).map((anim, i) => ({
    name: anim.name?.trim() || `Clip ${i + 1}`,
    duration: Math.max(0, ...(anim.samplers ?? []).map((s) => accessors[s.input]?.max?.[0] ?? 0)),
  }));
  return { clips, bones, triangles, meshes: (gltf.meshes ?? []).length };
}

/** A display name from a file name: "Meshy_AI_Man_all_animations.glb" -> "Meshy AI Man". */
export function characterNameFromFile(fileName: string): string {
  const name = fileName
    .replace(/\.glb$/i, '')
    .replace(/_(all_animations|optimized)(_\d+)?$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (name || 'Character').slice(0, 80);
}
