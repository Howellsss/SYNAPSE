import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { addRegistration, type EventTicket, type Registration } from '@/lib/events';

/** Add someone by hand: a walk-in, a guest, a performer you invited. */
export function AddRegistration({ open, onClose, eventId, tickets, onAdded }: {
  open: boolean; onClose: () => void; eventId: string; tickets: EventTicket[]; onAdded: (r: Registration, emailed: boolean) => void;
}) {
  const [ticketId, setTicketId] = useState(tickets[0]?.id ?? '');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [send, setSend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTicketId((id) => id || tickets[0]?.id || ''); setFirst(''); setLast(''); setEmail(''); setPhone(''); setSend(true); setError(null); setFull(false);
  }, [open, tickets]);

  const ticket = tickets.find((t) => t.id === ticketId);
  const submit = async (overCapacity = false) => {
    setSaving(true); setError(null);
    const r = await addRegistration(eventId, { ticketId, first, last, email, phone, send, overCapacity });
    setSaving(false);
    if (r.error || !r.data) { setError(r.error); setFull(r.full); return; }
    onAdded(r.data, !!r.data.emailed);
  };
  const input = 'mt-1.5 h-11 w-full rounded-lg border border-navy-100 px-3 text-[16px] text-navy-900 outline-none focus:border-gold-400 focus:ring-4 focus:ring-gold-400/20';

  return (
    <Modal open={open} onClose={onClose} title="Add someone" description="A walk-in, a guest or a performer you’ve invited. They get a ticket code straight away."
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-navy-700 hover:bg-navy-50">Cancel</button>
          {full && <button type="button" disabled={saving} onClick={() => { void submit(true); }} className="h-10 rounded-lg px-4 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50 disabled:opacity-50">Add anyway</button>}
          <button type="submit" form="add-reg" disabled={saving} className="h-10 rounded-lg bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50">{saving ? 'Adding…' : 'Add'}</button>
        </div>
      )}>
      <form id="add-reg" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
        <label className="block text-sm font-semibold text-navy-800">Registration type
          <select value={ticketId} onChange={(e) => { setTicketId(e.target.value); setFull(false); }} className={input}>
            {tickets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {ticket?.requires_approval && <span className="mt-1 block text-xs font-normal text-ivory-700">They’ll be added as Selected, skipping the application.</span>}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-navy-800">First name<input required value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" className={input} /></label>
          <label className="block text-sm font-semibold text-navy-800">Last name <span className="font-normal text-ivory-700">(optional)</span><input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" className={input} /></label>
        </div>
        <label className="block text-sm font-semibold text-navy-800">Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={input} /></label>
        <label className="block text-sm font-semibold text-navy-800">Phone <span className="font-normal text-ivory-700">(optional)</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" className={input} /></label>
        <label className="flex items-start gap-3 text-sm text-navy-800">
          <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-navy-200 accent-navy-800" />
          <span>Email them their ticket now{ticket && !ticket.form_id ? <span className="block text-xs text-ivory-700">This type has no form, so tickets can’t be emailed for it.</span> : null}</span>
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}{full ? ' You can still add them anyway.' : ''}</p>}
      </form>
    </Modal>
  );
}
