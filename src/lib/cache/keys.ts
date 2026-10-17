/**
 * Cache keys: `v1 / user:<id> / ws:<id> / <entity> / ...parts`.
 *
 * Every key carries the signed-in user and the workspace, taken from the verified session (never
 * from what a page or link passes in), so one person's cached data can't be served to another.
 * Bump CACHE_VERSION to drop everything cached at once.
 */

export const CACHE_VERSION = 'v1';

/** Who the data belongs to: both from the verified session (AuthContext). */
export interface CacheScope {
  userId: string;
  workspaceId: string;
}

export type CacheKey = readonly unknown[];

export function cacheKey(scope: CacheScope, entity: string, ...parts: unknown[]): CacheKey {
  if (!scope.userId || !scope.workspaceId) throw new Error('cacheKey needs a signed-in user and a workspace');
  return [CACHE_VERSION, `user:${scope.userId}`, `ws:${scope.workspaceId}`, entity, ...parts];
}

/** The tag for everything read from a table: writes to that table refresh it. */
export const tableTag = (table: string) => `table:${table}`;
