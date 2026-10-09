import { Clock, Lock, UserCheck, UserX } from 'lucide-react';
import { HowellsLogo } from '@/components/layout/Sidebar';
import type { WaitingRoomControls } from '@/meetings/useWaitingRoom';

/** What someone sees while the host decides whether to let them in. */
export function WaitingScreen({ title, hostName, onLeave }: { title: string; hostName?: string | null; onLeave: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white text-navy-900" data-waiting-screen>
      <header className="flex items-center gap-2 px-4 pt-4 sm:px-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800"><HowellsLogo className="h-[18px] w-[18px]" /></span>
        <span className="text-[13px] font-semibold tracking-[0.14em]">SYNAPSE</span>
      </header>
      <main className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-navy-50 ring-1 ring-inset ring-navy-100">
            <Clock className="h-7 w-7 animate-pulse text-gold-600" />
          </span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-gold-700">Waiting room</p>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight">Please wait, the host will let you in soon</h1>
          <p className="mt-2 text-sm text-ivory-700">{title}{hostName ? ` · Hosted by ${hostName}` : ''}</p>
          <p className="mt-1 text-sm text-ivory-700">Keep this page open. You'll join automatically when you're let in.</p>
          <button type="button" onClick={onLeave} className="mt-6 rounded-lg px-5 py-2.5 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Leave</button>
        </div>
      </main>
    </div>
  );
}

/** A plain screen for "the host turned you away / removed you / locked the meeting". */
export function RefusedScreen({ message, locked, onBack, backLabel, onRetry }: { message: string; locked?: boolean; onBack: () => void; backLabel: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-white p-6 text-center text-navy-900" data-refused-screen>
      <div className="max-w-md">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-navy-50 ring-1 ring-inset ring-navy-100">
          {locked ? <Lock className="h-6 w-6 text-navy-700" /> : <UserX className="h-6 w-6 text-burgundy-600" />}
        </span>
        <h1 className="mt-5 text-xl font-bold">{message}</h1>
        <div className="mt-6 flex justify-center gap-3">
          {onRetry && <button type="button" onClick={onRetry} className="btn-secondary">Try again</button>}
          <button type="button" onClick={onBack} className="btn-primary">{backLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Pops up for the host when someone is waiting, like Zoom's "X has entered the waiting room". */
export function WaitingBanner({ wr, onSeeAll }: { wr: WaitingRoomControls; onSeeAll: () => void }) {
  const first = wr.people[0];
  if (!first) return null;
  const more = wr.people.length - 1;
  return (
    <div role="status" aria-label="Waiting room" className="absolute right-3 top-3 z-30 w-[min(22rem,calc(100%-1.5rem))] rounded-xl bg-white p-3.5 text-sm text-navy-900 shadow-popover ring-1 ring-navy-100">
      <p className="font-semibold">
        {more > 0 ? `${wr.people.length} people are waiting to join` : `${first.name || 'Someone'} wants to join`}
      </p>
      <p className="mt-0.5 text-xs text-ivory-700">{more > 0 ? `${first.name || 'Someone'} and ${more} more` : 'They are in the waiting room.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {more > 0 ? (
          <>
            <button type="button" onClick={() => { void wr.admit('all'); }} className="inline-flex items-center gap-1.5 rounded-md bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-700"><UserCheck className="h-3.5 w-3.5" /> Admit all</button>
            <button type="button" onClick={onSeeAll} className="rounded-md px-3 py-1.5 text-xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">See waiting room</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { void wr.admit([first.ticket]); }} className="inline-flex items-center gap-1.5 rounded-md bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-700"><UserCheck className="h-3.5 w-3.5" /> Admit</button>
            <button type="button" onClick={() => { void wr.deny([first.ticket]); }} className="rounded-md px-3 py-1.5 text-xs font-semibold text-burgundy-600 ring-1 ring-inset ring-navy-100 hover:bg-burgundy-50">Deny</button>
          </>
        )}
      </div>
    </div>
  );
}

/** The "Waiting room" section at the top of the host's Participants panel. */
export function WaitingList({ wr }: { wr: WaitingRoomControls }) {
  if (!wr.people.length) return null;
  return (
    <section aria-label="Waiting room" className="border-b border-sand p-2">
      <div className="flex items-center justify-between px-2 py-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gold-700">Waiting room ({wr.people.length})</h3>
        {wr.people.length > 1 && <button type="button" onClick={() => { void wr.admit('all'); }} className="text-xs font-semibold text-navy-800 hover:underline">Admit all</button>}
      </div>
      <ul>
        {wr.people.map((p) => (
          <li key={p.ticket} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-navy-50">
            <span className="min-w-0 flex-1 truncate text-sm">{p.name || 'Someone'}</span>
            <button type="button" onClick={() => { void wr.admit([p.ticket]); }} aria-label={`Admit ${p.name}`} className="rounded-md bg-navy-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-700">Admit</button>
            <button type="button" onClick={() => { void wr.deny([p.ticket]); }} aria-label={`Deny ${p.name}`} className="rounded-md px-2 py-1 text-xs font-semibold text-burgundy-600 ring-1 ring-inset ring-navy-100 hover:bg-burgundy-50">Deny</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
