import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, ScanLine, ShieldCheck, Ticket, XCircle } from 'lucide-react';
import { EventsShell } from '@/components/events/EventKit';
import { LoadingSpinner } from '@/components/ui/States';
import { doorPassInfo, forgetPass, storePass, type DoorPassInfo } from '@/lib/doorPass';

/**
 * /e/door/<token>: a volunteer opens their door pass once on the phone they'll use. It's stored on
 * that phone; from then on, scanning a ticket's QR with the phone's camera checks the guest in.
 */
export function DoorPassPage({ token }: { token: string }) {
  const [info, setInfo] = useState<DoorPassInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    doorPassInfo(token).then((i) => {
      if (!alive) return;
      setInfo(i);
      if (i.valid && i.event_id) storePass(i.event_id, token);
      else if (i.event_id) forgetPass(i.event_id);
    }).catch((e) => { if (alive) { setInfo(null); setError((e as Error).message); } });
    return () => { alive = false; };
  }, [token]);

  if (info === undefined) return <EventsShell><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner className="h-10 w-10" /></div></EventsShell>;

  if (!info?.valid) {
    return (
      <EventsShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <XCircle className="mx-auto h-14 w-14 text-burgundy-600" />
          <h1 className="mt-5 font-event-display text-3xl font-semibold text-navy-900">This door pass doesn’t work</h1>
          <p className="mt-3 text-ivory-700">{error ?? 'It was removed by the organiser, or the event is over. Ask the organiser for a new one.'}</p>
        </div>
      </EventsShell>
    );
  }

  return (
    <EventsShell>
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="overflow-hidden rounded-[32px] border border-navy-100 bg-white shadow-[0_24px_60px_rgba(13,28,59,0.14)]">
          <div className="bg-green-600 px-6 py-8 text-center text-white">
            <CheckCircle2 className="mx-auto h-14 w-14" />
            <h1 className="mt-3 text-2xl font-bold">This phone is a scanner</h1>
            <p className="mt-1 text-white/90">for <b>{info.title}</b>{info.date ? ` · ${info.date}` : ''}</p>
          </div>
          <div className="space-y-5 px-6 py-7 text-navy-800">
            <p>Hi {info.name?.split(' ')[0]}. You’re on the door. Here’s how it works:</p>
            <ol className="space-y-4">
              <li className="flex gap-3"><Camera className="mt-0.5 h-5 w-5 shrink-0 text-gold-600" /><span>Open your phone’s <b>camera</b> and point it at the QR code on the guest’s ticket.</span></li>
              <li className="flex gap-3"><ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-gold-600" /><span>Tap the link that pops up.</span></li>
              <li className="flex gap-3"><Ticket className="mt-0.5 h-5 w-5 shrink-0 text-gold-600" /><span><b className="text-green-700">Green</b>: they’re in. <b className="text-amber-600">Amber</b>: already checked in. <b className="text-burgundy-700">Red</b>: don’t let them in; call the organiser.</span></li>
            </ol>
            {typeof info.expected === 'number' && (
              <p className="rounded-2xl bg-navy-50 px-4 py-3 text-sm">{info.checked_in ?? 0} of {info.expected} guests checked in so far.</p>
            )}
            <p className="rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-900">
              Opened this from your email app? Open the same link in <b>Safari</b> (iPhone) or <b>Chrome</b> (Android) too, because that’s where your camera opens tickets.
            </p>
            <p className="flex gap-2 text-sm text-ivory-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Use this same phone and browser at the door. Don’t share this link: anyone with it can check guests in until the organiser removes it.</p>
          </div>
        </div>
      </div>
    </EventsShell>
  );
}
