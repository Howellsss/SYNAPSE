import { useEffect, useState } from 'react';

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
export function useDevices(enabled = true): DeviceLists {
  const [lists, setLists] = useState<DeviceLists>(EMPTY);
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.enumerateDevices) return;
    let alive = true;
    const load = async () => {
      try {
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.deviceId);
        if (!alive) return;
        setLists({
          microphones: all.filter((d) => d.kind === 'audioinput'),
          cameras: all.filter((d) => d.kind === 'videoinput'),
          speakers: all.filter((d) => d.kind === 'audiooutput'),
        });
      } catch { /* keep what we had */ }
    };
    load();
    navigator.mediaDevices.addEventListener?.('devicechange', load);
    const t = window.setInterval(load, 4000); // some browsers miss devicechange for Continuity Camera
    return () => { alive = false; navigator.mediaDevices.removeEventListener?.('devicechange', load); window.clearInterval(t); };
  }, [enabled]);
  return lists;
}

/** A friendly name for a device, e.g. "Howells's iPhone Camera". */
export function deviceLabel(d: MediaDeviceInfo, index: number, fallback: string): string {
  const l = d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  if (d.deviceId === 'default') return l.replace(/^Default - /, '') ? `Same as system (${l.replace(/^Default - /, '')})` : 'Same as system';
  return l || `${fallback} ${index + 1}`;
}

export const isIphoneCamera = (d: MediaDeviceInfo) => /iphone|continuity/i.test(d.label);
