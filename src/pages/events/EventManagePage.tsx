import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Ban, CalendarDays, CheckCircle2, Copy, Download, ExternalLink, MapPin, MoreHorizontal, Pencil,
  RotateCcw, ScanLine, Search, Trash2, Undo2, Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import {
  DEFAULT_COVER, deleteEvent, downloadFile, eventDateLine, eventUrl, formatPrice, getEvent, listRegistrations, placeLine,
  registrationsCsv, setEventStatus, updateRegistration, type EventTicket, type HostEvent, type Registration,
} from '@/lib/events';
import { checkIn, checkInLog, checkInPath, invalidText, listCheckInStaff, setCheckInStaff, undoCheckIn, type CheckInLogEntry, type StaffMember } from '@/lib/checkin';
import { publicOrigin } from '@/lib/publicUrl';
import { useEventFonts } from '@/components/events/hooks';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingSpinner } from '@/components/ui/States';
import { Popover } from '@/components/spaces/room/Popover';
import { StatusBadge } from './EventsPage';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'attendees' | 'checkin';

/** /events/<id>: numbers, attendees and door check-in for one event. */
export function EventManagePage({ eventId }: { eventId: string }) {
  useEventFonts();
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [event, setEvent] = useState<HostEvent | null | undefined>(undefined);
  const [tickets, setTickets] = useState<EventTicket[]>([]);
  const [regs, setRegs] = useState<Registration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [confirm, setConfirm] = useState<null | 'cancel' | 'delete'>(null);

  const loadRegs = useCallback(async () => {
    const { data, error: err } = await listRegistrations(eventId);
    if (!err) setRegs(data);
  }, [eventId]);

  const load = useCallback(async () => {
    const { event: e, tickets: ts, error: err } = await getEvent(eventId);
    setEvent(e); setTickets(ts); setError(err);
    await loadRegs();
  }, [eventId, loadRegs]);

  useEffect(() => { void load(); }, [load]);
  // Keep counts fresh when several people are checking guests in.
  useEffect(() => { const t = window.setInterval(() => { void loadRegs(); }, 10000); return () => window.clearInterval(t); }, [loadRegs]);

  const patchReg = async (id: string, patch: Partial<Pick<Registration, 'checked_in_at' | 'payment_status' | 'status'>>) => {
    setRegs((rs) => rs?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? rs);
    // Check-ins and undos go through the door's check-in log, like a scan.
    if ('checked_in_at' in patch) {
      const { checked_in_at: at, ...rest } = patch;
      try {
        if (at) {
          const a = await checkIn(eventId, { registration: id, paid: rest.payment_status === 'paid' });
          if (a.result === 'not_eligible') toast(a.reason === 'unpaid' ? 'This ticket isn’t paid yet: mark it paid first.' : invalidText(a.reason), 'error');
        }
        else await undoCheckIn(eventId, id);
      } catch (e) { toast((e as Error).message === 'offline' ? 'No connection. Try again.' : (e as Error).message, 'error'); }
      void loadRegs();
      if (Object.keys(rest).length === 0 || rest.payment_status === 'paid') return;
      patch = rest;
    }
    const { error: err } = await updateRegistration(id, patch);
    if (err) { toast(err, 'error'); void loadRegs(); }
  };

  if (event === undefined && !error) return <div className="flex justify-center py-24"><LoadingSpinner className="h-10 w-10" /></div>;
  if (error || !event || (workspace && event.workspace_id !== workspace.id)) {
    return <div className="mx-auto max-w-lg py-16"><ErrorState message={error ?? 'Event not found.'} onRetry={() => { void load(); }} /></div>;
  }

  const confirmed = (regs ?? []).filter((r) => r.status === 'confirmed');
  const checkedIn = confirmed.filter((r) => r.checked_in_at).length;
  const capacity = tickets.length && tickets.every((t) => t.capacity) ? tickets.reduce((n, t) => n + (t.capacity ?? 0), 0) : null;
  const unpaid = confirmed.filter((r) => r.payment_status === 'unpaid');
  const currency = tickets[0]?.currency ?? 'NGN';
  const url = eventUrl(event.slug);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Could not copy the link', 'error'); } };
  const exportCsv = () => downloadFile(`${event.slug}-attendees.csv`, registrationsCsv(regs ?? [], tickets, event.questions ?? []), 'text/csv');

  const changeStatus = async (status: HostEvent['status']) => {
    const { error: err } = await setEventStatus(event.id, status);
    if (err) { toast(err, 'error'); return; }
    setEvent({ ...event, status });
    toast(status === 'published' ? 'Event published' : status === 'draft' ? 'Moved back to drafts' : 'Event cancelled');
  };

  return (
    <div className="w-full pb-6">
      <button type="button" onClick={() => navigate('/events')} className="mb-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"><ArrowLeft className="h-4 w-4" /> Events</button>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <img src={event.cover_url || DEFAULT_COVER} alt="" className="h-28 w-full shrink-0 rounded-xl object-cover sm:h-28 sm:w-40" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge e={event} /></div>
          <h1 className="mt-2 font-display text-[24px] font-bold leading-tight tracking-[-0.03em] text-navy-800 sm:text-[24px]">{event.title}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[15px] text-ivory-700"><CalendarDays className="h-4 w-4 shrink-0" />{eventDateLine(event.starts_at, event.ends_at, event.timezone)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[15px] text-ivory-700"><MapPin className="h-4 w-4 shrink-0" />{placeLine(event)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {event.status === 'published' && <a href={url} target="_blank" rel="noreferrer" className="flex h-[38px] items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><ExternalLink className="h-4 w-4" /> View page</a>}
          <button type="button" onClick={() => navigate(`/events/${event.id}/edit`)} className="flex h-[38px] items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><Pencil className="h-4 w-4" /> Edit</button>
          {event.status === 'draft' && <button type="button" onClick={() => { void changeStatus('published'); }} className="flex h-[38px] items-center rounded-lg bg-gold-400 px-4 text-sm font-semibold text-navy-900 hover:bg-gold-300">Publish</button>}
          <Popover
            label="Event actions"
            panelClassName="right-0 top-full mt-2 w-56"
            trigger={({ open, toggle }) => <button type="button" onClick={toggle} aria-expanded={open} aria-label="More actions" className="flex h-10 w-10 items-center justify-center rounded-lg ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><MoreHorizontal className="h-4 w-4" /></button>}
          >
            {(close) => (
              <>
                <MenuItem icon={<Copy className="h-4 w-4" />} onClick={() => { close(); void copy(); }}>Copy event link</MenuItem>
                <MenuItem icon={<Download className="h-4 w-4" />} onClick={() => { close(); exportCsv(); }}>Export attendees (CSV)</MenuItem>
                {event.status === 'published' && <MenuItem icon={<Undo2 className="h-4 w-4" />} onClick={() => { close(); void changeStatus('draft'); }}>Unpublish</MenuItem>}
                {event.status === 'cancelled' && <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => { close(); void changeStatus('published'); }}>Reopen event</MenuItem>}
                {event.status !== 'cancelled' && <MenuItem danger icon={<Ban className="h-4 w-4" />} onClick={() => { close(); setConfirm('cancel'); }}>Cancel event</MenuItem>}
                <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { close(); setConfirm('delete'); }}>Delete event</MenuItem>
              </>
            )}
          </Popover>
        </div>
      </div>

      {event.status === 'draft' && (
        <p className="mt-5 rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-900">This event is a draft. Only your team can see it. Publish it to open registration at <span className="font-semibold">{url}</span>.</p>
      )}

      <div className="mt-6 inline-flex rounded-full bg-white p-1 ring-1 ring-inset ring-navy-100" role="tablist" aria-label="Sections">
        {([['overview', 'Overview'], ['attendees', `Attendees ${confirmed.length}`], ['checkin', 'Check-in']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('rounded-md px-4 py-1.5 text-sm transition', tab === id ? 'bg-navy-800 font-semibold text-white' : 'font-medium text-navy-700 hover:bg-navy-50')}>{label}</button>
        ))}
      </div>

      <div className="mt-6">
        {regs === null ? <div className="flex justify-center py-16"><LoadingSpinner className="h-8 w-8" /></div>
          : tab === 'overview' ? (
            <Overview tickets={tickets} regs={confirmed} capacity={capacity} checkedIn={checkedIn} unpaidTotal={unpaid.reduce((n, r) => n + r.amount_minor, 0)} unpaidCount={unpaid.length} currency={currency} onSeeAll={() => setTab('attendees')} />
          ) : tab === 'attendees' ? (
            <Attendees regs={regs} tickets={tickets} onPatch={patchReg} onExport={exportCsv} />
          ) : (
            <CheckInTab eventId={event.id} checkedIn={checkedIn} total={confirmed.length} />
          )}
      </div>

      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void changeStatus('cancelled'); }}
        title="Cancel this event?"
        message="Registration closes and the event page and tickets say it's cancelled. Let your attendees know; you can export their emails first."
        confirmLabel="Cancel event"
        cancelLabel="Keep it"
        danger
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          const { error: err } = await deleteEvent(event.id);
          if (err) { toast(err, 'error'); return; }
          toast('Event deleted');
          navigate('/events');
        }}
        title="Delete this event?"
        message={`This permanently removes the event and its ${confirmed.length} registration${confirmed.length === 1 ? '' : 's'}. Attendees stay in Contacts. This can't be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function MenuItem({ icon, danger, onClick, children }: { icon: React.ReactNode; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-navy-50', danger ? 'text-burgundy-600' : 'text-navy-800')}>
      {icon}{children}
    </button>
  );
}

// ---------------------------------------------------------------- overview

function Overview({ tickets, regs, capacity, checkedIn, unpaidTotal, unpaidCount, currency, onSeeAll }: {
  tickets: EventTicket[]; regs: Registration[]; capacity: number | null; checkedIn: number; unpaidTotal: number; unpaidCount: number; currency: string; onSeeAll: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-navy-100 bg-sand lg:grid-cols-4">
        <Metric label="Registered" value={regs.length.toLocaleString()} />
        <Metric label="Checked in" value={`${checkedIn.toLocaleString()}${regs.length ? ` (${Math.round((checkedIn / regs.length) * 100)}%)` : ''}`} />
        <Metric label="Places left" value={capacity === null ? 'No limit' : Math.max(0, capacity - regs.length).toLocaleString()} />
        <Metric label="To collect at the door" value={unpaidTotal ? formatPrice(unpaidTotal, currency) : '—'} sub={unpaidCount ? `${unpaidCount} unpaid` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-navy-800">Tickets</h2>
          <ul className="mt-4 space-y-4">
            {tickets.map((t) => {
              const n = regs.filter((r) => r.ticket_id === t.id).length;
              const pct = t.capacity ? Math.min(100, Math.round((n / t.capacity) * 100)) : null;
              return (
                <li key={t.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold text-navy-800">{t.name} <span className="font-normal text-ivory-700">· {formatPrice(t.price_minor, t.currency)}</span></span>
                    <span className="font-semibold text-navy-800">{n}{t.capacity ? ` / ${t.capacity}` : ''}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-navy-50"><div className="h-full rounded-full bg-gold-400" style={{ width: `${pct ?? (n ? 100 : 0)}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-navy-800">Latest registrations</h2>
            {regs.length > 0 && <button type="button" onClick={onSeeAll} className="text-sm font-semibold text-gold-700 hover:text-gold-800">See all</button>}
          </div>
          {regs.length ? (
            <ul className="mt-3 divide-y divide-navy-100">
              {regs.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0"><span className="block truncate font-semibold text-navy-800">{r.first_name} {r.last_name}</span><span className="block truncate text-ivory-700">{r.email}</span></span>
                  <span className="shrink-0 text-xs text-ivory-700">{new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-ivory-700">No registrations yet. Share your event link to get started.</p>}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-[13px] font-medium text-ivory-700">{label}</p>
      <p className="mt-1 font-display text-[26px] font-semibold tracking-tight text-navy-800">{value}</p>
      {sub && <p className="text-xs text-ivory-700">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- attendees

function Attendees({ regs, tickets, onPatch, onExport }: {
  regs: Registration[]; tickets: EventTicket[]; onPatch: (id: string, p: Partial<Registration>) => void; onExport: () => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'in' | 'out' | 'unpaid' | 'cancelled'>('all');
  const ticketName = (id: string | null) => tickets.find((t) => t.id === id)?.name ?? '—';
  const shown = regs.filter((r) => {
    if (filter === 'cancelled' ? r.status !== 'cancelled' : r.status === 'cancelled') return false;
    if (filter === 'in' && !r.checked_in_at) return false;
    if (filter === 'out' && r.checked_in_at) return false;
    if (filter === 'unpaid' && r.payment_status !== 'unpaid') return false;
    const s = q.trim().toLowerCase();
    return !s || `${r.first_name} ${r.last_name} ${r.email} ${r.phone} ${r.pin}`.toLowerCase().includes(s);
  });

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-navy-100 p-4 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2 rounded-lg px-4 ring-1 ring-inset ring-navy-100 focus-within:ring-gold-400">
          <Search className="h-4 w-4 text-ivory-600" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or PIN" aria-label="Search attendees" className="h-10 w-full bg-transparent text-sm outline-none" />
        </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter" className="h-[38px] rounded-lg bg-white px-4 text-sm font-medium text-navy-800 ring-1 ring-inset ring-navy-100">
          <option value="all">Everyone</option><option value="in">Checked in</option><option value="out">Not checked in</option><option value="unpaid">Pay at door</option><option value="cancelled">Cancelled</option>
        </select>
        <button type="button" onClick={onExport} disabled={!regs.length} className="flex h-[38px] items-center justify-center gap-1.5 rounded-lg bg-navy-800 px-4 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50"><Download className="h-4 w-4" /> Export CSV</button>
      </div>
      {shown.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-ivory-700">{regs.length ? 'Nobody matches.' : 'No registrations yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs font-semibold uppercase tracking-wider text-ivory-700">
              <tr><th className="px-5 py-3">Name</th><th className="px-3 py-3">Ticket</th><th className="px-3 py-3">PIN</th><th className="px-3 py-3">Payment</th><th className="px-3 py-3">Check-in</th><th className="px-3 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3"><p className="font-semibold text-navy-800">{r.first_name} {r.last_name}</p><p className="text-ivory-700">{r.email}{r.phone ? ` · ${r.phone}` : ''}</p></td>
                  <td className="px-3 py-3 text-navy-700">{ticketName(r.ticket_id)}</td>
                  <td className="px-3 py-3 font-mono text-navy-700">{r.pin}</td>
                  <td className="px-3 py-3">
                    {r.payment_status === 'free' ? <span className="text-ivory-700">Free</span>
                      : r.payment_status === 'paid' ? <span className="status-pill bg-green-50 text-green-700">Paid</span>
                        : <button type="button" onClick={() => onPatch(r.id, { payment_status: 'paid' })} className="status-pill bg-gold-50 text-gold-800 hover:bg-gold-100">Unpaid · mark paid</button>}
                  </td>
                  <td className="px-3 py-3">
                    {r.status === 'cancelled' ? <span className="text-ivory-700">Cancelled</span> : r.checked_in_at
                      ? <button type="button" onClick={() => onPatch(r.id, { checked_in_at: null })} title="Undo check-in" className="status-pill bg-green-50 text-green-700 hover:bg-green-100"><CheckCircle2 className="h-3.5 w-3.5" /> {new Date(r.checked_in_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</button>
                      : <button type="button" onClick={() => onPatch(r.id, { checked_in_at: new Date().toISOString() })} className="status-pill bg-white text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Check in</button>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {r.status === 'confirmed'
                      ? <button type="button" onClick={() => onPatch(r.id, { status: 'cancelled' })} className="text-xs font-semibold text-ivory-700 hover:text-burgundy-600">Cancel</button>
                      : <button type="button" onClick={() => onPatch(r.id, { status: 'confirmed' })} className="text-xs font-semibold text-ivory-700 hover:text-navy-800">Restore</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- check-in

/** The Check-in tab: open the door scanner, choose the check-in team, and see the latest scans. */
function CheckInTab({ eventId, checkedIn, total }: { eventId: string; checkedIn: number; total: number }) {
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [log, setLog] = useState<CheckInLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const link = `${publicOrigin()}${checkInPath(eventId)}`;

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([listCheckInStaff(eventId), checkInLog(eventId, 20)]);
      setStaff(s); setLog(l); setError(null);
    } catch (e) { setError((e as Error).message === 'offline' ? 'No connection. Check your internet and try again.' : (e as Error).message); }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = window.setInterval(() => { void checkInLog(eventId, 20).then(setLog).catch(() => {}); }, 15000); return () => window.clearInterval(t); }, [eventId]);

  const toggle = async (m: StaffMember) => {
    setSaving(m.user_id);
    try {
      await setCheckInStaff(eventId, m.user_id, !m.on_team);
      setStaff((list) => list?.map((x) => (x.user_id === m.user_id ? { ...x, on_team: !m.on_team } : x)) ?? list);
      toast(m.on_team ? `${m.name} removed from the check-in team` : `${m.name} can now check guests in`);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(null); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Scanner link copied'); } catch { toast('Could not copy the link', 'error'); } };

  const team = (staff ?? []).filter((m) => !m.organiser);
  const organisers = (staff ?? []).filter((m) => m.organiser);
  const label: Record<CheckInLogEntry['result'], [string, string]> = {
    success: ['Checked in', 'bg-green-50 text-green-800'],
    already_checked_in: ['Already in', 'bg-amber-50 text-amber-800'],
    invalid: ['Not valid', 'bg-red-50 text-red-700'],
    not_eligible: ['Turned away', 'bg-red-50 text-red-700'],
    undone: ['Undone', 'bg-navy-50 text-navy-700'],
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col gap-6">
        <section className="card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-navy-800">Door scanner</h2>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-navy-50 px-3 py-1 text-sm font-semibold text-navy-800" aria-live="polite"><Users className="h-4 w-4" />{checkedIn} / {total} in</span>
          </div>
          <p className="mt-2 text-[15px] text-ivory-700">Open it on a phone at the door. It reads ticket QR codes (iPhone and Android), and you can search by name, email, phone, ticket code or PIN.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate(checkInPath(eventId))} className="flex h-11 items-center gap-2 rounded-lg bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700"><ScanLine className="h-4 w-4" /> Open the scanner</button>
            <button type="button" onClick={() => { void copy(); }} className="flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><Copy className="h-4 w-4" /> Copy link for your team</button>
          </div>
          <p className="mt-3 text-sm text-ivory-700">Your team signs in to SYNAPSE, then opens the link. Only people on the check-in team below (and organisers) can use it.</p>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-navy-800">Check-in team</h2>
          <p className="mt-1 text-[15px] text-ivory-700">People in your account who can check guests in for this event, even without access to Events.</p>
          {error ? <p role="alert" className="mt-4 text-sm text-burgundy-700">{error}</p>
            : staff === null ? <div className="flex justify-center py-6"><LoadingSpinner className="h-6 w-6" /></div>
            : (
              <ul className="mt-4 divide-y divide-navy-50">
                {team.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold text-navy-800">{m.name}</p><p className="truncate text-sm text-ivory-700">{m.email}</p></div>
                    <button type="button" role="switch" aria-checked={m.on_team} aria-label={`${m.name} on the check-in team`} disabled={saving === m.user_id} onClick={() => { void toggle(m); }}
                      className={cn('relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50', m.on_team ? 'bg-green-600' : 'bg-navy-100')}>
                      <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', m.on_team ? 'left-6' : 'left-1')} />
                    </button>
                  </li>
                ))}
                {team.length === 0 && <li className="py-3 text-sm text-ivory-700">Everyone in your account can already manage events. Invite people in Settings → Team to add door staff.</li>}
              </ul>
            )}
          {organisers.length > 0 && <p className="mt-3 text-sm text-ivory-700">Organisers (always allowed): {organisers.map((m) => m.name).join(', ')}</p>}
        </section>
      </div>

      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-navy-800">Latest scans</h2>
          <button type="button" onClick={() => { void load(); }} className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-navy-700 hover:bg-navy-50"><RotateCcw className="h-4 w-4" /> Refresh</button>
        </div>
        {log === null ? (error ? null : <div className="flex justify-center py-6"><LoadingSpinner className="h-6 w-6" /></div>)
          : log.length === 0 ? <p className="mt-4 text-[15px] text-ivory-700">Nothing scanned yet. Every scan, search check-in and undo shows here, with who did it.</p>
          : (
            <ul className="mt-3 divide-y divide-navy-50">
              {log.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2.5">
                  <span className={cn('w-[92px] shrink-0 rounded-full px-2.5 py-1 text-center text-xs font-semibold', label[x.result][1])}>{label[x.result][0]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-800">{x.name ?? 'Unknown code'}</p>
                    <p className="truncate text-xs text-ivory-700">{new Date(x.at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}{x.by ? ` · ${x.by}` : ''} · {x.via === 'scan' ? 'scanned' : x.via === 'undo' ? 'undo' : 'by search'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
