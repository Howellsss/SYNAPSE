import { supabase } from '@/lib/supabase';
import { publicOrigin } from '@/lib/publicUrl';

// ---------------------------------------------------------------- types

export type EventMode = 'in_person' | 'online' | 'hybrid';
export type EventStatus = 'draft' | 'published' | 'cancelled';
export type EventVisibility = 'public' | 'unlisted';
export type QuestionType = 'text' | 'long_text' | 'select' | 'checkbox';

export interface EventQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
}

export interface EventTicket {
  id: string;
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  capacity: number | null;
  /** Places left (public view only); null = unlimited. */
  remaining?: number | null;
}

/** An event as hosts see it (from the events table). */
export interface HostEvent {
  id: string;
  workspace_id: string;
  created_by: string | null;
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  cover_url: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  mode: EventMode;
  venue_name: string;
  address: string;
  city: string;
  online_url: string;
  organiser_name: string;
  status: EventStatus;
  visibility: EventVisibility;
  questions: EventQuestion[];
  created_at: string;
  updated_at: string;
}

/** An event as the public sees it (from public_event / public_events). */
export interface PublicEvent {
  id: string;
  organiser_id: string;
  slug: string;
  title: string;
  summary: string;
  description?: string;
  category: string;
  cover_url: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  mode: EventMode;
  venue_name: string;
  address: string;
  city: string;
  status: EventStatus;
  visibility: EventVisibility;
  organiser_name: string;
  questions?: EventQuestion[];
  registered: number;
  tickets: EventTicket[];
}

export interface Registration {
  id: string;
  event_id: string;
  ticket_id: string | null;
  contact_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  answers: Record<string, string | boolean>;
  pin: string;
  qr_token: string;
  status: 'confirmed' | 'cancelled';
  payment_status: 'free' | 'unpaid' | 'paid';
  amount_minor: number;
  checked_in_at: string | null;
  created_at: string;
}

export interface PublicTicket {
  qr_token: string;
  pin: string;
  first_name: string;
  last_name: string;
  email: string;
  status: 'confirmed' | 'cancelled';
  payment_status: 'free' | 'unpaid' | 'paid';
  amount_minor: number;
  checked_in_at: string | null;
  created_at: string;
  ticket_name: string | null;
  currency: string;
  online_url: string;
  event: PublicEvent;
}

export interface EventStats { upcoming: number; registrations: number; cities: number; organisers: number }

// ---------------------------------------------------------------- constants & pure helpers

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'music', label: 'Music' },
  { id: 'business', label: 'Business' },
  { id: 'tech', label: 'Tech' },
  { id: 'faith', label: 'Faith' },
  { id: 'arts', label: 'Arts & Culture' },
  { id: 'food', label: 'Food & Drink' },
  { id: 'sports', label: 'Sports & Fitness' },
  { id: 'education', label: 'Education' },
  { id: 'community', label: 'Community' },
];

export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? 'Community';

/** The hero picture used when an event has no poster of its own. */
export const DEFAULT_COVER = '/events/hero.webp';

export function slugify(title: string): string {
  const s = title
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/g, '');
  return s.length >= 3 ? s : `event-${s || 'new'}`.slice(0, 60);
}

/** A short random suffix that keeps slugs unique: lagos-jazz-k3f9. */
export const slugSuffix = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** "Free", "₦5,000", "$12.50". */
export function formatPrice(minor: number, currency = 'NGN'): string {
  if (!minor) return 'Free';
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: major % 1 ? 2 : 0 }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString()}`;
  }
}

/** "Free", "From ₦5,000", or "₦5,000" for one paid ticket. */
export function priceFrom(tickets: Pick<EventTicket, 'price_minor' | 'currency'>[]): string {
  if (!tickets.length) return 'Free';
  const sorted = [...tickets].sort((a, b) => a.price_minor - b.price_minor);
  if (sorted[0].price_minor === 0) return 'Free';
  const p = formatPrice(sorted[0].price_minor, sorted[0].currency);
  return tickets.length > 1 ? `From ${p}` : p;
}

export function eventDateLine(startsAt: string, endsAt: string, timeZone?: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const tz = timeZone ? { timeZone } : {};
  const sameDay = s.toLocaleDateString('en-GB', tz) === e.toLocaleDateString('en-GB', tz);
  const day = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...tz });
  const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, ...tz });
  return sameDay ? `${day(s)} · ${time(s)} – ${time(e)}` : `${day(s)}, ${time(s)} – ${day(e)}, ${time(e)}`;
}

export function placeLine(e: Pick<PublicEvent, 'mode' | 'venue_name' | 'city'>): string {
  if (e.mode === 'online') return 'Online';
  const where = [e.venue_name, e.city].filter(Boolean).join(', ');
  return e.mode === 'hybrid' ? `${where || 'Venue'} + online` : where || 'Venue to be announced';
}

/** How far a time zone is ahead of UTC at a moment, in ms. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(at / 1000) * 1000;
}

/** "2026-10-10T18:00" as wall time in `timeZone` → ISO instant. */
export function zonedToIso(local: string, timeZone: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return '';
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = guess - zoneOffsetMs(guess, timeZone);
  t = guess - zoneOffsetMs(t, timeZone); // settle across a DST change
  return new Date(t).toISOString();
}

/** ISO instant → "2026-10-10T18:00" wall time in `timeZone` (for datetime-local inputs). */
export function isoToZoned(iso: string, timeZone: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t + zoneOffsetMs(t, timeZone)).toISOString().slice(0, 16);
}

export type DateFilter = 'any' | 'today' | 'weekend' | 'week' | 'month';

/** Does an event (by its start/end) fall in the chosen window, measured from `now`? */
export function inDateWindow(startsAt: string, endsAt: string, f: DateFilter, now = new Date()): boolean {
  if (f === 'any') return true;
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  let from = day0.getTime();
  let to: number;
  if (f === 'today') to = from + 86400000;
  else if (f === 'week') to = from + 7 * 86400000;
  else if (f === 'month') { const m = new Date(day0); m.setMonth(m.getMonth() + 1, 1); to = m.getTime(); }
  else {
    // The coming weekend: Saturday 00:00 to Monday 00:00 (today counts if it's already the weekend).
    const dow = day0.getDay();
    const sat = new Date(day0);
    sat.setDate(day0.getDate() + (dow === 0 ? -1 : 6 - dow));
    from = sat.getTime();
    to = from + 2 * 86400000;
  }
  return s < to && e >= from;
}

/** Time left until the start, in whole units. */
export function countdown(startsAt: string, now = Date.now()) {
  const ms = Math.max(0, new Date(startsAt).getTime() - now);
  return {
    done: ms === 0,
    days: Math.floor(ms / 86400000),
    hours: Math.floor((ms % 86400000) / 3600000),
    minutes: Math.floor((ms % 3600000) / 60000),
    seconds: Math.floor((ms % 60000) / 1000),
  };
}

export function eventUrl(slug: string, origin = publicOrigin()) {
  return `${origin}/e/${slug}`;
}

export function ticketUrl(token: string, origin = publicOrigin()) {
  return `${origin}/e/ticket/${token}`;
}

/** Pull the ticket token out of a scanned QR (a ticket link) or a bare token. */
export function tokenFromScan(text: string): string | null {
  const m = text.trim().match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Google Calendar link and an .ics file body for "Add to calendar". */
export function calendarLinks(e: Pick<PublicEvent, 'title' | 'summary' | 'starts_at' | 'ends_at' | 'slug' | 'mode' | 'venue_name' | 'address' | 'city'>, origin?: string) {
  const url = eventUrl(e.slug, origin);
  const location = e.mode === 'online' ? url : [e.venue_name, e.address, e.city].filter(Boolean).join(', ');
  const details = `${e.summary ? e.summary + '\n\n' : ''}${url}`;
  const s = icsDate(new Date(e.starts_at));
  const en = icsDate(new Date(e.ends_at));
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${s}/${en}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
  const esc = (t: string) => t.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SYNAPSE//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.slug}@synapse`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${s}`,
    `DTEND:${en}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc(details)}`,
    `LOCATION:${esc(location)}`,
    `URL:${url}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return { google, ics };
}

export function downloadFile(name: string, body: string | Blob, type = 'text/plain') {
  const blob = typeof body === 'string' ? new Blob([body], { type }) : body;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Guard against spreadsheet formulas in names people typed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function registrationsCsv(regs: Registration[], tickets: EventTicket[], questions: EventQuestion[]): string {
  const ticketName = (id: string | null) => tickets.find((t) => t.id === id)?.name ?? '';
  const head = ['First name', 'Last name', 'Email', 'Phone', 'Ticket', 'Payment', 'PIN', 'Checked in', 'Registered', ...questions.map((q) => q.label)];
  const rows = regs.map((r) => [
    r.first_name, r.last_name, r.email, r.phone, ticketName(r.ticket_id), r.payment_status, r.pin,
    r.checked_in_at ? new Date(r.checked_in_at).toISOString() : '', new Date(r.created_at).toISOString(),
    ...questions.map((q) => { const a = r.answers?.[q.id]; return typeof a === 'boolean' ? (a ? 'Yes' : 'No') : a ?? ''; }),
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/** Readable text for errors raised by register_for_event. */
export function registerErrorText(message: string): string {
  if (/sold_out/.test(message)) return 'Sorry, that ticket just sold out. Choose another ticket.';
  if (/already_registered/.test(message)) return "You're already registered with this email. Check your inbox or use a different email.";
  if (/answer_required/.test(message)) return 'Please answer the required questions.';
  if (/email_invalid/.test(message)) return 'Please enter a valid email address.';
  if (/name_required/.test(message)) return 'Please enter your first name.';
  if (/event_over/.test(message)) return 'This event has ended.';
  if (/event_not_found|ticket_not_found/.test(message)) return "This event isn't open for registration.";
  return 'Something went wrong. Please try again.';
}

const missingTable = (msg: string) => /relation .*events.* does not exist|Could not find the (table|function)|public_event/i.test(msg);
export const NOT_SET_UP = "Events aren't set up in the database yet.";

// ---------------------------------------------------------------- public (no account)

export async function fetchPublicEvents(): Promise<{ data: PublicEvent[]; error: string | null }> {
  const { data, error } = await supabase.rpc('public_events');
  if (error) return { data: [], error: missingTable(error.message) ? NOT_SET_UP : error.message };
  return { data: (data ?? []) as PublicEvent[], error: null };
}

export async function fetchPublicEvent(slug: string): Promise<{ data: PublicEvent | null; error: string | null }> {
  const { data, error } = await supabase.rpc('public_event', { p_slug: slug });
  if (error) return { data: null, error: missingTable(error.message) ? NOT_SET_UP : error.message };
  return { data: (data ?? null) as PublicEvent | null, error: null };
}

export async function fetchEventStats(): Promise<EventStats | null> {
  const { data, error } = await supabase.rpc('public_event_stats');
  return error || !data ? null : (data as EventStats);
}

export async function registerForEvent(input: {
  slug: string; ticketId: string; firstName: string; lastName: string; email: string; phone: string; answers: Record<string, string | boolean>;
}): Promise<{ data: { qr_token: string; pin: string } | null; error: string | null }> {
  const { data, error } = await supabase.rpc('register_for_event', {
    p_slug: input.slug, p_ticket: input.ticketId, p_first: input.firstName, p_last: input.lastName,
    p_email: input.email, p_phone: input.phone, p_answers: input.answers,
  });
  if (error) return { data: null, error: registerErrorText(error.message) };
  return { data: data as { qr_token: string; pin: string }, error: null };
}

export async function fetchTicket(token: string): Promise<{ data: PublicTicket | null; error: string | null }> {
  const { data, error } = await supabase.rpc('public_ticket', { p_token: token });
  if (error) return { data: null, error: missingTable(error.message) ? NOT_SET_UP : 'We couldn’t find this ticket.' };
  return { data: (data ?? null) as PublicTicket | null, error: null };
}

// ---------------------------------------------------------------- hosts

const EVENT_COLS = 'id, workspace_id, created_by, slug, title, summary, description, category, cover_url, starts_at, ends_at, timezone, mode, venue_name, address, city, online_url, organiser_name, status, visibility, questions, created_at, updated_at';

export interface EventSummary extends HostEvent { registered: number; checked_in: number; capacity: number | null; tickets: EventTicket[] }

export async function listEvents(workspaceId: string): Promise<{ data: EventSummary[]; error: string | null }> {
  const { data, error } = await supabase.from('events').select(EVENT_COLS).eq('workspace_id', workspaceId).order('starts_at', { ascending: false }).limit(500);
  if (error) return { data: [], error: missingTable(error.message) ? NOT_SET_UP : error.message };
  const events = (data ?? []) as HostEvent[];
  if (!events.length) return { data: [], error: null };
  const ids = events.map((e) => e.id);
  const [{ data: tickets }, { data: regs }] = await Promise.all([
    supabase.from('event_tickets').select('id, event_id, name, description, price_minor, currency, capacity, sort').in('event_id', ids).order('sort'),
    supabase.from('event_registrations').select('event_id, checked_in_at').in('event_id', ids).eq('status', 'confirmed'),
  ]);
  return {
    data: events.map((e) => {
      const ts = ((tickets ?? []) as (EventTicket & { event_id: string })[]).filter((t) => t.event_id === e.id);
      const rs = ((regs ?? []) as { event_id: string; checked_in_at: string | null }[]).filter((r) => r.event_id === e.id);
      return {
        ...e,
        tickets: ts,
        registered: rs.length,
        checked_in: rs.filter((r) => r.checked_in_at).length,
        capacity: ts.length && ts.every((t) => t.capacity) ? ts.reduce((n, t) => n + (t.capacity ?? 0), 0) : null,
      };
    }),
    error: null,
  };
}

export async function getEvent(id: string): Promise<{ event: HostEvent | null; tickets: EventTicket[]; error: string | null }> {
  const { data, error } = await supabase.from('events').select(EVENT_COLS).eq('id', id).maybeSingle();
  if (error) return { event: null, tickets: [], error: missingTable(error.message) ? NOT_SET_UP : error.message };
  const { data: tickets } = await supabase.from('event_tickets').select('id, name, description, price_minor, currency, capacity, sort').eq('event_id', id).order('sort');
  return { event: data as HostEvent | null, tickets: (tickets ?? []) as EventTicket[], error: null };
}

export type EventDraft = Omit<HostEvent, 'id' | 'workspace_id' | 'created_by' | 'created_at' | 'updated_at'>;
export type TicketDraft = Omit<EventTicket, 'id' | 'remaining'> & { id?: string };

/** Create or update an event and its tickets. Tickets left out are removed (if nobody holds one). */
export async function saveEvent(input: {
  id?: string; workspaceId: string; userId: string; event: EventDraft; tickets: TicketDraft[];
}): Promise<{ id: string | null; error: string | null }> {
  const row = { ...input.event, updated_at: new Date().toISOString() };
  let id = input.id ?? null;
  if (id) {
    const { error } = await supabase.from('events').update(row).eq('id', id);
    if (error) return { id: null, error: friendlySaveError(error.message) };
  } else {
    let slug = row.slug;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await supabase.from('events')
        .insert({ ...row, slug, workspace_id: input.workspaceId, created_by: input.userId })
        .select('id').single();
      if (!error) { id = (data as { id: string }).id; break; }
      if (/events_slug_key|duplicate key/.test(error.message)) { slug = `${row.slug.slice(0, 54)}-${slugSuffix()}`; continue; }
      return { id: null, error: friendlySaveError(error.message) };
    }
    if (!id) return { id: null, error: 'Could not find a free web address for this event. Try another title.' };
  }

  const { data: existing } = await supabase.from('event_tickets').select('id').eq('event_id', id);
  const keep = new Set(input.tickets.map((t) => t.id).filter(Boolean));
  const remove = ((existing ?? []) as { id: string }[]).map((t) => t.id).filter((tid) => !keep.has(tid));
  if (remove.length) await supabase.from('event_tickets').delete().in('id', remove);
  for (const [i, t] of input.tickets.entries()) {
    const body = { name: t.name, description: t.description, price_minor: t.price_minor, currency: t.currency, capacity: t.capacity, sort: i };
    const { error } = t.id
      ? await supabase.from('event_tickets').update(body).eq('id', t.id)
      : await supabase.from('event_tickets').insert({ ...body, event_id: id });
    if (error) return { id, error: friendlySaveError(error.message) };
  }
  return { id, error: null };
}

function friendlySaveError(msg: string): string {
  if (missingTable(msg)) return NOT_SET_UP;
  if (/ends_at >= starts_at|events_check/.test(msg)) return 'The event must end after it starts.';
  if (/slug/.test(msg)) return 'That web address is taken or not valid. Use lowercase letters, numbers and dashes.';
  return msg;
}

export async function setEventStatus(id: string, status: EventStatus) {
  const { error } = await supabase.from('events').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteEvent(id: string) {
  const { error } = await supabase.from('events').delete().eq('id', id);
  return { error: error?.message ?? null };
}

export async function uploadCover(workspaceId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return { url: null, error: 'Use a PNG, JPG, WebP or GIF image.' };
  if (file.size > 8 * 1024 * 1024) return { url: null, error: 'The image must be under 8 MB.' };
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${workspaceId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('event-covers').upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { url: null, error: error.message };
  return { url: supabase.storage.from('event-covers').getPublicUrl(path).data.publicUrl, error: null };
}

export async function listRegistrations(eventId: string): Promise<{ data: Registration[]; error: string | null }> {
  const { data, error } = await supabase.from('event_registrations')
    .select('id, event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin, qr_token, status, payment_status, amount_minor, checked_in_at, created_at')
    .eq('event_id', eventId).order('created_at', { ascending: false }).limit(5000);
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as Registration[], error: null };
}

export async function updateRegistration(id: string, patch: Partial<Pick<Registration, 'checked_in_at' | 'payment_status' | 'status'>>) {
  const { error } = await supabase.from('event_registrations').update(patch).eq('id', id);
  return { error: error?.message ?? null };
}
