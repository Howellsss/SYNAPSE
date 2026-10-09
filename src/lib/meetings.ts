import { supabase } from '@/lib/supabase';
import { makeCode } from '@/meetings/codes';

export type MeetingKind = 'instant' | 'later' | 'scheduled';

export interface Meeting {
  id: string;
  workspace_id: string;
  host_id: string;
  title: string;
  code: string;
  nickname: string | null;
  kind: MeetingKind;
  scheduled_at: string | null;
  duration_min: number;
  ended_at: string | null;
  created_at: string;
  /** Private token for the shareable invite link (after the guest-links database update). */
  invite_token?: string | null;
  /** Only from meeting_by_invite: who is hosting, for the guest's join screen. */
  host_name?: string;
  /** After the meeting-tools database update: everyone but the host waits to be let in. */
  waiting_room?: boolean;
  /** Nobody new can join. */
  locked?: boolean;
  /** The host's breakout rooms while they are open. */
  breakout?: BreakoutState | null;
}

export interface BreakoutRoom { n: number; name: string }
export interface BreakoutState {
  open: boolean;
  rooms: BreakoutRoom[];
  /** participant id -> room number */
  assign: Record<string, number>;
  /** Shown to everyone: when the host plans to bring people back (ISO time), if set. */
  ends_at?: string | null;
  /** The host's latest message to every room. */
  message?: { text: string; at: string } | null;
  /** Names of the people assigned, so the host can see who is where. */
  names?: Record<string, string>;
}

/** Shown when a meeting tool needs the database update that hasn't been applied yet. */
export const TOOLS_NOT_SET_UP = 'This needs the meeting-tools database update (20261009090000_meeting_rooms_admit_breakouts_recordings.sql).';
const missing = (msg: string) => /does not exist|Could not find the (table|.*column)|schema cache/i.test(msg);

/** A calendar appointment today that has a video link (shown alongside meetings). */
export interface VideoAppointment {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  link: string;
}

// All columns: includes invite_token once the guest-links database update is applied, and still works before it.
const MEETING_COLS = '*';

/** Meetings from the last 30 days and everything scheduled ahead. */
export async function listMeetings(workspaceId: string): Promise<{ data: Meeting[]; error: string | null }> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('meetings')
    .select(MEETING_COLS)
    .eq('workspace_id', workspaceId)
    .or(`created_at.gte.${since},scheduled_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    if (/relation .*meetings.* does not exist|Could not find the table/i.test(error.message)) {
      return { data: [], error: "Meetings aren't set up in the database yet." };
    }
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as Meeting[], error: null };
}

/** Today's calendar appointments that have a video link. */
export async function listTodaysVideoAppointments(workspaceId: string): Promise<VideoAppointment[]> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 1);
  const { data } = await supabase
    .from('appointments')
    .select('id, title, start_time, end_time, meeting_link, location_url, status')
    .eq('workspace_id', workspaceId)
    .gte('start_time', start.toISOString())
    .lt('start_time', end.toISOString())
    .not('status', 'in', '(cancelled,rescheduled)')
    .order('start_time');
  return ((data ?? []) as { id: string; title: string; start_time: string; end_time: string; meeting_link: string | null; location_url: string | null }[])
    .map((a) => ({ id: a.id, title: a.title, start_time: a.start_time, end_time: a.end_time, link: a.meeting_link || a.location_url || '' }))
    .filter((a) => /^https:\/\//.test(a.link));
}

export interface NewMeeting {
  workspaceId: string;
  hostId: string;
  title: string;
  kind: MeetingKind;
  scheduledAt?: Date | null;
  durationMin?: number;
  nickname?: string | null;
}

export async function createMeeting(m: NewMeeting): Promise<{ data: Meeting | null; error: string | null }> {
  const title = m.title.trim().slice(0, 120) || 'Meeting';
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        workspace_id: m.workspaceId,
        host_id: m.hostId,
        title,
        code: makeCode(title),
        nickname: m.nickname || null,
        kind: m.kind,
        scheduled_at: m.scheduledAt ? m.scheduledAt.toISOString() : null,
        duration_min: m.durationMin ?? 30,
      })
      .select(MEETING_COLS)
      .single();
    if (!error) return { data: data as Meeting, error: null };
    if (/meetings_code_key/.test(error.message)) continue; // code collision: try another
    if (/meetings_nickname_key/.test(error.message)) return { data: null, error: 'That nickname is already used by another meeting.' };
    if (/does not exist|Could not find the table/i.test(error.message)) return { data: null, error: "Meetings aren't set up in the database yet." };
    return { data: null, error: error.message };
  }
  return { data: null, error: 'Could not create a meeting code. Try again.' };
}

/** Find a meeting in this account by code or nickname. */
export async function findMeeting(workspaceId: string, q: { code: string } | { nickname: string }): Promise<Meeting | null> {
  let query = supabase.from('meetings').select(MEETING_COLS).eq('workspace_id', workspaceId);
  query = 'code' in q ? query.eq('code', q.code) : query.eq('nickname', q.nickname);
  const { data } = await query.maybeSingle();
  return (data as Meeting | null) ?? null;
}

export async function getMeetingByCode(code: string): Promise<{ data: Meeting | null; error: string | null }> {
  const { data, error } = await supabase.from('meetings').select(MEETING_COLS).eq('code', code).maybeSingle();
  return { data: (data as Meeting | null) ?? null, error: error?.message ?? null };
}

/** A meeting as seen through its invite link (works without an account). */
export async function getMeetingByInvite(code: string, invite: string): Promise<Meeting | null> {
  const { data, error } = await supabase.rpc('meeting_by_invite', { p_code: code, p_token: invite });
  const m = (Array.isArray(data) ? data[0] : data) as Meeting | null | undefined;
  if (error || !m || typeof m !== 'object' || m.code !== code || !m.host_id) return null;
  return m;
}

export async function endMeeting(id: string): Promise<string | null> {
  const { error } = await supabase.from('meetings').update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  return error?.message ?? null;
}

/** Host settings: waiting room, lock, breakout rooms. */
export async function updateMeetingSettings(id: string, patch: Partial<Pick<Meeting, 'waiting_room' | 'locked' | 'breakout'>>): Promise<string | null> {
  const { error } = await supabase.from('meetings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (!error) return null;
  return missing(error.message) ? TOOLS_NOT_SET_UP : error.message;
}

export type AdmissionStatus = 'waiting' | 'admitted' | 'denied' | 'removed';
export interface Admission {
  ticket: string;
  identity: string;
  name: string;
  status: AdmissionStatus;
  created_at: string;
}

/** People in the waiting room, oldest first. null when admissions aren't set up yet. */
export async function listWaiting(meetingId: string): Promise<Admission[] | null> {
  const { data, error } = await supabase
    .from('meeting_admissions')
    .select('ticket, identity, name, status, created_at')
    .eq('meeting_id', meetingId)
    .eq('status', 'waiting')
    .order('created_at')
    .limit(100);
  if (error) return null;
  return (data ?? []) as Admission[];
}

/** Admit or turn away people in the waiting room. */
export async function decideAdmissions(meetingId: string, tickets: string[] | 'all', status: 'admitted' | 'denied'): Promise<string | null> {
  let q = supabase.from('meeting_admissions').update({ status, decided_at: new Date().toISOString() }).eq('meeting_id', meetingId).eq('status', 'waiting');
  if (tickets !== 'all') q = q.in('ticket', tickets);
  const { error } = await q;
  if (!error) return null;
  return missing(error.message) ? TOOLS_NOT_SET_UP : error.message;
}

/** Removed people can't come back with the same link or login. */
export async function markRemoved(meetingId: string, identity: string): Promise<void> {
  await supabase.from('meeting_admissions').update({ status: 'removed', decided_at: new Date().toISOString() }).eq('meeting_id', meetingId).eq('identity', identity);
}
