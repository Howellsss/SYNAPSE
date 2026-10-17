import { QueryClient } from '@tanstack/react-query';
import { CACHE_DEBUG, CACHE_ENABLED, GC_MS } from './config';
import { cacheKey, type CacheKey, type CacheScope } from './keys';

/**
 * The cache: in memory only (never the device's storage, since lists hold personal data), cleared
 * when someone signs out or switches workspace (CacheGuard). TanStack Query keeps the entries and
 * makes concurrent reads of the same key share one request (no stampede).
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: GC_MS, retry: false, refetchOnWindowFocus: false } },
});

/** Hits, misses, stale reads (shown, then refreshed) and errors since the page loaded. */
export const cacheStats = { hit: 0, miss: 0, stale: 0, error: 0 };

function log(event: keyof typeof cacheStats, key: CacheKey) {
  cacheStats[event] += 1;
  // The entity and parts only: never the user/workspace ids or any data.
  if (CACHE_DEBUG) console.debug(`[cache] ${event.toUpperCase()} ${key.slice(3).map(String).join(' / ')}`);
}

export interface CacheOptions {
  scope: CacheScope;
  /** What it is, then anything that changes the answer (page, search, filters). */
  key: [entity: string, ...parts: unknown[]];
  /** How long it stays fresh (ms). */
  ttl: number;
  /** Tables it reads (writes to any of them refresh it), e.g. ['table:contacts']. */
  tags: string[];
}

/**
 * Read through the cache. Fresh: the cached answer at once, no request. Stale: `onStale` gets the
 * cached answer at once (so the page shows it) while a fresh one is fetched and returned. Missing:
 * fetched and kept. A fetcher that throws is never cached, and the error reaches the caller.
 * With the cache switched off this is just `fetcher()`.
 */
export async function withCache<T>(opts: CacheOptions, fetcher: () => Promise<T>, onStale?: (data: T) => void): Promise<T> {
  if (!CACHE_ENABLED) return fetcher();
  const key = cacheKey(opts.scope, ...opts.key);
  const state = queryClient.getQueryState<T>(key);
  const fresh = state?.data !== undefined && !state.isInvalidated && Date.now() - state.dataUpdatedAt < opts.ttl;
  if (fresh) {
    log('hit', key);
    return state!.data as T;
  }
  if (state?.data !== undefined) {
    log('stale', key);
    onStale?.(state.data as T);
  } else {
    log('miss', key);
  }
  try {
    return await queryClient.fetchQuery({ queryKey: key, queryFn: fetcher, staleTime: 0, meta: { tags: opts.tags } });
  } catch (err) {
    log('error', key);
    throw err;
  }
}

/** Mark everything that read any of these tags as out of date (it refreshes on the next read). */
export function invalidateTags(tags: string[]) {
  if (!tags.length) return;
  void queryClient.invalidateQueries({
    predicate: (q) => ((q.meta?.tags as string[] | undefined) ?? []).some((t) => tags.includes(t)),
    refetchType: 'none',
  });
}

/** Drop everything (sign-out, another user or workspace). */
export function clearCache() {
  queryClient.clear();
}
