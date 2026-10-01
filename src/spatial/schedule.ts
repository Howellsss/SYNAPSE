import type { SpaceSchedule } from '@/types';

const DAY = 24 * 60;

export const DEFAULT_SCHEDULE = (timezone: string): SpaceSchedule => ({
  opens_at: '09:00',
  closes_at: '17:00',
  recurrence: 'weekdays',
  days: [1, 2, 3, 4, 5],
  timezone,
  calendar_id: null,
});

function toMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Calendar date, weekday and minute-of-day of an instant in a timezone. */
function zoned(date: Date, timeZone: string): { y: number; m: number; d: number; weekday: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(date);
  } catch {
    return zoned(date, 'UTC');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Whether the schedule has a window starting on this local calendar day. */
function runsOn(schedule: SpaceSchedule, weekday: number, date: string): boolean {
  switch (schedule.recurrence) {
    case 'daily': return true;
    case 'weekdays': return weekday >= 1 && weekday <= 5;
    case 'weekly': return (schedule.days ?? []).includes(weekday);
    case 'once': return schedule.date === date;
    default: return false;
  }
}

/** Local day shifted by n days (calendar arithmetic, timezone independent). */
function shiftDay(y: number, m: number, d: number, n: number): { y: number; m: number; d: number; weekday: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

/** Is the space open at `now`? Windows may run past midnight (closes_at <= opens_at). */
export function isOpenAt(schedule: SpaceSchedule, now: Date = new Date()): boolean {
  const open = toMinutes(schedule.opens_at);
  const close = toMinutes(schedule.closes_at);
  if (open === null || close === null) return false;
  const z = zoned(now, schedule.timezone);
  const overnight = close <= open;
  // Window that started today.
  if (runsOn(schedule, z.weekday, ymd(z.y, z.m, z.d))) {
    if (!overnight && z.minutes >= open && z.minutes < close) return true;
    if (overnight && z.minutes >= open) return true;
  }
  // Window that started yesterday and runs past midnight.
  if (overnight) {
    const y = shiftDay(z.y, z.m, z.d, -1);
    if (runsOn(schedule, y.weekday, ymd(y.y, y.m, y.d)) && z.minutes < close) return true;
  }
  return false;
}

/** UTC instant of a local wall-clock time in a timezone. */
function localToInstant(y: number, m: number, d: number, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const z = zoned(new Date(t), timeZone);
    const shown = Date.UTC(z.y, z.m - 1, z.d, Math.floor(z.minutes / 60), z.minutes % 60);
    t += guess - shown;
  }
  return new Date(t);
}

/** When the space next opens after `now`, or null if it never will (e.g. a past one-off). */
export function nextOpening(schedule: SpaceSchedule, now: Date = new Date()): Date | null {
  const open = toMinutes(schedule.opens_at);
  if (open === null || toMinutes(schedule.closes_at) === null) return null;
  const z = zoned(now, schedule.timezone);
  for (let i = 0; i <= 366; i++) {
    const day = shiftDay(z.y, z.m, z.d, i);
    if (!runsOn(schedule, day.weekday, ymd(day.y, day.m, day.d))) continue;
    if (i === 0 && z.minutes >= open) continue;
    return localToInstant(day.y, day.m, day.d, open, schedule.timezone);
  }
  return null;
}

/** "Opens Tue 09:00" style label in the viewer's locale, or null when open / always on. */
export function opensLabel(schedule: SpaceSchedule | null, persistence: string, now: Date = new Date()): string | null {
  if (persistence !== 'scheduled' || !schedule || isOpenAt(schedule, now)) return null;
  const next = nextOpening(schedule, now);
  if (!next) return 'Closed';
  const sameDay = next.toDateString() === now.toDateString();
  const time = next.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Opens at ${time}`;
  const within6Days = next.getTime() - now.getTime() < 6 * DAY * 60 * 1000;
  const day = next.toLocaleDateString(undefined, within6Days ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  return `Opens ${day} ${time}`;
}

/** Plain-language summary for settings and previews. */
export function describeSchedule(s: SpaceSchedule): string {
  const days = s.recurrence === 'daily' ? 'Every day'
    : s.recurrence === 'weekdays' ? 'Weekdays'
      : s.recurrence === 'once' ? (s.date ? `On ${s.date}` : 'Once')
        : (s.days ?? []).length ? (s.days ?? []).slice().sort().map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : 'No days chosen';
  return `${days}, ${s.opens_at}–${s.closes_at} (${s.timezone})`;
}

/** Problems that make a schedule unusable, for form validation. */
export function scheduleProblem(s: SpaceSchedule): string | null {
  if (toMinutes(s.opens_at) === null || toMinutes(s.closes_at) === null) return 'Enter opening and closing times.';
  if (s.opens_at === s.closes_at) return 'Opening and closing times must differ.';
  if (s.recurrence === 'weekly' && !(s.days ?? []).length) return 'Pick at least one day.';
  if (s.recurrence === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(s.date ?? '')) return 'Pick a date.';
  return null;
}
