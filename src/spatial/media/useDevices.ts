import { useCallback, useEffect, useRef, useState } from 'react';
import { isIphoneDevice, keepFullerList } from './continuity';

export interface DeviceLists {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

const EMPTY: DeviceLists = { microphones: [], cameras: [], speakers: [] };

/** Split a device list by kind, keeping the fuller earlier list where the browser answered with less. */
export function listsFrom(all: MediaDeviceInfo[], prev: DeviceLists = EMPTY): DeviceLists {
  const real = all.filter((d) => d.deviceId);
  return {
    microphones: keepFullerList(prev.microphones, real.filter((d) => d.kind === 'audioinput')),
    cameras: keepFullerList(prev.cameras, real.filter((d) => d.kind === 'videoinput')),
    speakers: keepFullerList(prev.speakers, real.filter((d) => d.kind === 'audiooutput')),
  };
}

/**
 * Cameras, microphones and speakers, kept up to date as devices come and go
 * (an iPhone used as a Continuity Camera appears here when it connects).
 * Labels are only filled in once the page has camera/mic permission.
 */
export function useDevices(enabled = true): DeviceLists & { refresh: () => Promise<void>; rescan: () => Promise<void> } {
  const [lists, setLists] = useState<DeviceLists>(EMPTY);
  const alive = useRef(false);
  const load = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!alive.current) return;
      setLists((prev) => listsFrom(all, prev));
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
  const rescan = useCallback(async () => {
    const seen = await probeDevices({ video: true });
    if (seen && alive.current) setLists((prev) => listsFrom(seen, prev));
    else await load();
  }, [load]);
  return { ...lists, refresh: load, rescan };
}

/** A friendly name for a device, e.g. "Howells's iPhone Camera". */
export function deviceLabel(d: MediaDeviceInfo, index: number, fallback: string): string {
  const l = d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  if (d.deviceId === 'default') return l.replace(/^Default - /, '') ? `Same as system (${l.replace(/^Default - /, '')})` : 'Same as system';
  return l || `${fallback} ${index + 1}`;
}

/**
 * Ask the browser for the camera for a moment and read the device list *while it is on*, the way
 * Google Meet does: Safari and Chrome give the complete list (with names, including an iPhone used
 * as a Continuity Camera) only while a camera is in use. Returns that list, or null if it couldn't ask.
 */
export async function probeDevices(kinds: { video?: boolean; audio?: boolean } = { video: true }): Promise<MediaDeviceInfo[] | null> {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: !!kinds.video, audio: !!kinds.audio });
    // A moment for the system to publish newly woken cameras (an iPhone wakes when a camera is requested).
    await new Promise((r) => setTimeout(r, 600));
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return null; // denied or busy: the plain list is the best we can do
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export const isIphoneCamera = (d: MediaDeviceInfo) => isIphoneDevice(d);
