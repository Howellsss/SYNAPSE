/**
 * After a new version of SYNAPSE goes live, a tab opened before it still asks for the old page
 * files, which no longer exist ("Failed to fetch dynamically imported module"). Reloading once
 * picks up the new version. Guarded so a real outage can't cause a reload loop.
 */
const KEY = 'synapse.reloadedForUpdate';

export function isStaleBuildError(error: unknown): boolean {
  const m = String((error as { message?: string })?.message ?? error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(m);
}

/** Reloads the page once per minute at most. Returns true when it reloads. */
export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* private mode: still reload once */ }
  window.location.reload();
  return true;
}
