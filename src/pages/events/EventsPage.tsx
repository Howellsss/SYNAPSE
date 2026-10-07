import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink, MapPin, Plus, Ticket, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/lib/router';
import { DEFAULT_COVER, NOT_SET_UP, eventDateLine, listEvents, placeLine, type EventSummary } from '@/lib/events';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/utils';

type Tab = 'upcoming' | 'drafts' | 'past' | 'all';

/** /events: the account's events, with live registration numbers. */
export function EventsPage() {
  const { workspace } = useAuth();
  const [, navigate] = useRouter();
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');

  const load = () => {
    if (!workspace) return;
    setError(null);
    listEvents(workspace.id).then(({ data, error: err }) => { setEvents(data); setError(err); });
  };
  useEffect(load, [workspace]);

  const now = Date.now();
  const groups = useMemo(() => {
    const all = events ?? [];
    const upcoming = all.filter((e) => e.status !== 'draft' && new Date(e.ends_at).getTime() >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return {
      upcoming,
      drafts: all.filter((e) => e.status === 'draft'),
      past: all.filter((e) => e.status !== 'draft' && new Date(e.ends_at).getTime() < now),
      all,
    };
  }, [events, now]);
  const shown = groups[tab];
  const live = groups.upcoming.filter((e) => e.status === 'published');
  const totals = {
    upcoming: live.length,
    registered: live.reduce((n, e) => n + e.registered, 0),
    checkedIn: (events ?? []).reduce((n, e) => n + e.checked_in, 0),
    drafts: groups.drafts.length,
  };

  return (
    <div className="mx-auto max-w-[1180px] pb-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] font-bold tracking-[-0.032em] text-navy-800 sm:text-[44px]">Events</h1>
          <p className="mt-1 text-[17px] text-ivory-700">Publish an event page, take registrations, and check people in with a QR code.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/e" target="_blank" rel="noreferrer" className="flex h-11 items-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 transition hover:bg-navy-50"><ExternalLink className="h-4 w-4" /> Public events page</a>
          <button type="button" onClick={() => navigate('/events/new')} className="flex h-11 items-center gap-1.5 rounded-full bg-navy-800 px-5 text-[15px] font-semibold text-white transition hover:bg-navy-700"><Plus className="h-4 w-4" /> New event</button>
        </div>
      </div>

      {error === NOT_SET_UP ? (
        <div className="card p-8 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-gold-500" />
          <h2 className="mt-4 text-xl font-semibold text-navy-800">Events need one database update</h2>
          <p className="mx-auto mt-2 max-w-lg text-ivory-700">Apply the migration <code className="rounded bg-navy-50 px-1.5 py-0.5 text-sm">20261005100000_add_events.sql</code> in Supabase (SQL editor), then refresh this page.</p>
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-navy-100 bg-sand lg:grid-cols-4">
            <Metric label="Upcoming events" value={totals.upcoming} />
            <Metric label="Registered (upcoming)" value={totals.registered} />
            <Metric label="Checked in (all time)" value={totals.checkedIn} />
            <Metric label="Drafts" value={totals.drafts} />
          </div>

          <div className="mb-5 inline-flex rounded-full bg-white p-1 ring-1 ring-inset ring-navy-100" role="tablist" aria-label="Show">
            {(['upcoming', 'drafts', 'past', 'all'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn('rounded-full px-4 py-1.5 text-sm capitalize transition', tab === t ? 'bg-navy-800 font-semibold text-white' : 'font-medium text-navy-700 hover:bg-navy-50')}
              >
                {t} <span className={cn('ml-0.5 text-xs', tab === t ? 'text-white/70' : 'text-ivory-600')}>{groups[t].length}</span>
              </button>
            ))}
          </div>

          {events === null ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-[20px] bg-navy-50" />)}</div>
          ) : shown.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<CalendarDays className="h-6 w-6" />}
                title={tab === 'drafts' ? 'No drafts' : tab === 'past' ? 'No past events yet' : 'No events yet'}
                description={tab === 'upcoming' || tab === 'all' ? 'Create your first event. You can save it as a draft and publish when it’s ready.' : undefined}
                action={tab === 'upcoming' || tab === 'all' ? <button type="button" onClick={() => navigate('/events/new')} className="btn-primary"><Plus className="h-4 w-4" /> New event</button> : undefined}
              />
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((e) => <EventRow key={e.id} e={e} onOpen={() => navigate(`/events/${e.id}`)} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-[13px] font-medium text-ivory-700">{label}</p>
      <p className="mt-1 font-display text-[28px] font-semibold tracking-tight text-navy-800">{value.toLocaleString()}</p>
    </div>
  );
}

export function StatusBadge({ e }: { e: Pick<EventSummary, 'status' | 'ends_at' | 'visibility'> }) {
  const past = new Date(e.ends_at).getTime() < Date.now();
  const [label, cls] = e.status === 'draft' ? ['Draft', 'bg-navy-50 text-navy-700']
    : e.status === 'cancelled' ? ['Cancelled', 'bg-burgundy-50 text-burgundy-700']
      : past ? ['Ended', 'bg-navy-50 text-ivory-700']
        : e.visibility === 'unlisted' ? ['Live · unlisted', 'bg-green-50 text-green-700'] : ['Live', 'bg-green-50 text-green-700'];
  return <span className={cn('status-pill', cls)}>{label}</span>;
}

function EventRow({ e, onOpen }: { e: EventSummary; onOpen: () => void }) {
  const pct = e.capacity ? Math.min(100, Math.round((e.registered / e.capacity) * 100)) : null;
  return (
    <li>
      <button type="button" onClick={onOpen} className="card card-hover flex w-full items-center gap-4 p-3 text-left sm:gap-5 sm:p-4">
        <img src={e.cover_url || DEFAULT_COVER} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover sm:h-24 sm:w-32" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[17px] font-semibold text-navy-800">{e.title}</h3>
            <StatusBadge e={e} />
          </div>
          <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-ivory-700"><CalendarDays className="h-3.5 w-3.5 shrink-0" />{eventDateLine(e.starts_at, e.ends_at, e.timezone)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-ivory-700"><MapPin className="h-3.5 w-3.5 shrink-0" />{placeLine(e)}</p>
        </div>
        <div className="hidden w-48 shrink-0 md:block">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-navy-800"><Users className="h-4 w-4 text-ivory-600" />{e.registered}{e.capacity ? ` / ${e.capacity}` : ''}</span>
            <span className="inline-flex items-center gap-1 text-xs text-ivory-700"><Ticket className="h-3.5 w-3.5" />{e.checked_in} in</span>
          </div>
          {pct !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-50"><div className="h-full rounded-full bg-gold-400" style={{ width: `${pct}%` }} /></div>}
        </div>
      </button>
    </li>
  );
}
