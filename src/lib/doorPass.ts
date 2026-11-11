/**
 * Door passes: a volunteer's phone checks guests in for one event without a SYNAPSE account.
 * Opening /e/door/<token> once stores the pass on that phone; scanning a ticket's QR with the camera
 * then checks the guest in with it (the database checks the pass, as in 20261119090000_event_door_passes.sql).
 */
import { supabase } from '@/lib/supabase';
import { OfflineError, checkInErrorText, isNetworkError, type CheckInAnswer, type CheckInPerson } from '@/lib/checkin';
import type { EventBrand } from '@/lib/events';

export interface DoorPass {
  id: string; name: string; email: string; link: string; created_at: string;
  activated_at: string | null; last_used_at: string | null; revoked_at: string | null; scans: number; emailed?: boolean;
}
export interface DoorPassInfo {
  valid: boolean; name?: string; event_id?: string; title?: string; slug?: string; date?: string;
  cover_url?: string | null; brand?: EventBrand; expected?: number; checked_in?: number;
}

const KEY = (eventId: string) => `synapse.doorPass.${eventId}`;

/** The pass this phone holds for an event, if any. */
export function storedPass(eventId: string): string | null {
  try { return localStorage.getItem(KEY(eventId)); } catch { return null; }
}
export function storePass(eventId: string, token: string) {
  try { localStorage.setItem(KEY(eventId), token); } catch { /* private mode: the pass page says so */ }
}
export function forgetPass(eventId: string) {
  try { localStorage.removeItem(KEY(eventId)); } catch { /* nothing stored */ }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
  let res;
  try { res = await supabase.rpc(fn, args); } catch (e) {
    if (isNetworkError((e as Error)?.message) || e instanceof TypeError) throw new OfflineError();
    throw e;
  }
  if (res.error) {
    if (isNetworkError(res.error.message)) throw new OfflineError();
    throw new Error(friendly(res.error.message));
  }
  return res.data as T;
}

function friendly(message: string): string {
  if (/name_required/.test(message)) return 'Add their name.';
  if (/email_invalid/.test(message)) return 'Enter a valid email address.';
  if (/already_added/.test(message)) return 'That email already has a door pass for this event.';
  if (/too_many/.test(message)) return 'An event can have up to 50 door passes.';
  if (/not_allowed/.test(message)) return 'This door pass no longer works. Ask the organiser for a new one.';
  if (/could not find the function|PGRST202/i.test(message)) return 'Door passes need the latest database update.';
  return checkInErrorText(message);
}

export const doorPassInfo = (token: string) => rpc<DoorPassInfo>('event_door_pass_info', { p_token: token });
export const doorCheckIn = (token: string, scan: string, paid = false) => rpc<CheckInAnswer>('event_door_check_in', { p_token: token, p_scan: scan, p_paid: paid });
export const doorUndo = (token: string, registrationId: string) =>
  rpc<{ ok: boolean; person: CheckInPerson }>('event_door_undo', { p_token: token, p_registration: registrationId });

export const listDoorPasses = (eventId: string) => rpc<DoorPass[]>('event_door_pass_list', { p_event: eventId });
export const addDoorPass = (eventId: string, name: string, email: string) => rpc<DoorPass>('event_door_pass_add', { p_event: eventId, p_name: name, p_email: email });
export const revokeDoorPass = (id: string) => rpc<null>('event_door_pass_revoke', { p_pass: id });

/** "Not opened yet" / "On a phone · last scan 7:42 PM" / "Removed". */
export function passStatus(p: Pick<DoorPass, 'activated_at' | 'last_used_at' | 'revoked_at'>): string {
  if (p.revoked_at) return 'Removed';
  if (p.last_used_at) return `On a phone · last scan ${new Date(p.last_used_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (p.activated_at) return 'On a phone · no scans yet';
  return 'Not opened yet';
}
