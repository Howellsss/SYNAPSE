import { useMemo, useState } from 'react';
import { CheckCircle2, Download, Search, UserPlus } from 'lucide-react';
import { STATUS_LABEL, type EventTicket, type Registration, type RegistrationStatus } from '@/lib/events';
import { StatusPill, type RegActions } from './RegistrationPanel';

type CheckFilter = 'any' | 'in' | 'out' | 'unpaid';

/** Every registration: search, filter by type, status and check-in; open one to see all its answers. */
export function Registrations({ regs, tickets, actions, onAdd, onExport, initialStatus = 'all' }: {
  regs: Registration[]; tickets: EventTicket[]; actions: RegActions; onAdd: () => void; onExport: (shown: Registration[]) => void; initialStatus?: RegistrationStatus | 'all' | 'active';
}) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState<RegistrationStatus | 'all' | 'active'>(initialStatus);
  const [check, setCheck] = useState<CheckFilter>('any');
  const ticketName = (id: string | null) => tickets.find((t) => t.id === id)?.name ?? '—';
  const statuses = useMemo(() => Array.from(new Set(regs.map((r) => r.status))), [regs]);

  const shown = regs.filter((r) => {
    if (type !== 'all' && r.ticket_id !== type) return false;
    if (status === 'active' ? r.status === 'cancelled' || r.status === 'declined' : status !== 'all' && r.status !== status) return false;
    if (check === 'in' && !r.checked_in_at) return false;
    if (check === 'out' && r.checked_in_at) return false;
    if (check === 'unpaid' && r.payment_status !== 'unpaid') return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const digits = s.replace(/\D/g, '');
    return `${r.first_name} ${r.last_name} ${r.email} ${r.ticket_code ?? ''} ${r.pin}`.toLowerCase().includes(s)
      || (digits.length >= 4 && r.phone.replace(/\D/g, '').includes(digits.length > 9 ? digits.slice(-9) : digits));
  });
  const select = 'h-[38px] rounded-lg bg-white px-3 text-sm font-medium text-navy-800 ring-1 ring-inset ring-navy-100';

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-navy-100 p-4 lg:flex-row lg:items-center">
        <label className="flex flex-1 items-center gap-2 rounded-lg px-4 ring-1 ring-inset ring-navy-100 focus-within:ring-gold-400">
          <Search className="h-4 w-4 text-ivory-600" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, ticket code or PIN" aria-label="Search registrations" className="h-10 w-full bg-transparent text-sm outline-none" />
        </label>
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Registration type" className={select}>
            <option value="all">All types</option>
            {tickets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status" className={select}>
            <option value="all">Any status</option>
            <option value="active">Not cancelled or declined</option>
            {(['confirmed', 'applied', 'shortlisted', 'selected', 'declined', 'cancelled'] as RegistrationStatus[]).filter((s) => statuses.includes(s)).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select value={check} onChange={(e) => setCheck(e.target.value as CheckFilter)} aria-label="Check-in" className={select}>
            <option value="any">Checked in or not</option><option value="in">Checked in</option><option value="out">Not checked in</option><option value="unpaid">Pay at the door</option>
          </select>
          <button type="button" onClick={onAdd} className="flex h-[38px] items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><UserPlus className="h-4 w-4" /> Add someone</button>
          <button type="button" onClick={() => onExport(shown)} disabled={!shown.length} className="flex h-[38px] items-center gap-1.5 rounded-lg bg-navy-800 px-4 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50"><Download className="h-4 w-4" /> Export CSV</button>
        </div>
      </div>
      <p className="border-b border-navy-100 px-5 py-2 text-xs font-medium text-ivory-700" aria-live="polite">{shown.length} of {regs.length} shown</p>
      {shown.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-ivory-700">{regs.length ? 'Nobody matches.' : 'No registrations yet. Share your event link, or add someone by hand.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs font-semibold uppercase tracking-wider text-ivory-700">
              <tr><th className="px-5 py-3">Name</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Ticket code</th><th className="px-3 py-3">Payment</th><th className="px-3 py-3">Check-in</th></tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {shown.map((r) => (
                <tr key={r.id} onClick={() => actions.open(r)} className="cursor-pointer hover:bg-navy-50/50">
                  <td className="px-5 py-3">
                    <button type="button" onClick={(e) => { e.stopPropagation(); actions.open(r); }} className="text-left font-semibold text-navy-800 hover:underline">{r.first_name} {r.last_name}</button>
                    <p className="text-ivory-700">{r.email}{r.phone ? ` · ${r.phone}` : ''}</p>
                  </td>
                  <td className="px-3 py-3 text-navy-700">{ticketName(r.ticket_id)}</td>
                  <td className="px-3 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-3 py-3 font-mono text-navy-700">{r.ticket_code ?? '—'}</td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    {r.payment_status === 'free' ? <span className="text-ivory-700">Free</span>
                      : r.payment_status === 'paid' ? <span className="status-pill bg-green-50 text-green-700">Paid</span>
                        : <button type="button" onClick={() => actions.markPaid(r)} className="status-pill bg-gold-50 text-gold-800 hover:bg-gold-100">Unpaid · mark paid</button>}
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    {!(r.status === 'confirmed' || r.status === 'selected') ? <span className="text-ivory-700">—</span> : r.checked_in_at
                      ? <button type="button" onClick={() => actions.checkIn(r, false)} title="Undo check-in" className="status-pill bg-green-50 text-green-700 hover:bg-green-100"><CheckCircle2 className="h-3.5 w-3.5" /> {new Date(r.checked_in_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</button>
                      : <button type="button" onClick={() => actions.checkIn(r, true)} className="status-pill bg-white text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Check in</button>}
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
