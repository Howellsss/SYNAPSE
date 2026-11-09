/**
 * Door check-in. Every decision is made by the database (event_check_in and friends in
 * 20261112090000_event_checkin.sql): the phone only shows what it says, so it can never show a
 * false green. When the connection drops, the call is retried until it gets a real answer.
 */
import { supabase } from '@/lib/supabase';
import type { EventBrand } from '@/lib/events';

export type CheckInResult = 'success' | 'already_checked_in' | 'invalid' | 'not_eligible';

export interface CheckInPerson {
  registration_id: string;
  name: string;
  status: string;
  type_name: string | null;
  ticket_code: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
  payment_status: string;
  amount_minor: number;
  currency: string | null;
}

export interface CheckInAnswer { result: CheckInResult; reason: string | null; person: CheckInPerson | null }

export interface CheckInState {
  allowed: boolean;
  organiser?: boolean;
  id?: string;
  title?: string;
  slug?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string;
  cover_url?: string | null;
  brand?: EventBrand;
  expected?: number;
  checked_in?: number;
}

export interface CheckInLogEntry { id: number; at: string; result: CheckInResult | 'undone'; via: 'scan' | 'manual' | 'undo'; name: string | null; registration_id: string | null; by: string | null }
export interface StaffMember { user_id: string; name: string; email: string; on_team: boolean; organiser: boolean }

/** Thrown when the server couldn't be reached: the caller retries, and shows "No connection". */
export class OfflineError extends Error { constructor() { super('offline'); } }

/** Whether an error means "couldn't reach the server" rather than a real answer. */
export function isNetworkError(message: string | undefined | null): boolean {
  return !!message && /failed to fetch|network|load failed|fetch failed|timed? ?out|offline|internet connection/i.test(message);
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
  let res;
  try { res = await supabase.rpc(fn, args); } catch (e) {
    if (isNetworkError((e as Error)?.message) || e instanceof TypeError) throw new OfflineError();
    throw e;
  }
  if (res.error) {
    if (isNetworkError(res.error.message)) throw new OfflineError();
    throw new Error(checkInErrorText(res.error.message));
  }
  return res.data as T;
}

export function checkInErrorText(message: string): string {
  if (/not_allowed/.test(message)) return 'You’re not on the check-in team for this event.';
  if (/busy/.test(message)) return 'Too many scans in a minute. Wait a moment and try again.';
  if (/not_member/.test(message)) return 'Only people in your account can join the check-in team.';
  if (/not_found/.test(message)) return 'That registration no longer exists.';
  return 'Something went wrong. Please try again.';
}

/**
 * Keep trying until the server answers (with a pause that grows to 5 seconds). `onWaiting` is told
 * when it starts and stops waiting for a connection. Real errors (not network) are thrown at once.
 */
export async function untilAnswered<T>(run: () => Promise<T>, onWaiting: (waiting: boolean) => void, signal?: { cancelled: boolean }): Promise<T> {
  let delay = 800;
  for (;;) {
    try {
      const out = await run();
      onWaiting(false);
      return out;
    } catch (e) {
      if (!(e instanceof OfflineError)) { onWaiting(false); throw e; }
      onWaiting(true);
      if (signal?.cancelled) throw e;
      await new Promise((ok) => setTimeout(ok, delay));
      delay = Math.min(delay * 1.6, 5000);
      if (signal?.cancelled) throw e;
    }
  }
}

export const checkInState = (eventId: string) => call<CheckInState>('event_checkin_state', { p_event: eventId });
export const checkIn = (eventId: string, how: { scan?: string; registration?: string; paid?: boolean }) =>
  call<CheckInAnswer>('event_check_in', { p_event: eventId, p_scan: how.scan ?? null, p_registration: how.registration ?? null, p_paid: !!how.paid });
export const undoCheckIn = (eventId: string, registrationId: string) =>
  call<{ ok: boolean; person: CheckInPerson }>('event_undo_check_in', { p_event: eventId, p_registration: registrationId });
export const searchForCheckIn = (eventId: string, query: string) => call<CheckInPerson[]>('event_checkin_search', { p_event: eventId, p_query: query });
export const checkInLog = (eventId: string, limit = 30) => call<CheckInLogEntry[]>('event_checkin_log', { p_event: eventId, p_limit: limit });
export const listCheckInStaff = (eventId: string) => call<StaffMember[]>('event_staff_list', { p_event: eventId });
export const setCheckInStaff = (eventId: string, userId: string, on: boolean) => call<null>('event_staff_set', { p_event: eventId, p_user: userId, p_on: on });

/** Where the scanner for an event lives (inside the app; staff sign in first). */
export const checkInPath = (eventId: string) => `/check-in/${eventId}`;

/** What the red screen says, by reason. */
export function invalidText(reason: string | null): string {
  switch (reason) {
    case 'other_event': return 'This ticket is for a different event.';
    case 'unsigned': return 'This code can’t be verified. Search their name or ticket code instead.';
    case 'cancelled': return 'This registration was cancelled.';
    case 'declined': return 'This application wasn’t selected.';
    case 'applied': case 'shortlisted': return 'This application hasn’t been selected.';
    default: return 'Not a ticket for this event.';
  }
}

/** A short sound and buzz per result (where the phone allows it). */
export function feedback(kind: 'green' | 'amber' | 'red', sound: boolean) {
  try { navigator.vibrate?.(kind === 'green' ? 80 : kind === 'amber' ? [60, 60, 60] : [200, 80, 200]); } catch { /* not supported */ }
  if (!sound) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tones = kind === 'green' ? [[880, 0, 0.12]] : kind === 'amber' ? [[660, 0, 0.1], [660, 0.16, 0.1]] : [[220, 0, 0.35]];
    for (const [f, at, len] of tones) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = kind === 'red' ? 'square' : 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + len);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + len + 0.02);
    }
    setTimeout(() => { void ctx.close(); }, 800);
  } catch { /* no sound */ }
}

/** The colour of a result screen. */
export function resultColour(a: Pick<CheckInAnswer, 'result' | 'reason'>): 'green' | 'amber' | 'red' {
  if (a.result === 'success') return 'green';
  if (a.result === 'already_checked_in' || a.reason === 'unpaid') return 'amber';
  return 'red';
}
