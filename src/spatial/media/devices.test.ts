import { describe, expect, it } from 'vitest';
import {
  HEAR_THRESHOLD, METER_SEGMENTS, chimeWav, classifyMediaError, detectBrowser, levelFromSamples, litSegments,
  normalizeMediaPrefs, permissionHelp, pickDevice,
} from './devices';

const err = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('classifyMediaError', () => {
  it('maps browser errors to problems we can explain', () => {
    expect(classifyMediaError(err('NotAllowedError'))).toBe('denied');
    expect(classifyMediaError(err('NotAllowedError', 'Permission denied by system'))).toBe('system_denied');
    expect(classifyMediaError(err('NotFoundError'))).toBe('no_device');
    expect(classifyMediaError(err('OverconstrainedError'))).toBe('no_device');
    expect(classifyMediaError(err('NotReadableError'))).toBe('busy');
    expect(classifyMediaError(err('TrackStartError'))).toBe('busy');
    expect(classifyMediaError(err('TypeError'))).toBe('unsupported');
    expect(classifyMediaError(null)).toBe('unknown');
  });
});

describe('detectBrowser', () => {
  it('recognises the main browsers', () => {
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36')).toBe('chrome');
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0')).toBe('edge');
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('firefox');
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15')).toBe('safari');
    expect(detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toBe('ios');
    expect(detectBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('android');
  });

  it('has instructions for every browser', () => {
    for (const b of ['chrome', 'edge', 'firefox', 'safari', 'ios', 'android', 'other'] as const) {
      expect(permissionHelp(b).length).toBeGreaterThan(20);
    }
  });
});

describe('level meter', () => {
  it('is silent for silence and full for a loud signal', () => {
    expect(levelFromSamples(new Float32Array(512))).toBe(0);
    expect(litSegments(levelFromSamples(new Float32Array(512).fill(0.9)))).toBe(METER_SEGMENTS);
  });

  it('counts normal speech as heard and background hiss as not', () => {
    const tone = (amp: number) => Float32Array.from({ length: 1024 }, (_, i) => amp * Math.sin(i / 5));
    expect(levelFromSamples(tone(0.1))).toBeGreaterThan(HEAR_THRESHOLD);
    expect(levelFromSamples(tone(0.003))).toBeLessThan(HEAR_THRESHOLD);
  });

  it('lights at least one segment for any sound, never more than 12', () => {
    expect(litSegments(0)).toBe(0);
    expect(litSegments(0.01)).toBe(1);
    expect(litSegments(5)).toBe(12);
  });
});

describe('devices and prefs', () => {
  it('keeps a saved device that is still plugged in, otherwise falls back to the first', () => {
    const list = [{ deviceId: 'a' }, { deviceId: 'b' }];
    expect(pickDevice(list, 'b')).toBe('b');
    expect(pickDevice(list, 'gone')).toBe('a');
    expect(pickDevice([], 'b')).toBeUndefined();
  });

  it('fills in missing media prefs with the safe defaults', () => {
    expect(normalizeMediaPrefs(null)).toEqual({ join_muted: true, join_camera_off: true, data_saver: false });
    expect(normalizeMediaPrefs({ join_muted: false, data_saver: 'yes' })).toEqual({ join_muted: false, join_camera_off: true, data_saver: false });
  });

  it('builds a playable WAV test sound', async () => {
    const wav = chimeWav();
    expect(wav.type).toBe('audio/wav');
    const head = new TextDecoder().decode(new Uint8Array(await wav.arrayBuffer()).slice(0, 12));
    expect(head.startsWith('RIFF') && head.endsWith('WAVE')).toBe(true);
  });
});
