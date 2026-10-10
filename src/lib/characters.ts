import { supabase } from '@/lib/supabase';
import { checkCharacterFileMeta, characterNameFromFile, formatMb, readGlbSummary } from '@/lib/glb';
import { shrinkGlbFile } from '@/lib/glbCompress';
import type { Character } from '@/types';

/**
 * The SYNAPSE character library: one set of characters for every account and workspace.
 * Everyone signed in can read it; only SYNAPSE admins (platform_admins) can change it.
 * New files live under library/ in the private "characters" bucket.
 */
export const CHARACTERS_BUCKET = 'characters';

export async function listCharacters(): Promise<{ data: Character[]; error: string | null }> {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .order('created_at', { ascending: false });
  return { data: (data ?? []) as Character[], error: error?.message ?? null };
}

/** Largest file accepted before shrinking (straight from Meshy). */
const MAX_SOURCE_BYTES = 300 * 1024 * 1024;

/**
 * Checks the .glb in the browser, shrinks its textures when it's over the limit (no Blender
 * needed), uploads it to the library and records it. Nothing is stored if it isn't a valid GLB
 * or can't be brought under 30 MB.
 */
export async function uploadCharacter(userId: string, original: File, onProgress?: (message: string) => void): Promise<{ data: Character | null; error: string | null }> {
  if (!/\.glb$/i.test(original.name)) return { data: null, error: 'Please choose a .glb file (binary glTF).' };
  if (original.size > MAX_SOURCE_BYTES) return { data: null, error: `That file is ${formatMb(original.size)}. Files up to ${formatMb(MAX_SOURCE_BYTES)} can be shrunk.` };
  let file: File;
  try {
    file = await shrinkGlbFile(original, onProgress);
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }
  onProgress?.(file === original ? `Uploading ${formatMb(file.size)}…` : `Shrunk ${formatMb(original.size)} to ${formatMb(file.size)}. Uploading…`);
  const metaError = checkCharacterFileMeta(file);
  if (metaError) return { data: null, error: metaError };
  let summary;
  try {
    summary = readGlbSummary(await file.arrayBuffer());
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }

  const path = `library/${crypto.randomUUID()}.glb`;
  const { error: uploadError } = await supabase.storage
    .from(CHARACTERS_BUCKET)
    .upload(path, file, { upsert: false, contentType: 'model/gltf-binary' });
  if (uploadError) return { data: null, error: uploadError.message };

  const { data, error } = await supabase
    .from('characters')
    .insert({
      workspace_id: null,
      name: characterNameFromFile(original.name),
      storage_path: path,
      size_bytes: file.size,
      clips: summary.clips,
      default_clip: summary.clips[0]?.name ?? null,
      bones: summary.bones,
      triangles: summary.triangles,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) {
    // Don't leave an orphaned file behind.
    await supabase.storage.from(CHARACTERS_BUCKET).remove([path]);
    return { data: null, error: error.message };
  }
  return { data: data as Character, error: null };
}

/** A short-lived link the 3D viewer can load the file from. */
export async function characterFileUrl(character: Pick<Character, 'storage_path'>): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(CHARACTERS_BUCKET).createSignedUrl(character.storage_path, 3600);
  return { url: data?.signedUrl ?? null, error: error?.message ?? (data?.signedUrl ? null : 'Could not open the character file.') };
}

export async function updateCharacter(id: string, changes: Partial<Pick<Character, 'name' | 'default_clip' | 'space_clips'>>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('characters').update(changes).eq('id', id);
  return { error: error?.message ?? null };
}

/** Makes this the character everyone appears as in every workspace (one for all of SYNAPSE). */
export async function setSpaceCharacter(id: string): Promise<{ error: string | null }> {
  const { error: clearError } = await supabase
    .from('characters')
    .update({ use_in_spaces: false })
    .eq('use_in_spaces', true)
    .neq('id', id);
  if (clearError) return { error: clearError.message };
  const { error } = await supabase.from('characters').update({ use_in_spaces: true }).eq('id', id);
  return { error: error?.message ?? null };
}

/** Short-lived links for several characters at once, by character id. */
export async function characterFileUrls(characters: Pick<Character, 'id' | 'storage_path'>[]): Promise<Record<string, string>> {
  if (!characters.length) return {};
  const { data } = await supabase.storage.from(CHARACTERS_BUCKET).createSignedUrls(characters.map((c) => c.storage_path), 3600);
  const byPath = new Map((data ?? []).filter((d) => d.signedUrl && !d.error).map((d) => [d.path, d.signedUrl]));
  const out: Record<string, string> = {};
  for (const c of characters) {
    const url = byPath.get(c.storage_path);
    if (url) out[c.id] = url;
  }
  return out;
}

/** Saves the character you appear as (profiles.avatar_config.characterId), keeping other avatar settings. */
export async function saveMyCharacter(userId: string, currentConfig: Record<string, unknown> | null, characterId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_config: { ...(currentConfig ?? {}), characterId } })
    .eq('user_id', userId);
  return { error: error?.message ?? null };
}

/** Removes the record and its file. */
export async function deleteCharacter(character: Pick<Character, 'id' | 'storage_path'>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('characters').delete().eq('id', character.id);
  if (error) return { error: error.message };
  await supabase.storage.from(CHARACTERS_BUCKET).remove([character.storage_path]);
  return { error: null };
}
