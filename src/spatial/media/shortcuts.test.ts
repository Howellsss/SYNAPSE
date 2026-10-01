import { describe, expect, it } from 'vitest';
import { callShortcut } from './shortcuts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ key: k, code: `Key${k.toUpperCase()}`, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('callShortcut', () => {
  it('maps Ctrl/Cmd+Shift+A and +V', () => {
    expect(callShortcut(key('A', { ctrlKey: true, shiftKey: true }))).toBe('mic');
    expect(callShortcut(key('a', { metaKey: true, shiftKey: true }))).toBe('mic');
    expect(callShortcut(key('V', { ctrlKey: true, shiftKey: true }))).toBe('cam');
  });
  it('ignores other combinations', () => {
    expect(callShortcut(key('a', { ctrlKey: true }))).toBeNull();
    expect(callShortcut(key('v', { shiftKey: true }))).toBeNull();
    expect(callShortcut(key('a', { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
    expect(callShortcut(key('b', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
