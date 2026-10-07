import { useEffect, useState } from 'react';
import { CalendarDays, CalendarPlus, CheckCircle2, Download, ExternalLink, Globe, MapPin, Ticket } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { calendarLinks, downloadFile, eventDateLine, fetchTicket, formatPrice, placeLine, ticketUrl, type PublicTicket } from '@/lib/events';
import { EventsShell, QrImage } from '@/components/events/EventKit';
import { useQrDataUrl } from '@/components/events/hooks';
import { LoadingSpinner } from '@/components/ui/States';

/** /e/ticket/<token>: the attendee's pass, with QR and PIN. Only someone with the link can open it. */
export function TicketPage({ token }: { token: string }) {
  const [, navigate] = useRouter();
  const [t, setT] = useState<PublicTicket | null | undefined>(undefined);
  const link = ticketUrl(token);
  const qr = useQrDataUrl(t ? link : null, 800);

  useEffect(() => {
    let alive = true;
    fetchTicket(token).then(({ data }) => { if (alive) setT(data); });
    return () => { alive = false; };
  }, [token]);

  if (t === undefined) return <EventsShell><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner className="h-10 w-10" /></div></EventsShell>;
  if (t === null) {
    return (
      <EventsShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <Ticket className="mx-auto h-12 w-12 text-gold-500" />
          <h1 className="mt-5 font-event-display text-3xl font-semibold text-navy-900">Ticket not found</h1>
          <p className="mt-3 text-ivory-700">Check the link in your confirmation, or contact the organiser.</p>
          <button type="button" onClick={() => navigate('/e')} className="mt-8 rounded-full bg-gold-400 px-6 py-3 text-sm font-semibold text-navy-900 hover:bg-gold-300">Browse events</button>
        </div>
      </EventsShell>
    );
  }

  const e = t.event;
  const cal = calendarLinks(e);
  const cancelled = t.status === 'cancelled' || e.status === 'cancelled';

  return (
    <EventsShell>
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="overflow-hidden rounded-[32px] border border-navy-100 bg-white shadow-[0_24px_60px_rgba(13,28,59,0.14)]">
          <div className="bg-navy-900 px-6 pb-6 pt-7 text-white">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-400">{t.ticket_name ?? 'Ticket'}</p>
            <h1 className="mt-2 font-event-display text-2xl font-semibold leading-tight">{e.title}</h1>
            <p className="mt-3 flex items-start gap-2 text-sm text-ivory-300"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />{eventDateLine(e.starts_at, e.ends_at, e.timezone)}</p>
            <p className="mt-1.5 flex items-start gap-2 text-sm text-ivory-300">{e.mode === 'online' ? <Globe className="mt-0.5 h-4 w-4 shrink-0" /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0" />}{placeLine(e)}</p>
          </div>
          <div className="relative">
            {/* The perforation between the stub and the pass */}
            <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-white ring-1 ring-navy-100" aria-hidden="true" />
            <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-white ring-1 ring-navy-100" aria-hidden="true" />
          </div>
          <div className="px-6 pb-7 pt-6 text-center">
            {cancelled ? (
              <p className="rounded-2xl bg-burgundy-50 px-4 py-3 text-sm font-semibold text-burgundy-700">This {t.status === 'cancelled' ? 'registration' : 'event'} was cancelled.</p>
            ) : (
              <>
                <div className="mx-auto w-fit"><QrImage text={link} size={220} /></div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ivory-700">Check-in PIN</p>
                <p className="font-event-display text-3xl font-semibold tracking-[0.3em] text-navy-900">{t.pin}</p>
              </>
            )}
            <p className="mt-4 font-semibold text-navy-900">{t.first_name} {t.last_name}</p>
            <p className="text-sm text-ivory-700">{t.email}</p>
            {t.checked_in_at && (
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-700"><CheckCircle2 className="h-4 w-4" /> Checked in {new Date(t.checked_in_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
            )}
            {t.payment_status === 'unpaid' && !cancelled && (
              <p className="mt-4 rounded-2xl bg-gold-50 px-4 py-3 text-sm text-gold-900">Pay {formatPrice(t.amount_minor, t.currency)} at the venue.</p>
            )}
            {t.online_url && e.mode !== 'in_person' && !cancelled && (
              <a href={t.online_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-gold-700 hover:text-gold-800">Join online <ExternalLink className="h-3.5 w-3.5" /></a>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" disabled={!qr || cancelled} onClick={() => { if (qr) { const a = document.createElement('a'); a.href = qr; a.download = `${e.slug}-ticket.png`; a.click(); } }} className="flex h-12 items-center justify-center gap-2 rounded-full bg-navy-800 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50"><Download className="h-4 w-4" /> Download QR</button>
          <button type="button" onClick={() => downloadFile(`${e.slug}.ics`, cal.ics, 'text/calendar')} className="flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><CalendarPlus className="h-4 w-4" /> Add to calendar</button>
        </div>
        <button type="button" onClick={() => navigate(`/e/${e.slug}`)} className="mt-3 w-full rounded-full py-3 text-sm font-semibold text-navy-700 hover:bg-navy-50">View event page</button>
      </div>
    </EventsShell>
  );
}
