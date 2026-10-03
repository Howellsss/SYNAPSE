import { describe, expect, it } from 'vitest';
import { elapsed, parseChat, parseControl, parseReact, MAX_CHAT } from './messages';

describe('meeting messages', () => {
  it('accepts chat and trims it', () => {
    expect(parseChat({ t: 'msg', id: 'abc', text: '  hi  ' })).toEqual({ t: 'msg', id: 'abc', text: 'hi' });
    expect(parseChat({ t: 'msg', id: 'abc', text: 'x'.repeat(5000) })?.text).toHaveLength(MAX_CHAT);
  });
  it('rejects bad chat', () => {
    expect(parseChat({ t: 'msg', id: 'a b', text: 'hi' })).toBeNull();
    expect(parseChat({ t: 'msg', id: 'a', text: '   ' })).toBeNull();
    expect(parseChat('hi')).toBeNull();
  });
  it('accepts only known reactions', () => {
    expect(parseReact({ t: 'emoji', e: '👏' })).toEqual({ t: 'emoji', e: '👏' });
    expect(parseReact({ t: 'emoji', e: '<script>' })).toBeNull();
    expect(parseReact({ t: 'hand', up: true })).toEqual({ t: 'hand', up: true });
    expect(parseReact({ t: 'hand', up: 'yes' })).toBeNull();
  });
  it('parses control', () => {
    expect(parseControl({ t: 'ended' })).toEqual({ t: 'ended' });
    expect(parseControl({ type: 'meeting-ended' })).toBeNull();
  });
  it('formats elapsed time', () => {
    expect(elapsed(42_000)).toBe('0:42');
    expect(elapsed(725_000)).toBe('12:05');
    expect(elapsed(3_729_000)).toBe('1:02:09');
  });
});
