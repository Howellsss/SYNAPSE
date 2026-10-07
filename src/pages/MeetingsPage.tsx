import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Video, Plus, ChevronDown, Link2, CalendarDays, Play, Sparkles, Copy, ExternalLink, Download, Loader2, History, Radio,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { createMeeting, findMeeting, listMeetings, listTodaysVideoAppointments, type Meeting, type MeetingKind, type VideoAppointment } from '@/lib/meetings';
import { calendarLinks, isSameDay, meetingUrl, parseJoinInput, startsLabel, toNickname } from '@/meetings/codes';
import { startOf, upcomingRooms } from '@/meetings/lists';
import { Popover } from '@/components/spaces/room/Popover';
import { menuItem } from '@/components/spaces/room/styles';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { cn } from '@/lib/utils';

type Tab = 'meetings' | 'calls';

const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function MeetingsPage() {
  const { workspace, user, profile } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [tab, setTab] = useState<Tab>('meetings');
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [appointments, setAppointments] = useState<VideoAppointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joinText, setJoinText] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState<null | 'later' | 'scheduled'>(null);
  const [startingInstant, setStartingInstant] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!workspace) return;
    setError(null);
    const [{ data, error: err }, appts] = await Promise.all([listMeetings(workspace.id), listTodaysVideoAppointments(workspace.id)]);
    if (err) { setError(err); setMeetings([]); return; }
    setMeetings(data);
    setAppointments(appts);
  }, [workspace]);

  useEffect(() => { load(); }, [load]);
  // Keep "in 5 min" labels fresh.
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(t); }, []);

  const today = useMemo(() => (meetings ?? []).filter((m) => isSameDay(startOf(m), now) && (m.kind === 'scheduled' || !m.ended_at))
    .sort((a, b) => startOf(a).getTime() - startOf(b).getTime()), [meetings, now]);
  const upcoming = useMemo(() => upcomingRooms(meetings ?? [], now).slice(0, 5), [meetings, now]);
  const calls = useMemo(() => (meetings ?? []).filter((m) => m.ended_at || startOf(m).getTime() < now.getTime() - 12 * 3600000)
    .sort((a, b) => startOf(b).getTime() - startOf(a).getTime()), [meetings, now]);

  if (!workspace || !user) return null;

  const enter = (code: string) => navigate(`/meetings/${code}`);

  const startInstant = async () => {
    setStartingInstant(true);
    const first = profile?.first_name?.trim();
    const { data, error: err } = await createMeeting({ workspaceId: workspace.id, hostId: user.id, title: first ? `${first}'s room` : 'Instant meeting', kind: 'instant' });
    setStartingInstant(false);
    if (err || !data) { toast(err ?? 'Could not start a meeting.', 'error'); return; }
    enter(data.code);
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    const q = parseJoinInput(joinText);
    if (!q) { setJoinError('Enter a meeting code like FOCU-358, a link, or a nickname.'); return; }
    setJoining(true);
    const m = await findMeeting(workspace.id, q);
    setJoining(false);
    if (!m) { setJoinError("No meeting with that code or nickname in your account."); return; }
    enter(m.code);
  };

  const newMenu = (variant: 'header' | 'empty') => (
    <Popover
      label="New meeting"
      panelClassName={cn('top-full mt-2 w-64', variant === 'header' ? 'right-0' : 'left-1/2 -translate-x-1/2')}
      trigger={({ open, toggle }) => (
        variant === 'header' ? (
          <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="btn-primary h-11 !px-5">
            <Plus className="h-4 w-4" /> New <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} />
          </button>
        ) : (
          <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="btn-primary h-12 !px-6 text-[15px]">
            <Video className="h-5 w-5" /> New meeting
          </button>
        )
      )}
    >
      {(close) => (
        <>
          <button role="menuitem" className={cn(menuItem, 'py-2.5 font-medium')} onClick={() => { close(); setCreating('later'); }}>
            <Link2 className="h-4 w-4 text-navy-500" /> Create a meeting for later
          </button>
          <button role="menuitem" className={cn(menuItem, 'py-2.5 font-medium')} disabled={startingInstant} onClick={() => { close(); startInstant(); }}>
            {startingInstant ? <Loader2 className="h-4 w-4 animate-spin text-green-600" /> : <Video className="h-4 w-4 text-green-600" />} Start an instant meeting
          </button>
          <button role="menuitem" className={cn(menuItem, 'py-2.5 font-medium')} onClick={() => { close(); setCreating('scheduled'); }}>
            <CalendarDays className="h-4 w-4 text-purple-600" /> Schedule in calendar
          </button>
        </>
      )}
    </Popover>
  );

  return (
    <div className="w-full pb-8">
      {/* Top row */}
      <div className="flex flex-wrap items-center gap-3 border-b border-sand pb-5">
        <div role="tablist" aria-label="Meetings or calls" className="flex rounded-lg bg-white p-1 ring-1 ring-inset ring-navy-100">
          {(['meetings', 'calls'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn('rounded-md px-4 py-1.5 text-sm font-semibold transition', tab === t ? 'bg-navy-800 text-white' : 'text-navy-700 hover:bg-navy-50')}
            >
              {t === 'meetings' ? 'Meetings' : 'Calls'}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold text-navy-800">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
        <div className="flex-1" />
        <form onSubmit={join} className="flex w-full items-center gap-2 sm:w-auto" noValidate>
          <label className={cn('flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border bg-white pl-3 pr-1 transition sm:w-[300px] sm:flex-none', joinError ? 'border-burgundy-400' : 'border-navy-100 focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-400/30')}>
            <Video className="h-4 w-4 shrink-0 text-ivory-600" />
            <input
              value={joinText}
              onChange={(e) => { setJoinText(e.target.value); setJoinError(null); }}
              placeholder="Enter a code or nickname"
              aria-label="Meeting code or nickname"
              className="min-w-0 flex-1 bg-transparent text-sm text-navy-800 placeholder:text-ivory-600 focus:outline-none"
            />
            <button type="submit" disabled={!joinText.trim() || joining} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-gold-700 transition hover:bg-gold-50 disabled:text-ivory-500">
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join'}
            </button>
          </label>
          <div className="sm:hidden">{newMenu('header')}</div>
        </form>
        <div className="hidden sm:block">{newMenu('header')}</div>
        {joinError && <p role="alert" className="w-full text-right text-xs text-burgundy-600">{joinError}</p>}
      </div>

      {error ? (
        <div className="mt-6"><ErrorState message={`Couldn't load meetings. ${error}`} onRetry={() => { setMeetings(null); load(); }} /></div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* Main card */}
          <section className="min-h-[420px] rounded-xl border border-sand bg-white p-6 shadow-card sm:min-h-[500px] sm:p-8" aria-label={tab === 'meetings' ? "Today's meetings" : 'Calls'}>
            {meetings === null ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
            ) : tab === 'meetings' ? (
              today.length || appointments.length ? (
                <TodayList meetings={today} appointments={appointments} now={now} onEnter={enter} />
              ) : (
                <Empty
                  icon={<Video className="h-10 w-10" />}
                  title="No meetings scheduled for today"
                  text={<>Schedule a meeting or click <strong className="text-navy-800">New</strong> to start an instant room or create a meeting link for later.</>}
                  action={newMenu('empty')}
                />
              )
            ) : calls.length ? (
              <CallsList meetings={calls} onEnter={enter} />
            ) : (
              <Empty icon={<History className="h-10 w-10" />} title="No calls yet" text="Meetings you've finished show up here." />
            )}
          </section>

          {/* Right column */}
          <div className="space-y-6">
            <section className="rounded-xl border border-sand bg-white p-6 shadow-card" aria-label="Upcoming rooms">
              <div className="border-b border-sand pb-4">
                <h2 className="text-base font-bold text-navy-800">Upcoming rooms</h2>
                <p className="mt-1 text-sm text-ivory-700">Encrypted HD video</p>
              </div>
              {meetings === null ? (
                <div className="mt-4 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
              ) : upcoming.length ? (
                <ul className="mt-4 space-y-3">
                  {upcoming.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-sand bg-white p-4 shadow-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-navy-800">{m.title}</p>
                        <p className="mt-1 truncate text-xs text-ivory-700">{roomWhen(m, now)} · Room {m.code}</p>
                      </div>
                      <button type="button" onClick={() => enter(m.code)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-700" aria-label={`Enter ${m.title}`}>
                        <Play className="h-3.5 w-3.5" /> Enter
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-2xl bg-ivory-50 px-4 py-5 text-center text-sm text-ivory-700">No upcoming rooms. Use <strong className="text-navy-800">New</strong> to start or schedule one.</p>
              )}
            </section>

            <section className="rounded-xl border border-sand bg-white p-6 shadow-card" aria-label="Meeting intelligence">
              <div className="flex items-start justify-between gap-3 border-b border-sand pb-4">
                <div>
                  <h2 className="text-base font-bold text-navy-800">Meeting intelligence</h2>
                  <p className="mt-1 text-sm text-ivory-700">AI brief & transcript memory</p>
                </div>
                <Sparkles className="h-5 w-5 shrink-0 text-gold-600" />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-navy-700">Searchable transcripts and action items from your meetings will collect here, ready for your AI assistant.</p>
              <button type="button" onClick={() => navigate('/ai-hub')} className="btn-secondary mt-4 w-full">Open knowledge base</button>
            </section>
          </div>
        </div>
      )}

      {creating && (
        <CreateMeetingModal
          kind={creating}
          onClose={() => setCreating(null)}
          onCreated={(m) => { setMeetings((list) => [m, ...(list ?? [])]); }}
          onEnter={enter}
        />
      )}
    </div>
  );
}

function roomWhen(m: Meeting, now: Date): string {
  if (m.kind === 'scheduled') return startsLabel(new Date(m.scheduled_at!), now);
  return m.kind === 'instant' ? 'Live now' : 'Ready now';
}

function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
      <span className="flex h-28 w-36 items-center justify-center rounded-xl bg-gradient-to-br from-navy-50 to-ivory-100 text-navy-600 shadow-sm">{icon}</span>
      <h2 className="mt-8 text-2xl font-bold text-navy-800">{title}</h2>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ivory-700">{text}</p>
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

function TodayList({ meetings, appointments, now, onEnter }: { meetings: Meeting[]; appointments: VideoAppointment[]; now: Date; onEnter: (code: string) => void }) {
  const rows = [
    ...meetings.map((m) => ({ key: m.id, at: startOf(m), node: <MeetingRow m={m} now={now} onEnter={onEnter} /> })),
    ...appointments.map((a) => ({ key: a.id, at: new Date(a.start_time), node: <AppointmentRow a={a} /> })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return (
    <div>
      <h2 className="text-lg font-bold text-navy-800">Today</h2>
      <ul className="mt-4 divide-y divide-sand">{rows.map((r) => <li key={r.key}>{r.node}</li>)}</ul>
    </div>
  );
}

function MeetingRow({ m, now, onEnter }: { m: Meeting; now: Date; onEnter: (code: string) => void }) {
  const at = startOf(m);
  const copy = async () => { try { await navigator.clipboard.writeText(meetingUrl(m.code)); } catch { /* ignore */ } };
  const live = !m.ended_at && (m.kind === 'instant' || (m.kind === 'scheduled' && at <= now && now.getTime() < at.getTime() + m.duration_min * 60000));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
      <span className="w-20 shrink-0 text-sm font-semibold text-navy-800">{m.kind === 'scheduled' ? fmtTime(at) : 'Anytime'}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-semibold text-navy-800">
          {m.title}
          {live && <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green-700"><Radio className="h-3 w-3" /> Live</span>}
          {m.ended_at && <span className="rounded-md bg-ivory-200/60 px-2 py-0.5 text-[11px] font-semibold text-ivory-800">Ended</span>}
        </p>
        <p className="mt-0.5 truncate text-xs text-ivory-700">Room {m.code}{m.nickname ? ` · ${m.nickname}` : ''}{m.kind === 'scheduled' ? ` · ${m.duration_min} min` : ''}</p>
      </div>
      <button type="button" onClick={copy} className="btn-ghost !px-3 !py-2 text-sm" aria-label={`Copy link for ${m.title}`}><Copy className="h-4 w-4" /> Copy link</button>
      {!m.ended_at && <button type="button" onClick={() => onEnter(m.code)} className="inline-flex items-center gap-1.5 rounded-xl bg-navy-800 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700"><Play className="h-3.5 w-3.5" /> Enter</button>}
    </div>
  );
}

function AppointmentRow({ a }: { a: VideoAppointment }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
      <span className="w-20 shrink-0 text-sm font-semibold text-navy-800">{fmtTime(new Date(a.start_time))}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-navy-800">{a.title}</p>
        <p className="mt-0.5 truncate text-xs text-ivory-700">Calendar appointment · video link</p>
      </div>
      <a href={a.link} target="_blank" rel="noopener noreferrer" className="btn-secondary !px-3 !py-2 text-sm"><ExternalLink className="h-4 w-4" /> Open link</a>
    </div>
  );
}

function CallsList({ meetings, onEnter }: { meetings: Meeting[]; onEnter: (code: string) => void }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-navy-800">Recent calls</h2>
      <ul className="mt-4 divide-y divide-sand">
        {meetings.map((m) => {
          const at = startOf(m);
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <span className="w-28 shrink-0 text-sm text-navy-700">{at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {fmtTime(at)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-navy-800">{m.title}</p>
                <p className="mt-0.5 text-xs text-ivory-700">Room {m.code} · {m.ended_at ? 'Ended' : 'Not ended'}</p>
              </div>
              {!m.ended_at && <button type="button" onClick={() => onEnter(m.code)} className="btn-secondary !px-3 !py-2 text-sm">Rejoin</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Create a meeting for later" and "Schedule in calendar". */
function CreateMeetingModal({ kind, onClose, onCreated, onEnter }: {
  kind: Extract<MeetingKind, 'later' | 'scheduled'>;
  onClose: () => void;
  onCreated: (m: Meeting) => void;
  onEnter: (code: string) => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const soon = new Date(Date.now() + 60 * 60000);
  soon.setMinutes(soon.getMinutes() < 30 ? 30 : 60, 0, 0);
  const [title, setTitle] = useState(kind === 'scheduled' ? '' : 'Focus room');
  const [nickname, setNickname] = useState('');
  const [date, setDate] = useState(localDate(soon));
  const [time, setTime] = useState(`${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  const [duration, setDuration] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Meeting | null>(null);

  const nick = nickname.trim() ? toNickname(nickname) : null;
  const start = new Date(`${date}T${time}`);
  const problem = !title.trim() ? 'Add a title.'
    : nickname.trim() && !nick ? 'Nicknames use 3–40 letters, numbers or dashes.'
    : kind === 'scheduled' && (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 5 * 60000) ? 'Choose a time in the future.'
    : null;

  const save = async () => {
    if (problem || !workspace || !user) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await createMeeting({
      workspaceId: workspace.id, hostId: user.id, title, kind, nickname: nick,
      scheduledAt: kind === 'scheduled' ? start : null, durationMin: duration,
    });
    setSaving(false);
    if (err || !data) { setError(err ?? 'Could not create the meeting.'); return; }
    onCreated(data);
    setCreated(data);
  };

  const copy = async (m: Meeting) => {
    try { await navigator.clipboard.writeText(meetingUrl(m.code)); toast('Link copied'); } catch { toast('Could not copy the link', 'error'); }
  };

  if (created) {
    const links = created.scheduled_at ? calendarLinks({ title: created.title, code: created.code, start: new Date(created.scheduled_at), durationMin: created.duration_min }) : null;
    const icsHref = links ? `data:text/calendar;charset=utf-8,${encodeURIComponent(links.ics)}` : '';
    return (
      <Modal
        open
        onClose={onClose}
        title={kind === 'scheduled' ? 'Meeting scheduled' : "Here's your meeting link"}
        description={kind === 'scheduled' ? `${new Date(created.scheduled_at!).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${created.duration_min} min` : 'Share it with people in your account. It works until you end the meeting.'}
        footer={
          <>
            <button type="button" onClick={onClose} className="btn-secondary">Done</button>
            <button type="button" onClick={() => onEnter(created.code)} className="btn-primary"><Play className="h-4 w-4" /> {kind === 'scheduled' ? 'Open room' : 'Enter now'}</button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <input readOnly value={meetingUrl(created.code)} aria-label="Meeting link" className="input-field min-w-0 flex-1 font-mono text-sm" />
            <button type="button" onClick={() => copy(created)} className="btn-secondary shrink-0"><Copy className="h-4 w-4" /> Copy</button>
          </div>
          <p className="text-sm text-ivory-700">Code <strong className="font-mono text-navy-800">{created.code}</strong>{created.nickname && <> · nickname <strong className="text-navy-800">{created.nickname}</strong></>}</p>
          {links && (
            <div className="flex flex-wrap gap-2">
              <a href={links.google} target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2 text-sm"><CalendarDays className="h-4 w-4" /> Add to Google Calendar</a>
              <a href={icsHref} download={`${created.code}.ics`} className="btn-secondary !py-2 text-sm"><Download className="h-4 w-4" /> Download .ics</a>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'scheduled' ? 'Schedule a meeting' : 'Create a meeting for later'}
      description={kind === 'scheduled' ? 'Pick a time. You can add it to your calendar next.' : 'Get a link now and use it whenever you are ready.'}
      footer={
        <>
          {(error || problem) && <p className="mr-auto text-sm text-burgundy-600">{error ?? (title || kind === 'later' ? problem : null)}</p>}
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={save} disabled={!!problem || saving} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {kind === 'scheduled' ? 'Schedule' : 'Create link'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="mt-title" className="mb-1.5 block text-sm font-semibold text-navy-800">Title</label>
          <input id="mt-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={kind === 'scheduled' ? 'Weekly sync' : 'Focus room'} autoFocus />
        </div>
        {kind === 'scheduled' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="mt-date" className="mb-1.5 block text-sm font-semibold text-navy-800">Date</label>
              <input id="mt-date" type="date" className="input-field" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="mt-time" className="mb-1.5 block text-sm font-semibold text-navy-800">Time</label>
              <input id="mt-time" type="time" className="input-field" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <label htmlFor="mt-duration" className="mb-1.5 block text-sm font-semibold text-navy-800">Length</label>
              <select id="mt-duration" className="input-field" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} h${d % 60 ? ' 30' : ''}`}</option>)}
              </select>
            </div>
          </div>
        )}
        <div>
          <label htmlFor="mt-nick" className="mb-1.5 block text-sm font-semibold text-navy-800">Nickname <span className="font-normal text-ivory-700">(optional)</span></label>
          <input id="mt-nick" className="input-field" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="weekly-sync" maxLength={40} />
          <p className="mt-1 text-xs text-ivory-700">{nick ? <>People can join by typing <strong>{nick}</strong>.</> : 'An easy name people can type instead of the code.'}</p>
        </div>
      </div>
    </Modal>
  );
}
