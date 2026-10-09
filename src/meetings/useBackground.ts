import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalTrack, LocalVideoTrack } from 'livekit-client';
import { BLUR_RADIUS, PRESETS, loadChoice, paintPreset, saveChoice, type BackgroundChoice } from './backgrounds';

export type BackgroundStatus = 'off' | 'loading' | 'on' | 'unsupported' | 'error';

export interface Background {
  choice: BackgroundChoice;
  status: BackgroundStatus;
  choose: (c: BackgroundChoice) => void;
  /** A picture from your computer (kept for this meeting only). */
  upload: (file: File) => void;
}

const painted = new Map<string, string>();
const presetUrl = (id: string) => {
  if (!painted.has(id)) {
    const p = PRESETS.find((x) => x.id === id);
    painted.set(id, p ? paintPreset(p) : '');
  }
  return painted.get(id)!;
};

type Processor = { switchTo: (o: unknown) => Promise<void> };

/**
 * Blur or replace the background of your camera, with LiveKit's background processor (runs in
 * your browser; the effect is what everyone sees). Loaded only when first used.
 */
export function useBackground(camera: LocalTrack | null, onError: (msg: string) => void): Background {
  const [choice, setChoice] = useState<BackgroundChoice>(loadChoice);
  const [status, setStatus] = useState<BackgroundStatus>('off');
  const applied = useRef<{ track: LocalTrack; proc: Processor } | null>(null);
  const errRef = useRef(onError);
  errRef.current = onError;

  useEffect(() => {
    if (!camera || camera.kind !== 'video') return;
    let alive = true;
    (async () => {
      if (choice.kind === 'none') {
        if (applied.current?.track === camera) {
          await (camera as LocalVideoTrack).stopProcessor().catch(() => {});
          applied.current = null;
        }
        if (alive) setStatus('off');
        return;
      }
      setStatus('loading');
      const lib = await import('@livekit/track-processors').catch(() => null);
      if (!alive) return;
      if (!lib) { setStatus('error'); errRef.current("Couldn't load background effects. Check your connection."); return; }
      if (!lib.supportsBackgroundProcessors()) { setStatus('unsupported'); return; }
      const opts = choice.kind === 'blur'
        ? { mode: 'background-blur' as const, blurRadius: BLUR_RADIUS[choice.strength] }
        : { mode: 'virtual-background' as const, imagePath: choice.url || presetUrl(choice.id) };
      try {
        if (applied.current?.track === camera) {
          await applied.current.proc.switchTo(opts);
        } else {
          const proc = lib.BackgroundProcessor(opts);
          await (camera as LocalVideoTrack).setProcessor(proc);
          applied.current = { track: camera, proc: proc as unknown as Processor };
        }
        if (alive) setStatus('on');
      } catch (err) {
        console.warn('background effect failed', err);
        if (!alive) return;
        setStatus('error');
        errRef.current("Couldn't apply the background. Your camera is shown as it is.");
      }
    })();
    return () => { alive = false; };
  }, [camera, choice]);

  const choose = useCallback((c: BackgroundChoice) => { setChoice(c); saveChoice(c); }, []);
  const upload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) { errRef.current('Choose a picture (JPG or PNG).'); return; }
    const url = URL.createObjectURL(file);
    setChoice({ kind: 'image', id: `upload-${Date.now()}`, url, label: file.name });
  }, []);

  return { choice, status, choose, upload };
}
