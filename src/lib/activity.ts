import { supabase } from '@/lib/supabase';

export interface ActivityItem {
  id: string;
  kind: 'booking' | 'form';
  title: string;
  detail: string;
  at: string;
}

type Person = { first_name: string | null; last_name: string | null } | null;
const nameOf = (p: Person) => [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Someone';

/** What happened lately: new bookings and form submissions, newest first. */
export async function recentActivity(workspaceId: string, limit = 8): Promise<ActivityItem[]> {
  const [appts, subs] = await Promise.all([
    supabase.from('appointments').select('id, created_at, title, contacts(first_name, last_name), calendars(name)')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(limit),
    supabase.from('form_submissions').select('id, created_at, forms(name), contacts(first_name, last_name)')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(limit),
  ]);
  const items: ActivityItem[] = [];
  for (const a of (appts.data ?? []) as unknown as { id: string; created_at: string; title: string | null; contacts: Person; calendars: { name: string } | null }[]) {
    items.push({ id: 'a' + a.id, kind: 'booking', title: 'New booking', detail: `${nameOf(a.contacts)} booked ${a.title || a.calendars?.name || 'an appointment'}`, at: a.created_at });
  }
  for (const f of (subs.data ?? []) as unknown as { id: string; created_at: string; forms: { name: string } | null; contacts: Person }[]) {
    items.push({ id: 'f' + f.id, kind: 'form', title: 'Form submitted', detail: `${nameOf(f.contacts)} submitted ${f.forms?.name || 'a form'}`, at: f.created_at });
  }
  return items.sort((x, y) => y.at.localeCompare(x.at)).slice(0, limit);
}

export interface DayCount { label: string; date: string; count: number }

/** Counts per day for the last 7 days (oldest first), today last. */
export function bucketByDay(timestamps: string[], now = new Date()): DayCount[] {
  const days: DayCount[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), date: d.toDateString(), count: 0 });
  }
  for (const ts of timestamps) {
    const key = new Date(ts).toDateString();
    const day = days.find((d) => d.date === key);
    if (day) day.count++;
  }
  return days;
}

/** Appointments and messages over the last 7 days, per day. */
export async function weeklyActivity(workspaceId: string, now = new Date()): Promise<DayCount[]> {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).toISOString();
  const [appts, msgs] = await Promise.all([
    supabase.from('appointments').select('start_time').eq('workspace_id', workspaceId).gte('start_time', since).lte('start_time', now.toISOString()),
    supabase.from('messages').select('created_at').eq('workspace_id', workspaceId).gte('created_at', since),
  ]);
  const stamps = [
    ...((appts.data ?? []) as { start_time: string }[]).map((r) => r.start_time),
    ...((msgs.data ?? []) as { created_at: string }[]).map((r) => r.created_at),
  ];
  return bucketByDay(stamps, now);
}
