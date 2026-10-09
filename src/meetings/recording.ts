/** Helpers for recording a meeting in the browser (see useRecorder). */

export const RECORDINGS_BUCKET = 'meeting-recordings';

const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
export function pickMimeType(isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string {
  return TYPES.find((t) => { try { return isSupported(t); } catch { return false; } }) ?? '';
}

export const extFor = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

/** "Team call — 9 Oct 2026, 10:02" */
export function recordingTitle(meetingTitle: string, at: Date): string {
  return `${meetingTitle} — ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`.slice(0, 200);
}
