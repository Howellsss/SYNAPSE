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
