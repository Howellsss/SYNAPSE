import type { Meeting } from '@/lib/meetings';

/** When a meeting starts: its scheduled time, or when it was created. */
export const startOf = (m: Pick<Meeting, 'scheduled_at' | 'created_at'>) => (m.scheduled_at ? new Date(m.scheduled_at) : new Date(m.created_at));

/** Upcoming = not ended, and either scheduled in the next week or an instant/later room made in the last 12 h. */
export function upcomingRooms(meetings: Meeting[], now = new Date()): Meeting[] {
  const t = now.getTime();
  return meetings
    .filter((m) => !m.ended_at)
    .filter((m) => (m.kind === 'scheduled'
      ? new Date(m.scheduled_at!).getTime() >= t - 60 * 60000 && new Date(m.scheduled_at!).getTime() <= t + 7 * 86400000
      : new Date(m.created_at).getTime() >= t - 12 * 3600000))
    .sort((a, b) => startOf(a).getTime() - startOf(b).getTime());
}

