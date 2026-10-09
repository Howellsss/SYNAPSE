import { useState } from 'react';
import { DoorOpen, LogIn, Send, Shuffle, Users } from 'lucide-react';
import { Panel } from './MeetingPanels';
import { autoAssign, makeRooms, timeLeft, MAX_ROOMS } from '@/meetings/breakouts';
import type { BreakoutState } from '@/lib/meetings';
import { cn } from '@/lib/utils';

const DURATIONS = [0, 5, 10, 15, 30, 45];

/** The host's breakout rooms: plan them, open them, visit them, message them, close them. */
export function BreakoutPanel({ plan, people, hostRoom, now, onOpen, onCloseRooms, onMessage, onVisit, onClose }: {
  plan: BreakoutState | null;
  /** Everyone in the main room except the host. */
  people: { id: string; name: string }[];
  /** Where the host is now (0 = main room). */
  hostRoom: number;
  now: number;
  onOpen: (plan: BreakoutState) => void;
  onCloseRooms: () => void;
  onMessage: (text: string) => void;
  onVisit: (n: number) => void;
  onClose: () => void;
}) {
  const [count, setCount] = useState(Math.min(MAX_ROOMS, Math.max(2, Math.ceil(people.length / 3))));
  const [minutes, setMinutes] = useState(0);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');
  const rooms = makeRooms(count);
  const unassigned = people.filter((p) => !assign[p.id]);

  if (plan?.open) {
    const names = plan.names ?? {};
    const left = timeLeft(plan.ends_at, now);
    return (
      <Panel title="Breakout rooms" onClose={onClose}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-700" role="status">Rooms are open{left ? ` · ${left}` : ''}</p>
          {plan.rooms.map((r) => {
            const inRoom = Object.entries(plan.assign).filter(([, n]) => n === r.n).map(([id]) => names[id] ?? 'Guest');
            return (
              <section key={r.n} aria-label={r.name} className={cn('rounded-xl border p-3', hostRoom === r.n ? 'border-gold-400' : 'border-navy-100')}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{r.name} <span className="font-normal text-ivory-700">({inRoom.length})</span></h3>
                  {hostRoom === r.n
                    ? <span className="text-xs font-semibold text-gold-700">You're here</span>
                    : <button type="button" onClick={() => onVisit(r.n)} aria-label={`Join ${r.name}`} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><LogIn className="h-3.5 w-3.5" /> Join</button>}
                </div>
                <p className="mt-1 text-xs text-ivory-700">{inRoom.length ? inRoom.join(', ') : 'Nobody yet'}</p>
              </section>
            );
          })}
          {hostRoom !== 0 && <button type="button" onClick={() => onVisit(0)} className="btn-secondary w-full"><DoorOpen className="h-4 w-4" /> Back to the main room</button>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (message.trim()) { onMessage(message.trim()); setMessage(''); } }}>
            <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} aria-label="Message to all rooms" placeholder="Message to all rooms" className="input-field h-10 min-w-0 flex-1 text-sm" />
            <button type="submit" aria-label="Send to all rooms" disabled={!message.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold-400 text-navy-900 hover:bg-gold-300 disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        </div>
        <footer className="border-t border-sand p-3">
          <button type="button" onClick={onCloseRooms} className="h-10 w-full rounded-lg bg-burgundy-500 text-sm font-semibold text-white hover:bg-burgundy-600">Close all rooms</button>
        </footer>
      </Panel>
    );
  }

  const open = () => {
    const finalAssign = Object.fromEntries(Object.entries(assign).filter(([id, n]) => n >= 1 && n <= count && people.some((p) => p.id === id)));
    onOpen({
      open: true,
      rooms,
      assign: finalAssign,
      ends_at: minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null,
      message: null,
      names: Object.fromEntries(people.map((p) => [p.id, p.name])),
    });
  };

  return (
    <Panel title="Breakout rooms" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy-800">Rooms</span>
            <input type="number" min={1} max={MAX_ROOMS} value={count} onChange={(e) => setCount(Math.max(1, Math.min(MAX_ROOMS, Number(e.target.value) || 1)))} className="input-field h-10 text-sm" aria-label="Number of rooms" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy-800">Time</span>
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="input-field h-10 text-sm" aria-label="How long">
              {DURATIONS.map((m) => <option key={m} value={m}>{m ? `${m} minutes` : 'No limit'}</option>)}
            </select>
          </label>
        </div>
        <button type="button" onClick={() => setAssign(autoAssign(people.map((p) => p.id), count))} disabled={!people.length} className="btn-secondary w-full disabled:opacity-50"><Shuffle className="h-4 w-4" /> Assign automatically</button>
        {!people.length ? (
          <div className="pt-6 text-center">
            <Users className="mx-auto h-8 w-8 text-ivory-500" />
            <p className="mt-2 text-sm text-ivory-700">When people join, you can put them into rooms here.</p>
          </div>
        ) : (
          <ul className="space-y-1" aria-label="Who goes where">
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-navy-50">
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                <select
                  value={assign[p.id] && assign[p.id] <= count ? assign[p.id] : 0}
                  onChange={(e) => setAssign((a) => ({ ...a, [p.id]: Number(e.target.value) }))}
                  aria-label={`Room for ${p.name}`}
                  className="h-8 rounded-md border border-navy-100 bg-white px-2 text-xs"
                >
                  <option value={0}>Main room</option>
                  {rooms.map((r) => <option key={r.n} value={r.n}>{r.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
        {people.length > 0 && unassigned.length > 0 && <p className="text-xs text-ivory-700">{unassigned.length} {unassigned.length === 1 ? 'person stays' : 'people stay'} in the main room.</p>}
      </div>
      <footer className="border-t border-sand p-3">
        <button type="button" onClick={open} disabled={!people.length || unassigned.length === people.length} className="btn-primary w-full disabled:opacity-50">Open rooms</button>
      </footer>
    </Panel>
  );
}
