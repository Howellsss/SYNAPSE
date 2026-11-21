import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, CalendarDays, ClipboardList, Contact, Download, MapPin, QrCode, Search, Sparkles, Ticket, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/lib/router';
import {
  CATEGORIES, DEFAULT_COVER, whenLine, fetchEventStats, fetchPublicEvents, inDateWindow,
  type DateFilter, type EventStats, type PublicEvent,
} from '@/lib/events';
import { EventCard, EventsShell } from '@/components/events/EventKit';
import { cn } from '@/lib/utils';

const DATES: { id: DateFilter; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'month', label: 'This month' },
];

/** /e: the public events home. Everything shown comes from published events; nothing is made up. */
export function EventsHomePage() {
  const [, navigate] = useRouter();
  const { user } = useAuth();
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [when, setWhen] = useState<DateFilter>('any');
  const [freeOnly, setFreeOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPublicEvents().then(({ data, error: err }) => { if (alive) { setEvents(data); setError(err); } });
    fetchEventStats().then((s) => { if (alive) setStats(s); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const c = city.trim().toLowerCase();
    return (events ?? []).filter((e) => {
      if (category !== 'all' && e.category !== category) return false;
      if (!inDateWindow(e.starts_at, e.ends_at, when)) return false;
      if (freeOnly && !e.tickets.some((t) => t.price_minor === 0)) return false;
      if (c && !`${e.city} ${e.venue_name} ${e.address}`.toLowerCase().includes(c) && !(c === 'online' && e.mode !== 'in_person')) return false;
      const hay = `${e.title} ${e.summary} ${e.organiser_name} ${e.venue_name} ${e.city}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [events, q, city, category, when, freeOnly]);

  const next = events?.[0] ?? null;
  const filtering = q || city || category !== 'all' || when !== 'any' || freeOnly;
  const clear = () => { setQ(''); setCity(''); setCategory('all'); setWhen('any'); setFreeOnly(false); };
  const cities = useMemo(() => [...new Set((events ?? []).map((e) => e.city).filter(Boolean))].slice(0, 6), [events]);
  const host = () => navigate(user ? '/events/new' : '/signup');

  return (
    <EventsShell>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-7 px-5 pb-8 pt-6 sm:gap-10 sm:px-8 sm:pb-14 sm:pt-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-20 lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-50 px-2.5 py-1 text-[11px] font-semibold text-gold-800 sm:gap-2 sm:px-3 sm:text-xs"><Sparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Events on SYNAPSE</span>
            <h1 className="mt-3.5 font-event-display text-[27px] font-semibold leading-[1.08] sm:mt-5 tracking-tight text-navy-900 sm:text-[56px] lg:text-[64px]">
              Find your people.<br /><span className="text-gold-500">Show up.</span>
            </h1>
            <p className="mt-3 max-w-xl text-[14px] leading-[1.6] text-ivory-700 sm:mt-5 sm:text-lg sm:leading-relaxed sm:text-ivory-800">
              Concerts, conferences, church gatherings, food fairs and meetups. Register in a minute, get your QR ticket instantly, and walk straight in.
            </p>

            <form
              className="mt-5 flex flex-col gap-0.5 rounded-[20px] border border-navy-100 bg-white p-1.5 shadow-[0_12px_32px_-12px_rgba(13,28,59,0.16)] sm:mt-8 sm:flex-row sm:items-center sm:gap-2 sm:rounded-full sm:p-2 sm:shadow-[0_18px_50px_rgba(13,28,59,0.10)]"
              onSubmit={(e) => { e.preventDefault(); document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' }); }}
              role="search"
            >
              <label className="flex flex-1 items-center gap-2.5 px-3.5 sm:px-4">
                <Search className="h-4 w-4 shrink-0 text-ivory-600 sm:h-5 sm:w-5" />
                <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search events" placeholder="Search events, artists, organisers" className="h-10 w-full bg-transparent text-[14px] sm:h-11 sm:text-[15px] outline-none placeholder:text-ivory-600" />
              </label>
              <span className="hidden h-7 w-px bg-navy-100 sm:block" aria-hidden="true" />
              <label className="flex items-center gap-2.5 border-t border-navy-100/70 px-3.5 sm:w-48 sm:border-0 sm:px-4">
                <MapPin className="h-4 w-4 shrink-0 text-ivory-600 sm:h-5 sm:w-5" />
                <input value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" placeholder="City or online" list="event-cities" className="h-10 w-full bg-transparent text-[14px] sm:h-11 sm:text-[15px] outline-none placeholder:text-ivory-600" />
                <datalist id="event-cities">{cities.map((c) => <option key={c} value={c} />)}<option value="Online" /></datalist>
              </label>
              <button type="submit" className="mt-1 h-11 rounded-full bg-navy-800 px-7 text-[14px] font-semibold sm:mt-0 sm:h-12 sm:text-[15px] text-white hover:bg-navy-700">Search</button>
            </form>

            {stats && stats.upcoming > 0 && (
              <dl className="mt-5 grid grid-cols-3 divide-x divide-navy-100 rounded-2xl border border-navy-100 py-3 text-center sm:mt-8 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-4 sm:divide-x-0 sm:rounded-none sm:border-0 sm:py-0 sm:text-left">
                <Stat value={stats.upcoming} label={stats.upcoming === 1 ? 'upcoming event' : 'upcoming events'} />
                {stats.registrations > 0 && <Stat value={stats.registrations} label={stats.registrations === 1 ? 'person registered' : 'people registered'} />}
                {stats.cities > 0 && <Stat value={stats.cities} label={stats.cities === 1 ? 'city' : 'cities'} />}
              </dl>
            )}
          </div>

          <div className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] sm:aspect-[4/5] sm:rounded-[36px] sm:aspect-[5/5] lg:aspect-[4/5]">
              <img src="/events/hero.webp" alt="Three women in bright headwraps, seen from behind" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy-950/50 via-transparent to-transparent" />
            </div>
            {next && (
              <button
                type="button"
                onClick={() => navigate(`/e/${next.slug}`)}
                className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-2xl bg-white/95 p-2.5 sm:bottom-5 sm:left-5 sm:right-5 sm:rounded-3xl sm:p-3 text-left shadow-[0_18px_40px_rgba(13,28,59,0.25)] backdrop-blur transition hover:bg-white sm:left-auto sm:w-[340px]"
              >
                <img src={next.cover_url || DEFAULT_COVER} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover sm:h-14 sm:w-14 sm:rounded-2xl" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-gold-700">Next up</span>
                  <span className="block truncate font-event-display text-sm font-semibold text-navy-900">{next.title}</span>
                  <span className="block truncate text-xs text-ivory-700">{whenLine(next)}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-navy-700" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Explore */}
      <section id="explore" className="scroll-mt-20 border-t border-navy-100/70">
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12 lg:py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-event-display text-[22px] font-semibold tracking-tight text-navy-900 sm:text-4xl">Upcoming events</h2>
              <p className="mt-1 text-[13px] text-ivory-700 sm:mt-2 sm:text-base">{events === null ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'event' : 'events'}${filtering ? ' match' : ''}`}</p>
            </div>
            {filtering && <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><X className="h-4 w-4" /> Clear filters</button>}
          </div>

          <div className="-mx-5 mt-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-4 sm:mt-6 sm:px-4">
            <div className="flex w-max gap-2" role="group" aria-label="Category">
              <Chip on={category === 'all'} onClick={() => setCategory('all')}>All</Chip>
              {CATEGORIES.map((c) => <Chip key={c.id} on={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Chip>)}
            </div>
          </div>
          <div className="-mx-5 mt-2 flex items-center gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:mt-3 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0" role="group" aria-label="When">
            {DATES.map((d) => <Chip key={d.id} small on={when === d.id} onClick={() => setWhen(d.id)}>{d.label}</Chip>)}
            <span className="mx-1 hidden h-5 w-px bg-navy-100 sm:block" aria-hidden="true" />
            <Chip small on={freeOnly} onClick={() => setFreeOnly((v) => !v)}>Free</Chip>
          </div>

          <div className="mt-5 sm:mt-8">
            {events === null ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-[340px] animate-pulse rounded-[24px] bg-navy-50" />)}
              </div>
            ) : filtered.length ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((e) => <EventCard key={e.id} event={e} onOpen={() => navigate(`/e/${e.slug}`)} />)}
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-navy-200 px-6 py-16 text-center">
                <CalendarDays className="mx-auto h-10 w-10 text-gold-500" />
                <h3 className="mt-4 font-event-display text-xl font-semibold text-navy-900">
                  {error ? 'Events are on their way' : filtering ? 'Nothing matches yet' : 'No upcoming events yet'}
                </h3>
                <p className="mx-auto mt-2 max-w-md text-ivory-700">
                  {error ? "We couldn't load events right now. Please check back soon." : filtering ? 'Try another date, city or category.' : 'Be the first to put something on. It takes a few minutes.'}
                </p>
                <button type="button" onClick={filtering && !error ? clear : host} className="mt-6 rounded-full bg-gold-400 px-6 py-3 text-sm font-semibold text-navy-900 hover:bg-gold-300">
                  {filtering && !error ? 'Clear filters' : 'Host an event'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-14 lg:py-20">
          <h2 className="max-w-2xl font-event-display text-[22px] font-semibold leading-tight tracking-tight text-navy-900 sm:text-4xl">From “I’m going” to the front door in three steps.</h2>
          <div className="mt-5 grid gap-3 sm:mt-10 sm:gap-5 md:grid-cols-3">
            <Step n="01" icon={<Search className="h-5 w-5" />} title="Find it" text="Browse by city, date or what you love. Every page has the time, the place, the price and who's hosting." />
            <Step n="02" icon={<Ticket className="h-5 w-5" />} title="Register in a minute" text="Pick a ticket, add your details and you're in. Add it to your calendar with one tap." />
            <Step n="03" icon={<QrCode className="h-5 w-5" />} title="Show your QR" text="Your ticket has a QR code and a 6-digit PIN. The door scans it and you walk straight in." />
          </div>
        </div>
      </section>

      {/* Organisers */}
      <section id="organisers" className="scroll-mt-20 px-5 pb-12 sm:px-8 sm:pb-16">
        <div className="mx-auto grid max-w-7xl gap-7 overflow-hidden rounded-[26px] bg-navy-900 p-6 text-white sm:gap-10 sm:rounded-[36px] sm:p-12 lg:grid-cols-[1.1fr_1fr] lg:p-16">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-400 sm:text-xs">For organisers</p>
            <h2 className="mt-2.5 font-event-display text-[22px] font-semibold leading-tight tracking-tight sm:mt-3 sm:text-[44px]">Host events people remember.</h2>
            <p className="mt-3 max-w-lg text-[14px] leading-[1.6] text-ivory-300 sm:mt-4 sm:text-lg sm:leading-relaxed">Create a beautiful event page, take registrations, check people in at the door, and keep every attendee in your SYNAPSE contacts.</p>
            <button type="button" onClick={host} className="mt-5 inline-flex items-center gap-2 rounded-full bg-gold-400 px-5 py-2.5 text-[14px] font-semibold sm:mt-8 sm:px-6 sm:py-3 sm:text-[15px] text-navy-900 hover:bg-gold-300">
              Create your event <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <ul className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <Feature icon={<Ticket className="h-5 w-5" />} title="Ticket types" text="Free, VIP, early bird, each with its own price and capacity." />
            <Feature icon={<ClipboardList className="h-5 w-5" />} title="Your questions" text="Ask what you need: dietary needs, T-shirt size, church, company." />
            <Feature icon={<QrCode className="h-5 w-5" />} title="QR check-in" text="Scan tickets with your phone or type the PIN. Works with many doors at once." />
            <Feature icon={<Contact className="h-5 w-5" />} title="Straight into your CRM" text="Every attendee lands in Contacts, ready for follow-up." />
            <Feature icon={<BarChart3 className="h-5 w-5" />} title="Live numbers" text="Registrations, check-ins and spaces left, per ticket." />
            <Feature icon={<Download className="h-5 w-5" />} title="Export anytime" text="Download your attendee list as a spreadsheet." />
          </ul>
        </div>
      </section>
    </EventsShell>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="font-event-display text-[19px] font-semibold text-navy-900 sm:text-3xl">{value.toLocaleString()}</dd>
      <dd className="mt-0.5 text-[11px] leading-tight text-ivory-700 sm:mt-0 sm:text-sm">{label}</dd>
    </div>
  );
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full font-semibold transition',
        small ? 'px-3 py-1 text-[12px] sm:px-3.5 sm:py-1.5 sm:text-[13px]' : 'px-3.5 py-1.5 text-[13px] sm:px-4 sm:py-2 sm:text-sm',
        on ? 'bg-navy-800 text-white' : 'bg-white text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50',
      )}
    >
      {children}
    </button>
  );
}

function Step({ n, icon, title, text }: { n: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-[22px] border border-navy-100 p-5 sm:rounded-[28px] sm:p-7">
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-50 text-gold-700 sm:h-11 sm:w-11 sm:rounded-2xl [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-5 sm:[&>svg]:w-5">{icon}</span>
        <span className="font-event-display text-[12px] font-semibold text-ivory-500 sm:text-sm">{n}</span>
      </div>
      <h3 className="mt-4 font-event-display text-[17px] font-semibold text-navy-900 sm:mt-6 sm:text-xl">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ivory-700 sm:mt-2 sm:text-base sm:leading-relaxed">{text}</p>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <li className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-inset ring-white/10 sm:rounded-3xl sm:p-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-400/15 text-gold-300 sm:h-10 sm:w-10 sm:rounded-xl [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-5 sm:[&>svg]:w-5">{icon}</span>
      <p className="mt-3 text-[13.5px] font-semibold leading-snug sm:mt-4 sm:text-base">{title}</p>
      <p className="mt-1 text-[12px] leading-[1.5] text-ivory-400 sm:text-sm sm:leading-relaxed">{text}</p>
    </li>
  );
}

