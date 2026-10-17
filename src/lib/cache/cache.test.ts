import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, tableTag } from './keys';
import { tagsWrittenBy } from './writes';
import { cacheStats, clearCache, invalidateTags, withCache, type CacheOptions } from './withCache';
import { ttlMs } from './config';

const alice = { userId: 'user-a', workspaceId: 'ws-1' };
const bob = { userId: 'user-b', workspaceId: 'ws-1' };
const opts = (scope = alice, extra: Partial<CacheOptions> = {}): CacheOptions => ({
  scope, key: ['contacts', 0], ttl: 30_000, tags: [tableTag('contacts')], ...extra,
});

beforeEach(() => { clearCache(); vi.useRealTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('cache keys', () => {
  it('carry the version, the user and the workspace', () => {
    expect(cacheKey(alice, 'contacts', 2)).toEqual(['v1', 'user:user-a', 'ws:ws-1', 'contacts', 2]);
  });
  it('refuse to build a key without a signed-in user and workspace', () => {
    expect(() => cacheKey({ userId: '', workspaceId: 'ws-1' }, 'contacts')).toThrow();
    expect(() => cacheKey({ userId: 'u', workspaceId: '' }, 'contacts')).toThrow();
  });
});

describe('withCache', () => {
  it('fetches once, then answers from the cache while fresh', async () => {
    const fetcher = vi.fn().mockResolvedValue(['Ama']);
    expect(await withCache(opts(), fetcher)).toEqual(['Ama']);
    expect(await withCache(opts(), fetcher)).toEqual(['Ama']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never gives one person another person's cached data", async () => {
    await withCache(opts(alice), async () => ['alice contact']);
    const forBob = vi.fn().mockResolvedValue(['bob contact']);
    expect(await withCache(opts(bob), forBob)).toEqual(['bob contact']);
    expect(forBob).toHaveBeenCalledTimes(1);
  });

  it('keeps workspaces apart for the same person', async () => {
    await withCache(opts(alice), async () => ['ws-1']);
    const other = vi.fn().mockResolvedValue(['ws-2']);
    expect(await withCache(opts({ userId: 'user-a', workspaceId: 'ws-2' }), other)).toEqual(['ws-2']);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('shows stale data at once, then returns the fresh answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
    await withCache(opts(), async () => ['old']);
    vi.setSystemTime(new Date('2026-10-17T10:01:00Z')); // past the 30 s
    const onStale = vi.fn();
    expect(await withCache(opts(), async () => ['new'], onStale)).toEqual(['new']);
    expect(onStale).toHaveBeenCalledWith(['old']);
  });

  it('does not cache a failed read, and the error reaches the caller', async () => {
    await expect(withCache(opts(), async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    const retry = vi.fn().mockResolvedValue(['ok']);
    expect(await withCache(opts(), retry)).toEqual(['ok']);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('makes concurrent reads of the same thing share one request', async () => {
    let calls = 0;
    const fetcher = () => new Promise<string[]>((ok) => { calls += 1; setTimeout(() => ok(['x']), 20); });
    const [a, b] = await Promise.all([withCache(opts(), fetcher), withCache(opts(), fetcher)]);
    expect(a).toEqual(['x']);
    expect(b).toEqual(['x']);
    expect(calls).toBe(1);
  });

  it('refreshes after a write to a table it reads', async () => {
    await withCache(opts(), async () => ['before']);
    invalidateTags(tagsWrittenBy('https://p.supabase.co/rest/v1/contacts?id=eq.1', 'PATCH') as string[]);
    await Promise.resolve();
    const fetcher = vi.fn().mockResolvedValue(['after']);
    expect(await withCache(opts(), fetcher)).toEqual(['after']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps data when a different table is written', async () => {
    await withCache(opts(), async () => ['kept']);
    invalidateTags([tableTag('forms')]);
    const fetcher = vi.fn().mockResolvedValue(['other']);
    expect(await withCache(opts(), fetcher)).toEqual(['kept']);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forgets everything on clear (sign-out, another workspace)', async () => {
    await withCache(opts(), async () => ['cached']);
    clearCache();
    const fetcher = vi.fn().mockResolvedValue(['again']);
    expect(await withCache(opts(), fetcher)).toEqual(['again']);
  });

  it('counts hits, misses and errors', async () => {
    const before = { ...cacheStats };
    await withCache(opts(), async () => [1]);
    await withCache(opts(), async () => [1]);
    await withCache(opts(alice, { key: ['other'] }), async () => { throw new Error('x'); }).catch(() => {});
    expect(cacheStats.miss - before.miss).toBe(2);
    expect(cacheStats.hit - before.hit).toBe(1);
    expect(cacheStats.error - before.error).toBe(1);
  });
});

describe('tagsWrittenBy', () => {
  const url = (p: string) => `https://abc.supabase.co${p}`;
  it('reads change nothing', () => {
    expect(tagsWrittenBy(url('/rest/v1/contacts?select=*'), 'GET')).toEqual([]);
    expect(tagsWrittenBy(url('/rest/v1/contacts'), 'HEAD')).toEqual([]);
  });
  it('writes refresh their table', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(tagsWrittenBy(url('/rest/v1/appointments'), m)).toEqual(['table:appointments']);
  });
  it('read-only RPCs change nothing; others refresh everything', () => {
    expect(tagsWrittenBy(url('/rest/v1/rpc/get_form_submission_counts'), 'POST')).toEqual([]);
    expect(tagsWrittenBy(url('/rest/v1/rpc/accept_invitation'), 'POST')).toBe('*');
  });
  it('storage, auth and functions are not table writes', () => {
    expect(tagsWrittenBy(url('/storage/v1/object/avatars/a.png'), 'POST')).toEqual([]);
    expect(tagsWrittenBy(url('/functions/v1/livekit-token'), 'POST')).toEqual([]);
    expect(tagsWrittenBy('not a url', 'POST')).toEqual([]);
  });
});

describe('ttl settings', () => {
  it('has defaults in milliseconds', () => {
    expect(ttlMs('CONTACTS')).toBe(30_000);
    expect(ttlMs('SPACES')).toBe(60_000);
  });
});

describe('with the cache switched off', () => {
  it('always goes to Supabase', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_CACHE', 'off');
    const mod = await import('./withCache');
    const fetcher = vi.fn().mockResolvedValue(['live']);
    await mod.withCache(opts(), fetcher);
    await mod.withCache(opts(), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
