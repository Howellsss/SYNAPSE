import { lazy, Suspense, useEffect, useState } from 'react';
import { Check, Shirt } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import { resolveSpaceClips } from '@/spatial/scene/avatarClips';
import type { Character } from '@/types';

const CharacterViewer = lazy(() => import('@/components/characters/CharacterViewer'));

/**
 * "Choose your character": pick who you appear as in every workspace, from the SYNAPSE library,
 * with a live 3D preview.
 */
export function CharacterPicker({ open, library, urls, currentId, onClose, onChoose }: {
  open: boolean;
  library: Character[];
  /** Signed file links by character id. */
  urls: Record<string, string>;
  /** Who you appear as now. */
  currentId: string | null;
  onClose: () => void;
  onChoose: (characterId: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string | null>(currentId);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setSelected(currentId ?? library[0]?.id ?? null); }, [open, currentId, library]);

  const chosen = library.find((c) => c.id === selected) ?? null;
  const clips = chosen ? resolveSpaceClips(chosen) : null;
  // Preview the standing animation (or walking, or the first clip).
  const previewClip = clips?.idle ?? clips?.walk ?? chosen?.clips[0]?.name ?? null;
  const url = chosen ? urls[chosen.id] : undefined;

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    const ok = await onChoose(chosen.id);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose your character"
      description="This is how everyone sees you in every workspace. You can change it any time."
      size="xl"
      footer={(
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={!chosen || saving || chosen.id === currentId}>
            {saving ? <LoadingSpinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {chosen && chosen.id === currentId ? 'This is you' : 'Use this character'}
          </button>
        </>
      )}
    >
      {library.length === 0 ? (
        <p className="py-10 text-center text-sm text-ivory-700">No characters are available yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
          <div className="relative h-[min(50vh,24rem)] overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_center,#1A253C,#091530)]">
            {url ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center"><LoadingSpinner className="h-6 w-6 text-ivory-300" /></div>}>
                <CharacterViewer key={chosen?.id} url={url} clip={previewClip} playing />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ivory-300">Preview unavailable</div>
            )}
          </div>
          <ul className="flex max-h-[min(50vh,24rem)] flex-col gap-2 overflow-y-auto" role="listbox" aria-label="Characters">
            {library.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.id === selected}
                  onClick={() => setSelected(c.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition',
                    c.id === selected ? 'border-navy-800 bg-navy-800 text-white' : 'border-navy-100 bg-white text-navy-800 hover:border-navy-300',
                  )}
                >
                  <Shirt className={cn('h-4 w-4 shrink-0', c.id === selected ? 'text-gold-400' : 'text-gold-600')} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                  {c.id === currentId && <span className={cn('text-xs', c.id === selected ? 'text-ivory-300' : 'text-ivory-600')}>You</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
