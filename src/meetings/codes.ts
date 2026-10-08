/** Meeting codes look like FOCU-358: four letters from the title, three digits. */
export const CODE_RE = /^[A-Z]{4}-[0-9]{3}$/;
export const NICKNAME_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function makeCode(title: string, rand: () => number = Math.random): string {
  let letters = title.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  while (letters.length < 4) letters += LETTERS[Math.floor(rand() * LETTERS.length)];
  const digits = String(Math.floor(rand() * 1000)).padStart(3, '0');
  return `${letters}-${digits}`;
}

/** "Weekly Sync!" -> "weekly-sync" (or null if it can't be a nickname). */
export function toNickname(input: string): string | null {
  const n = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return NICKNAME_RE.test(n) ? n : null;
}

/** What someone typed in "Enter a code or nickname": a code, a nickname, or nothing usable. */
export function parseJoinInput(input: string): { code: string } | { nickname: string } | null {
  const v = input.trim();
  if (!v) return null;
  const fromUrl = v.match(/\/meetings\/([A-Za-z]{4}-?\d{3})(?:[/?#]|$)/);
  const raw = fromUrl ? fromUrl[1] : v;
  const code = raw.match(/^([A-Za-z]{4})[-\s]?(\d{3})$/);
  if (code) return { code: `${code[1].toUpperCase()}-${code[2]}` };
  const nickname = toNickname(v);
  return nickname ? { nickname } : null;
}

export function meetingUrl(code: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  return `${origin}/meetings/${code}`;
}

/**
 * The link to share: with the meeting's invite token, anyone who opens it can join (people outside
 * the account join as guests with their name). Without a token it only works for account members.
 */
export function inviteUrl(m: { code: string; invite_token?: string | null }, origin?: string): string {
  const base = meetingUrl(m.code, origin);
  return m.invite_token ? `${base}?invite=${encodeURIComponent(m.invite_token)}` : base;
}

/** The invite token in the current address (…/meetings/CODE?invite=… or #/meetings/CODE?invite=…). */
export function inviteFromLocation(path: string, search = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  const q = new URLSearchParams(search).get('invite') ?? new URLSearchParams(path.split('?')[1] ?? '').get('invite');
  const t = (q ?? '').trim();
  return /^[0-9a-f]{32}$/i.test(t) ? t : null;
}

/** "in 5 min", "in 2 h", "now", "started 10 min ago", "tomorrow 09:00". */
export function startsLabel(at: Date | null, now = new Date()): string {
  if (!at) return 'Ready now';
  const mins = Math.round((at.getTime() - now.getTime()) / 60000);
  if (mins <= 0 && mins > -1) return 'in 0 min';
  if (mins < 0) return mins > -60 ? `started ${-mins} min ago` : 'started earlier';
  if (mins < 60) return `in ${mins} min`;
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `at ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  return at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ` ${time}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Google Calendar "add event" link and an .ics file for a scheduled meeting. */
export function calendarLinks(m: { title: string; code: string; start: Date; durationMin: number; invite_token?: string | null }, origin?: string) {
  const end = new Date(m.start.getTime() + m.durationMin * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const url = inviteUrl(m, origin);
  const details = `Join on SYNAPSE: ${url}\nMeeting code: ${m.code}`;
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(m.title)}&dates=${fmt(m.start)}/${fmt(end)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(url)}`;
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SYNAPSE//Meetings//EN', 'BEGIN:VEVENT',
    `UID:${m.code}@synapse`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(m.start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(m.title)}`, `DESCRIPTION:${esc(details)}`, `LOCATION:${esc(url)}`, `URL:${url}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return { google, ics };
}
