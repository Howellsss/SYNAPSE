import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ExternalLink, ImagePlus, Plus, Trash2, Upload } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import {
  CATEGORIES, DEFAULT_COVER, getEvent, isoToZoned, listWorkspaceForms, saveEvent, slugify, typeSlug, uploadCover, zonedToIso,
  type EventDraft, type EventMode, type EventQuestion, type QuestionType, type TicketDraft, type TypeStatus,
} from '@/lib/events';
import { TimezoneSelect } from '@/components/ui/TimezoneSelect';
import { LoadingSpinner } from '@/components/ui/States';
import { EventCard } from '@/components/events/EventKit';
import { useEventFonts } from '@/components/events/hooks';
import { cn } from '@/lib/utils';
import { publicOrigin } from '@/lib/publicUrl';

const CURRENCIES = ['NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'EUR'];
const QUESTION_TYPES: { id: QuestionType; label: string }[] = [
  { id: 'text', label: 'Short answer' },
  { id: 'long_text', label: 'Paragraph' },
  { id: 'select', label: 'Dropdown' },
  { id: 'checkbox', label: 'Checkbox' },
];

interface TicketRow {
  id?: string; name: string; description: string; price: string; currency: string; capacity: string;
  /** Its own registration page: web address, form, approval, when it's open. */
  slug: string; formId: string; approval: boolean; opens: string; closes: string; status: TypeStatus;
}
const newTicket = (currency = 'NGN', name = ''): TicketRow => ({ name, description: '', price: '', currency, capacity: '', slug: '', formId: '', approval: false, opens: '', closes: '', status: 'open' });
const HEX = /^#[0-9a-f]{6}$/i;

const defaultTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos'; } catch { return 'Africa/Lagos'; } };
const newId = () => Math.random().toString(36).slice(2, 10);

function nextSaturdayAt(hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

/** /events/new and /events/<id>/edit. */
export function EventBuilder({ eventId }: { eventId?: string }) {
  useEventFonts();
  const { user, workspace } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [loading, setLoading] = useState(!!eventId);
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [category, setCategory] = useState('community');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [tz, setTz] = useState(defaultTz);
  const [start, setStart] = useState(() => nextSaturdayAt(18));
  const [end, setEnd] = useState(() => nextSaturdayAt(21));
  const [mode, setMode] = useState<EventMode>('in_person');
  const [venue, setVenue] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [online, setOnline] = useState('');
  const [organiser, setOrganiser] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [status, setStatus] = useState<'draft' | 'published' | 'cancelled'>('draft');
  const [tickets, setTickets] = useState<TicketRow[]>([newTicket('NGN', 'General admission')]);
  const [questions, setQuestions] = useState<EventQuestion[]>([]);
  const [dateTba, setDateTba] = useState(false);
  const [tagline, setTagline] = useState('');
  const [programme, setProgramme] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [brandPrimary, setBrandPrimary] = useState('');
  const [brandAccent, setBrandAccent] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [forms, setForms] = useState<{ id: string; name: string; status: string }[]>([]);
  const logoRef = useRef<HTMLInputElement>(null);
  const setTicket = (i: number, patch: Partial<TicketRow>) => setTickets((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  useEffect(() => { if (workspace) void listWorkspaceForms(workspace.id).then(setForms); }, [workspace]);

  useEffect(() => {
    if (!eventId) { setOrganiser(workspace?.name ?? ''); return; }
    let alive = true;
    getEvent(eventId).then(({ event, tickets: ts, error: err }) => {
      if (!alive) return;
      setLoading(false);
      if (err || !event) { setError(err ?? 'Event not found.'); return; }
      setTitle(event.title); setSlug(event.slug); setSlugTouched(true); setCategory(event.category);
      setSummary(event.summary); setDescription(event.description); setCover(event.cover_url);
      setTz(event.timezone);
      if (event.starts_at && event.ends_at) { setStart(isoToZoned(event.starts_at, event.timezone)); setEnd(isoToZoned(event.ends_at, event.timezone)); } else setDateTba(true);
      setTagline(event.tagline ?? ''); setProgramme((event.programme ?? []).join(', ')); setLogo(event.organiser_logo_url ?? null);
      setBrandPrimary(event.brand?.primary ?? ''); setBrandAccent(event.brand?.accent ?? ''); setPrivacy(event.privacy_notice ?? '');
      setMode(event.mode); setVenue(event.venue_name); setAddress(event.address); setCity(event.city); setOnline(event.online_url);
      setOrganiser(event.organiser_name); setVisibility(event.visibility); setStatus(event.status); setQuestions(event.questions ?? []);
      setTickets(ts.map((t) => ({
        id: t.id, name: t.name, description: t.description, price: t.price_minor ? String(t.price_minor / 100) : '', currency: t.currency, capacity: t.capacity ? String(t.capacity) : '',
        slug: t.slug ?? '', formId: t.form_id ?? '', approval: !!t.requires_approval, status: t.status ?? 'open',
        opens: t.opens_at ? isoToZoned(t.opens_at, event.timezone) : '', closes: t.closes_at ? isoToZoned(t.closes_at, event.timezone) : '',
      })));
    });
    return () => { alive = false; };
  }, [eventId, workspace]);

  const onTitle = (v: string) => { setTitle(v); if (!slugTouched) setSlug(v.trim() ? slugify(v) : ''); };

  const pickLogo = async (file: File | undefined) => {
    if (!file || !workspace) return;
    const { url, error: err } = await uploadCover(workspace.id, file);
    if (err || !url) { toast(err ?? 'Upload failed', 'error'); return; }
    setLogo(url);
  };

  const pickCover = async (file: File | undefined) => {
    if (!file || !workspace) return;
    setUploading(true);
    const { url, error: err } = await uploadCover(workspace.id, file);
    setUploading(false);
    if (err || !url) { toast(err ?? 'Upload failed', 'error'); return; }
    setCover(url);
  };

  const validate = (): string | null => {
    if (!title.trim()) return 'Give your event a title.';
    if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) return 'The web address can use lowercase letters, numbers and dashes (3–80 characters).';
    if (!dateTba) {
      const s = zonedToIso(start, tz); const e = zonedToIso(end, tz);
      if (!s || !e) return 'Choose when the event starts and ends, or mark the date as to be announced.';
      if (e <= s) return 'The event must end after it starts.';
    }
    if ((brandPrimary && !HEX.test(brandPrimary)) || (brandAccent && !HEX.test(brandAccent))) return 'Brand colours look like #E9472B.';
    if (mode !== 'online' && !venue.trim() && !city.trim()) return 'Add a venue or city.';
    if (mode !== 'in_person' && online.trim() && !/^https:\/\//.test(online.trim())) return 'The online link must start with https://';
    if (!tickets.length) return 'Add at least one ticket.';
    for (const t of tickets) {
      if (!t.name.trim()) return 'Every ticket needs a name.';
      if (t.price && !(Number(t.price) >= 0)) return `Check the price of “${t.name}”.`;
      if (t.capacity && !(Number.isInteger(Number(t.capacity)) && Number(t.capacity) > 0)) return `Capacity for “${t.name}” must be a whole number.`;
      if (t.formId && !/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(t.slug)) return `Give “${t.name}” a web address of lowercase letters, numbers and dashes (2–40), e.g. register.`;
      if (t.slug && !t.formId) return `Choose the form people fill in for “${t.name}”, or clear its web address.`;
      if (t.opens && t.closes && t.closes <= t.opens) return `“${t.name}” must close after it opens.`;
    }
    const slugs = tickets.map((t) => t.slug).filter(Boolean);
    if (new Set(slugs).size !== slugs.length) return 'Two registration types have the same web address. Give each its own.';
    for (const q of questions) {
      if (!q.label.trim()) return 'Every question needs a label.';
      if (q.type === 'select' && !(q.options ?? []).filter((o) => o.trim()).length) return `Add choices for “${q.label}”.`;
    }
    return null;
  };

  const save = async (publish: boolean) => {
    const problem = validate();
    if (problem) { setError(problem); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (!user || !workspace) return;
    setError(null);
    setSaving(publish ? 'publish' : 'draft');
    const draft: EventDraft = {
      slug, title: title.trim(), summary: summary.trim(), description: description.trim(), category, cover_url: cover,
      starts_at: dateTba ? null : zonedToIso(start, tz), ends_at: dateTba ? null : zonedToIso(end, tz), timezone: tz, mode,
      venue_name: mode === 'online' ? '' : venue.trim(), address: mode === 'online' ? '' : address.trim(), city: mode === 'online' ? '' : city.trim(),
      online_url: mode === 'in_person' ? '' : online.trim(), organiser_name: organiser.trim(),
      status: publish ? 'published' : status === 'published' && eventId ? 'published' : 'draft', visibility,
      questions: questions.map((q) => ({ ...q, label: q.label.trim(), options: q.type === 'select' ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined })),
      tagline: tagline.trim(), programme: programme.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 12), organiser_logo_url: logo,
      brand: { ...(brandPrimary ? { primary: brandPrimary } : {}), ...(brandAccent ? { accent: brandAccent } : {}) }, privacy_notice: privacy.trim(),
    };
    const ticketDrafts: TicketDraft[] = tickets.map((t) => ({
      id: t.id, name: t.name.trim(), description: t.description.trim(), currency: t.currency,
      price_minor: t.price ? Math.round(Number(t.price) * 100) : 0, capacity: t.capacity ? Number(t.capacity) : null,
      slug: t.slug || null, form_id: t.formId || null, requires_approval: t.approval, status: t.status,
      opens_at: t.opens ? zonedToIso(t.opens, tz) : null, closes_at: t.closes ? zonedToIso(t.closes, tz) : null,
    }));
    const { id, error: err } = await saveEvent({ id: eventId, workspaceId: workspace.id, userId: user.id, event: draft, tickets: ticketDrafts });
    setSaving(null);
    if (err || !id) { setError(err ?? 'Could not save.'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    toast(publish ? 'Event published' : 'Saved');
    navigate(`/events/${id}`);
  };

  if (loading) return <div className="flex justify-center py-24"><LoadingSpinner className="h-10 w-10" /></div>;

  const preview = {
    slug: slug || 'preview', title: title || 'Your event title', cover_url: cover, starts_at: dateTba ? null : zonedToIso(start, tz) || new Date().toISOString(), timezone: tz,
    category, mode, venue_name: venue, city, organiser_name: organiser, registered: 0,
    tickets: tickets.map((t, i) => ({ id: String(i), name: t.name, description: '', price_minor: t.price ? Math.round(Number(t.price) * 100) || 0 : 0, currency: t.currency, capacity: null })),
  };
  const isLive = status === 'published' && !!eventId;

  return (
    <div className="w-full pb-28">
      <button type="button" onClick={() => navigate(eventId ? `/events/${eventId}` : '/events')} className="mb-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"><ArrowLeft className="h-4 w-4" /> {eventId ? 'Back to event' : 'Events'}</button>
      <h1 className="font-display text-[24px] font-bold tracking-[-0.02em] text-navy-800 sm:text-[24px]">{eventId ? 'Edit event' : 'New event'}</h1>
      <p className="mt-1 text-[14px] text-ivory-700">Fill in what people need to know. Save a draft anytime; publish when it's ready.</p>
      {error && <p role="alert" className="mt-5 rounded-2xl bg-burgundy-50 px-4 py-3 text-sm font-medium text-burgundy-700">{error}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Section title="Basics">
            <Field label="Title" required><input value={title} onChange={(e) => onTitle(e.target.value)} maxLength={140} placeholder="e.g. Lagos Jazz & Wine Night" className="input-field" /></Field>
            <Field label="Web address" hint={`${publicOrigin()}/e/${slug || 'your-event'}`}>
              <div className="flex items-center overflow-hidden rounded-xl border border-navy-100 focus-within:border-gold-400 focus-within:ring-4 focus-within:ring-gold-400/20">
                <span className="shrink-0 border-r border-navy-100 bg-white px-3 py-2.5 text-sm text-ivory-700">/e/</span>
                <input value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80)); }} aria-label="Web address" className="min-w-0 flex-1 px-3 py-2.5 text-sm text-navy-700 outline-none" />
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field">{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              </Field>
              <Field label="Organiser name"><input value={organiser} onChange={(e) => setOrganiser(e.target.value)} maxLength={120} className="input-field" /></Field>
            </div>
            <Field label="Tagline (optional)" hint="A short line shown above the description, e.g. Words. Sound. Style."><input value={tagline} onChange={(e) => setTagline(e.target.value.slice(0, 140))} className="input-field" /></Field>
            <Field label="Summary" hint={`${summary.length}/280 · shown under the title and in search`}><input value={summary} onChange={(e) => setSummary(e.target.value.slice(0, 280))} placeholder="One line that makes people want to come" className="input-field" /></Field>
            <Field label="About this event"><textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 20000))} rows={7} placeholder="Line-up, agenda, dress code, what's included…" className="input-field" /></Field>
          </Section>

          <Section title="Poster">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-navy-50 sm:w-60">
                <img src={cover || DEFAULT_COVER} alt="Event poster" className="h-full w-full object-cover" />
                {!cover && <span className="absolute bottom-2 left-2 rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-navy-800">Default image</span>}
              </div>
              <div className="space-y-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { void pickCover(e.target.files?.[0]); e.target.value = ''; }} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary">{uploading ? <LoadingSpinner className="h-4 w-4" /> : cover ? <Upload className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}{cover ? 'Replace poster' : 'Upload poster'}</button>
                {cover && <button type="button" onClick={() => setCover(null)} className="btn-ghost block">Use the default image</button>}
                <p className="text-xs text-ivory-700">PNG, JPG or WebP, up to 8 MB. Landscape 4:3 looks best.</p>
              </div>
            </div>
          </Section>

          <Section title="Date & time">
            <label className="flex items-center gap-2 text-sm font-medium text-navy-800">
              <input type="checkbox" checked={dateTba} onChange={(e) => setDateTba(e.target.checked)} className="h-4 w-4 accent-gold-500" /> The date is to be announced
            </label>
            {dateTba && <p className="-mt-2 text-sm text-ivory-700">People can register now; the page says “Date to be announced” until you set one.</p>}
            <div className={cn('grid gap-4 sm:grid-cols-2', dateTba && 'hidden')}>
              <Field label="Starts" required><input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value >= end) setEnd(e.target.value); }} className="input-field" /></Field>
              <Field label="Ends" required><input type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="input-field" /></Field>
            </div>
            <Field label="Time zone"><TimezoneSelect value={tz} onChange={setTz} /></Field>
          </Section>

          <Section title="Location">
            <div className="inline-flex rounded-full bg-white p-1 ring-1 ring-inset ring-navy-100" role="radiogroup" aria-label="Where">
              {([['in_person', 'In person'], ['online', 'Online'], ['hybrid', 'Both']] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={cn('rounded-md px-4 py-1.5 text-sm transition', mode === id ? 'bg-navy-800 font-semibold text-white' : 'font-medium text-navy-700 hover:bg-navy-50')}>{label}</button>
              ))}
            </div>
            {mode !== 'online' && (
              <>
                <Field label="Venue"><input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Muri Okunola Park" className="input-field" /></Field>
                <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                  <Field label="Address"><input value={address} onChange={(e) => setAddress(e.target.value)} className="input-field" /></Field>
                  <Field label="City"><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lagos" className="input-field" /></Field>
                </div>
              </>
            )}
            {mode !== 'in_person' && (
              <Field label="Online link" hint="Only registered attendees see it, on their ticket."><input value={online} onChange={(e) => setOnline(e.target.value)} placeholder="https://" className="input-field" /></Field>
            )}
          </Section>

          <Section title="Tickets & registration" action={<button type="button" onClick={() => setTickets((t) => [...t, newTicket(t[0]?.currency)])} className="btn-secondary btn-sm"><Plus className="h-3.5 w-3.5" /> Add ticket</button>}>
            <p className="-mt-1 text-sm text-ivory-700">Leave the price empty for a free ticket. Paid tickets are paid at the venue for now; online payment is coming. Give a ticket a form to give it a registration page of its own (e.g. attendees and performer applications).</p>
            {tickets.map((t, i) => (
              <div key={t.id ?? i} className="rounded-2xl border border-navy-100 p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_150px_110px_auto] sm:items-end">
                  <Field label="Ticket name"><input value={t.name} onChange={(e) => setTickets((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="General, VIP, Early bird…" maxLength={80} className="input-field" /></Field>
                  <Field label="Price">
                    <div className="flex overflow-hidden rounded-xl border border-navy-100 focus-within:border-gold-400">
                      <select value={t.currency} onChange={(e) => setTickets((all) => all.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)))} aria-label="Currency" className="border-r border-navy-100 bg-white px-1.5 text-xs font-semibold text-navy-700 outline-none">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                      <input value={t.price} onChange={(e) => setTickets((all) => all.map((x, j) => (j === i ? { ...x, price: e.target.value.replace(/[^0-9.]/g, '') } : x)))} inputMode="decimal" placeholder="Free" aria-label="Price" className="w-full min-w-0 px-2.5 py-2.5 text-sm outline-none" />
                    </div>
                  </Field>
                  <Field label="Capacity"><input value={t.capacity} onChange={(e) => setTickets((all) => all.map((x, j) => (j === i ? { ...x, capacity: e.target.value.replace(/[^0-9]/g, '') } : x)))} inputMode="numeric" placeholder="No limit" className="input-field" /></Field>
                  <button type="button" disabled={tickets.length === 1} onClick={() => setTickets((all) => all.filter((_, j) => j !== i))} aria-label={`Remove ticket ${t.name || i + 1}`} className="flex h-11 w-11 items-center justify-center rounded-lg text-ivory-700 hover:bg-burgundy-50 hover:text-burgundy-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </div>
                <input value={t.description} onChange={(e) => setTickets((all) => all.map((x, j) => (j === i ? { ...x, description: e.target.value.slice(0, 400) } : x)))} placeholder="What's included (optional)" aria-label="Ticket description" className="input-field mt-3" />
                <TypeSettings t={t} eventSlug={slug} forms={forms} onChange={(patch) => setTicket(i, patch)} />
              </div>
            ))}
          </Section>

          <Section title="Questions for attendees" action={<button type="button" onClick={() => setQuestions((q) => [...q, { id: newId(), label: '', type: 'text', required: false }])} className="btn-secondary btn-sm"><Plus className="h-3.5 w-3.5" /> Add question</button>}>
            <p className="-mt-1 text-sm text-ivory-700">We always ask for name, email and phone. Add anything else you need.</p>
            {questions.map((q, i) => (
              <div key={q.id} className="rounded-2xl border border-navy-100 p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_170px_auto] sm:items-end">
                  <Field label="Question"><input value={q.label} onChange={(e) => setQuestions((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. Any dietary needs?" maxLength={200} className="input-field" /></Field>
                  <Field label="Answer type">
                    <select value={q.type} onChange={(e) => setQuestions((all) => all.map((x, j) => (j === i ? { ...x, type: e.target.value as QuestionType } : x)))} className="input-field">{QUESTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
                  </Field>
                  <button type="button" onClick={() => setQuestions((all) => all.filter((_, j) => j !== i))} aria-label="Remove question" className="flex h-11 w-11 items-center justify-center rounded-lg text-ivory-700 hover:bg-burgundy-50 hover:text-burgundy-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                {q.type === 'select' && (
                  <Field label="Choices (one per line)"><textarea value={(q.options ?? []).join('\n')} onChange={(e) => setQuestions((all) => all.map((x, j) => (j === i ? { ...x, options: e.target.value.split('\n') } : x)))} rows={3} className="input-field mt-1" /></Field>
                )}
                <label className="mt-3 flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" checked={q.required} onChange={(e) => setQuestions((all) => all.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} className="h-4 w-4 accent-gold-500" /> Required</label>
              </div>
            ))}
          </Section>

          <Section title="Branding & privacy">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-navy-50 ring-1 ring-inset ring-navy-100">
                {logo ? <img src={logo} alt="Organiser logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-ivory-600" />}
              </div>
              <div className="flex flex-wrap gap-2">
                <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
                <button type="button" onClick={() => logoRef.current?.click()} className="btn-secondary btn-sm">{logo ? 'Replace organiser logo' : 'Add organiser logo'}</button>
                {logo && <button type="button" onClick={() => setLogo(null)} className="btn-ghost btn-sm">Remove</button>}
              </div>
            </div>
            <Field label="Programme (optional)" hint="Comma separated, e.g. Spoken Word, Music, Fashion"><input value={programme} onChange={(e) => setProgramme(e.target.value)} className="input-field" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColourField label="Main colour" value={brandPrimary} onChange={setBrandPrimary} />
              <ColourField label="Accent colour" value={brandAccent} onChange={setBrandAccent} />
            </div>
            <Field label="Privacy notice" hint="Shown on registration pages: what you collect, why, how long you keep it and who sees it.">
              <textarea value={privacy} onChange={(e) => setPrivacy(e.target.value.slice(0, 8000))} rows={4} className="input-field" placeholder="We collect your name, email and phone to manage your registration…" />
            </Field>
          </Section>

          <Section title="Who can find it">
            <div className="grid gap-3 sm:grid-cols-2">
              {([['public', 'Public', 'Listed on the SYNAPSE events page and searchable.'], ['unlisted', 'Unlisted', 'Only people with the link can see and register.']] as const).map(([id, label, text]) => (
                <button key={id} type="button" role="radio" aria-checked={visibility === id} onClick={() => setVisibility(id)} className={cn('rounded-2xl p-4 text-left ring-1 ring-inset transition', visibility === id ? 'ring-2 ring-navy-800' : 'ring-navy-100 hover:bg-navy-50/60')}>
                  <p className="font-semibold text-navy-800">{label}</p>
                  <p className="mt-1 text-sm text-ivory-700">{text}</p>
                </button>
              ))}
            </div>
          </Section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ivory-700">Preview</p>
            <div className="font-event pointer-events-none"><EventCard event={preview} onOpen={() => {}} /></div>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-[var(--dock-h,0px)] z-30 border-t border-navy-100 bg-white/90 backdrop-blur-xl lg:left-[var(--nav-w,0px)]">
        <div className="mx-auto flex max-w-[1180px] items-center justify-end gap-2 px-4 py-3 lg:px-10">
          {!isLive && <button type="button" onClick={() => { void save(false); }} disabled={!!saving} className="h-[38px] rounded-lg px-4 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50 disabled:opacity-60">{saving === 'draft' ? 'Saving…' : 'Save draft'}</button>}
          <button type="button" onClick={() => { void save(true); }} disabled={!!saving} className="h-[38px] rounded-lg bg-gold-400 px-4 text-sm font-semibold text-navy-900 hover:bg-gold-300 disabled:opacity-60">{saving === 'publish' ? 'Saving…' : isLive ? 'Save changes' : 'Publish'}</button>
        </div>
      </div>
    </div>
  );
}

/** A ticket's own registration page: web address, form, approval and when it's open. */
function TypeSettings({ t, eventSlug, forms, onChange }: { t: TicketRow; eventSlug: string; forms: { id: string; name: string; status: string }[]; onChange: (p: Partial<TicketRow>) => void }) {
  const [open, setOpen] = useState(!!(t.formId || t.slug));
  return (
    <div className="mt-3 rounded-xl bg-navy-50/60 px-3 py-2.5">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-navy-800">
        Registration page {t.formId ? <span className="font-normal text-ivory-700">· /e/{eventSlug || 'event'}/{t.slug || '…'}{t.approval ? ' · by application' : ''}</span> : <span className="font-normal text-ivory-700">· off</span>}
        <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Form people fill in">
              <select value={t.formId} onChange={(e) => onChange({ formId: e.target.value, slug: e.target.value && !t.slug ? typeSlug(t.approval ? 'apply' : 'register') : t.slug })} className="input-field">
                <option value="">None: register on the event page</option>
                {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
            <Field label="Web address" hint={`/e/${eventSlug || 'event'}/${t.slug || 'register'}`}>
              <input value={t.slug} onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) })} placeholder="register" className="input-field" />
            </Field>
          </div>
          {!forms.length && <p className="text-xs text-ivory-700">No forms yet. <a href="/#/forms" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-gold-700">Make one in Forms <ExternalLink className="h-3 w-3" /></a></p>}
          <label className="flex items-start gap-2 text-sm text-navy-800">
            <input type="checkbox" checked={t.approval} onChange={(e) => onChange({ approval: e.target.checked })} className="mt-0.5 h-4 w-4 accent-gold-500" />
            <span><span className="font-semibold">People apply; you choose</span><span className="block text-xs text-ivory-700">They get a ticket only once you select them (e.g. performers).</span></span>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Opens (optional)"><input type="datetime-local" value={t.opens} onChange={(e) => onChange({ opens: e.target.value })} className="input-field" /></Field>
            <Field label="Closes (optional)"><input type="datetime-local" value={t.closes} min={t.opens || undefined} onChange={(e) => onChange({ closes: e.target.value })} className="input-field" /></Field>
            <Field label="Status">
              <select value={t.status} onChange={(e) => onChange({ status: e.target.value as TypeStatus })} className="input-field">
                <option value="open">Open</option><option value="closed">Closed</option><option value="draft">Hidden (draft)</option>
              </select>
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={HEX.test(value) ? value : '#0a1628'} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} className="h-11 w-12 cursor-pointer rounded-lg border border-navy-100 bg-white p-1" />
        <input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="Default" className="input-field" />
      </div>
    </Field>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-navy-800">{title}</h2>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-navy-800">{label}{required && <span className="text-burgundy-600" aria-hidden="true"> *</span>}</span>
        {children}
      </label>
      {hint && <p className="mt-1 truncate text-xs text-ivory-700">{hint}</p>}
    </div>
  );
}
