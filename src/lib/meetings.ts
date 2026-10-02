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
}

/** A calendar appointment today that has a video link (shown alongside meetings). */
export interface VideoAppointment {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  link: string;
}

const MEETING_COLS = 'id, workspace_id, host_id, title, code, nickname, kind, scheduled_at, duration_min, ended_at, created_at';

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

export async function endMeeting(id: string): Promise<string | null> {
  const { error } = await supabase.from('meetings').update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  return error?.message ?? null;
}
