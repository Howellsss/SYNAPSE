import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { checkIn, checkInState, feedback, resultColour, undoCheckIn, untilAnswered, type CheckInAnswer } from '@/lib/checkin';
import { doorCheckIn, doorUndo, forgetPass, storedPass } from '@/lib/doorPass';

/**
 * Door staff scanning a ticket's QR with any phone camera land on the ticket's link. The guest is
 * checked in straight away, and the screen turns green (amber: already in; red: not valid), when
 * that phone holds a door pass for the event (a volunteer, no account) or is signed in as the
 * event's organiser or check-in team. The database decides, exactly as in the scanner. Everyone
 * else gets staff = false here and sees the ticket.
 */
export function useDoorCheck(eventId: string | null, scan: string) {
  const { user, loading } = useAuth();
  const [answer, setAnswer] = useState<CheckInAnswer | null>(null);
  const [staff, setStaff] = useState<boolean | null>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!eventId || started.current) return;
    const held = storedPass(eventId);
    if (!held && loading) return;
    started.current = true;
    const signal = { cancelled: false };
    void (async () => {
      // A door pass on this phone: no sign-in needed.
      if (held) {
        setPass(held); setStaff(true);
        try {
          const a = await untilAnswered(() => doorCheckIn(held, scan), setWaiting, signal);
          setAnswer(a); feedback(resultColour(a), true);
        } catch (e) {
          if (signal.cancelled) return;
          if (/no longer works/.test((e as Error).message)) forgetPass(eventId);
          setError((e as Error).message);
        }
        return;
      }
      if (!user) { setStaff(false); return; }
      try {
        const state = await untilAnswered(() => checkInState(eventId), setWaiting, signal);
        if (!state.allowed) { setStaff(false); return; }
        setStaff(true);
        const a = await untilAnswered(() => checkIn(eventId, { scan }), setWaiting, signal);
        setAnswer(a); feedback(resultColour(a), true);
      } catch (e) {
        if (signal.cancelled) return;
        // Not on the team (or no check-in for this database yet): just show the ticket.
        setStaff((s) => (s === true ? true : false));
        setError((e as Error).message);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [user, loading, eventId, scan]);

  // Signed out with no pass: nothing to wait for.
  useEffect(() => { if (!loading && !user && eventId && !storedPass(eventId)) setStaff(false); }, [loading, user, eventId]);

  const markPaid = async () => {
    if (!eventId || !answer?.person) return;
    const a = pass
      ? await untilAnswered(() => doorCheckIn(pass, scan, true), setWaiting)
      : await untilAnswered(() => checkIn(eventId, { registration: answer.person!.registration_id, paid: true }), setWaiting);
    setAnswer(a); feedback(resultColour(a), true);
  };
  const undo = async () => {
    if (!eventId || !answer?.person) return;
    const id = answer.person.registration_id;
    await untilAnswered(() => (pass ? doorUndo(pass, id) : undoCheckIn(eventId, id)), setWaiting);
    setAnswer({ result: 'invalid', reason: 'undone', person: { ...answer.person, checked_in_at: null } });
  };
  return { staff, answer, waiting, error, markPaid, undo, eventId, byPass: !!pass };
}
