import { useState } from 'react';
import { CheckCircle2, ExternalLink, Mail, Undo2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import {
  answerLink, formatPrice, holdsPlace, labelledAnswers, STATUS_LABEL,
  type AnswerField, type EventTicket, type Registration, type RegistrationStatus,
} from '@/lib/events';
import { cn } from '@/lib/utils';

/** What the dashboard can do with a registration; each one goes through the database's checks. */
export interface RegActions {
  setStatus: (r: Registration, status: RegistrationStatus) => void;
  checkIn: (r: Registration, on: boolean) => void;
  markPaid: (r: Registration) => void;
  send: (r: Registration) => Promise<void>;
  open: (r: Registration) => void;
}

const STATUS_PILL: Record<RegistrationStatus, string> = {
  confirmed: 'bg-green-50 text-green-800',
  selected: 'bg-green-50 text-green-800',
  applied: 'bg-navy-50 text-navy-800',
  shortlisted: 'bg-gold-50 text-gold-900',
  declined: 'bg-red-50 text-red-700',
  cancelled: 'bg-red-50 text-red-700',
};

export function StatusPill({ status }: { status: RegistrationStatus }) {
  return <span className={cn('status-pill', STATUS_PILL[status])}>{STATUS_LABEL[status]}</span>;
}

/** An answer: a link opens in a new tab, long text keeps its line breaks. */
export function AnswerValue({ value, clamp }: { value: string; clamp?: boolean }) {
  const link = answerLink(value);
  if (link) {
    return (
      <a href={link} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}
        className="inline-flex max-w-full items-center gap-1 font-semibold text-navy-800 underline decoration-gold-400 underline-offset-2 hover:text-gold-800">
        <span className="truncate">{value.replace(/^https?:\/\/(www\.)?/i, '')}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" />
      </a>
    );
  }
  return <span className={cn('whitespace-pre-line break-words text-navy-800', clamp && 'line-clamp-3')}>{value}</span>;
}

/** Everything about one registration, with the actions that fit its status. */
export function RegistrationPanel({ reg, ticket, fields, onClose, actions, busy }: {
  reg: Registration | null; ticket: EventTicket | undefined; fields: AnswerField[]; onClose: () => void; actions: RegActions; busy: boolean;
}) {
  const [sending, setSending] = useState(false);
  if (!reg) return <Drawer open={false} onClose={onClose}><span /></Drawer>;
  const answers = labelledAnswers(reg, fields, { withContact: false });
  const approval = !!ticket?.requires_approval;
  const holds = holdsPlace(reg.status);
  const send = async () => { setSending(true); try { await actions.send(reg); } finally { setSending(false); } };
  const btn = 'flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:opacity-50';

  return (
    <Drawer open onClose={onClose} title={`${reg.first_name} ${reg.last_name}`.trim()} description={ticket?.name ?? 'Registration'} width="lg">
      <div className="space-y-6 px-6 py-5 pb-28">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={reg.status} />
          {reg.ticket_code && <span className="status-pill bg-white font-mono text-navy-800 ring-1 ring-inset ring-navy-100">{reg.ticket_code}</span>}
          {reg.checked_in_at && <span className="status-pill bg-green-50 text-green-800"><CheckCircle2 className="h-3.5 w-3.5" /> In {new Date(reg.checked_in_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</span>}
        </div>

        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ivory-700">Email</dt><dd className="break-all"><a href={`mailto:${reg.email}`} className="font-semibold text-navy-800 hover:underline">{reg.email}</a></dd>
          {reg.phone && <><dt className="text-ivory-700">Phone</dt><dd><a href={`tel:${reg.phone.replace(/\s/g, '')}`} className="font-semibold text-navy-800 hover:underline">{reg.phone}</a></dd></>}
          <dt className="text-ivory-700">Registered</dt><dd className="text-navy-800">{new Date(reg.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
          <dt className="text-ivory-700">PIN</dt><dd className="font-mono text-navy-800">{reg.pin}</dd>
          {reg.payment_status !== 'free' && <><dt className="text-ivory-700">Payment</dt><dd className="text-navy-800">{reg.payment_status === 'paid' ? 'Paid' : `Unpaid · ${formatPrice(reg.amount_minor, ticket?.currency)}`}</dd></>}
          <dt className="text-ivory-700">Consent</dt><dd className="text-navy-800">{reg.consent_at ? `Given ${new Date(reg.consent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : (reg.answers as Record<string, unknown>)?.added_by_organiser ? 'Added by the organiser' : '—'}</dd>
        </dl>

        <section>
          <h3 className="text-sm font-semibold text-navy-800">Their answers</h3>
          {answers.length ? (
            <dl className="mt-3 space-y-3">
              {answers.map((a) => (
                <div key={a.id} className="rounded-xl bg-navy-50/60 px-4 py-3">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ivory-700">{a.label}</dt>
                  <dd className="mt-1 text-[15px]"><AnswerValue value={a.value} /></dd>
                </div>
              ))}
            </dl>
          ) : <p className="mt-2 text-sm text-ivory-700">{(reg.answers as Record<string, unknown>)?.added_by_organiser ? 'Added by hand: no form answers.' : 'No other answers.'}</p>}
        </section>

        <section className="space-y-3 border-t border-navy-100 pt-5">
          <h3 className="text-sm font-semibold text-navy-800">Actions</h3>
          {approval && ['applied', 'shortlisted', 'declined'].includes(reg.status) && (
            <div className="flex flex-wrap gap-2">
              {reg.status !== 'shortlisted' && <button type="button" disabled={busy} onClick={() => actions.setStatus(reg, 'shortlisted')} className={cn(btn, 'bg-white text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50')}>Shortlist</button>}
              <button type="button" disabled={busy} onClick={() => actions.setStatus(reg, 'selected')} className={cn(btn, 'bg-green-600 text-white hover:bg-green-700')}>Select</button>
              {reg.status !== 'declined' && <button type="button" disabled={busy} onClick={() => actions.setStatus(reg, 'declined')} className={cn(btn, 'bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50')}>Decline</button>}
            </div>
          )}
          {approval && reg.status === 'selected' && (
            <button type="button" disabled={busy} onClick={() => actions.setStatus(reg, 'confirmed')} className={cn(btn, 'bg-navy-800 text-white hover:bg-navy-700')}>Mark as confirmed</button>
          )}
          <div className="flex flex-wrap gap-2">
            {reg.status !== 'cancelled' && reg.status !== 'declined' && (
              <button type="button" disabled={sending} onClick={() => { void send(); }} className={cn(btn, 'bg-white text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50')}>
                <Mail className="h-4 w-4" /> {sending ? 'Sending…' : holds ? 'Email their ticket again' : 'Email "application received" again'}
              </button>
            )}
            {holds && (reg.checked_in_at
              ? <button type="button" disabled={busy} onClick={() => actions.checkIn(reg, false)} className={cn(btn, 'bg-white text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50')}><Undo2 className="h-4 w-4" /> Undo check-in</button>
              : <button type="button" disabled={busy || reg.payment_status === 'unpaid'} title={reg.payment_status === 'unpaid' ? 'Mark it paid first' : undefined} onClick={() => actions.checkIn(reg, true)} className={cn(btn, 'bg-white text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50')}><CheckCircle2 className="h-4 w-4" /> Check in</button>)}
            {reg.payment_status === 'unpaid' && holds && <button type="button" disabled={busy} onClick={() => actions.markPaid(reg)} className={cn(btn, 'bg-gold-400 text-navy-900 hover:bg-gold-300')}>Mark paid</button>}
          </div>
          <div className="pt-1">
            {reg.status === 'cancelled'
              ? <button type="button" disabled={busy} onClick={() => actions.setStatus(reg, approval ? 'applied' : 'confirmed')} className="text-sm font-semibold text-navy-700 hover:text-navy-900">Restore this registration</button>
              : reg.status !== 'declined' && <button type="button" disabled={busy} onClick={() => actions.setStatus(reg, 'cancelled')} className="text-sm font-semibold text-red-700 hover:text-red-800">Cancel this registration</button>}
          </div>
        </section>
      </div>
    </Drawer>
  );
}
