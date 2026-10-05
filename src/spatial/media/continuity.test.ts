import { describe, expect, it } from 'vitest';
import { iphoneStatus, isIphoneDevice, isMacDesktop } from './continuity';

const d = (label: string) => ({ label });

describe('continuity camera', () => {
  it('recognises iPhone devices', () => {
    expect(isIphoneDevice(d("Howells's iPhone Camera"))).toBe(true);
    expect(isIphoneDevice(d('iPhone Microphone'))).toBe(true);
    expect(isIphoneDevice(d('FaceTime HD Camera'))).toBe(false);
  });
  it('tells camera, mic-only and none apart', () => {
    expect(iphoneStatus([d('FaceTime HD Camera'), d('H iPhone Camera')], [])).toBe('camera');
    expect(iphoneStatus([d('FaceTime HD Camera')], [d('MacBook Pro Microphone'), d("Howells's iPhone Microphone")])).toBe('mic-only');
    expect(iphoneStatus([d('FaceTime HD Camera')], [d('MacBook Pro Microphone')])).toBe('none');
  });
  it('detects a Mac desktop', () => {
    expect(isMacDesktop('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129')).toBe(true);
    expect(isMacDesktop('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false);
    expect(isMacDesktop('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });
});
