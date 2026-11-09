import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, Loader2, Search, ShieldAlert, Undo2, Volume2, VolumeX, WifiOff, XCircle,
} from 'lucide-react';
import { useRouter } from '@/lib/router';
import { formatPrice } from '@/lib/events';
import {
  checkIn, checkInState, feedback, invalidText, resultColour, searchForCheckIn, undoCheckIn, untilAnswered,
  type CheckInAnswer, type CheckInPerson, type CheckInState,
} from '@/lib/checkin';
import { getQrReader } from '@/lib/qrReader';
import { useEventFonts } from '@/components/events/hooks';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

const SHOW_MS = 2000;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
const readPref = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const savePref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

/**
 * /check-in/<event>: the door scanner, full screen for a phone. Only the event's organisers and its
 * check-in team get in. Scan a ticket, or search by name, email, phone, ticket code or PIN.
 * Every result comes from the server; with no connection it says so and keeps trying.
 */
export function CheckInPage({ eventId }: { eventId: string }) {
  useEventFonts();
  const [, navigate] = useRouter();
  const [state, setState] = useState<CheckInState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [shown, setShown] = useState<CheckInAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<CheckInPerson | null>(null);
  const [sound, setSound] = useState(() => readPref('synapse.checkin.sound', true));
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = useRef(false);
  const cancel = useRef({ cancelled: false });

  const loadState = useCallback(async () => {
    try {
      const s = await untilAnswered(() => checkInState(eventId), setWaiting, cancel.current);
      setState(s); setLoadError(null);
    } catch (e) { if (!cancel.current.cancelled) setLoadError((e as Error).message); }
  }, [eventId]);

  useEffect(() => {
    const c = { cancelled: false };
    cancel.current = c;
    void loadState();
    // The count stays right while several people are scanning.
    const t = window.setInterval(() => { if (!busy.current) void checkInState(eventId).then(setState).catch(() => {}); }, 15000);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { c.cancelled = true; window.clearInterval(t); window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [eventId, loadState]);

  // One check-in at a time; the answer shows for two seconds (or until acted on, for unpaid tickets).
  const run = useCallback(async (how: { scan?: string; registration?: string; paid?: boolean }) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setActionError(null);
    try {
      const a = await untilAnswered(() => checkIn(eventId, how), setWaiting, cancel.current);
      setShown(a);
      feedback(resultColour(a), sound);
      if (a.result === 'success' && a.person) {
        setLast(a.person);
        setState((s) => (s ? { ...s, checked_in: (s.checked_in ?? 0) + 1 } : s));
      }
    } catch (e) {
      if (!cancel.current.cancelled) setActionError((e as Error).message);
    } finally {
      busy.current = false; setPending(false);
    }
  }, [eventId, sound]);

  useEffect(() => {
    if (!shown || (shown.result === 'not_eligible' && shown.reason === 'unpaid')) return;
    const t = window.setTimeout(() => setShown(null), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [shown]);

  const undo = async (p: CheckInPerson) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setActionError(null);
    try {
      await untilAnswered(() => undoCheckIn(eventId, p.registration_id), setWaiting, cancel.current);
      setShown(null);
      setLast((l) => (l?.registration_id === p.registration_id ? null : l));
      setState((s) => (s ? { ...s, checked_in: Math.max(0, (s.checked_in ?? 0) - 1) } : s));
    } catch (e) { setActionError((e as Error).message); } finally { busy.current = false; setPending(false); }
  };

  if (!state && !loadError) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-white">
          <LoadingSpinner className="h-10 w-10" />
          {waiting && <p className="flex items-center gap-2 text-sm"><WifiOff className="h-4 w-4" /> No connection — retrying…</p>}
        </div>
      </Screen>
    );
  }
  if (loadError || !state?.allowed) {
    return (
      <Screen>
        <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 text-center text-white">
          <ShieldAlert className="h-14 w-14 text-gold-400" />
          <h1 className="mt-4 font-display text-2xl font-bold">Check-in team only</h1>
          <p className="mt-2 text-navy-100">{loadError ?? 'You’re not on the check-in team for this event. Ask the organiser to add you from the event’s Check-in tab.'}</p>
          <button type="button" onClick={() => navigate('/dashboard')} className="mt-6 h-12 rounded-full bg-white px-6 text-sm font-semibold text-navy-900 hover:bg-navy-50">Back to SYNAPSE</button>
        </div>
      </Screen>
    );
  }

  const expected = state.expected ?? 0;
  const inCount = Math.min(state.checked_in ?? 0, expected || Infinity);
  const pct = expected ? Math.round((inCount / expected) * 100) : 0;
  const accent = state.brand?.primary ?? '#D4A84B';
  const offline = !online || waiting;

  return (
    <Screen>
      {/* Header: the event, the live count, sound, back */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-navy-950/95 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <button type="button" onClick={() => navigate(state.organiser ? `/events/${eventId}` : '/dashboard')} aria-label="Leave the scanner" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-navy-200">Check-in</p>
            <h1 className="truncate font-display text-lg font-bold text-white">{state.title}</h1>
          </div>
          <button type="button" onClick={() => { const v = !sound; setSound(v); savePref('synapse.checkin.sound', v); }} aria-pressed={sound} aria-label={sound ? 'Sound on' : 'Sound off'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10">
            {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
        </div>
        <div className="mx-auto mt-2 max-w-5xl px-1" aria-live="polite">
          <div className="flex items-baseline justify-between text-white">
            <p><span className="font-display text-3xl font-bold tabular-nums">{inCount}</span> <span className="text-navy-200">/ {expected} checked in</span></p>
            <p className="text-sm font-semibold tabular-nums text-navy-200">{pct}%</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: accent }} /></div>
        </div>
        {offline && (
          <p role="status" className="mx-auto mt-3 flex max-w-5xl items-center gap-2 rounded-xl bg-gold-400 px-3 py-2 text-sm font-semibold text-navy-950">
            <WifiOff className="h-4 w-4 shrink-0" /> No connection — retrying. Nothing is confirmed until it says so.
          </p>
        )}
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 content-start gap-4 px-4 py-4 lg:grid-cols-2 lg:gap-6">
        <Scanner paused={!!shown || pending} onCode={(raw) => { void run({ scan: raw }); }} />
        <div className="flex flex-col gap-4">
          {last && (
            <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3 text-white ring-1 ring-inset ring-white/10">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
              <p className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold">{last.name}</span> <span className="text-navy-200">checked in</span></p>
              <button type="button" onClick={() => { void undo(last); }} disabled={pending} className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-gold-300 hover:bg-white/10 disabled:opacity-50"><Undo2 className="h-4 w-4" /> Undo</button>
            </div>
          )}
          {actionError && <p role="alert" className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white">{actionError}</p>}
          <Lookup eventId={eventId} disabled={pending} onCheckIn={(id) => { void run({ registration: id }); }} onUndo={(p) => { void undo(p); }} refreshKey={state.checked_in ?? 0} />
        </div>
      </main>

      {(shown || (pending && waiting)) && (
        <ResultScreen
          answer={shown}
          waiting={pending && waiting}
          busy={pending}
          onClose={() => setShown(null)}
          onUndo={(p) => { void undo(p); }}
          onPaid={(p) => { setShown(null); void run({ registration: p.registration_id, paid: true }); }}
        />
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col bg-navy-950 font-sans">{children}</div>;
}

// ---------------------------------------------------------------- camera

function Scanner({ paused, onCode }: { paused: boolean; onCode: (raw: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<'off' | 'starting' | 'on'>('off');
  const [err, setErr] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setMode('off');
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    setErr(null); setMode('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocamera');
      const [s] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
        getQrReader(),
      ]);
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      setMode('on');
    } catch (e) {
      stop();
      setErr((e as Error)?.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or search below.'
        : 'The camera couldn’t start on this device. Search by name or ticket code below.');
    }
  };

  // Read the picture a few times a second; the same code is ignored for 3 seconds.
  useEffect(() => {
    if (mode !== 'on') return;
    let alive = true;
    let lastRaw = ''; let lastAt = 0;
    const tick = async () => {
      if (!alive) return;
      const v = video.current;
      if (v && v.readyState >= 2 && !pausedRef.current) {
        try {
          const reader = await getQrReader();
          const codes = await reader.detect(v);
          const raw = codes[0]?.rawValue?.trim();
          const now = Date.now();
          if (raw && (raw !== lastRaw || now - lastAt > 3000) && !pausedRef.current) {
            lastRaw = raw; lastAt = now;
            onCodeRef.current(raw);
          }
        } catch { /* keep looking */ }
      }
      if (alive) window.setTimeout(() => { void tick(); }, 250);
    };
    void tick();
    return () => { alive = false; };
  }, [mode]);

  return (
    <section aria-label="Scan a ticket" className="flex flex-col">
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black ring-1 ring-inset ring-white/10 lg:aspect-[4/3]">
        <video ref={video} muted playsInline autoPlay className={cn('h-full w-full object-cover', mode === 'on' ? '' : 'invisible')} />
        {mode === 'on' ? (
          <>
            <span className="pointer-events-none absolute inset-[16%] rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(5,12,28,0.45)]" aria-hidden="true" />
            <p className="absolute inset-x-0 bottom-4 text-center text-sm font-semibold text-white drop-shadow">Point at the ticket’s QR code</p>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
            <Camera className="h-12 w-12 text-navy-200" />
            <button type="button" onClick={() => { void start(); }} disabled={mode === 'starting'} className="flex h-14 items-center gap-2 rounded-full bg-gold-400 px-7 text-base font-bold text-navy-950 hover:bg-gold-300 disabled:opacity-70">
              {mode === 'starting' ? <><Loader2 className="h-5 w-5 animate-spin" /> Starting camera…</> : <><Camera className="h-5 w-5" /> Start scanning</>}
            </button>
            {err && <p role="alert" className="max-w-xs text-sm text-gold-200">{err}</p>}
          </div>
        )}
      </div>
      {mode === 'on' && (
        <button type="button" onClick={stop} className="mt-3 flex h-11 items-center justify-center gap-2 self-center rounded-full px-5 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 hover:bg-white/10"><CameraOff className="h-4 w-4" /> Stop camera</button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- manual lookup

function Lookup({ eventId, disabled, onCheckIn, onUndo, refreshKey }: {
  eventId: string; disabled: boolean; onCheckIn: (id: string) => void; onUndo: (p: CheckInPerson) => void; refreshKey: number;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CheckInPerson[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'offline' | 'error'>('idle');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows(null); setState('idle'); return; }
    let live = true;
    setState('loading');
    const t = window.setTimeout(() => {
      searchForCheckIn(eventId, term)
        .then((r) => { if (live) { setRows(r); setState('idle'); } })
        .catch((e: Error) => { if (live) setState(e.message === 'offline' ? 'offline' : 'error'); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, eventId, refreshKey]);

  return (
    <section aria-label="Find someone" className="rounded-3xl bg-white p-4 sm:p-5">
      <label htmlFor="checkin-search" className="text-sm font-semibold text-navy-900">Can’t scan? Find them</label>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-navy-300" />
        <input id="checkin-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false}
          placeholder="Name, email, phone, ticket code or PIN"
          className="h-14 w-full rounded-2xl border border-navy-100 pl-12 pr-4 text-[16px] text-navy-900 outline-none focus:border-gold-400 focus:ring-4 focus:ring-gold-400/20" />
      </div>
      <div className="mt-3" aria-live="polite">
        {state === 'loading' && <p className="px-1 py-2 text-sm text-navy-400">Searching…</p>}
        {state === 'offline' && <p className="flex items-center gap-2 px-1 py-2 text-sm font-semibold text-gold-800"><WifiOff className="h-4 w-4" /> No connection. Searching again when you type.</p>}
        {state === 'error' && <p className="px-1 py-2 text-sm text-burgundy-700">Search didn’t work. Please try again.</p>}
        {state === 'idle' && rows && rows.length === 0 && <p className="px-1 py-2 text-sm text-navy-400">Nobody registered matches “{q.trim()}”.</p>}
        {state === 'idle' && rows && rows.length > 0 && (
          <ul className="divide-y divide-navy-50">
            {rows.map((p) => {
              const holds = p.status === 'confirmed' || p.status === 'selected';
              return (
                <li key={p.registration_id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-navy-900">{p.name}</p>
                    <p className="truncate text-sm text-navy-400">{[p.type_name, p.ticket_code].filter(Boolean).join(' · ')}</p>
                  </div>
                  {!holds ? (
                    <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">{p.status === 'cancelled' ? 'Cancelled' : 'Not selected'}</span>
                  ) : p.checked_in_at ? (
                    <button type="button" disabled={disabled} onClick={() => onUndo(p)} title="Undo check-in" className="flex h-11 items-center gap-1.5 rounded-full bg-green-50 px-3 text-sm font-semibold text-green-800 hover:bg-green-100 disabled:opacity-50">
                      <CheckCircle2 className="h-4 w-4" /> In {time(p.checked_in_at)}
                    </button>
                  ) : (
                    <button type="button" disabled={disabled} onClick={() => onCheckIn(p.registration_id)} className="h-11 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-50">Check in</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the result, full screen

function ResultScreen({ answer, waiting, busy, onClose, onUndo, onPaid }: {
  answer: CheckInAnswer | null; waiting: boolean; busy: boolean; onClose: () => void; onUndo: (p: CheckInPerson) => void; onPaid: (p: CheckInPerson) => void;
}) {
  if (!answer || waiting) {
    return (
      <div role="alertdialog" aria-live="assertive" aria-label="Checking" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-navy-900 px-6 text-center text-white">
        <WifiOff className="h-16 w-16 text-gold-400" />
        <p className="mt-5 font-display text-3xl font-bold">No connection</p>
        <p className="mt-2 text-lg text-navy-100">Retrying… Don’t let them in until this turns green.</p>
        <Loader2 className="mt-6 h-8 w-8 animate-spin text-navy-200" />
      </div>
    );
  }
  const colour = resultColour(answer);
  const p = answer.person;
  const unpaid = answer.reason === 'unpaid' && p;
  const bg = colour === 'green' ? 'bg-green-600 text-white' : colour === 'amber' ? 'bg-amber-400 text-navy-950' : 'bg-red-600 text-white';
  const title = answer.result === 'success' ? 'Checked in'
    : answer.result === 'already_checked_in' ? 'Already checked in'
    : unpaid ? 'Payment due' : 'Not valid';
  const Icon = colour === 'green' ? CheckCircle2 : colour === 'amber' ? AlertTriangle : XCircle;
  return (
    <div role="alertdialog" aria-live="assertive" aria-label={title} onClick={unpaid ? undefined : onClose}
      className={cn('fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center', bg)}>
      <Icon className="h-24 w-24" strokeWidth={2.2} />
      <p className="mt-4 font-display text-4xl font-bold sm:text-5xl">{title}</p>
      {p && <p className="mt-4 text-2xl font-semibold sm:text-3xl">{p.name}</p>}
      {p && (p.type_name || p.ticket_code) && <p className="mt-1 text-lg opacity-90">{[p.type_name, p.ticket_code].filter(Boolean).join(' · ')}</p>}
      {answer.result === 'already_checked_in' && p?.checked_in_at && (
        <p className="mt-4 text-lg font-semibold">First checked in at {time(p.checked_in_at)}{p.checked_in_by ? ` by ${p.checked_in_by}` : ''}</p>
      )}
      {answer.result === 'invalid' && <p className="mt-4 max-w-md text-lg">{invalidText(answer.reason)}</p>}
      {answer.result === 'not_eligible' && !unpaid && <p className="mt-4 max-w-md text-lg">{invalidText(answer.reason)}</p>}
      {unpaid && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <p className="text-xl font-semibold">Collect {formatPrice(p.amount_minor, p.currency ?? 'NGN')} before entry</p>
          <div className="flex gap-3">
            <button type="button" disabled={busy} onClick={() => onPaid(p)} className="h-14 rounded-full bg-navy-950 px-6 text-base font-bold text-white hover:bg-navy-900 disabled:opacity-50">Paid · check in</button>
            <button type="button" onClick={onClose} className="h-14 rounded-full px-6 text-base font-semibold ring-2 ring-inset ring-navy-950/40 hover:bg-white/20">Not now</button>
          </div>
        </div>
      )}
      {answer.result === 'success' && p && (
        <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onUndo(p); }} className="mt-8 flex h-12 items-center gap-2 rounded-full bg-white/15 px-5 text-base font-semibold hover:bg-white/25 disabled:opacity-50"><Undo2 className="h-5 w-5" /> Undo</button>
      )}
      {!unpaid && <p className="absolute bottom-[max(24px,env(safe-area-inset-bottom))] text-sm opacity-80">Tap to continue</p>}
    </div>
  );
}
