import { supabase } from '@/lib/supabase';
import { UPLOAD_CACHE } from '@/lib/cache/config';
import { publicOrigin } from '@/lib/publicUrl';
import { fieldElements } from '@/lib/form-engine';
import type { FormDefinition } from '@/lib/form-builder-types';

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

/** Whether a registration type takes people now, and if not why. */
export type TypeState = 'open' | 'full' | 'closed' | 'not_open_yet' | 'ended' | 'cancelled' | 'unavailable';
export type TypeStatus = 'draft' | 'open' | 'closed';

/**
 * A ticket, which is also a registration type: with a web address (/e/<event>/<slug>) and a form
 * it has its own registration page; with approval, people apply and wait to be selected.
 */
export interface EventTicket {
  id: string;
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  capacity: number | null;
  /** Places left (public view only); null = unlimited. */
  remaining?: number | null;
  slug?: string | null;
  form_id?: string | null;
  requires_approval?: boolean;
  opens_at?: string | null;
  closes_at?: string | null;
  status?: TypeStatus;
  /** Public view: it has a form, and whether it takes people now. */
  has_form?: boolean;
  state?: TypeState;
}

/** An event's own colours, used on its pages and emails. */
export interface EventBrand { primary?: string; accent?: string; ink?: string; palette?: string[] }

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
  /** Both empty while the date is to be announced. */
  starts_at: string | null;
  ends_at: string | null;
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
  tagline: string;
  programme: string[];
  organiser_logo_url: string | null;
  brand: EventBrand;
  privacy_notice: string;
  /** Per-email wording ({ confirmed: { subject, message }, … }); empty keeps the defaults. */
  email_templates: Partial<Record<EmailKind, { subject?: string; message?: string }>>;
  /** The connected account the emails go from (else the account's first). */
  email_account_id: string | null;
  /** A line at the foot of emails and tickets (e.g. a scripture). */
  footer_line: string;
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
  /** Both empty while the date is to be announced. */
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  mode: EventMode;
  venue_name: string;
  address: string;
  city: string;
  status: EventStatus;
  visibility: EventVisibility;
  organiser_name: string;
  organiser_logo_url?: string | null;
  tagline?: string;
  programme?: string[];
  brand?: EventBrand;
  questions?: EventQuestion[];
  registered: number;
  tickets: EventTicket[];
}

/** Statuses: attendees are confirmed at once; performers go applied → shortlisted → selected (or declined) → confirmed. */
export type RegistrationStatus = 'confirmed' | 'applied' | 'shortlisted' | 'selected' | 'declined' | 'cancelled';
/** The statuses that hold a place and carry a ticket. */
export const holdsPlace = (s: RegistrationStatus) => s === 'confirmed' || s === 'selected';

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
  status: RegistrationStatus;
  payment_status: 'free' | 'unpaid' | 'paid';
  amount_minor: number;
  checked_in_at: string | null;
  ticket_code: string | null;
  consent_at: string | null;
  created_at: string;
}

export interface PublicTicket {
  qr_token: string;
  /** What the QR holds: the ticket's link with its signature. */
  qr_url?: string | null;
  footer_line?: string;
  pin: string;
  ticket_code?: string | null;
  requires_approval?: boolean;
  first_name: string;
  last_name: string;
  email: string;
  status: RegistrationStatus;
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

export const DATE_TBA = 'Date to be announced';

export function eventDateLine(startsAt: string | null, endsAt: string | null, timeZone?: string): string {
  if (!startsAt || !endsAt) return DATE_TBA;
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
export function inDateWindow(startsAt: string | null, endsAt: string | null, f: DateFilter, now = new Date()): boolean {
  if (f === 'any') return true;
  if (!startsAt || !endsAt) return false;
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

/** Google Calendar link and an .ics file body for "Add to calendar" (none while the date is to be announced). */
export function calendarLinks(e: Pick<PublicEvent, 'title' | 'summary' | 'starts_at' | 'ends_at' | 'slug' | 'mode' | 'venue_name' | 'address' | 'city'>, origin?: string) {
  if (!e.starts_at || !e.ends_at) return null;
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

export function registrationsCsv(regs: Registration[], tickets: EventTicket[], questions: EventQuestion[], formFields: AnswerField[] = []): string {
  const ticketName = (id: string | null) => tickets.find((t) => t.id === id)?.name ?? '';
  const head = ['First name', 'Last name', 'Email', 'Phone', 'Ticket', 'Status', 'Ticket code', 'Payment', 'PIN', 'Checked in', 'Registered', ...questions.map((q) => q.label), ...formFields.map((f) => f.label)];
  const rows = regs.map((r) => [
    r.first_name, r.last_name, r.email, r.phone, ticketName(r.ticket_id), r.status, r.ticket_code ?? '', r.payment_status, r.pin,
    r.checked_in_at ? new Date(r.checked_in_at).toISOString() : '', new Date(r.created_at).toISOString(),
    ...questions.map((q) => { const a = r.answers?.[q.id]; return typeof a === 'boolean' ? (a ? 'Yes' : 'No') : a ?? ''; }),
    ...formFields.map((f) => answerText(r.answers?.[f.id])),
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

/** Readable text for errors raised by event_register (registering through a type's form). */
export function typeRegisterErrorText(message: string): string {
  if (/consent_required/.test(message)) return 'Please tick the consent box to continue.';
  if (/email_invalid/.test(message)) return 'Please enter a valid email address.';
  if (/name_required/.test(message)) return 'Please enter your name.';
  if (/\bfull\b/.test(message)) return 'Sorry, every place has just been taken.';
  if (/not_open_yet/.test(message)) return "Registration hasn't opened yet.";
  if (/closed|not_found/.test(message)) return 'Registration is closed.';
  if (/busy/.test(message)) return 'Lots of people are registering right now. Please try again in a minute.';
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

/** What a registration page shows: the event, the type (and whether it's open), and its form. */
export interface RegistrationPage {
  event: PublicEvent;
  privacy_notice?: string;
  type: (Pick<EventTicket, 'id' | 'name' | 'description' | 'price_minor' | 'currency' | 'opens_at' | 'closes_at'> & { slug: string; requires_approval: boolean; state: TypeState }) | null;
  form: { id: string; name: string; description: string | null; definition: unknown } | null;
}

export async function fetchRegistrationPage(slug: string, type: string): Promise<{ data: RegistrationPage | null; error: string | null }> {
  const { data, error } = await supabase.rpc('public_event_registration', { p_slug: slug, p_type: type });
  if (error) return { data: null, error: missingTable(error.message) || /public_event_registration/.test(error.message) ? NOT_SET_UP : error.message };
  return { data: (data ?? null) as RegistrationPage | null, error: null };
}

export type TypeRegisterResult =
  | { status: 'confirmed' | 'selected'; first_name: string; type_name: string; qr_token: string; ticket_code: string | null; qr_url?: string | null; emailed?: boolean }
  | { status: 'applied'; first_name: string; type_name: string; emailed?: boolean }
  | { status: 'duplicate'; type_name: string };

/** Register (or apply) through a registration type's form. */
export async function registerThroughForm(slug: string, type: string, answers: Record<string, string>): Promise<{ data: TypeRegisterResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc('event_register', { p_slug: slug, p_type: type, p_answers: answers });
  if (error) return { data: null, error: typeRegisterErrorText(error.message) };
  return { data: data as TypeRegisterResult, error: null };
}

/** Email the ticket again. Answers the same whether or not the email registered. */
export async function resendTicket(slug: string, email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('event_resend_ticket', { p_slug: slug, p_email: email.trim() });
  return { error: error ? 'Something went wrong. Please try again.' : null };
}

export type EmailKind = 'confirmed' | 'applied' | 'selected' | 'declined';
/** The emails people get, and the wording each starts with (kept in step with event_email_default). */
export const EMAIL_KINDS: { kind: EmailKind; label: string; when: string; subject: string; message: string }[] = [
  { kind: 'confirmed', label: 'Registered', when: 'when someone registers (with their ticket)', subject: "You're in: {{event}}",
    message: "Hi {{first_name}},\n\nYou're registered for {{event}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!" },
  { kind: 'applied', label: 'Application received', when: 'when someone applies', subject: "We've got your application: {{event}}",
    message: "Hi {{first_name}},\n\nThank you for applying ({{type}}) for {{event}}. We read every application and we'll be in touch once we've decided." },
  { kind: 'selected', label: 'Selected', when: 'when you select an applicant (with their ticket)', subject: "You've been selected: {{event}}",
    message: "Hi {{first_name}},\n\nGreat news: you've been selected for {{event}}! Your ticket is below. Show the QR code at the door, or give your ticket code {{code}}.\n\nWe can't wait to see you." },
  { kind: 'declined', label: 'Not selected', when: 'when you decline an applicant', subject: 'About your application: {{event}}',
    message: "Hi {{first_name}},\n\nThank you so much for applying to {{event}}. We had more applications than places this time, so we can't offer you a spot, but we'd love to see you there, and we hope you'll apply again." },
];

/** The account's connected email accounts (the ones emails can go from). */
export async function listEmailAccounts(workspaceId: string): Promise<{ id: string; email: string; status: string }[]> {
  const { data } = await supabase.from('email_accounts').select('id, email, status').eq('workspace_id', workspaceId).order('created_at');
  return (data ?? []) as { id: string; email: string; status: string }[];
}

/** Move an application along (applied → shortlisted → selected / declined …); selecting sends the ticket. */
export async function setRegistrationStatus(id: string, status: RegistrationStatus, notify = true): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('event_set_registration_status', { p_reg: id, p_status: status, p_notify: notify });
  if (!error) return { error: null };
  if (/full/.test(error.message)) return { error: 'Every place for this type is taken. Raise its capacity first.' };
  if (/not_allowed/.test(error.message)) return { error: 'You need access to Events to do this.' };
  return { error: error.message };
}

export async function fetchTicket(token: string): Promise<{ data: PublicTicket | null; error: string | null }> {
  const { data, error } = await supabase.rpc('public_ticket', { p_token: token });
  if (error) return { data: null, error: missingTable(error.message) ? NOT_SET_UP : 'We couldn’t find this ticket.' };
  return { data: (data ?? null) as PublicTicket | null, error: null };
}

// ---------------------------------------------------------------- hosts

const EVENT_COLS = 'id, workspace_id, created_by, slug, title, summary, description, category, cover_url, starts_at, ends_at, timezone, mode, venue_name, address, city, online_url, organiser_name, status, visibility, questions, tagline, programme, organiser_logo_url, brand, privacy_notice, email_templates, email_account_id, footer_line, created_at, updated_at';
const TICKET_COLS = 'id, name, description, price_minor, currency, capacity, sort, slug, form_id, requires_approval, opens_at, closes_at, status';

export interface EventSummary extends HostEvent { registered: number; checked_in: number; capacity: number | null; tickets: EventTicket[] }

export async function listEvents(workspaceId: string): Promise<{ data: EventSummary[]; error: string | null }> {
  const { data, error } = await supabase.from('events').select(EVENT_COLS).eq('workspace_id', workspaceId).order('starts_at', { ascending: false, nullsFirst: true }).limit(500);
  if (error) return { data: [], error: missingTable(error.message) ? NOT_SET_UP : error.message };
  const events = (data ?? []) as HostEvent[];
  if (!events.length) return { data: [], error: null };
  const ids = events.map((e) => e.id);
  const [{ data: tickets }, { data: regs }] = await Promise.all([
    supabase.from('event_tickets').select(`event_id, ${TICKET_COLS}`).in('event_id', ids).order('sort'),
    supabase.from('event_registrations').select('event_id, checked_in_at').in('event_id', ids).in('status', ['confirmed', 'selected']),
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
  const { data: tickets } = await supabase.from('event_tickets').select(TICKET_COLS).eq('event_id', id).order('sort');
  return { event: data as HostEvent | null, tickets: (tickets ?? []) as EventTicket[], error: null };
}

export type EventDraft = Omit<HostEvent, 'id' | 'workspace_id' | 'created_by' | 'created_at' | 'updated_at'>;
export type TicketDraft = Omit<EventTicket, 'id' | 'remaining' | 'has_form' | 'state'> & { id?: string };

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
    const body = {
      name: t.name, description: t.description, price_minor: t.price_minor, currency: t.currency, capacity: t.capacity, sort: i,
      slug: t.slug || null, form_id: t.form_id || null, requires_approval: !!t.requires_approval,
      opens_at: t.opens_at || null, closes_at: t.closes_at || null, status: t.status ?? 'open',
    };
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
  if (/events_dates_together/.test(msg)) return 'Give both a start and an end, or mark the date as to be announced.';
  if (/event_tickets_slug_key/.test(msg)) return 'Two registration types have the same web address. Give each its own.';
  if (/slug/.test(msg)) return 'That web address is taken or not valid. Use lowercase letters, numbers and dashes.';
  return msg;
}

/** The account's forms, to pick one for a registration type. */
export async function listWorkspaceForms(workspaceId: string): Promise<{ id: string; name: string; status: string }[]> {
  const { data } = await supabase.from('forms').select('id, name, status').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(200);
  return (data ?? []) as { id: string; name: string; status: string }[];
}

/** "Performer application" → "performer-application": a type's web address. */
export const typeSlug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'register';

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
  const { error } = await supabase.storage.from('event-covers').upload(path, file, { contentType: file.type, upsert: false, cacheControl: UPLOAD_CACHE });
  if (error) return { url: null, error: error.message };
  return { url: supabase.storage.from('event-covers').getPublicUrl(path).data.publicUrl, error: null };
}

export async function listRegistrations(eventId: string): Promise<{ data: Registration[]; error: string | null }> {
  const { data, error } = await supabase.from('event_registrations')
    .select('id, event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin, qr_token, status, payment_status, amount_minor, checked_in_at, ticket_code, consent_at, created_at')
    .eq('event_id', eventId).order('created_at', { ascending: false }).limit(5000);
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as Registration[], error: null };
}

export async function updateRegistration(id: string, patch: Partial<Pick<Registration, 'checked_in_at' | 'payment_status' | 'status'>>) {
  const { error } = await supabase.from('event_registrations').update(patch).eq('id', id);
  return { error: error?.message ?? null };
}


// ---------------------------------------------------------------- organiser dashboard

/** A question from a registration type's form, for labelling answers. */
export interface AnswerField { id: string; label: string; type: string; contact: boolean }
export interface TypeForm { ticket_id: string; fields: AnswerField[] }

/** Each registration type's questions (organisers only). */
export async function fetchRegistrationForms(eventId: string): Promise<{ data: TypeForm[]; error: string | null }> {
  const { data, error } = await supabase.rpc('event_registration_forms', { p_event: eventId });
  if (error) return { data: [], error: /not_allowed/.test(error.message) ? 'You need access to Events to see this.' : error.message };
  const rows = (data ?? []) as { ticket_id: string; definition: FormDefinition | null }[];
  return { data: rows.map((r) => ({ ticket_id: r.ticket_id, fields: r.definition ? formAnswerFields(r.definition) : [] })), error: null };
}

/** A form's questions in order (consent boxes left out): id, label, and whether it's name/email/phone. */
export function formAnswerFields(def: FormDefinition): AnswerField[] {
  const CONTACT = ['first_name', 'last_name', 'full_name', 'email', 'phone'];
  try {
    return fieldElements(def).filter((el) => el.type !== 'consent').map((el) => ({
      id: el.field.fieldId, label: (el.field.label || el.type).trim(), type: el.type,
      contact: CONTACT.includes(el.field.mappedContactField ?? '') || ['full_name', 'email', 'phone'].includes(el.type),
    }));
  } catch { return []; }
}

/** An answer as text (lists joined, yes/no for booleans). */
export function answerText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(answerText).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Whether an answer is a web link people can open (http/https only). */
export function answerLink(v: string): string | null {
  const t = v.trim();
  if (/^https?:\/\/[^\s]+$/i.test(t)) return t;
  if (/^(www\.)[^\s]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(t)) return `https://${t}`;
  return null;
}

/** A registration's answers with their labels; questions they skipped are left out. */
export function labelledAnswers(r: Pick<Registration, 'answers'>, fields: AnswerField[], { withContact = true } = {}) {
  return fields.filter((f) => withContact || !f.contact)
    .map((f) => ({ ...f, value: answerText(r.answers?.[f.id]).trim() }))
    .filter((a) => a.value !== '');
}

export async function addRegistration(eventId: string, p: { ticketId: string; first: string; last: string; email: string; phone?: string; send: boolean; overCapacity?: boolean }) {
  const { data, error } = await supabase.rpc('event_add_registration', {
    p_event: eventId, p_ticket: p.ticketId, p_first: p.first, p_last: p.last, p_email: p.email, p_phone: p.phone ?? null, p_send: p.send, p_over_capacity: !!p.overCapacity,
  });
  if (!error) return { data: data as Registration & { emailed: boolean }, error: null, full: false };
  const m = error.message;
  return {
    data: null, full: /full/.test(m),
    error: /full/.test(m) ? 'Every place for this type is taken.'
      : /duplicate/.test(m) ? 'Someone with this email is already registered for this type.'
      : /email_invalid/.test(m) ? 'Enter a valid email address.'
      : /name_required/.test(m) ? 'Enter their first name.'
      : /not_allowed/.test(m) ? 'You need access to Events to do this.' : 'Something went wrong. Please try again.',
  };
}

export async function sendTicket(id: string): Promise<{ error: string | null; to?: string }> {
  const { data, error } = await supabase.rpc('event_send_ticket', { p_reg: id });
  if (!error) return { error: null, to: (data as { to?: string })?.to };
  const m = error.message;
  return {
    error: /too_soon/.test(m) ? 'It was just sent. Wait a minute before sending again.'
      : /no_email_account/.test(m) ? 'Connect an email account in Settings → Email to send tickets.'
      : /no_email_route/.test(m) ? 'This registration type has no form, so it can’t be emailed.'
      : /no_ticket/.test(m) ? 'There’s no ticket to send: this registration was cancelled or declined.'
      : /not_allowed/.test(m) ? 'You need access to Events to do this.' : 'Something went wrong. Please try again.',
  };
}

/** Where each status sits on the performer review board, and what it's called. */
export const REVIEW_COLUMNS: { status: RegistrationStatus; label: string; hint: string }[] = [
  { status: 'applied', label: 'Applied', hint: 'New applications' },
  { status: 'shortlisted', label: 'Shortlisted', hint: 'Worth a closer look' },
  { status: 'selected', label: 'Selected', hint: 'Ticket sent' },
  { status: 'confirmed', label: 'Confirmed', hint: 'They’ve confirmed' },
  { status: 'declined', label: 'Declined', hint: 'Not this time' },
];

export const STATUS_LABEL: Record<RegistrationStatus, string> = {
  confirmed: 'Confirmed', applied: 'Applied', shortlisted: 'Shortlisted', selected: 'Selected', declined: 'Declined', cancelled: 'Cancelled',
};
