/**
 * Cache settings. Everything can be changed with Vite environment variables (see .env.example):
 *
 *   VITE_CACHE=off              turn the cache off (every read goes to Supabase)
 *   VITE_CACHE_DEBUG=on         log hits, misses and refreshes in the browser console
 *   VITE_CACHE_TTL_<NAME>=60    seconds a kind of data stays fresh (e.g. VITE_CACHE_TTL_CONTACTS)
 */

const env = import.meta.env as Record<string, string | undefined>;

export const CACHE_ENABLED = (env.VITE_CACHE ?? 'on').toLowerCase() !== 'off';
export const CACHE_DEBUG = (env.VITE_CACHE_DEBUG ?? '').toLowerCase() === 'on';

/** Seconds each kind of data stays fresh (after that it's shown at once and refreshed behind). */
const DEFAULT_TTL = {
  /** Today's numbers, meetings and activity. */
  DASHBOARD: 30,
  /** Contact lists (personal data: kept in memory only, never on the device). */
  CONTACTS: 30,
  /** The calendar view: calendars and their bookings (people book from outside, so kept short). */
  CALENDARS: 30,
  /** Workspaces (spaces) and their members. */
  SPACES: 60,
  /** Forms with their submission counts (submissions arrive from outside, so kept shortish). */
  FORMS: 60,
} as const;

export type TtlName = keyof typeof DEFAULT_TTL;

/** Fresh time in milliseconds, from the environment override if there is one. */
export function ttlMs(name: TtlName): number {
  const raw = env[`VITE_CACHE_TTL_${name}`];
  const secs = raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : DEFAULT_TTL[name];
  return Math.max(0, secs) * 1000;
}

/** How long unused cached data is kept in memory before it's dropped. */
export const GC_MS = 10 * 60_000;

/**
 * Browser/CDN cache time (seconds) for uploaded pictures. Safe to be long: every upload gets a new
 * file name, or (avatars and logos, which overwrite) a new ?t= version on its address.
 */
export const UPLOAD_CACHE = '31536000';
