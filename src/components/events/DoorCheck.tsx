import { AlertTriangle, CheckCircle2, ScanLine, Ticket, Undo2, WifiOff, XCircle } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { cn } from '@/lib/utils';
import { checkInPath, invalidText, resultColour } from '@/lib/checkin';
import type { useDoorCheck } from './useDoorCheck';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function DoorCheckScreen({ door, onShowTicket }: { door: ReturnType<typeof useDoorCheck>; onShowTicket: () => void }) {
  const [, navigate] = useRouter();
  const { answer, waiting, error } = door;
  if (!answer) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-navy-900 px-6 text-center text-white">
        {waiting ? <WifiOff className="h-16 w-16 text-gold-400" /> : <ScanLine className="h-16 w-16 animate-pulse text-gold-400" />}
        <p className="mt-5 text-2xl font-bold">{waiting ? 'No connection. Retrying…' : error ? error : 'Checking the ticket…'}</p>
        {waiting && <p className="mt-2 max-w-sm text-ivory-300">Don’t let them in until this turns green.</p>}
      </div>
    );
  }
  const undone = answer.reason === 'undone';
  const unpaid = answer.result === 'not_eligible' && answer.reason === 'unpaid';
  const colour = undone ? 'amber' : resultColour(answer);
  const p = answer.person;
  const bg = colour === 'green' ? 'bg-green-600' : colour === 'amber' ? 'bg-amber-500' : 'bg-burgundy-600';
  const title = undone ? 'Check-in undone' : answer.result === 'success' ? 'Checked in' : answer.result === 'already_checked_in' ? 'Already checked in' : unpaid ? 'Payment due' : 'Not valid';
  const Icon = colour === 'green' ? CheckCircle2 : colour === 'amber' ? AlertTriangle : XCircle;
  return (
    <div role="alertdialog" aria-live="assertive" aria-label={title} className={cn('fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center text-white', bg)}>
      <Icon className="h-24 w-24" strokeWidth={2.2} />
      <p className="mt-4 text-4xl font-extrabold">{title}</p>
      {p && <p className="mt-3 text-2xl font-semibold">{p.name}</p>}
      {p && (p.type_name || p.ticket_code) && <p className="mt-1 text-lg opacity-90">{[p.type_name, p.ticket_code].filter(Boolean).join(' · ')}</p>}
      {answer.result === 'already_checked_in' && p?.checked_in_at && (
        <p className="mt-4 text-lg font-semibold">First checked in at {time(p.checked_in_at)}{p.checked_in_by ? ` by ${p.checked_in_by}` : ''}</p>
      )}
      {!undone && (answer.result === 'invalid' || (answer.result === 'not_eligible' && !unpaid)) && <p className="mt-4 max-w-md text-lg">{invalidText(answer.reason)}</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {unpaid && <button type="button" onClick={() => { void door.markPaid(); }} className="h-12 rounded-full bg-white px-6 font-bold text-navy-900">Paid · check in</button>}
        {answer.result === 'success' && !undone && (
          <button type="button" onClick={() => { void door.undo(); }} className="inline-flex h-12 items-center gap-2 rounded-full bg-white/20 px-5 font-semibold ring-1 ring-white/60"><Undo2 className="h-5 w-5" /> Undo</button>
        )}
        <button type="button" onClick={onShowTicket} className="inline-flex h-12 items-center gap-2 rounded-full bg-white/20 px-5 font-semibold ring-1 ring-white/60"><Ticket className="h-5 w-5" /> Show ticket</button>
        {door.eventId && !door.byPass && (
          <button type="button" onClick={() => navigate(checkInPath(door.eventId!))} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 font-bold text-navy-900"><ScanLine className="h-5 w-5" /> Open the scanner</button>
        )}
      </div>
      <p className="mt-8 max-w-sm text-sm opacity-90">Next guest: scan their QR with your camera, or use the scanner.</p>
    </div>
  );
}
