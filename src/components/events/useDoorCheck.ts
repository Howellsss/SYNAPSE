import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { checkIn, checkInState, feedback, resultColour, undoCheckIn, untilAnswered, type CheckInAnswer } from '@/lib/checkin';

/**
 * Door staff scanning a ticket's QR with any phone camera land on the ticket's link. When the
 * person holding that phone is signed in as the event's organiser or check-in team, the guest is
 * checked in straight away and the screen turns green (amber: already in; red: not valid). The
 * database decides, exactly as in the scanner. Everyone else gets null here and sees the ticket.
 */
export function useDoorCheck(eventId: string | null, scan: string) {
  const { user, loading } = useAuth();
  const [answer, setAnswer] = useState<CheckInAnswer | null>(null);
  const [staff, setStaff] = useState<boolean | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user || !eventId || started.current) { if (!user) setStaff(false); return; }
    started.current = true;
    const signal = { cancelled: false };
    void (async () => {
      try {
        const state = await untilAnswered(() => checkInState(eventId), setWaiting, signal);
        if (!state.allowed) { setStaff(false); return; }
        setStaff(true);
        const a = await untilAnswered(() => checkIn(eventId, { scan }), setWaiting, signal);
        setAnswer(a);
        feedback(resultColour(a), true);
      } catch (e) {
        if (signal.cancelled) return;
        // Not on the team (or no check-in for this database yet): just show the ticket.
        setStaff((s) => (s === true ? true : false));
        setError((e as Error).message);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [user, loading, eventId, scan]);

  const markPaid = async () => {
    if (!eventId || !answer?.person) return;
    const a = await untilAnswered(() => checkIn(eventId, { registration: answer.person!.registration_id, paid: true }), setWaiting);
    setAnswer(a); feedback(resultColour(a), true);
  };
  const undo = async () => {
    if (!eventId || !answer?.person) return;
    await untilAnswered(() => undoCheckIn(eventId, answer.person!.registration_id), setWaiting);
    setAnswer({ result: 'invalid', reason: 'undone', person: { ...answer.person, checked_in_at: null } });
  };
  return { staff, answer, waiting, error, markPaid, undo, eventId };
}

