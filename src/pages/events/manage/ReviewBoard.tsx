import { useState } from 'react';
import { Search } from 'lucide-react';
import { labelledAnswers, REVIEW_COLUMNS, type AnswerField, type EventTicket, type Registration, type RegistrationStatus } from '@/lib/events';
import { AnswerValue, type RegActions } from './RegistrationPanel';
import { cn } from '@/lib/utils';

const ACCENT: Record<string, string> = {
  applied: 'bg-navy-300', shortlisted: 'bg-gold-400', selected: 'bg-green-600', confirmed: 'bg-green-800', declined: 'bg-red-500',
};

/**
 * The performer review board: Applied → Shortlisted → Selected / Declined → Confirmed.
 * Each card shows the applicant's answers (links open in a new tab). Selecting sends their ticket
 * and the "You've been selected" email; declining sends the kind note.
 */
export function ReviewBoard({ regs, tickets, fieldsFor, actions, busyId }: {
  regs: Registration[]; tickets: EventTicket[]; fieldsFor: (ticketId: string | null) => AnswerField[]; actions: RegActions; busyId: string | null;
}) {
  const approvalTypes = tickets.filter((t) => t.requires_approval);
  const [type, setType] = useState(approvalTypes[0]?.id ?? '');
  const [q, setQ] = useState('');
  const pool = regs.filter((r) => r.ticket_id === type && r.status !== 'cancelled');
  const s = q.trim().toLowerCase();
  const matches = (r: Registration) => !s || `${r.first_name} ${r.last_name} ${r.email} ${Object.values(r.answers ?? {}).join(' ')}`.toLowerCase().includes(s);

  if (!approvalTypes.length) {
    return <section className="card p-8 text-center text-sm text-ivory-700">None of this event’s registration types take applications. Turn on “Needs approval” for a type in Edit to review applicants here.</section>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {approvalTypes.length > 1 && (
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Registration type" className="h-[38px] rounded-lg bg-white px-3 text-sm font-medium text-navy-800 ring-1 ring-inset ring-navy-100">
            {approvalTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <label className="flex flex-1 items-center gap-2 rounded-lg bg-white px-4 ring-1 ring-inset ring-navy-100 focus-within:ring-gold-400 sm:max-w-sm">
          <Search className="h-4 w-4 text-ivory-600" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search applicants and answers" aria-label="Search applicants" className="h-10 w-full bg-transparent text-sm outline-none" />
        </label>
        <p className="text-sm text-ivory-700">Selecting someone emails them their ticket. Declining sends a kind note.</p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[1100px] grid-cols-5 gap-4">
          {REVIEW_COLUMNS.map((col) => {
            const cards = pool.filter((r) => r.status === col.status && matches(r));
            return (
              <section key={col.status} aria-label={col.label} className="flex min-h-[260px] flex-col rounded-2xl bg-navy-50/70 p-3">
                <header className="mb-3 flex items-center gap-2 px-1">
                  <span className={cn('h-2.5 w-2.5 rounded-full', ACCENT[col.status])} aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-navy-800">{col.label}</h3>
                  <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-navy-700">{pool.filter((r) => r.status === col.status).length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-3">
                  {cards.map((r) => <Card key={r.id} r={r} fields={fieldsFor(r.ticket_id)} actions={actions} busy={busyId === r.id} />)}
                  {cards.length === 0 && <p className="px-1 text-xs text-ivory-700">{s ? 'Nobody matches.' : col.hint}</p>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({ r, fields, actions, busy }: { r: Registration; fields: AnswerField[]; actions: RegActions; busy: boolean }) {
  const answers = labelledAnswers(r, fields, { withContact: false }).slice(0, 5);
  const move = (status: RegistrationStatus, label: string, tone: string) => (
    <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); actions.setStatus(r, status); }} className={cn('h-8 rounded-lg px-2.5 text-xs font-semibold disabled:opacity-50', tone)}>{label}</button>
  );
  const plain = 'bg-white text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50';
  return (
    <article className="rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-inset ring-navy-100">
      <button type="button" onClick={() => actions.open(r)} className="block w-full text-left">
        <p className="font-semibold text-navy-900 hover:underline">{r.first_name} {r.last_name}</p>
        <p className="text-xs text-ivory-700">Applied {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
      </button>
      {answers.length > 0 && (
        <dl className="mt-2.5 space-y-1.5 text-[13px]">
          {answers.map((a) => (
            <div key={a.id} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ivory-700">{a.label}</dt>
              <dd className="min-w-0"><AnswerValue value={a.value} clamp /></dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {r.status === 'applied' && <>{move('shortlisted', 'Shortlist', plain)}{move('selected', 'Select', 'bg-green-600 text-white hover:bg-green-700')}{move('declined', 'Decline', 'bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50')}</>}
        {r.status === 'shortlisted' && <>{move('selected', 'Select', 'bg-green-600 text-white hover:bg-green-700')}{move('declined', 'Decline', 'bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50')}{move('applied', 'Back', plain)}</>}
        {r.status === 'selected' && <>{move('confirmed', 'Mark confirmed', 'bg-navy-800 text-white hover:bg-navy-700')}</>}
        {r.status === 'declined' && <>{move('shortlisted', 'Reconsider', plain)}</>}
        <button type="button" onClick={() => actions.open(r)} className="h-8 rounded-lg px-2.5 text-xs font-semibold text-navy-700 hover:bg-navy-50">Details</button>
      </div>
    </article>
  );
}
