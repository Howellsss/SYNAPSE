import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { parseReaction, parseStreamChat, viewersLabel, watchFromLocation, watchUrl } from './streams';

describe('streams', () => {
  it('builds and reads watch links', () => {
    expect(watchUrl({ code: 'LIVE-001', watch_token: 'abc' }, 'https://s.app')).toBe('https://s.app/live/LIVE-001?watch=abc');
    expect(watchFromLocation('/live/LIVE-001?watch=abc', '')).toBe('abc');
    expect(watchFromLocation('/live/LIVE-001', '?watch=xyz')).toBe('xyz');
  });
  it('checks chat and reactions from the data channel', () => {
    expect(parseStreamChat({ id: 'a1', text: '  hi   there ' })).toEqual({ id: 'a1', text: 'hi there' });
    expect(parseStreamChat({ id: 'bad id!', text: 'x' })).toBeNull();
    expect(parseStreamChat({ id: 'a', text: '   ' })).toBeNull();
    expect(parseReaction({ e: '🔥' })).toBe('🔥');
    expect(parseReaction({ e: '<script>' })).toBeNull();
  });
  it('labels viewer counts', () => {
    expect(viewersLabel(1)).toBe('1 viewer');
    expect(viewersLabel(1234)).toBe('1.2K viewers');
    expect(viewersLabel(25000)).toBe('25K viewers');
  });
});
