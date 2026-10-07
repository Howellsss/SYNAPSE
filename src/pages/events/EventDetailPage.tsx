import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CalendarDays, CalendarPlus, Check, Copy, Download, ExternalLink, Globe, Mail, MapPin, Share2, Ticket, User, Users, X,
} from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useToast } from '@/context/ToastContext';
import {
  DEFAULT_COVER, calendarLinks, categoryLabel, countdown, downloadFile, eventDateLine, eventUrl, fetchPublicEvent, fetchPublicEvents,
  formatPrice, placeLine, registerForEvent, ticketUrl, type EventTicket, type PublicEvent,
} from '@/lib/events';
import { EventCard, EventsShell, QrImage } from '@/components/events/EventKit';
import { useQrDataUrl } from '@/components/events/hooks';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

/** /e/<slug>: one event, its tickets and registration. */
export function EventDetailPage({ slug }: { slug: string }) {
  const [, navigate] = useRouter();
  const [event, setEvent] = useState<PublicEvent | null | undefined>(undefined);
  const [more, setMore] = useState<PublicEvent[]>([]);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const load = () => fetchPublicEvent(slug).then(({ data }) => {
    setEvent(data);
    if (data) setTicketId((cur) => cur ?? data.tickets.find((t) => t.remaining !== 0)?.id ?? null);
  });

  useEffect(() => {
    let alive = true;
    fetchPublicEvent(slug).then(({ data }) => {
      if (!alive) return;
      setEvent(data);
      setTicketId(data?.tickets.find((t) => t.remaining !== 0)?.id ?? null);
      if (data) document.title = `${data.title} · SYNAPSE Events`;
    });
    fetchPublicEvents().then(({ data }) => { if (alive) setMore(data.filter((e) => e.slug !== slug)); });
    return () => { alive = false; document.title = 'SYNAPSE'; };
  }, [slug]);

  if (event === undefined) {
    return <EventsShell><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner className="h-10 w-10" /></div></EventsShell>;
  }
  if (event === null) {
    return (
      <EventsShell>
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <CalendarDays className="mx-auto h-12 w-12 text-gold-500" />
          <h1 className="mt-5 font-event-display text-3xl font-semibold text-navy-900">Event not found</h1>
          <p className="mt-3 text-ivory-700">The link may be wrong, or the organiser hasn't published this event yet.</p>
          <button type="button" onClick={() => navigate('/e')} className="mt-8 rounded-full bg-gold-400 px-6 py-3 text-sm font-semibold text-navy-900 hover:bg-gold-300">Browse events</button>
        </div>
      </EventsShell>
    );
  }

  const ended = new Date(event.ends_at).getTime() < Date.now();
  const cancelled = event.status === 'cancelled';
  const open = !ended && !cancelled;
  const fromOrganiser = more.filter((e) => e.organiser_id === event.organiser_id).slice(0, 4);
  const others = (fromOrganiser.length ? fromOrganiser : more).slice(0, 4);
  const mapQuery = [event.venue_name, event.address, event.city].filter(Boolean).join(', ');

  return (
    <EventsShell>
      <div className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-8 lg:pb-16">
        <button type="button" onClick={() => navigate('/e')} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"><ArrowLeft className="h-4 w-4" /> All events</button>

        {cancelled && <p role="status" className="mt-4 rounded-2xl bg-burgundy-50 px-4 py-3 text-sm font-semibold text-burgundy-700">This event has been cancelled by the organiser.</p>}
        {ended && !cancelled && <p role="status" className="mt-4 rounded-2xl bg-navy-50 px-4 py-3 text-sm font-semibold text-navy-700">This event has ended.</p>}

        <div className="mt-5 grid gap-10 lg:grid-cols-[1fr_400px]">
          <article className="min-w-0">
            <div className="overflow-hidden rounded-[32px] bg-navy-50">
              <img src={event.cover_url || DEFAULT_COVER} alt="" className="aspect-[16/10] w-full object-cover" />
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gold-50 px-3 py-1 text-xs font-semibold text-gold-800">{categoryLabel(event.category)}</span>
              {event.mode !== 'in_person' && <span className="rounded-full bg-navy-50 px-3 py-1 text-xs font-semibold text-navy-700">{event.mode === 'online' ? 'Online' : 'In person + online'}</span>}
            </div>
            <h1 className="mt-4 font-event-display text-[34px] font-semibold leading-[1.1] tracking-tight text-navy-900 sm:text-[48px]">{event.title}</h1>
            {event.summary && <p className="mt-4 text-lg leading-relaxed text-ivory-800">{event.summary}</p>}

            <ul className="mt-7 space-y-4">
              <InfoRow icon={<CalendarDays className="h-5 w-5" />} title={eventDateLine(event.starts_at, event.ends_at, event.timezone)} sub={event.timezone.replace(/_/g, ' ')} />
              <InfoRow
                icon={event.mode === 'online' ? <Globe className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                title={placeLine(event)}
                sub={event.mode === 'online' ? 'The link is on your ticket after you register.' : event.address}
                action={mapQuery && event.mode !== 'online' ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-gold-700 hover:text-gold-800">Directions <ExternalLink className="h-3.5 w-3.5" /></a> : undefined}
              />
              {event.organiser_name && <InfoRow icon={<User className="h-5 w-5" />} title={`Hosted by ${event.organiser_name}`} />}
              {event.registered > 0 && <InfoRow icon={<Users className="h-5 w-5" />} title={`${event.registered.toLocaleString()} ${event.registered === 1 ? 'person' : 'people'} going`} />}
            </ul>

            {event.description && (
              <section className="mt-10 border-t border-navy-100 pt-8">
                <h2 className="font-event-display text-2xl font-semibold text-navy-900">About this event</h2>
                <div className="mt-4 whitespace-pre-wrap break-words text-[16px] leading-[1.75] text-navy-700">{event.description}</div>
              </section>
            )}

            {mapQuery && event.mode !== 'online' && (
              <section className="mt-10 border-t border-navy-100 pt-8">
                <h2 className="font-event-display text-2xl font-semibold text-navy-900">Location</h2>
                <p className="mt-3 font-semibold text-navy-800">{event.venue_name}</p>
                <p className="text-ivory-700">{[event.address, event.city].filter(Boolean).join(', ')}</p>
                <iframe
                  title="Map"
                  loading="lazy"
                  className="mt-4 h-72 w-full rounded-[24px] border border-navy-100"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                />
              </section>
            )}
          </article>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[28px] border border-navy-100 bg-white p-5 shadow-[0_18px_50px_rgba(13,28,59,0.08)] sm:p-6">
              {open && <Countdown startsAt={event.starts_at} />}
              <h2 className="mt-5 font-event-display text-lg font-semibold text-navy-900">Tickets</h2>
              {event.tickets.length ? (
                <div className="mt-3 space-y-2" role="radiogroup" aria-label="Tickets">
                  {event.tickets.map((t) => (
                    <TicketOption key={t.id} t={t} selected={ticketId === t.id} disabled={!open || t.remaining === 0} onSelect={() => setTicketId(t.id)} />
                  ))}
                </div>
              ) : <p className="mt-2 text-sm text-ivory-700">Registration hasn't opened yet.</p>}
              <button
                type="button"
                disabled={!open || !ticketId}
                onClick={() => setRegistering(true)}
                className="mt-5 h-[52px] w-full rounded-full bg-gold-400 text-[15px] font-semibold text-navy-900 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelled ? 'Cancelled' : ended ? 'Event ended' : event.tickets.length && event.tickets.every((t) => t.remaining === 0) ? 'Sold out' : 'Register'}
              </button>
              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-navy-100 pt-5">
                <AddToCalendar event={event} />
                <ShareButton event={event} />
              </div>
            </div>
          </aside>
        </div>

        {others.length > 0 && (
          <section className="mt-16 border-t border-navy-100 pt-10">
            <h2 className="font-event-display text-2xl font-semibold text-navy-900">{fromOrganiser.length ? `More from ${event.organiser_name}` : 'You might also like'}</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {others.map((e) => <EventCard key={e.id} event={e} onOpen={() => { navigate(`/e/${e.slug}`); window.scrollTo({ top: 0 }); }} />)}
            </div>
          </section>
        )}
      </div>

      {/* Phones: the ticket card is far down the page, so keep Register in reach. */}
      {open && ticketId && !registering && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-navy-100 bg-white/95 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-ivory-700">{event.tickets.find((t) => t.id === ticketId)?.name}</p>
              <p className="font-event-display text-base font-semibold text-navy-900">{formatPrice(event.tickets.find((t) => t.id === ticketId)?.price_minor ?? 0, event.tickets.find((t) => t.id === ticketId)?.currency)}</p>
            </div>
            <button type="button" onClick={() => setRegistering(true)} aria-label="Register now" className="h-12 rounded-full bg-gold-400 px-7 text-[15px] font-semibold text-navy-900 hover:bg-gold-300">Register</button>
          </div>
        </div>
      )}

      {registering && ticketId && (
        <RegisterSheet event={event} ticketId={ticketId} onTicket={setTicketId} onClose={() => { setRegistering(false); void load(); }} />
      )}
    </EventsShell>
  );
}

function InfoRow({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-navy-50 text-navy-700">{icon}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="font-semibold text-navy-900">{title}</p>
        {sub && <p className="text-sm text-ivory-700">{sub}</p>}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </li>
  );
}

function Countdown({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const c = countdown(startsAt, now);
  if (c.done) return <p className="rounded-2xl bg-gold-50 px-4 py-3 text-center text-sm font-semibold text-gold-800">Happening now</p>;
  const cells = [[c.days, 'Days'], [c.hours, 'Hours'], [c.minutes, 'Mins'], [c.seconds, 'Secs']] as const;
  return (
    <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-navy-900 p-2 text-center text-white" aria-label="Time until the event" role="timer">
      {cells.map(([v, l]) => (
        <div key={l} className="rounded-xl bg-white/[0.06] py-2">
          <p className="font-event-display text-2xl font-semibold tabular-nums">{String(v).padStart(2, '0')}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-400">{l}</p>
        </div>
      ))}
    </div>
  );
}

function TicketOption({ t, selected, disabled, onSelect }: { t: EventTicket; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl p-4 text-left ring-1 ring-inset transition',
        selected ? 'bg-gold-50/60 ring-2 ring-gold-400' : 'ring-navy-100 hover:bg-navy-50/50',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', selected ? 'bg-gold-400 ring-gold-400' : 'ring-navy-200')}>
        {selected && <Check className="h-3 w-3 text-navy-900" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-navy-900">{t.name}</span>
          <span className="shrink-0 font-event-display text-sm font-semibold text-navy-900">{formatPrice(t.price_minor, t.currency)}</span>
        </span>
        {t.description && <span className="mt-0.5 block text-sm text-ivory-700">{t.description}</span>}
        {t.remaining === 0 ? <span className="mt-1 block text-xs font-semibold text-burgundy-600">Sold out</span>
          : t.remaining != null && t.remaining <= 20 ? <span className="mt-1 block text-xs font-semibold text-gold-700">{t.remaining} left</span> : null}
      </span>
    </button>
  );
}

function AddToCalendar({ event }: { event: PublicEvent }) {
  const [open, setOpen] = useState(false);
  const links = useMemo(() => calendarLinks(event), [event]);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">
        <CalendarPlus className="h-4 w-4" /> Calendar
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-2xl border border-navy-100 bg-white p-1.5 shadow-popover" role="menu">
          <a role="menuitem" href={links.google} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-navy-800 hover:bg-navy-50"><CalendarDays className="h-4 w-4" /> Google Calendar</a>
          <button role="menuitem" type="button" onClick={() => { downloadFile(`${event.slug}.ics`, links.ics, 'text/calendar'); setOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-navy-800 hover:bg-navy-50"><Download className="h-4 w-4" /> Apple / Outlook (.ics)</button>
        </div>
      )}
    </div>
  );
}

function ShareButton({ event }: { event: PublicEvent }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const url = eventUrl(event.slug);
  const text = `${event.title} · ${eventDateLine(event.starts_at, event.ends_at, event.timezone)}`;
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: event.title, text, url }); return; } catch { /* closed or unsupported: show the menu */ }
    }
    setOpen((v) => !v);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Could not copy the link', 'error'); }
    setOpen(false);
  };
  return (
    <div className="relative">
      <button type="button" onClick={() => { void share(); }} aria-expanded={open} className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">
        <Share2 className="h-4 w-4" /> Share
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-56 rounded-2xl border border-navy-100 bg-white p-1.5 shadow-popover" role="menu">
          <button role="menuitem" type="button" onClick={() => { void copy(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-navy-800 hover:bg-navy-50"><Copy className="h-4 w-4" /> Copy link</button>
          <a role="menuitem" href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-navy-800 hover:bg-navy-50"><Share2 className="h-4 w-4" /> WhatsApp</a>
          <a role="menuitem" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-navy-800 hover:bg-navy-50"><X className="h-4 w-4" /> X (Twitter)</a>
          <a role="menuitem" href={`mailto:?subject=${encodeURIComponent(event.title)}&body=${encodeURIComponent(`${text}\n${url}`)}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-navy-800 hover:bg-navy-50"><Mail className="h-4 w-4" /> Email</a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- registration

function RegisterSheet({ event, ticketId, onTicket, onClose }: { event: PublicEvent; ticketId: string; onTicket: (id: string) => void; onClose: () => void }) {
  const [step, setStep] = useState<'details' | 'done'>('details');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ qr_token: string; pin: string } | null>(null);
  const ticket = event.tickets.find((t) => t.id === ticketId) ?? event.tickets[0];
  const questions = event.questions ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const submit = async () => {
    setError(null);
    if (!first.trim()) { setError('Please enter your first name.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    const missing = questions.find((q) => q.required && (q.type === 'checkbox' ? answers[q.id] !== true : !String(answers[q.id] ?? '').trim()));
    if (missing) { setError(`Please answer: ${missing.label}`); return; }
    setBusy(true);
    const { data, error: err } = await registerForEvent({ slug: event.slug, ticketId: ticket.id, firstName: first, lastName: last, email, phone, answers });
    setBusy(false);
    if (err || !data) { setError(err ?? 'Something went wrong.'); return; }
    setResult(data);
    setStep('done');
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={step === 'done' ? "You're registered" : `Register for ${event.title}`}>
      <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-sm animate-backdrop-in" onClick={onClose} />
      <div className="relative flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-popover animate-scale-in sm:rounded-[28px]">
        <header className="flex items-start justify-between gap-4 border-b border-navy-100 px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-gold-700">{step === 'done' ? "You're in" : 'Register'}</p>
            <h2 className="mt-1 truncate font-event-display text-lg font-semibold text-navy-900">{event.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-ivory-700 hover:bg-navy-50"><X className="h-5 w-5" /></button>
        </header>

        {step === 'details' ? (
          <form className="flex-1 overflow-y-auto px-6 py-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {event.tickets.length > 1 ? (
              <label className="block">
                <span className="text-sm font-semibold text-navy-800">Ticket</span>
                <select value={ticket.id} onChange={(e) => onTicket(e.target.value)} className="input-field mt-1.5 !rounded-2xl">
                  {event.tickets.map((t) => <option key={t.id} value={t.id} disabled={t.remaining === 0}>{t.name} · {formatPrice(t.price_minor, t.currency)}{t.remaining === 0 ? ' (sold out)' : ''}</option>)}
                </select>
              </label>
            ) : (
              <p className="flex items-center justify-between rounded-2xl bg-navy-50/60 px-4 py-3 text-sm"><span className="inline-flex items-center gap-2 font-semibold text-navy-800"><Ticket className="h-4 w-4 text-gold-600" />{ticket.name}</span><span className="font-semibold">{formatPrice(ticket.price_minor, ticket.currency)}</span></p>
            )}
            {ticket.price_minor > 0 && (
              <p className="mt-3 rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-900">This ticket is {formatPrice(ticket.price_minor, ticket.currency)}, paid at the venue. Your place is held when you register.</p>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Field label="First name" required><input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" maxLength={80} className="input-field !rounded-2xl" /></Field>
              <Field label="Last name"><input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" maxLength={80} className="input-field !rounded-2xl" /></Field>
            </div>
            <div className="mt-3 grid gap-3">
              <Field label="Email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} className="input-field !rounded-2xl" /></Field>
              <Field label="Phone"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={40} className="input-field !rounded-2xl" /></Field>
              {questions.map((q) => (
                q.type === 'checkbox' ? (
                  <label key={q.id} className="flex items-start gap-3 rounded-2xl px-1 py-1 text-sm text-navy-800">
                    <input type="checkbox" checked={answers[q.id] === true} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded accent-gold-500" />
                    <span>{q.label}{q.required && <span className="text-burgundy-600"> *</span>}</span>
                  </label>
                ) : (
                  <Field key={q.id} label={q.label} required={q.required}>
                    {q.type === 'select' ? (
                      <select value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} className="input-field !rounded-2xl">
                        <option value="">Choose…</option>
                        {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : q.type === 'long_text' ? (
                      <textarea value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} rows={3} maxLength={2000} className="input-field !rounded-2xl" />
                    ) : (
                      <input value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} maxLength={500} className="input-field !rounded-2xl" />
                    )}
                  </Field>
                )
              ))}
            </div>
            {error && <p role="alert" className="mt-4 rounded-2xl bg-burgundy-50 px-4 py-3 text-sm font-medium text-burgundy-700">{error}</p>}
            <button type="submit" disabled={busy} className="mt-6 h-[52px] w-full rounded-full bg-gold-400 text-[15px] font-semibold text-navy-900 hover:bg-gold-300 disabled:opacity-60">
              {busy ? 'Registering…' : ticket.price_minor > 0 ? 'Reserve my place' : 'Complete registration'}
            </button>
            <p className="mt-3 text-center text-xs text-ivory-700">The organiser receives your details to manage this event.</p>
          </form>
        ) : result && (
          <Confirmation event={event} ticketName={ticket.name} price={ticket.price_minor > 0 ? formatPrice(ticket.price_minor, ticket.currency) : null} name={`${first} ${last}`.trim()} result={result} />
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-navy-800">{label}{required && <span className="text-burgundy-600" aria-hidden="true"> *</span>}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function Confirmation({ event, ticketName, price, name, result }: { event: PublicEvent; ticketName: string; price: string | null; name: string; result: { qr_token: string; pin: string } }) {
  const [, navigate] = useRouter();
  const link = ticketUrl(result.qr_token);
  const qr = useQrDataUrl(link, 800);
  const cal = calendarLinks(event);
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600"><Check className="h-6 w-6" strokeWidth={3} /></span>
      <h3 className="mt-3 font-event-display text-2xl font-semibold text-navy-900">You're registered</h3>
      <p className="mt-1 text-sm text-ivory-700">{name} · {ticketName}</p>
      <div className="mx-auto mt-5 w-fit rounded-3xl border border-navy-100 p-4"><QrImage text={link} size={200} /></div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ivory-700">Your check-in PIN</p>
      <p className="font-event-display text-3xl font-semibold tracking-[0.3em] text-navy-900" data-testid="ticket-pin">{result.pin}</p>
      {price && <p className="mx-auto mt-4 max-w-sm rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-900">Pay {price} at the venue when you check in.</p>}
      <p className="mx-auto mt-4 max-w-sm text-sm text-ivory-700">Show the QR code or tell the door your PIN. Save your ticket now; you can reopen it from this link anytime.</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={!qr} onClick={() => { if (qr) { const a = document.createElement('a'); a.href = qr; a.download = `${event.slug}-ticket.png`; a.click(); } }} className="flex h-12 items-center justify-center gap-2 rounded-full bg-navy-800 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50">
          <Download className="h-4 w-4" /> Download QR
        </button>
        <button type="button" onClick={() => navigate(`/e/ticket/${result.qr_token}`)} className="flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">
          <Ticket className="h-4 w-4" /> Open my ticket
        </button>
        <a href={cal.google} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><CalendarDays className="h-4 w-4" /> Google Calendar</a>
        <button type="button" onClick={() => downloadFile(`${event.slug}.ics`, cal.ics, 'text/calendar')} className="flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><CalendarPlus className="h-4 w-4" /> Apple / Outlook</button>
      </div>
    </div>
  );
}
