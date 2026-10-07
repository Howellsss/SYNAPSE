import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Ban, CalendarDays, Camera, CameraOff, CheckCircle2, Copy, Download, ExternalLink, MapPin, MoreHorizontal, Pencil,
  RotateCcw, Search, Trash2, Undo2, Users, XCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import {
  DEFAULT_COVER, deleteEvent, downloadFile, eventDateLine, eventUrl, formatPrice, getEvent, listRegistrations, placeLine,
  registrationsCsv, setEventStatus, tokenFromScan, updateRegistration, type EventTicket, type HostEvent, type Registration,
} from '@/lib/events';
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
            <CheckIn regs={regs} tickets={tickets} checkedIn={checkedIn} total={confirmed.length} onPatch={patchReg} />
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

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function CheckIn({ regs, tickets, checkedIn, total, onPatch }: {
  regs: Registration[]; tickets: EventTicket[]; checkedIn: number; total: number; onPatch: (id: string, p: Partial<Registration>) => void;
}) {
  const [pin, setPin] = useState('');
  const [found, setFound] = useState<{ reg: Registration | null; how: string; already?: string | null } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const regsRef = useRef(regs);
  regsRef.current = regs;
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  const ticketName = (id: string | null) => tickets.find((t) => t.id === id)?.name ?? '';

  // Look someone up and check them in straight away (unless already in, cancelled or unpaid).
  const admit = useCallback((reg: Registration | undefined, how: string) => {
    if (!reg) { setFound({ reg: null, how }); return; }
    const already = reg.checked_in_at;
    setFound({ reg, how, already });
    if (!already && reg.status === 'confirmed' && reg.payment_status !== 'unpaid') onPatch(reg.id, { checked_in_at: new Date().toISOString() });
  }, [onPatch]);

  const byPin = (value: string) => {
    const p = value.replace(/\D/g, '').slice(0, 6);
    setPin(p);
    if (p.length === 6) { admit(regsRef.current.find((r) => r.pin === p), `PIN ${p}`); setPin(''); }
  };

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);
  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!scanning || !Detector) return;
    let alive = true;
    let last = '';
    const detector = new Detector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        try {
          const codes = await detector.detect(v);
          const raw = codes[0]?.rawValue;
          if (raw && raw !== last) {
            last = raw;
            const token = tokenFromScan(raw);
            admit(token ? regsRef.current.find((r) => r.qr_token === token) : undefined, 'QR code');
            window.setTimeout(() => { last = ''; }, 3000);
          }
        } catch { /* keep scanning */ }
      }
      window.setTimeout(() => { void tick(); }, 350);
    };
    void tick();
    return () => { alive = false; };
  }, [scanning, Detector, admit]);

  const start = async () => {
    setScanError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = s;
      setScanning(true);
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play().catch(() => {}); } });
    } catch {
      setScanError('Camera unavailable. Allow camera access, or use the PIN.');
    }
  };

  const r = found?.reg;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-800">Check guests in</h2>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-navy-50 px-3 py-1 text-sm font-semibold text-navy-800" aria-live="polite"><Users className="h-4 w-4" />{checkedIn} / {total} in</span>
        </div>

        <label className="mt-5 block">
          <span className="text-sm font-semibold text-navy-800">Type the 6-digit PIN</span>
          <input
            value={pin}
            onChange={(e) => byPin(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••••"
            aria-label="Ticket PIN"
            className="mt-2 h-16 w-full rounded-2xl border border-navy-100 text-center font-event-display text-3xl tracking-[0.4em] text-navy-900 outline-none focus:border-gold-400 focus:ring-4 focus:ring-gold-400/20"
          />
        </label>

        <div className="mt-6 border-t border-navy-100 pt-6">
          <p className="text-sm font-semibold text-navy-800">Or scan the ticket QR</p>
          {Detector ? (
            <>
              <div className={cn('relative mt-3 overflow-hidden rounded-2xl bg-navy-900', scanning ? 'aspect-square sm:aspect-video' : 'hidden')}>
                <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
                <span className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-gold-400/90" aria-hidden="true" />
              </div>
              <button type="button" onClick={() => { if (scanning) stop(); else void start(); }} className={cn('mt-3 flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold', scanning ? 'text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50' : 'bg-navy-800 text-white hover:bg-navy-700')}>
                {scanning ? <><CameraOff className="h-4 w-4" /> Stop camera</> : <><Camera className="h-4 w-4" /> Scan with camera</>}
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm text-ivory-700">This browser can't read QR codes. Use Chrome on Android or a Mac, or type the PIN shown on the ticket.</p>
          )}
          {scanError && <p role="alert" className="mt-2 text-sm text-burgundy-600">{scanError}</p>}
        </div>
      </section>

      <section className="card flex min-h-[320px] flex-col items-center justify-center p-6 text-center" aria-live="assertive">
        {!found ? (
          <>
            <CheckCircle2 className="h-12 w-12 text-navy-100" />
            <p className="mt-3 text-ivory-700">Results appear here.</p>
          </>
        ) : !r ? (
          <>
            <XCircle className="h-14 w-14 text-burgundy-500" />
            <p className="mt-3 text-xl font-semibold text-navy-800">No ticket found</p>
            <p className="mt-1 text-sm text-ivory-700">{found.how} doesn't match anyone registered for this event.</p>
          </>
        ) : r.status === 'cancelled' ? (
          <>
            <XCircle className="h-14 w-14 text-burgundy-500" />
            <p className="mt-3 text-xl font-semibold text-navy-800">{r.first_name} {r.last_name}</p>
            <p className="mt-1 font-semibold text-burgundy-600">This registration was cancelled.</p>
          </>
        ) : found.already ? (
          <>
            <CheckCircle2 className="h-14 w-14 text-gold-500" />
            <p className="mt-3 text-xl font-semibold text-navy-800">{r.first_name} {r.last_name}</p>
            <p className="mt-1 font-semibold text-gold-700">Already checked in at {new Date(found.already).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</p>
            <p className="mt-1 text-sm text-ivory-700">{ticketName(r.ticket_id)}</p>
          </>
        ) : r.payment_status === 'unpaid' ? (
          <>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-50 font-event-display text-lg font-semibold text-gold-800">₦</span>
            <p className="mt-3 text-xl font-semibold text-navy-800">{r.first_name} {r.last_name}</p>
            <p className="mt-1 text-sm text-ivory-700">{ticketName(r.ticket_id)}</p>
            <p className="mt-3 font-semibold text-gold-800">Collect {formatPrice(r.amount_minor, tickets.find((t) => t.id === r.ticket_id)?.currency)} before entry</p>
            <button type="button" onClick={() => { onPatch(r.id, { payment_status: 'paid', checked_in_at: new Date().toISOString() }); setFound({ reg: { ...r, payment_status: 'paid' }, how: found.how, already: null }); }} className="mt-4 h-[38px] rounded-lg bg-gold-400 px-4 text-sm font-semibold text-navy-900 hover:bg-gold-300">Paid · check in</button>
          </>
        ) : (
          <>
            <CheckCircle2 className="h-14 w-14 text-green-600" />
            <p className="mt-3 text-xl font-semibold text-navy-800">{r.first_name} {r.last_name}</p>
            <p className="mt-1 font-semibold text-green-700">Checked in</p>
            <p className="mt-1 text-sm text-ivory-700">{ticketName(r.ticket_id)} · via {found.how}</p>
            <button type="button" onClick={() => { onPatch(r.id, { checked_in_at: null }); setFound(null); }} className="mt-4 text-sm font-semibold text-ivory-700 hover:text-navy-800">Undo</button>
          </>
        )}
      </section>
    </div>
  );
}
