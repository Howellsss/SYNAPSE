/**
 * iPhone as a camera on a Mac (Continuity Camera). macOS offers the iPhone's camera and
 * microphone to apps as ordinary devices; the browser just lists them.
 */

type Labelled = { label: string };

export const isIphoneDevice = (d: Labelled) => /iphone|continuity/i.test(d.label);

export type IphoneStatus = 'camera' | 'mic-only' | 'none';

/**
 * 'camera': the iPhone camera is listed. 'mic-only': macOS offers the iPhone's microphone but not
 * its camera (usually Continuity Camera is off on the phone, or the phone isn't set up for it).
 */
export function iphoneStatus(cameras: Labelled[], microphones: Labelled[]): IphoneStatus {
  if (cameras.some(isIphoneDevice)) return 'camera';
  if (microphones.some(isIphoneDevice)) return 'mic-only';
  return 'none';
}

export const isMacDesktop = (ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) =>
  /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad|iPod/.test(ua);

type DeviceLike = { deviceId: string; kind: string; label: string };

/**
 * Keep the best camera/mic list we've seen. When no camera is in use, some browsers (Safari) answer
 * with a reduced list: devices without names, or only one per kind. If the new list for a kind has
 * unnamed devices but we already had a named list, keep the named one. A fully named new list always
 * wins, so unplugged devices still disappear.
 */
export function keepFullerList<T extends DeviceLike>(prev: T[], next: T[]): T[] {
  const reduced = next.length === 0 || next.some((d) => !d.label);
  const prevNamed = prev.length > 0 && prev.every((d) => d.label);
  return reduced && prevNamed ? prev : next;
}

/** "Safari", "Chrome", "Edge", "Firefox" or "your browser", for help text. */
export function browserName(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return 'your browser';
}
