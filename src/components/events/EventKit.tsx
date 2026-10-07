import type { ReactNode } from 'react';
import { MapPin, Ticket, Users } from 'lucide-react';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/lib/router';
import { DEFAULT_COVER, categoryLabel, placeLine, priceFrom, type PublicEvent } from '@/lib/events';
import { cn } from '@/lib/utils';
import { useEventFonts, useQrDataUrl } from './hooks';

export function QrImage({ text, size = 220, className }: { text: string; size?: number; className?: string }) {
  const url = useQrDataUrl(text, size * 2);
  return url
    ? <img src={url} width={size} height={size} alt="Ticket QR code" className={cn('rounded-xl', className)} />
    : <div style={{ width: size, height: size }} className={cn('animate-pulse rounded-xl bg-navy-50', className)} aria-hidden="true" />;
}

/** The public events pages' frame: top bar, content, footer. Fonts: Unbounded for titles, Raleway for text. */
export function EventsShell({ children }: { children: ReactNode }) {
  useEventFonts();
  const { user } = useAuth();
  const [, navigate] = useRouter();
  const host = () => navigate(user ? '/events' : '/signup');
  return (
    <div className="min-h-[100dvh] bg-white font-event text-navy-800">
      <header className="sticky top-0 z-40 border-b border-navy-100/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
          <a href="/e" onClick={(e) => { e.preventDefault(); navigate('/e'); }} className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-navy-800"><HowellsLogo className="h-[18px] w-[18px]" /></span>
            <span className="whitespace-nowrap font-event-display text-[14px] font-semibold tracking-tight sm:text-[15px]">SYNAPSE <span className="text-gold-600">Events</span></span>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-navy-600 md:flex">
            <a href="/e#explore" onClick={(e) => { e.preventDefault(); navigate('/e'); setTimeout(() => document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' }), 50); }} className="hover:text-navy-900">Explore</a>
            <a href="/e#how" onClick={(e) => { e.preventDefault(); navigate('/e'); setTimeout(() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }), 50); }} className="hover:text-navy-900">How it works</a>
            <a href="/e#organisers" onClick={(e) => { e.preventDefault(); navigate('/e'); setTimeout(() => document.getElementById('organisers')?.scrollIntoView({ behavior: 'smooth' }), 50); }} className="hover:text-navy-900">For organisers</a>
          </nav>
          <div className="flex items-center gap-2">
            {!user && <button type="button" onClick={() => navigate('/signin')} className="hidden rounded-full px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50 sm:block">Sign in</button>}
            <button type="button" onClick={host} className="whitespace-nowrap rounded-full bg-gold-400 px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-300">{user ? 'My events' : 'Host an event'}</button>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-navy-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-navy-800"><HowellsLogo className="h-[18px] w-[18px]" /></span>
            <div>
              <p className="font-event-display text-sm font-semibold">SYNAPSE Events</p>
              <p className="text-xs text-ivory-700">Find events. Host events. Remember the people.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-ivory-700">
            <button type="button" onClick={() => navigate('/e')} className="hover:text-navy-800">Explore events</button>
            <button type="button" onClick={host} className="hover:text-navy-800">Host an event</button>
            <button type="button" onClick={() => navigate('/')} className="hover:text-navy-800">About SYNAPSE</button>
          </div>
          <p className="text-xs text-ivory-600">© {new Date().getFullYear()} SYNAPSE</p>
        </div>
      </footer>
    </div>
  );
}

/** The gold-topped date tile on event cards: OCT / 10. */
export function DateTile({ iso, timeZone, className }: { iso: string; timeZone?: string; className?: string }) {
  const d = new Date(iso);
  const tz = timeZone ? { timeZone } : {};
  return (
    <div className={cn('flex w-14 flex-col items-center overflow-hidden rounded-2xl bg-white text-center shadow-[0_4px_16px_rgba(13,28,59,0.18)]', className)}>
      <span className="w-full bg-gold-400 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy-900">{d.toLocaleDateString('en-GB', { month: 'short', ...tz })}</span>
      <span className="py-1 font-event-display text-xl font-semibold leading-tight text-navy-900">{d.toLocaleDateString('en-GB', { day: 'numeric', ...tz })}</span>
    </div>
  );
}

export function EventCard({ event, onOpen }: { event: Pick<PublicEvent, 'slug' | 'title' | 'cover_url' | 'starts_at' | 'timezone' | 'category' | 'mode' | 'venue_name' | 'city' | 'tickets' | 'registered' | 'organiser_name'>; onOpen: () => void }) {
  const soldOut = event.tickets.length > 0 && event.tickets.every((t) => t.remaining === 0);
  const time = new Date(event.starts_at).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: event.timezone || undefined });
  return (
    <a
      href={`/e/${event.slug}`}
      onClick={(e) => { e.preventDefault(); onOpen(); }}
      className="group flex flex-col overflow-hidden rounded-[24px] border border-navy-100 bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(13,28,59,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <img src={event.cover_url || DEFAULT_COVER} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        <DateTile iso={event.starts_at} timeZone={event.timezone} className="absolute left-3 top-3" />
        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-navy-800 backdrop-blur">{categoryLabel(event.category)}</span>
        {soldOut && <span className="absolute bottom-3 left-3 rounded-full bg-navy-900/85 px-3 py-1 text-xs font-semibold text-white">Sold out</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-700">{time}</p>
        <h3 className="line-clamp-2 font-event-display text-[17px] font-semibold leading-snug text-navy-900">{event.title}</h3>
        <p className="flex items-center gap-1.5 truncate text-sm text-ivory-700"><MapPin className="h-3.5 w-3.5 shrink-0" />{placeLine(event)}</p>
        <div className="mt-auto flex items-center justify-between pt-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold text-navy-800"><Ticket className="h-4 w-4 text-gold-600" />{priceFrom(event.tickets)}</span>
          {event.registered > 0 && <span className="inline-flex items-center gap-1 text-xs text-ivory-700"><Users className="h-3.5 w-3.5" />{event.registered} going</span>}
        </div>
      </div>
    </a>
  );
}
