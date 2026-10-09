/**
 * Polls in a meeting, like Zoom's: the host asks, everyone answers, the host sees the results
 * and everyone sees them once they've answered or the poll ends. Sent over the data channel and
 * not saved after the meeting. Who voted comes from LiveKit, so one vote per person (changing
 * your answer replaces it), and the host counts the votes.
 */

export const MAX_OPTIONS = 10;
export const MAX_QUESTION = 200;
export const MAX_OPTION = 80;

export interface Poll {
  id: string;
  q: string;
  options: string[];
  /** More than one answer allowed. */
  multi: boolean;
}

export interface PollResults {
  id: string;
  counts: number[];
  voters: number;
  closed: boolean;
}

export type PollMsg =
  | { t: 'poll'; poll: Poll }
  | { t: 'vote'; id: string; picks: number[] }
  | { t: 'results'; results: PollResults }
  | { t: 'end'; id: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const okId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
const okCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100000;

/** A poll as typed by the host: trimmed, empty options dropped. null if it can't be asked yet. */
export function makePoll(id: string, q: string, options: string[], multi: boolean): Poll | null {
  const question = q.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION);
  const opts = options.map((o) => o.replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION)).filter(Boolean).slice(0, MAX_OPTIONS);
  if (!question || opts.length < 2) return null;
  return { id, q: question, options: opts, multi };
}

export function parsePollMsg(raw: unknown): PollMsg | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'poll' && isObj(raw.poll)) {
    const p = raw.poll;
    if (!okId(p.id) || typeof p.q !== 'string' || !Array.isArray(p.options) || !p.options.every((o) => typeof o === 'string')) return null;
    const poll = makePoll(p.id, p.q, p.options as string[], p.multi === true);
    return poll ? { t: 'poll', poll } : null;
  }
  if (raw.t === 'vote' && okId(raw.id) && Array.isArray(raw.picks)) {
    const picks = [...new Set(raw.picks.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < MAX_OPTIONS))];
    return picks.length ? { t: 'vote', id: raw.id, picks } : null;
  }
  if (raw.t === 'results' && isObj(raw.results)) {
    const r = raw.results;
    if (!okId(r.id) || !Array.isArray(r.counts) || r.counts.length > MAX_OPTIONS || !r.counts.every(okCount) || !okCount(r.voters)) return null;
    return { t: 'results', results: { id: r.id, counts: r.counts as number[], voters: r.voters, closed: r.closed === true } };
  }
  if (raw.t === 'end' && okId(raw.id)) return { t: 'end', id: raw.id };
  return null;
}

/** Keep only answers that fit this poll (one for single-choice polls). */
export function cleanPicks(poll: Poll, picks: number[]): number[] {
  const ok = [...new Set(picks)].filter((n) => n >= 0 && n < poll.options.length).sort((a, b) => a - b);
  return poll.multi ? ok : ok.slice(0, 1);
}

/** Count everyone's latest answers. */
export function tally(poll: Poll, votes: Record<string, number[]>, closed = false): PollResults {
  const counts = poll.options.map(() => 0);
  let voters = 0;
  for (const picks of Object.values(votes)) {
    const clean = cleanPicks(poll, picks);
    if (!clean.length) continue;
    voters += 1;
    for (const n of clean) counts[n] += 1;
  }
  return { id: poll.id, counts, voters, closed };
}

/** "42%" of the people who answered. */
export const percent = (count: number, voters: number) => (voters ? Math.round((count / voters) * 100) : 0);
