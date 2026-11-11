import { useCallback, useEffect, useState } from 'react';
import { Copy, Mail, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import { addDoorPass, listDoorPasses, passStatus, revokeDoorPass, type DoorPass } from '@/lib/doorPass';

/** Door scanners: volunteers (no account) who check guests in with their own phone's camera. */
export function DoorPasses({ eventId }: { eventId: string }) {
  const { toast } = useToast();
  const [passes, setPasses] = useState<DoorPass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPasses(await listDoorPasses(eventId)); setError(null); } catch (e) { setPasses([]); setError((e as Error).message); }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    try {
      const p = await addDoorPass(eventId, name.trim(), email.trim());
      setName(''); setEmail('');
      toast(p.emailed ? `Door pass emailed to ${p.email}` : 'Door pass made. No email account is connected, so copy the link and send it to them.');
      await load();
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  const copy = async (p: DoorPass) => {
    try { await navigator.clipboard.writeText(p.link); toast(`Door pass link for ${p.name} copied`); } catch { toast(p.link); }
  };
  const remove = async (p: DoorPass) => {
    try { await revokeDoorPass(p.id); toast(`${p.name}’s door pass removed. Their phone can’t scan any more.`); await load(); } catch (e) { toast((e as Error).message, 'error'); }
    setRemoving(null);
  };

  const live = (passes ?? []).filter((p) => !p.revoked_at);
  const removed = (passes ?? []).filter((p) => p.revoked_at);

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-navy-800">Door scanners</h2>
      <p className="mt-1 text-[15px] text-ivory-700">
        Volunteers without a SYNAPSE account. Each gets a door pass by email; opening it once makes their phone a scanner for this event, and then they check guests in with the phone’s camera.
      </p>
      <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_1.3fr_auto]" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input aria-label="Their name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="input-field" maxLength={80} />
        <input aria-label="Their email" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
        <button type="submit" disabled={busy || !name.trim() || !email.trim()} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-navy-800 px-4 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50">
          {busy ? <LoadingSpinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Send pass
        </button>
      </form>
      {error ? <p role="alert" className="mt-4 text-sm text-burgundy-700">{error}</p>
        : passes === null ? <div className="flex justify-center py-6"><LoadingSpinner className="h-6 w-6" /></div>
        : (
          <ul className="mt-4 divide-y divide-navy-50">
            {live.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-navy-800">{p.name}</p>
                  <p className="truncate text-sm text-ivory-700">{p.email}</p>
                  <p className={cn('mt-0.5 text-xs font-semibold', p.activated_at ? 'text-green-700' : 'text-ivory-700')}>{passStatus(p)}{p.scans ? ` · ${p.scans} checked in` : ''}</p>
                </div>
                <button type="button" onClick={() => { void copy(p); }} aria-label={`Copy ${p.name}’s door pass link`} className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><Copy className="h-4 w-4" /> Copy link</button>
                {removing === p.id ? (
                  <span className="inline-flex items-center gap-1 text-sm">Remove?
                    <button type="button" onClick={() => { void remove(p); }} className="h-9 rounded-lg bg-burgundy-500 px-3 text-sm font-bold text-white hover:bg-burgundy-600">Remove</button>
                    <button type="button" onClick={() => setRemoving(null)} className="h-9 rounded-lg px-3 text-sm font-semibold hover:bg-navy-50">Keep</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setRemoving(p.id)} aria-label={`Remove ${p.name}’s door pass`} className="flex h-9 w-9 items-center justify-center rounded-lg text-burgundy-600 hover:bg-burgundy-50"><Trash2 className="h-4 w-4" /></button>
                )}
              </li>
            ))}
            {live.length === 0 && <li className="flex items-center gap-2 py-3 text-sm text-ivory-700"><Mail className="h-4 w-4" /> No door scanners yet. Add a volunteer’s name and email above.</li>}
            {removed.length > 0 && <li className="py-3 text-sm text-ivory-700">Removed: {removed.map((p) => p.name).join(', ')}</li>}
          </ul>
        )}
    </section>
  );
}
