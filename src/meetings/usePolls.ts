import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { TOPICS, type MeetingBus } from './useMeetingBus';
import { cleanPicks, makePoll, parsePollMsg, tally, type Poll, type PollResults } from './polls';
import { newChatId } from './messages';

export interface PollState {
  poll: Poll;
  results: PollResults | null;
  /** What you answered, or null if you haven't. */
  mine: number[] | null;
  closed: boolean;
}

export interface Polls {
  list: PollState[];
  /** The poll that's open now, if any. */
  active: PollState | null;
  /** New polls you haven't looked at. */
  unseen: number;
  markSeen: () => void;
  launch: (q: string, options: string[], multi: boolean) => boolean;
  vote: (id: string, picks: number[]) => void;
  end: (id: string) => void;
}

/**
 * Polls over the data channel. Only the host's polls, results and "ended" messages count; votes
 * go to the host, who counts them and shares the totals with everyone.
 */
export function usePolls({ bus, room, isHost, hostId, me }: { bus: MeetingBus; room: Room | null; isHost: boolean; hostId: string; me: string }): Polls {
  const [list, setList] = useState<PollState[]>([]);
  const [unseen, setUnseen] = useState(0);
  const votes = useRef(new Map<string, Record<string, number[]>>());
  const listRef = useRef(list);
  listRef.current = list;
  const sendTimer = useRef<Record<string, number>>({});

  const update = useCallback((id: string, fn: (s: PollState) => PollState) => setList((l) => l.map((s) => (s.poll.id === id ? fn(s) : s))), []);

  // Host: share the totals (at most twice a second while votes come in).
  const share = useCallback((id: string, closed = false) => {
    const s = listRef.current.find((x) => x.poll.id === id);
    if (!s) return;
    const results = tally(s.poll, votes.current.get(id) ?? {}, closed);
    update(id, (x) => ({ ...x, results, closed: closed || x.closed }));
    window.clearTimeout(sendTimer.current[id]);
    const go = () => { void bus.send(TOPICS.poll, { t: 'results', results }); };
    if (closed) go();
    else sendTimer.current[id] = window.setTimeout(go, 500);
  }, [bus, update]);

  useEffect(() => bus.on(TOPICS.poll, (raw, from) => {
    const msg = parsePollMsg(raw);
    if (!msg) return;
    if (msg.t === 'vote') {
      if (!isHost) return;
      const s = listRef.current.find((x) => x.poll.id === msg.id);
      if (!s || s.closed) return;
      const picks = cleanPicks(s.poll, msg.picks);
      if (!picks.length) return;
      const byPerson = votes.current.get(msg.id) ?? {};
      byPerson[from] = picks;
      votes.current.set(msg.id, byPerson);
      share(msg.id);
      return;
    }
    if (from !== hostId) return;
    if (msg.t === 'poll') {
      setList((l) => (l.some((s) => s.poll.id === msg.poll.id) ? l : [{ poll: msg.poll, results: null, mine: null, closed: false }, ...l.map((s) => ({ ...s, closed: true }))]));
      setUnseen((n) => n + 1);
    } else if (msg.t === 'results') {
      update(msg.results.id, (s) => (msg.results.counts.length === s.poll.options.length ? { ...s, results: msg.results, closed: s.closed || msg.results.closed } : s));
    } else if (msg.t === 'end') {
      update(msg.id, (s) => ({ ...s, closed: true }));
    }
  }), [bus, isHost, hostId, share, update]);

  // Host: someone joins while a poll is open -> send it to them, with the totals so far.
  useEffect(() => {
    if (!room || !isHost) return;
    const onJoin = (p: { identity: string }) => {
      const s = listRef.current.find((x) => !x.closed);
      if (!s) return;
      void bus.send(TOPICS.poll, { t: 'poll', poll: s.poll }, { to: [p.identity] });
      if (s.results) void bus.send(TOPICS.poll, { t: 'results', results: s.results }, { to: [p.identity] });
    };
    room.on('participantConnected', onJoin);
    return () => { room.off('participantConnected', onJoin); };
  }, [room, isHost, bus]);

  const launch = useCallback((q: string, options: string[], multi: boolean) => {
    const poll = makePoll(newChatId(), q, options, multi);
    if (!poll || !isHost) return false;
    // One poll at a time, as in Zoom: launching a new one ends the open one.
    for (const s of listRef.current) if (!s.closed) { void bus.send(TOPICS.poll, { t: 'end', id: s.poll.id }); }
    votes.current.set(poll.id, {});
    setList((l) => [{ poll, results: tally(poll, {}), mine: null, closed: false }, ...l.map((s) => ({ ...s, closed: true }))]);
    void bus.send(TOPICS.poll, { t: 'poll', poll });
    return true;
  }, [bus, isHost]);

  const vote = useCallback((id: string, picks: number[]) => {
    const s = listRef.current.find((x) => x.poll.id === id);
    if (!s || s.closed) return;
    const clean = cleanPicks(s.poll, picks);
    if (!clean.length) return;
    update(id, (x) => ({ ...x, mine: clean }));
    if (isHost) {
      const byPerson = votes.current.get(id) ?? {};
      byPerson[me] = clean;
      votes.current.set(id, byPerson);
      share(id);
    } else {
      void bus.send(TOPICS.poll, { t: 'vote', id, picks: clean }, { to: [hostId] });
    }
  }, [bus, isHost, hostId, me, share, update]);

  const end = useCallback((id: string) => {
    if (!isHost) return;
    void bus.send(TOPICS.poll, { t: 'end', id });
    share(id, true);
  }, [bus, isHost, share]);

  return {
    list,
    active: list.find((s) => !s.closed) ?? null,
    unseen,
    markSeen: useCallback(() => setUnseen(0), []),
    launch, vote, end,
  };
}
