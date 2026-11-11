import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Ban, CalendarDays, Copy, Download, ExternalLink, MapPin, MoreHorizontal, Pencil,
  RotateCcw, ScanLine, Trash2, Undo2, Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { DoorPasses } from '@/components/events/DoorPasses';
import {
  DEFAULT_COVER, deleteEvent, downloadFile, eventDateLine, eventUrl, fetchRegistrationForms, formatPrice, getEvent, holdsPlace,
  listRegistrations, placeLine, registrationsCsv, REVIEW_COLUMNS, sendTicket, setEventStatus, setRegistrationStatus, updateRegistration,
  type AnswerField, type EventTicket, type HostEvent, type Registration, type RegistrationStatus, type TypeForm,
} from '@/lib/events';
import { Modal } from '@/components/ui/Modal';
import { RegistrationPanel, type RegActions } from './manage/RegistrationPanel';
import { Registrations } from './manage/Registrations';
import { ReviewBoard } from './manage/ReviewBoard';
import { AddRegistration } from './manage/AddRegistration';
import { checkIn, checkInLog, checkInPath, invalidText, listCheckInStaff, setCheckInStaff, undoCheckIn, type CheckInLogEntry, type StaffMember } from '@/lib/checkin';
import { publicOrigin } from '@/lib/publicUrl';
import { useEventFonts } from '@/components/events/hooks';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingSpinner } from '@/components/ui/States';
import { Popover } from '@/components/spaces/room/Popover';
import { StatusBadge } from './EventsPage';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'registrations' | 'review' | 'checkin';

/** /events/<id>: the organiser's dashboard: numbers, registrations, the performer review board and door check-in. */
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
  const [forms, setForms] = useState<TypeForm[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [change, setChange] = useState<{ reg: Registration; status: RegistrationStatus } | null>(null);
  const [notify, setNotify] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRegs = useCallback(async () => {
    const { data, error: err } = await listRegistrations(eventId);
    if (!err) setRegs(data);
  }, [eventId]);

  const load = useCallback(async () => {
    const { event: e, tickets: ts, error: err } = await getEvent(eventId);
    setEvent(e); setTickets(ts); setError(err);
    await Promise.all([loadRegs(), fetchRegistrationForms(eventId).then((f) => setForms(f.data))]);
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

  const fieldsFor = (ticketId: string | null): AnswerField[] => forms.find((f) => f.ticket_id === ticketId)?.fields ?? [];

  // Status changes go through the database (capacity, ticket codes, emails, audit log).
  const applyStatus = async (reg: Registration, status: RegistrationStatus, send: boolean) => {
    setBusyId(reg.id);
    const { error: err } = await setRegistrationStatus(reg.id, status, send);
    setBusyId(null);
    if (err) { toast(err, 'error'); return; }
    const name = `${reg.first_name} ${reg.last_name}`.trim();
    toast(status === 'selected' ? (send ? `${name} selected: their ticket is on its way` : `${name} selected`)
      : status === 'declined' ? (send ? `${name} declined: the note is on its way` : `${name} declined`)
      : status === 'cancelled' ? `${name}’s registration cancelled`
      : `${name} moved to ${status === 'applied' ? 'Applied' : status === 'shortlisted' ? 'Shortlisted' : status === 'confirmed' ? 'Confirmed' : status}`);
    void loadRegs();
  };
  const actions: RegActions = {
    // Selecting, declining and cancelling ask first; the rest happen straight away.
    setStatus: (reg, status) => {
      if (status === 'selected' || status === 'declined' || status === 'cancelled') { setNotify(true); setChange({ reg, status }); return; }
      void applyStatus(reg, status, false);
    },
    checkIn: (reg, on) => { void patchReg(reg.id, { checked_in_at: on ? new Date().toISOString() : null }); },
    markPaid: (reg) => { void patchReg(reg.id, { payment_status: 'paid' }); },
    send: async (reg) => {
      const { error: err, to } = await sendTicket(reg.id);
      if (err) toast(err, 'error'); else toast(`Sent to ${to ?? reg.email}`);
      void loadRegs();
    },
    open: (reg) => setOpenId(reg.id),
  };

  if (event === undefined && !error) return <div className="flex justify-center py-24"><LoadingSpinner className="h-10 w-10" /></div>;
  if (error || !event || (workspace && event.workspace_id !== workspace.id)) {
    return <div className="mx-auto max-w-lg py-16"><ErrorState message={error ?? 'Event not found.'} onRetry={() => { void load(); }} /></div>;
  }

  // Everyone holding a place (confirmed attendees and selected performers) is expected at the door.
  const confirmed = (regs ?? []).filter((r) => holdsPlace(r.status));
  const checkedIn = confirmed.filter((r) => r.checked_in_at).length;
  const hasApproval = tickets.some((t) => t.requires_approval);
  const toReview = (regs ?? []).filter((r) => r.status === 'applied' || r.status === 'shortlisted').length;
  const allFields = forms.flatMap((f) => f.fields.filter((x) => !x.contact)).filter((f, i, a) => a.findIndex((g) => g.id === f.id) === i);
  const openReg = (regs ?? []).find((r) => r.id === openId) ?? null;
  const capacity = tickets.length && tickets.every((t) => t.capacity) ? tickets.reduce((n, t) => n + (t.capacity ?? 0), 0) : null;
  const unpaid = confirmed.filter((r) => r.payment_status === 'unpaid');
  const currency = tickets[0]?.currency ?? 'NGN';
  const url = eventUrl(event.slug);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Could not copy the link', 'error'); } };
  const exportCsv = (rows: Registration[] = regs ?? []) => downloadFile(`${event.slug}-registrations.csv`, registrationsCsv(rows, tickets, event.questions ?? [], allFields), 'text/csv');

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
                <MenuItem icon={<Download className="h-4 w-4" />} onClick={() => { close(); exportCsv(); }}>Export registrations (CSV)</MenuItem>
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

      <div className="mt-6 inline-flex max-w-full overflow-x-auto rounded-full bg-white p-1 ring-1 ring-inset ring-navy-100" role="tablist" aria-label="Sections">
        {([['overview', 'Overview'], ['registrations', `Registrations ${(regs ?? []).length}`], ...(hasApproval ? [['review', `Review board${toReview ? ` ${toReview}` : ''}`]] : []), ['checkin', 'Check-in']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('shrink-0 whitespace-nowrap rounded-md px-4 py-1.5 text-sm transition', tab === id ? 'bg-navy-800 font-semibold text-white' : 'font-medium text-navy-700 hover:bg-navy-50')}>{label}</button>
        ))}
      </div>

      <div className="mt-6">
        {regs === null ? <div className="flex justify-center py-16"><LoadingSpinner className="h-8 w-8" /></div>
          : tab === 'overview' ? (
            <Overview tickets={tickets} all={regs} regs={confirmed} capacity={capacity} checkedIn={checkedIn} unpaidTotal={unpaid.reduce((n, r) => n + r.amount_minor, 0)} unpaidCount={unpaid.length} currency={currency}
              onSeeAll={() => setTab('registrations')} onReview={() => setTab('review')} onOpen={actions.open} />
          ) : tab === 'registrations' ? (
            <Registrations regs={regs} tickets={tickets} actions={actions} onAdd={() => setAdding(true)} onExport={(rows) => exportCsv(rows)} />
          ) : tab === 'review' ? (
            <ReviewBoard regs={regs} tickets={tickets} fieldsFor={fieldsFor} actions={actions} busyId={busyId} />
          ) : (
            <CheckInTab eventId={event.id} checkedIn={checkedIn} total={confirmed.length} />
          )}
      </div>

      <RegistrationPanel reg={openReg} ticket={tickets.find((t) => t.id === openReg?.ticket_id)} fields={fieldsFor(openReg?.ticket_id ?? null)} onClose={() => setOpenId(null)} actions={actions} busy={busyId === openReg?.id} />
      <AddRegistration open={adding} onClose={() => setAdding(false)} eventId={event.id} tickets={tickets}
        onAdded={(r, emailed) => { setAdding(false); toast(`${r.first_name} added${emailed ? ': ticket emailed' : ''}`); void loadRegs(); }} />
      <Modal open={!!change} onClose={() => setChange(null)} size="sm"
        title={change ? `${change.status === 'selected' ? 'Select' : change.status === 'declined' ? 'Decline' : 'Cancel the registration of'} ${change.reg.first_name} ${change.reg.last_name}?`.replace(/\s+\?$/, '?') : ''}
        footer={change && (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setChange(null)} className="h-10 rounded-lg px-4 text-sm font-semibold text-navy-700 hover:bg-navy-50">Not now</button>
            <button type="button" onClick={() => { const c = change; setChange(null); void applyStatus(c.reg, c.status, notify && c.status !== 'cancelled'); }}
              className={cn('h-10 rounded-lg px-5 text-sm font-semibold text-white', change.status === 'selected' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700')}>
              {change.status === 'selected' ? 'Select' : change.status === 'declined' ? 'Decline' : 'Cancel registration'}
            </button>
          </div>
        )}>
        {change && (
          <div className="space-y-4 text-[15px] text-navy-800">
            <p>{change.status === 'selected' ? 'They get a ticket code and a place at the event.' : change.status === 'declined' ? 'Their application is closed. You can reconsider later from the board.' : 'Their ticket stops working at the door. You can restore it later.'}</p>
            {change.status !== 'cancelled' && (
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-navy-200 accent-navy-800" />
                <span>{change.status === 'selected' ? 'Email them the “You’ve been selected” message with their ticket' : 'Email them the kind “not this time” note'}<span className="block text-sm text-ivory-700">You can change the wording in Edit → Emails.</span></span>
              </label>
            )}
          </div>
        )}
      </Modal>

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

function Overview({ tickets, all, regs, capacity, checkedIn, unpaidTotal, unpaidCount, currency, onSeeAll, onReview, onOpen }: {
  tickets: EventTicket[]; all: Registration[]; regs: Registration[]; capacity: number | null; checkedIn: number; unpaidTotal: number; unpaidCount: number; currency: string;
  onSeeAll: () => void; onReview: () => void; onOpen: (r: Registration) => void;
}) {
  const approval = tickets.filter((t) => t.requires_approval);
  const apps = all.filter((r) => approval.some((t) => t.id === r.ticket_id));
  const toReview = apps.filter((r) => r.status === 'applied' || r.status === 'shortlisted').length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-navy-100 bg-sand lg:grid-cols-4">
        <Metric label="Registered" value={regs.length.toLocaleString()} sub="holding a place" />
        <Metric label="Checked in" value={`${checkedIn.toLocaleString()}${regs.length ? ` (${Math.round((checkedIn / regs.length) * 100)}%)` : ''}`} />
        {approval.length
          ? <Metric label="Applications to review" value={toReview.toLocaleString()} sub={`${apps.length} received`} />
          : <Metric label="Places left" value={capacity === null ? 'No limit' : Math.max(0, capacity - regs.length).toLocaleString()} />}
        <Metric label="To collect at the door" value={unpaidTotal ? formatPrice(unpaidTotal, currency) : '—'} sub={unpaidCount ? `${unpaidCount} unpaid` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-navy-800">By registration type</h2>
          <ul className="mt-4 space-y-5">
            {tickets.map((t) => {
              const mine = regs.filter((r) => r.ticket_id === t.id);
              const n = mine.length;
              const inN = mine.filter((r) => r.checked_in_at).length;
              const pct = t.capacity ? Math.min(100, Math.round((n / t.capacity) * 100)) : null;
              return (
                <li key={t.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold text-navy-800">{t.name} <span className="font-normal text-ivory-700">· {t.requires_approval ? 'applications' : formatPrice(t.price_minor, t.currency)}</span></span>
                    <span className="font-semibold text-navy-800">{n}{t.capacity ? ` / ${t.capacity}` : ''}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-navy-50"><div className="h-full rounded-full bg-gold-400" style={{ width: `${pct ?? (n ? 100 : 0)}%` }} /></div>
                  <p className="mt-1.5 text-xs text-ivory-700">{t.requires_approval ? `${n} selected or confirmed` : `${n} registered`} · {inN} checked in{t.capacity ? ` · ${Math.max(0, t.capacity - n)} places left` : ''}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {approval.length > 0 ? (
          <section className="card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-navy-800">Applications</h2>
              <button type="button" onClick={onReview} className="text-sm font-semibold text-gold-700 hover:text-gold-800">Open the review board</button>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {REVIEW_COLUMNS.map((c) => (
                <li key={c.status} className="rounded-xl bg-navy-50/70 px-3 py-3 text-center">
                  <p className="font-display text-2xl font-semibold text-navy-800">{apps.filter((r) => r.status === c.status).length}</p>
                  <p className="text-xs font-medium text-ivory-700">{c.label}</p>
                </li>
              ))}
            </ul>
            <LatestList regs={all.slice(0, 4)} tickets={tickets} onOpen={onOpen} onSeeAll={onSeeAll} />
          </section>
        ) : (
          <section className="card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy-800">Latest registrations</h2>
            <LatestList regs={all.slice(0, 6)} tickets={tickets} onOpen={onOpen} onSeeAll={onSeeAll} />
          </section>
        )}
      </div>
    </div>
  );
}

function LatestList({ regs, tickets, onOpen, onSeeAll }: { regs: Registration[]; tickets: EventTicket[]; onOpen: (r: Registration) => void; onSeeAll: () => void }) {
  if (!regs.length) return <p className="mt-3 text-sm text-ivory-700">No registrations yet. Share your event link to get started.</p>;
  return (
    <>
      <ul className="mt-4 divide-y divide-navy-100 border-t border-navy-100">
        {regs.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:bg-navy-50/50">
              <span className="min-w-0"><span className="block truncate font-semibold text-navy-800">{r.first_name} {r.last_name}</span><span className="block truncate text-ivory-700">{tickets.find((t) => t.id === r.ticket_id)?.name ?? ''} · {r.email}</span></span>
              <span className="shrink-0 text-xs text-ivory-700">{new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onSeeAll} className="mt-3 text-sm font-semibold text-gold-700 hover:text-gold-800">See all registrations</button>
    </>
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

        <DoorPasses eventId={eventId} />
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
