import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Check, Pause, Play, Star, Trash2, Upload, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { characterFileUrl, deleteCharacter, listCharacters, setSpaceCharacter, updateCharacter, uploadCharacter } from '@/lib/characters';
import { AVATAR_ACTION_LABELS, AVATAR_ACTIONS, pickSpaceCharacter, resolveSpaceClips, type AvatarAction } from '@/spatial/scene/avatarClips';
import { formatMb } from '@/lib/glb';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSpinner, Skeleton } from '@/components/ui/States';
import { cn, timeAgo } from '@/lib/utils';
import type { Character } from '@/types';

// three.js is large; load it only when a character is shown.
const CharacterViewer = lazy(() => import('@/components/characters/CharacterViewer'));

function formatSeconds(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)}s`;
}

/** Upload 3D characters (.glb) and preview each animation clip. */
export function CharactersPage() {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Character | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await listCharacters(workspace.id);
    setCharacters(data);
    setLoadError(error);
    setSelectedId((id) => (id && data.some((c) => c.id === id) ? id : data[0]?.id ?? null));
    setLoading(false);
  }, [workspace]);

  useEffect(() => { load(); }, [load]);

  const onFile = async (file: File | undefined) => {
    if (!file || !workspace || !user) return;
    setUploading(`${file.name} (${formatMb(file.size)})`);
    const { data, error } = await uploadCharacter(workspace.id, user.id, file);
    setUploading(null);
    if (fileInput.current) fileInput.current.value = '';
    if (error || !data) { toast(error ?? 'Upload failed.', 'error'); return; }
    setCharacters((list) => [data, ...list]);
    setSelectedId(data.id);
    toast(`${data.name} uploaded with ${data.clips.length} animation${data.clips.length === 1 ? '' : 's'}.`);
  };

  const onDelete = async (c: Character) => {
    setConfirmDelete(null);
    const { error } = await deleteCharacter(c);
    if (error) { toast(error, 'error'); return; }
    setCharacters((list) => list.filter((x) => x.id !== c.id));
    setSelectedId((id) => (id === c.id ? characters.find((x) => x.id !== c.id)?.id ?? null : id));
    toast(`${c.name} deleted.`);
  };

  const onChanged = (c: Character) => setCharacters((list) => list.map((x) => (x.id === c.id ? c : x)));

  const onUseInSpaces = async (c: Character) => {
    if (!workspace) return;
    const { error } = await setSpaceCharacter(workspace.id, c.id);
    if (error) { toast(error, 'error'); return; }
    setCharacters((list) => list.map((x) => ({ ...x, use_in_spaces: x.id === c.id })));
    toast(`Everyone now appears as ${c.name} in your workspaces.`);
  };
  const inSpaces = pickSpaceCharacter(characters);

  const selected = characters.find((c) => c.id === selectedId) ?? null;
  const uploadButton = (
    <button type="button" className="btn-primary" onClick={() => fileInput.current?.click()} disabled={!!uploading}>
      {uploading ? <LoadingSpinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
      Upload character
    </button>
  );

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Characters</h1>
          <p className="mt-0.5 text-sm text-ivory-600">3D characters for your workspace. Upload a .glb (up to 30 MB) and preview its animations.</p>
        </div>
        {uploadButton}
        <input ref={fileInput} type="file" accept=".glb,model/gltf-binary" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {uploading && (
        <div className="card flex items-center gap-3 p-4 text-sm text-navy-800" role="status">
          <LoadingSpinner className="h-4 w-4" /> Uploading {uploading}… Large files can take a minute.
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Skeleton className="h-40" />
          <Skeleton className="h-[28rem]" />
        </div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={load} /></div>
      ) : characters.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Box className="h-7 w-7" />}
            title="No characters yet"
            description="Upload a .glb character, for example a Meshy export with its animations merged into one file. Files can be up to 30 MB."
            action={uploadButton}
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <ul className="space-y-2" aria-label="Characters">
            {characters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-current={c.id === selectedId ? 'true' : undefined}
                  className={cn('card card-hover w-full p-4 text-left', c.id === selectedId && 'ring-2 ring-gold-400')}
                >
                  <p className="truncate text-sm font-semibold text-navy-800">{c.name}</p>
                  {inSpaces?.id === c.id && <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-gold-700"><Users className="h-3.5 w-3.5" /> Used in workspaces</p>}
                  <p className="mt-0.5 text-xs text-ivory-600">
                    {c.clips.length} animation{c.clips.length === 1 ? '' : 's'} · {formatMb(c.size_bytes)} · {timeAgo(c.created_at)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <CharacterDetail
              key={selected.id}
              character={selected}
              onChanged={onChanged}
              onDelete={() => setConfirmDelete(selected)}
              inSpaces={inSpaces?.id === selected.id}
              onUseInSpaces={() => onUseInSpaces(selected)}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && onDelete(confirmDelete)}
        title="Delete character?"
        message={`${confirmDelete?.name ?? 'This character'} and its file will be removed from this workspace. Your copy on your computer isn't affected.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function CharacterDetail({ character, onChanged, onDelete, inSpaces, onUseInSpaces }: {
  character: Character;
  onChanged: (c: Character) => void;
  onDelete: () => void;
  inSpaces: boolean;
  onUseInSpaces: () => void;
}) {
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [clip, setClip] = useState<string | null>(character.default_clip ?? character.clips[0]?.name ?? null);
  const [playing, setPlaying] = useState(true);
  const [fileClips, setFileClips] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    characterFileUrl(character).then(({ url: u, error }) => {
      if (!alive) return;
      setUrl(u);
      setUrlError(error);
    });
    return () => { alive = false; };
  }, [character]);

  // The file is the source of truth for clip names; the saved list adds lengths.
  const durations = new Map(character.clips.map((c) => [c.name, c.duration]));
  const clipNames = fileClips ?? character.clips.map((c) => c.name);

  const setDefault = async () => {
    if (!clip) return;
    setSaving(true);
    const { error } = await updateCharacter(character.id, { default_clip: clip });
    setSaving(false);
    if (error) { toast(error, 'error'); return; }
    onChanged({ ...character, default_clip: clip });
    toast(`"${clip}" is now ${character.name}'s default animation.`);
  };

  return (
    <div className="card overflow-hidden">
      <div className="relative h-[min(60vh,32rem)] bg-[radial-gradient(ellipse_at_center,#1A253C,#091530)]">
        {urlError ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ivory-300">{urlError}</div>
        ) : url ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><LoadingSpinner className="h-6 w-6 text-ivory-300" /></div>}>
            <CharacterViewer url={url} clip={clip} playing={playing} onLoaded={setFileClips} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center"><LoadingSpinner className="h-6 w-6 text-ivory-300" /></div>
        )}
        <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-ivory-400">Drag to turn · scroll or pinch to zoom</p>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-navy-800">{character.name}</h2>
            <p className="text-xs text-ivory-600">
              {formatMb(character.size_bytes)} · {character.bones} bones · {character.triangles.toLocaleString()} triangles
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm text-burgundy-500" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>

        {clipNames.length === 0 ? (
          <p className="text-sm text-ivory-600">This file has no animations. It will show the character standing still.</p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ivory-600">Animations</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Animations">
                {clipNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { setClip(name); setPlaying(true); }}
                    aria-pressed={clip === name}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition',
                      clip === name ? 'border-navy-800 bg-navy-800 text-white' : 'border-navy-100 bg-white text-navy-800 hover:border-navy-300',
                    )}
                  >
                    {character.default_clip === name && <Star className="h-3.5 w-3.5 fill-gold-400 text-gold-400" aria-label="Default" />}
                    {name.replace(/_/g, ' ')}
                    {durations.has(name) && <span className={cn('text-xs', clip === name ? 'text-ivory-300' : 'text-ivory-600')}>{formatSeconds(durations.get(name) ?? 0)}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setPlaying((p) => !p)} disabled={!clip}>
                {playing ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Play</>}
              </button>
              {clip && character.default_clip !== clip ? (
                <button type="button" className="btn-primary btn-sm" onClick={setDefault} disabled={saving}>
                  <Star className="h-4 w-4" /> Save "{clip.replace(/_/g, ' ')}" as default animation
                </button>
              ) : clip ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-ivory-700">
                  <Star className="h-4 w-4 fill-gold-400 text-gold-400" /> Default animation
                </span>
              ) : null}
            </div>

            <SpaceClipChoices character={character} clipNames={clipNames} onPreview={(name) => { setClip(name); setPlaying(true); }} onChanged={onChanged} />
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-navy-50 pt-4">
          {inSpaces ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800"><Check className="h-4 w-4 text-green-600" /> Everyone appears as this character in your workspaces</span>
          ) : (
            <button type="button" className="btn-secondary btn-sm" onClick={onUseInSpaces}><Users className="h-4 w-4" /> Use in workspaces</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Which clip plays for standing, walking, wave and cheer when people walk around a space. */
function SpaceClipChoices({ character, clipNames, onPreview, onChanged }: {
  character: Character;
  clipNames: string[];
  onPreview: (clip: string) => void;
  onChanged: (c: Character) => void;
}) {
  const { toast } = useToast();
  const chosen = resolveSpaceClips(character);

  const choose = async (action: AvatarAction, value: string) => {
    const next = { ...chosen, [action]: value || null };
    const { error } = await updateCharacter(character.id, { space_clips: next });
    if (error) { toast(error, 'error'); return; }
    onChanged({ ...character, space_clips: next });
    if (value) onPreview(value);
  };

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ivory-600">In workspaces</p>
      <p className="mb-3 text-xs text-ivory-600">Which animation plays as people walk around a space. Choosing one plays it above.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {AVATAR_ACTIONS.map((action) => (
          <label key={action} className="block text-sm">
            <span className="font-medium text-navy-800">{AVATAR_ACTION_LABELS[action].label}</span>
            <span className="block text-xs text-ivory-600">{AVATAR_ACTION_LABELS[action].hint}</span>
            <select className="input-field mt-1" value={chosen[action] ?? ''} onChange={(e) => choose(action, e.target.value)}>
              <option value="">{action === 'idle' ? 'None (stand still)' : 'None'}</option>
              {clipNames.map((name) => <option key={name} value={name}>{name.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
