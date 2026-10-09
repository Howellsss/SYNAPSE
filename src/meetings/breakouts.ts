import type { BreakoutRoom, BreakoutState } from '@/lib/meetings';

/**
 * Breakout rooms: the host splits the meeting into smaller rooms for a while. The plan lives on
 * the meeting (meetings.breakout), so everyone's app sees it within a few seconds, and the
 * livekit-token function only lets people into the room they were put in.
 */

export const MAX_ROOMS = 20;

export function makeRooms(n: number): BreakoutRoom[] {
  const count = Math.max(1, Math.min(MAX_ROOMS, Math.floor(n)));
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, name: `Room ${i + 1}` }));
}

/** Spread people evenly over the rooms, in a random order. */
export function autoAssign(ids: string[], rooms: number, random: () => number = Math.random): Record<string, number> {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const n = Math.max(1, Math.min(MAX_ROOMS, rooms));
  return Object.fromEntries(order.map((id, i) => [id, (i % n) + 1]));
}

/** The meeting's breakout plan as read from the server, checked. null when there isn't one. */
export function parseBreakout(raw: unknown): BreakoutState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const rooms = Array.isArray(r.rooms)
    ? (r.rooms as unknown[]).flatMap((x) => {
      const o = x as { n?: unknown; name?: unknown } | null;
      return o && typeof o.n === 'number' && Number.isInteger(o.n) && o.n >= 1 && o.n <= MAX_ROOMS
        ? [{ n: o.n, name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : `Room ${o.n}` }]
        : [];
    }).slice(0, MAX_ROOMS)
    : [];
  const assign: Record<string, number> = {};
  if (r.assign && typeof r.assign === 'object') {
    for (const [k, v] of Object.entries(r.assign as Record<string, unknown>)) {
      if (typeof v === 'number' && rooms.some((x) => x.n === v)) assign[k] = v;
    }
  }
  const names: Record<string, string> = {};
  if (r.names && typeof r.names === 'object') {
    for (const [k, v] of Object.entries(r.names as Record<string, unknown>)) if (typeof v === 'string') names[k] = v.slice(0, 80);
  }
  const message = r.message && typeof r.message === 'object' ? r.message as { text?: unknown; at?: unknown } : null;
  return {
    open: r.open === true && rooms.length > 0,
    rooms,
    assign,
    ends_at: typeof r.ends_at === 'string' ? r.ends_at : null,
    message: message && typeof message.text === 'string' && typeof message.at === 'string' ? { text: message.text.slice(0, 300), at: message.at } : null,
    names,
  };
}

/** The room this person is in while rooms are open (0 = main room). */
export function roomOf(b: BreakoutState | null, id: string): number {
  return b?.open ? b.assign[id] ?? 0 : 0;
}

/** "4:05 left" */
export function timeLeft(endsAt: string | null | undefined, now: number): string | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
}
