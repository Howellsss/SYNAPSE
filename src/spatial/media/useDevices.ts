import { useCallback, useEffect, useRef, useState } from 'react';
import { isIphoneDevice } from './continuity';

export interface DeviceLists {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

const EMPTY: DeviceLists = { microphones: [], cameras: [], speakers: [] };

/**
 * Cameras, microphones and speakers, kept up to date as devices come and go
 * (an iPhone used as a Continuity Camera appears here when it connects).
 * Labels are only filled in once the page has camera/mic permission.
 */
export function useDevices(enabled = true): DeviceLists & { refresh: () => Promise<void> } {
  const [lists, setLists] = useState<DeviceLists>(EMPTY);
  const alive = useRef(false);
  const load = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.deviceId);
      if (!alive.current) return;
      setLists({
        microphones: all.filter((d) => d.kind === 'audioinput'),
        cameras: all.filter((d) => d.kind === 'videoinput'),
        speakers: all.filter((d) => d.kind === 'audiooutput'),
      });
    } catch { /* keep what we had */ }
  }, []);
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.enumerateDevices) return;
    alive.current = true;
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    navigator.mediaDevices.addEventListener?.('devicechange', load);
    // Coming back from setting up the phone, and as a fallback where devicechange is missed.
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    const t = window.setInterval(load, 4000);
    return () => {
      alive.current = false;
      navigator.mediaDevices.removeEventListener?.('devicechange', load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(t);
    };
  }, [enabled, load]);
  return { ...lists, refresh: load };
}

/** A friendly name for a device, e.g. "Howells's iPhone Camera". */
export function deviceLabel(d: MediaDeviceInfo, index: number, fallback: string): string {
  const l = d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  if (d.deviceId === 'default') return l.replace(/^Default - /, '') ? `Same as system (${l.replace(/^Default - /, '')})` : 'Same as system';
  return l || `${fallback} ${index + 1}`;
}

export const isIphoneCamera = (d: MediaDeviceInfo) => isIphoneDevice(d);
