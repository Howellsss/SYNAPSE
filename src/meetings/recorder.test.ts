import { describe, expect, it } from 'vitest';
import { extFor, pickMimeType, recordingTitle } from './recording';

describe('recorder', () => {
  it('picks the best format the browser can record', () => {
    expect(pickMimeType((t) => t === 'video/webm;codecs=vp8,opus' || t === 'video/webm')).toBe('video/webm;codecs=vp8,opus');
    expect(pickMimeType((t) => t === 'video/mp4')).toBe('video/mp4');
    expect(pickMimeType(() => false)).toBe('');
    expect(pickMimeType(() => { throw new Error('x'); })).toBe('');
    expect(extFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extFor('video/webm')).toBe('webm');
  });
  it('names recordings after the meeting and time', () => {
    const t = recordingTitle('Team call', new Date(2026, 9, 9, 10, 2));
    expect(t.startsWith('Team call — ')).toBe(true);
    expect(t).toMatch(/2026/);
  });
});
