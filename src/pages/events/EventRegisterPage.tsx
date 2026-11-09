import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronDown, Clock, Download, Globe, Hourglass, MapPin, ShieldCheck, Ticket, UserRound } from 'lucide-react';
import { useRouter } from '@/lib/router';
import {
  DEFAULT_COVER, eventDateLine, fetchRegistrationPage, placeLine, registerThroughForm, ticketUrl,
  type PublicEvent, type RegistrationPage, type TypeRegisterResult,
} from '@/lib/events';
import { deserializeDefinition } from '@/lib/form-definition';
import { useViewport } from '@/lib/useViewport';
import { EventsShell, QrImage } from '@/components/events/EventKit';
import { useQrDataUrl } from '@/components/events/hooks';
import { FormPlayer, type FormPayload, type SubmitOutcome } from '@/components/forms/FormPlayer';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

/**
 * /e/<event>/<type>: register (or apply) through a registration type's form. On bigger screens
 * the event sits on the left, sticky, and the form on the right; on smaller ones the event folds
 * into a header above the form.
 */
export function EventRegisterPage({ slug, type }: { slug: string; type: string }) {
  const [, navigate] = useRouter();
  const viewport = useViewport();
  const [page, setPage] = useState<RegistrationPage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<TypeRegisterResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetchRegistrationPage(slug, type).then(({ data, error: err }) => {
      if (!alive) return;
      setPage(data);
      setError(err);
      if (data?.event) document.title = `${data.type?.requires_approval ? 'Apply' : 'Register'} · ${data.event.title}`;
    });
    return () => { alive = false; document.title = 'SYNAPSE'; };
  }, [slug, type]);

  const definition = useMemo(() => (page?.form ? deserializeDefinition(page.form.definition as object) : null), [page]);

  if (page === undefined) return <EventsShell><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner className="h-10 w-10" /></div></EventsShell>;
  if (!page?.event) {
    return (
      <EventsShell>
        <Centered title="Event not found" text={error ?? 'The link may be wrong, or the organiser hasn’t published this event yet.'} action={{ label: 'Browse events', go: () => navigate('/e') }} />
      </EventsShell>
    );
  }

  const { event } = page;
  const t = page.type;
  const desktop = viewport === 'desktop';
  const submit = async (p: FormPayload): Promise<SubmitOutcome> => {
    const { data, error: err } = await registerThroughForm(slug, type, p.answers);
    if (err || !data) return { ok: false, error: err ?? 'Something went wrong. Please try again.' };
    setDone(data);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return { ok: true };
  };

  let right: React.ReactNode;
  if (!t || !definition || !page.form) {
    right = <StateCard icon={<Ticket className="h-6 w-6" />} title="This registration link isn’t available" text="It may have been switched off. See the event page for the ways to take part." />;
  } else if (done) {
    right = <Done result={done} event={event} />;
  } else if (t.state !== 'open') {
    const opens = t.opens_at ? new Date(t.opens_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: event.timezone || undefined }) : null;
    const states: Record<string, [string, string]> = {
      full: ['Event full', 'Every place has been taken. Keep an eye on the event page in case more open up.'],
      not_open_yet: ['Not open yet', opens ? `${t.requires_approval ? 'Applications open' : 'Registration opens'} ${opens}.` : 'Registration opens soon.'],
      closed: [t.requires_approval ? 'Applications closed' : 'Registration closed', 'This is no longer taking new registrations.'],
      ended: ['This event has ended', 'Thanks for your interest. See what else is coming up.'],
      cancelled: ['This event was cancelled', 'The organiser has cancelled this event.'],
      unavailable: ['Not available', 'This registration isn’t open.'],
    };
    const [title, text] = states[t.state] ?? states.unavailable;
    right = <StateCard icon={t.state === 'not_open_yet' ? <Clock className="h-6 w-6" /> : <Ticket className="h-6 w-6" />} title={title} text={text} />;
  } else {
    right = (
      <FormPlayer definition={definition} formName={page.form.name} formDescription={page.form.description} kind="form"
        viewport={viewport} onSubmit={submit} formId={page.form.id} stage panel />
    );
  }

  return (
    <EventsShell>
      <div className={cn('mx-auto w-full', desktop ? 'max-w-[1200px] px-12 py-12' : 'max-w-[720px] sm:px-6 sm:py-8')}>
        <div className={cn(desktop && 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-10')}>
          {desktop ? <EventPanel event={event} onOpen={() => navigate(`/e/${event.slug}`)} /> : <EventHeader event={event} onOpen={() => navigate(`/e/${event.slug}`)} />}
          <div className="min-w-0">
            {t && !done && (
              <p className={cn('mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-ivory-700', !desktop && 'px-5 pt-5 sm:px-0 sm:pt-0')}>
                {t.requires_approval ? <Hourglass className="h-3.5 w-3.5" /> : <Ticket className="h-3.5 w-3.5" />}
                {t.name}{t.requires_approval ? ' · reviewed by the organiser' : ''}
              </p>
            )}
            {right}
            {page.privacy_notice && <PrivacyNotice text={page.privacy_notice} organiser={event.organiser_name} />}
          </div>
        </div>
      </div>
    </EventsShell>
  );
}

const brandOf = (e: PublicEvent) => e.brand?.primary || '#B8892F';

/** The event, on the left of a big screen: poster, who's hosting, what and when, sticky while you fill in the form. */
function EventPanel({ event, onOpen }: { event: PublicEvent; onOpen: () => void }) {
  const [more, setMore] = useState(false);
  const accent = brandOf(event);
  return (
    <aside className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pb-4 [scrollbar-width:thin]">
      <div className="overflow-hidden rounded-[28px] bg-navy-50 shadow-[0_24px_60px_-28px_rgba(13,28,59,0.45)]">
        <img src={event.cover_url || DEFAULT_COVER} alt="" className="aspect-[4/3] w-full object-cover" />
      </div>
      <Organiser event={event} className="mt-6" />
      <h1 className="mt-3 font-event-display text-[40px] font-semibold leading-[1.05] tracking-tight text-navy-900">{event.title}</h1>
      {event.tagline && <p className="mt-2 text-sm font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>{event.tagline}</p>}
      <ul className="mt-6 space-y-3 text-[15px] text-navy-800">
        <li className="flex items-start gap-3"><CalendarDays className="mt-0.5 h-5 w-5 shrink-0" style={{ color: accent }} /><span>{eventDateLine(event.starts_at, event.ends_at, event.timezone)}</span></li>
        <li className="flex items-start gap-3">{event.mode === 'online' ? <Globe className="mt-0.5 h-5 w-5 shrink-0" style={{ color: accent }} /> : <MapPin className="mt-0.5 h-5 w-5 shrink-0" style={{ color: accent }} />}<span>{placeLine(event)}</span></li>
      </ul>
      {!!event.programme?.length && (
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="Programme">
          {event.programme.map((p) => <li key={p} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `color-mix(in srgb, ${accent} 12%, white)`, color: `color-mix(in srgb, ${accent} 70%, #0b1220)` }}>{p}</li>)}
        </ul>
      )}
      {(event.summary || event.description) && (
        <div className="mt-6 border-t border-navy-100 pt-5">
          <p className={cn('whitespace-pre-wrap text-[15px] leading-relaxed text-ivory-800', !more && 'line-clamp-5')}>{event.description || event.summary}</p>
          {(event.description?.length ?? 0) > 280 && <button type="button" onClick={() => setMore(!more)} className="mt-2 text-sm font-semibold text-navy-800 underline underline-offset-4">{more ? 'Show less' : 'Read more'}</button>}
        </div>
      )}
      <button type="button" onClick={onOpen} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-navy-700 hover:text-navy-900"><ArrowLeft className="h-4 w-4" /> Event page</button>
    </aside>
  );
}

/** The event, folded into a header above the form on tablets and phones. */
function EventHeader({ event, onOpen }: { event: PublicEvent; onOpen: () => void }) {
  return (
    <header className="flex items-center gap-4 border-b border-navy-100 px-5 py-4 sm:mb-6 sm:rounded-[24px] sm:border sm:px-4">
      <img src={event.cover_url || DEFAULT_COVER} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover sm:h-20 sm:w-20" />
      <div className="min-w-0">
        <Organiser event={event} small />
        <button type="button" onClick={onOpen} className="block truncate text-left font-event-display text-lg font-semibold leading-tight text-navy-900 hover:underline sm:text-xl">{event.title}</button>
        <p className="mt-0.5 truncate text-[13px] text-ivory-700">{eventDateLine(event.starts_at, event.ends_at, event.timezone)} · {placeLine(event)}</p>
      </div>
    </header>
  );
}

function Organiser({ event, small, className }: { event: PublicEvent; small?: boolean; className?: string }) {
  if (!event.organiser_name) return null;
  return (
    <p className={cn('flex items-center gap-2 font-semibold text-ivory-800', small ? 'text-[11px] uppercase tracking-wider' : 'text-sm', className)}>
      {event.organiser_logo_url
        ? <img src={event.organiser_logo_url} alt="" className={cn('rounded-full object-cover ring-1 ring-navy-100', small ? 'h-4 w-4' : 'h-7 w-7')} />
        : !small && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-50"><UserRound className="h-4 w-4 text-navy-600" /></span>}
      {small ? event.organiser_name : <>Hosted by <span className="text-navy-900">{event.organiser_name}</span></>}
    </p>
  );
}

const card = 'rounded-none bg-white px-5 py-10 text-center sm:rounded-[24px] sm:px-10 sm:shadow-[0_0_0_1px_rgba(16,24,40,0.04),0_4px_8px_rgba(16,24,40,0.04),0_32px_64px_-20px_rgba(16,24,40,0.22)]';

function StateCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className={card} role="status">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-navy-50 text-navy-700">{icon}</span>
      <h2 className="mt-4 font-event-display text-2xl font-semibold text-navy-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ivory-700">{text}</p>
    </div>
  );
}

/** After they send: the ticket (attendees), the application received (performers), or already registered. */
function Done({ result, event }: { result: TypeRegisterResult; event: PublicEvent }) {
  const [, navigate] = useRouter();
  const link = 'qr_token' in result && result.qr_token ? ticketUrl(result.qr_token) : null;
  const qr = useQrDataUrl(link, 800);

  if (result.status === 'duplicate') {
    return (
      <div className={card} role="status">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-navy-50 text-navy-700"><Ticket className="h-6 w-6" /></span>
        <h2 className="mt-4 font-event-display text-2xl font-semibold text-navy-900">You’re already registered</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ivory-700">
          This email or phone number already has a {result.type_name} registration for {event.title}. Use the ticket link you got when you registered.
        </p>
      </div>
    );
  }
  if (result.status === 'applied') {
    return (
      <div className={card} role="status">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600"><Check className="h-7 w-7" strokeWidth={3} /></span>
        <h2 className="mt-4 font-event-display text-[28px] font-semibold text-navy-900">Application received</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ivory-700">
          Thank you, {result.first_name}. {event.organiser_name || 'The organiser'} reviews every application. If you’re selected, you’ll get your ticket then.
        </p>
        <button type="button" onClick={() => navigate(`/e/${event.slug}`)} className="mt-6 h-12 rounded-full px-6 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Back to the event</button>
      </div>
    );
  }
  return (
    <div className={card} role="status">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600"><Check className="h-7 w-7" strokeWidth={3} /></span>
      <h2 className="mt-4 font-event-display text-[28px] font-semibold text-navy-900">You’re in, {result.first_name}!</h2>
      <p className="mt-1 text-[15px] text-ivory-700">{result.type_name} · {event.title}</p>
      {link && <div className="mx-auto mt-6 w-fit rounded-3xl border border-navy-100 p-4"><QrImage text={link} size={200} /></div>}
      {result.ticket_code && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ivory-700">Your ticket code</p>
          <p className="font-event-display text-3xl font-semibold tracking-[0.12em] text-navy-900" data-testid="ticket-code">{result.ticket_code}</p>
        </>
      )}
      <p className="mx-auto mt-4 max-w-sm text-sm text-ivory-700">Show this QR code at the door, or give them your code. Save your ticket now; you can reopen it from its link anytime.</p>
      <div className="mx-auto mt-6 grid max-w-md gap-2 sm:grid-cols-2">
        <button type="button" disabled={!qr} onClick={() => { if (qr) { const a = document.createElement('a'); a.href = qr; a.download = `${event.slug}-ticket.png`; a.click(); } }}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-navy-800 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50"><Download className="h-4 w-4" /> Save QR</button>
        {'qr_token' in result && result.qr_token && (
          <button type="button" onClick={() => navigate(`/e/ticket/${result.qr_token}`)} className="flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><Ticket className="h-4 w-4" /> Open my ticket</button>
        )}
      </div>
    </div>
  );
}

function PrivacyNotice({ text, organiser }: { text: string; organiser: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 px-5 pb-8 sm:px-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 text-sm font-semibold text-navy-700 hover:text-navy-900">
        <ShieldCheck className="h-4 w-4" /> How {organiser || 'the organiser'} uses your details
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-navy-50 px-4 py-3 text-sm leading-relaxed text-navy-800">{text}</p>}
    </div>
  );
}

function Centered({ title, text, action }: { title: string; text: string; action: { label: string; go: () => void } }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <CalendarDays className="mx-auto h-12 w-12 text-gold-500" />
      <h1 className="mt-5 font-event-display text-3xl font-semibold text-navy-900">{title}</h1>
      <p className="mt-3 text-ivory-700">{text}</p>
      <button type="button" onClick={action.go} className="mt-8 rounded-full bg-gold-400 px-6 py-3 text-sm font-semibold text-navy-900 hover:bg-gold-300">{action.label}</button>
    </div>
  );
}
