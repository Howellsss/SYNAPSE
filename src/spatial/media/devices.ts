import type { MediaPrefs } from '@/types';

export const DEFAULT_MEDIA_PREFS: MediaPrefs = { join_muted: true, join_camera_off: true, data_saver: false };

/** Fills in anything missing from a stored value (older rows, hand-edited JSON). */
export function normalizeMediaPrefs(value: unknown): MediaPrefs {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof MediaPrefs, unknown>>;
  return {
    join_muted: typeof v.join_muted === 'boolean' ? v.join_muted : DEFAULT_MEDIA_PREFS.join_muted,
    join_camera_off: typeof v.join_camera_off === 'boolean' ? v.join_camera_off : DEFAULT_MEDIA_PREFS.join_camera_off,
    data_saver: typeof v.data_saver === 'boolean' ? v.data_saver : DEFAULT_MEDIA_PREFS.data_saver,
  };
}

// ---------------------------------------------------------------- errors

export type DeviceProblem = 'denied' | 'system_denied' | 'no_device' | 'busy' | 'insecure' | 'unsupported' | 'unknown';

/** Turns a getUserMedia failure into something we can explain. */
export function classifyMediaError(err: unknown): DeviceProblem {
  const name = (err as { name?: string } | null)?.name ?? '';
  const message = ((err as { message?: string } | null)?.message ?? '').toLowerCase();
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      // Chrome on macOS/Windows says "Permission denied by system" when the OS blocks the browser.
      return message.includes('system') ? 'system_denied' : 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'no_device';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

export type BrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'ios' | 'android' | 'other';

export function detectBrowser(ua: string): BrowserKind {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

/** Step-by-step fix for a blocked camera or microphone, in this browser. */
export function permissionHelp(browser: BrowserKind): string {
  switch (browser) {
    case 'chrome':
    case 'edge':
      return 'Click the camera icon (or the settings icon) at the left of the address bar, set Camera and Microphone to Allow, then reload the page.';
    case 'firefox':
      return 'Click the crossed-out camera or microphone icon in the address bar, remove the block, then reload the page.';
    case 'safari':
      return 'In the menu bar choose Safari → Settings for This Website, set Camera and Microphone to Allow, then reload the page.';
    case 'ios':
      return 'Tap aA in the address bar → Website Settings, and allow Camera and Microphone. If they are greyed out, open Settings → Safari (or your browser) and allow them there.';
    case 'android':
      return 'Tap the icon at the left of the address bar → Permissions, and allow Camera and Microphone. If that doesn\'t work, open Settings → Apps → your browser → Permissions.';
    default:
      return 'Open this site\'s settings in your browser, allow Camera and Microphone, then reload the page.';
  }
}

/** Short version for the preview panel. */
export function permissionHint(browser: BrowserKind): string {
  switch (browser) {
    case 'chrome':
    case 'edge': return 'Blocked? Use the icon at the left of the address bar to allow access.';
    case 'firefox': return 'Blocked? Use the crossed-out icon in the address bar to allow access.';
    case 'safari': return 'Blocked? Safari → Settings for This Website → allow Camera and Microphone.';
    case 'ios': return 'Blocked? Tap aA in the address bar → Website Settings.';
    case 'android': return 'Blocked? Tap the icon at the left of the address bar → Permissions.';
    default: return 'Blocked? Allow camera and microphone in your browser\'s site settings.';
  }
}

export function systemPermissionHelp(ua: string): string {
  if (/Windows/i.test(ua)) return 'Windows is blocking your browser. Open Settings → Privacy & security → Camera (and Microphone), allow desktop apps, then restart the browser.';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS is blocking your browser. Open System Settings → Privacy & Security → Camera (and Microphone), turn your browser on, then restart it.';
  return 'Your computer is blocking the browser from using the camera or microphone. Allow it in your system\'s privacy settings, then restart the browser.';
}

export function problemText(problem: DeviceProblem, device: 'camera' | 'microphone'): string {
  switch (problem) {
    case 'denied': return `SYNAPSE isn't allowed to use your ${device}.`;
    case 'system_denied': return `Your computer is blocking the ${device}.`;
    case 'no_device': return `No ${device} found. Plug one in, then try again.`;
    case 'busy': return `Your ${device} is being used by another app (like Zoom or Teams). Close it, then try again.`;
    case 'insecure': return 'Camera and microphone only work on a secure (https) page.';
    case 'unsupported': return `This browser can't use a ${device}. Try the latest Chrome, Edge, Firefox or Safari.`;
    default: return `Couldn't start your ${device}. Try again.`;
  }
}

// ---------------------------------------------------------------- level meter

export const METER_SEGMENTS = 12;
/** Level (0–1) above which we tell people "We can hear you". */
export const HEAR_THRESHOLD = 0.12;

/** Loudness 0–1 from analyser samples (-1..1), scaled so normal speech fills most of the meter. */
export function levelFromSamples(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  // Speech RMS is roughly 0.01–0.3; a square root curve spreads that across the bar.
  return Math.min(1, Math.sqrt(rms * 3));
}

export function litSegments(level: number, segments = METER_SEGMENTS): number {
  if (!(level > 0)) return 0;
  return Math.min(segments, Math.max(1, Math.round(level * segments)));
}

// ---------------------------------------------------------------- remembered devices

export interface DeviceIds {
  camera?: string;
  microphone?: string;
  speaker?: string;
}

const DEVICES_KEY = 'synapse.devices';

export function loadDeviceIds(): DeviceIds {
  try {
    const raw = localStorage.getItem(DEVICES_KEY);
    const v = raw ? JSON.parse(raw) : {};
    const pick = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
    return { camera: pick(v?.camera), microphone: pick(v?.microphone), speaker: pick(v?.speaker) };
  } catch {
    return {};
  }
}

export function saveDeviceIds(ids: DeviceIds): void {
  try { localStorage.setItem(DEVICES_KEY, JSON.stringify(ids)); } catch { /* private mode or storage full */ }
}

/** The saved device if it's still plugged in, otherwise the first one (the system default). */
export function pickDevice(devices: { deviceId: string }[], saved?: string): string | undefined {
  if (saved && devices.some((d) => d.deviceId === saved)) return saved;
  return devices[0]?.deviceId;
}

// ---------------------------------------------------------------- environment

export function mediaSupport(): 'ok' | 'insecure' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return 'ok';
}

export function supportsSpeakerChoice(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

// ---------------------------------------------------------------- test sound

/** A short two-note chime as a WAV file, so it can play through any chosen speaker. */
export function chimeWav(sampleRate = 22050): Blob {
  const notes = [{ f: 659.25, start: 0, len: 0.35 }, { f: 987.77, start: 0.18, len: 0.55 }];
  const total = Math.ceil(sampleRate * 0.8);
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const n of notes) {
      const dt = t - n.start;
      if (dt < 0 || dt > n.len) continue;
      const env = Math.min(1, dt / 0.01) * Math.exp(-dt * 6);
      v += Math.sin(2 * Math.PI * n.f * dt) * env * 0.35;
    }
    pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const dv = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}
