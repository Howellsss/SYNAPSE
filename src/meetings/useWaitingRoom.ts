import { useCallback, useEffect, useRef, useState } from 'react';
import { decideAdmissions, listWaiting, type Admission } from '@/lib/meetings';

/** How often the host checks the waiting room. */
export const HOST_POLL_MS = 3000;

export interface WaitingRoomControls {
  /** People waiting, oldest first. */
  people: Admission[];
  /** False until the database update for admissions is applied. */
  available: boolean;
  admit: (tickets: string[] | 'all') => Promise<void>;
  deny: (tickets: string[]) => Promise<void>;
}

/** The host's view of the waiting room: checks every few seconds while they're in the call. */
export function useWaitingRoom(meetingId: string, on: boolean, onError: (msg: string) => void): WaitingRoomControls {
  const [people, setPeople] = useState<Admission[]>([]);
  const [available, setAvailable] = useState(false);
  const errRef = useRef(onError);
  errRef.current = onError;

  const load = useCallback(async () => {
    const list = await listWaiting(meetingId);
    setAvailable(list !== null);
    setPeople(list ?? []);
  }, [meetingId]);

  useEffect(() => {
    if (!on) return;
    void load();
    const t = window.setInterval(() => { void load(); }, HOST_POLL_MS);
    return () => window.clearInterval(t);
  }, [on, load]);

  const decide = useCallback(async (tickets: string[] | 'all', status: 'admitted' | 'denied') => {
    // Take them off the list straight away; the next check confirms.
    setPeople((p) => (tickets === 'all' ? [] : p.filter((x) => !tickets.includes(x.ticket))));
    const err = await decideAdmissions(meetingId, tickets, status);
    if (err) errRef.current(err);
    void load();
  }, [meetingId, load]);

  return {
    people,
    available,
    admit: (t) => decide(t, 'admitted'),
    deny: (t) => decide(t, 'denied'),
  };
}
