import { supabase } from '@/lib/supabase';
import { checkCharacterFileMeta, characterNameFromFile, readGlbSummary } from '@/lib/glb';
import type { Character } from '@/types';

/** Private bucket; files live under <workspace id>/. */
export const CHARACTERS_BUCKET = 'characters';

export async function listCharacters(workspaceId: string): Promise<{ data: Character[]; error: string | null }> {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  return { data: (data ?? []) as Character[], error: error?.message ?? null };
}

/**
 * Checks the .glb in the browser, uploads it to the workspace's folder and records it.
 * Nothing is stored if the file isn't a valid GLB or is over 30 MB.
 */
export async function uploadCharacter(workspaceId: string, userId: string, file: File): Promise<{ data: Character | null; error: string | null }> {
  const metaError = checkCharacterFileMeta(file);
  if (metaError) return { data: null, error: metaError };
  let summary;
  try {
    summary = readGlbSummary(await file.arrayBuffer());
  } catch (e) {
    return { data: null, error: (e as Error).message };
  }

  const path = `${workspaceId}/${crypto.randomUUID()}.glb`;
  const { error: uploadError } = await supabase.storage
    .from(CHARACTERS_BUCKET)
    .upload(path, file, { upsert: false, contentType: 'model/gltf-binary' });
  if (uploadError) return { data: null, error: uploadError.message };

  const { data, error } = await supabase
    .from('characters')
    .insert({
      workspace_id: workspaceId,
      name: characterNameFromFile(file.name),
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

export async function updateCharacter(id: string, changes: Partial<Pick<Character, 'name' | 'default_clip'>>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('characters').update(changes).eq('id', id);
  return { error: error?.message ?? null };
}

/** Removes the record and its file. */
export async function deleteCharacter(character: Pick<Character, 'id' | 'storage_path'>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('characters').delete().eq('id', character.id);
  if (error) return { error: error.message };
  await supabase.storage.from(CHARACTERS_BUCKET).remove([character.storage_path]);
  return { error: null };
}
