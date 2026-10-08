import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Video, Plus, ChevronDown, ChevronLeft, ChevronRight, Link2, CalendarDays, Play, Copy, ExternalLink, Download, Loader2, Radio, MonitorUp, NotebookPen,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { createMeeting, findMeeting, listMeetings, listTodaysVideoAppointments, type Meeting, type MeetingKind, type VideoAppointment } from '@/lib/meetings';
import { calendarLinks, inviteUrl, isSameDay, parseJoinInput, startsLabel, toNickname } from '@/meetings/codes';
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

  const [day, setDay] = useState(() => new Date());
  const isToday = isSameDay(day, now);
  // The selected day's rooms: scheduled ones on that day, plus today's open instant/later rooms.
  const dayList = useMemo(() => (meetings ?? []).filter((m) => isSameDay(startOf(m), day) && (m.kind === 'scheduled' || !m.ended_at))
    .sort((a, b) => startOf(a).getTime() - startOf(b).getTime()), [meetings, day]);
  const upcoming = useMemo(() => upcomingRooms(meetings ?? [], now).filter((m) => !isSameDay(startOf(m), day)).slice(0, 5), [meetings, now, day]);
  const calls = useMemo(() => (meetings ?? []).filter((m) => m.ended_at || startOf(m).getTime() < now.getTime() - 12 * 3600000)
    .sort((a, b) => startOf(b).getTime() - startOf(a).getTime()), [meetings, now]);
  const [joinOpen, setJoinOpen] = useState(false);

  if (!workspace || !user) return null;

  const enter = (code: string) => navigate(`/meetings/${code}`);

  const startInstant = async (then?: 'share') => {
    setStartingInstant(true);
    const first = profile?.first_name?.trim();
    const { data, error: err } = await createMeeting({ workspaceId: workspace.id, hostId: user.id, title: first ? `${first}'s room` : 'Instant meeting', kind: 'instant' });
    setStartingInstant(false);
    if (err || !data) { toast(err ?? 'Could not start a meeting.', 'error'); return; }
    navigate(`/meetings/${data.code}${then === 'share' ? '?share=1' : ''}`);
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    const q = parseJoinInput(joinText);
    if (!q) { setJoinError('Enter a meeting code like FOCU-358, a link, or a nickname.'); return; }
    // A pasted invite link works as it is, including links from other accounts.
    const link = joinText.trim().match(/\/meetings\/([A-Za-z]{4}-?\d{3})\?invite=([0-9a-f]{32})/i);
    if (link) { navigate(`/meetings/${link[1].toUpperCase()}?invite=${link[2]}`); return; }
    setJoining(true);
    const m = await findMeeting(workspace.id, q);
    setJoining(false);
    if (!m) { setJoinError("No meeting with that code or nickname in your account. Paste the full invite link for meetings from other accounts."); return; }
    enter(m.code);
  };

  const shiftDay = (n: number) => setDay((d) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });
  const dayTitle = `${isToday ? 'Today, ' : ''}${day.toLocaleDateString(undefined, isToday ? { month: 'short', day: 'numeric' } : { weekday: 'long', month: 'short', day: 'numeric' })}`;

  return (
    <div className="w-full pb-8">
      {error ? (
        <ErrorState message={`Couldn't load meetings. ${error}`} onRetry={() => { setMeetings(null); load(); }} />
      ) : (
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* Start: big tiles, like the Zoom home screen */}
          <section aria-label="Start a meeting" className="flex min-h-[520px] items-center justify-center py-6">
            <div className="grid grid-cols-2 gap-x-10 gap-y-9 sm:gap-x-16">
              <div className="flex flex-col items-center">
                <Tile tone="gold" label="New meeting" icon={startingInstant ? <Loader2 className="h-10 w-10 animate-spin" /> : <Video className="h-11 w-11" fill="currentColor" strokeWidth={1.5} />} onClick={() => { void startInstant(); }} disabled={startingInstant} hideLabel />
                <Popover
                  label="New meeting options"
                  panelClassName="left-1/2 top-full mt-2 w-64 -translate-x-1/2"
                  trigger={({ open, toggle }) => (
                    <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="New meeting options" className="mt-3 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[15px] font-medium text-navy-800 hover:bg-navy-50">
                      New meeting <ChevronDown className={cn('h-4 w-4 text-ivory-600 transition', open && 'rotate-180')} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <button role="menuitem" className={cn(menuItem, 'py-2.5 font-medium')} disabled={startingInstant} onClick={() => { close(); void startInstant(); }}>
                        <Video className="h-4 w-4 text-green-600" /> Start an instant meeting
                      </button>
                      <button role="menuitem" className={cn(menuItem, 'py-2.5 font-medium')} onClick={() => { close(); setCreating('later'); }}>
                        <Link2 className="h-4 w-4 text-navy-500" /> Create a meeting for later
                      </button>
                      <button role="menuitem" className={cn(menuItem, 'py-2.5 font-medium')} onClick={() => { close(); setCreating('scheduled'); }}>
                        <CalendarDays className="h-4 w-4 text-purple-600" /> Schedule in calendar
                      </button>
                    </>
                  )}
                </Popover>
              </div>
              <Tile label="Join" icon={<Plus className="h-11 w-11" strokeWidth={2.5} />} onClick={() => { setJoinError(null); setJoinOpen(true); }} />
              <Tile label="Schedule" icon={<CalendarDays className="h-11 w-11" strokeWidth={2} />} onClick={() => setCreating('scheduled')} />
              <Tile label="Share screen" icon={<MonitorUp className="h-11 w-11" strokeWidth={2} />} onClick={() => { void startInstant('share'); }} disabled={startingInstant} />
              <div className="col-span-2 flex justify-center">
                <Tile label="My notes" icon={<NotebookPen className="h-11 w-11" strokeWidth={2} />} onClick={() => navigate('/ai-hub')} />
              </div>
            </div>
          </section>

          {/* Clock and the day's meetings */}
          <aside aria-label="Your meetings" className="overflow-hidden rounded-xl border border-navy-100 bg-white shadow-card">
            <div className="relative overflow-hidden bg-navy-800 px-6 py-7 text-center text-white">
              <span aria-hidden="true" className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-gold-400/20 blur-2xl" />
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-16 right-0 h-40 w-40 rounded-full bg-[#2A4377] blur-2xl" />
              <p className="relative text-[44px] font-bold leading-none tracking-tight tabular-nums">{fmtTime(now)}</p>
              <p className="relative mt-2 text-[15px] text-ivory-300">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            </div>

            <div className="flex items-center gap-2 border-b border-sand px-3 py-2.5">
              <button type="button" onClick={() => setCreating('scheduled')} aria-label="Schedule a meeting" title="Schedule a meeting" className="flex h-9 w-9 items-center justify-center rounded-lg text-navy-800 hover:bg-navy-50"><Plus className="h-5 w-5" /></button>
              <label className="relative mx-auto inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[15px] font-semibold text-navy-900 hover:bg-navy-50">
                {dayTitle} <ChevronDown className="h-4 w-4 text-ivory-600" />
                <input type="date" aria-label="Pick a day" value={localDate(day)} onChange={(e) => { if (e.target.value) setDay(new Date(`${e.target.value}T12:00:00`)); }} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
              <span className="w-9" />
            </div>

            <div className="flex items-center gap-1 border-b border-sand px-3 py-2">
              <button type="button" onClick={() => setDay(new Date())} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><CalendarDays className="h-3.5 w-3.5" /> Today</button>
              <button type="button" onClick={() => shiftDay(-1)} aria-label="Previous day" className="flex h-8 w-8 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => shiftDay(1)} aria-label="Next day" className="flex h-8 w-8 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50"><ChevronRight className="h-4 w-4" /></button>
              <div className="flex-1" />
              <div role="tablist" aria-label="Meetings or calls" className="flex rounded-md bg-white p-0.5 ring-1 ring-inset ring-navy-100">
                {(['meetings', 'calls'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('rounded px-2.5 py-1 text-xs font-semibold transition', tab === t ? 'bg-navy-800 text-white' : 'text-navy-700 hover:bg-navy-50')}>
                    {t === 'meetings' ? 'Meetings' : 'Past calls'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-[300px] px-4 py-3" aria-label={tab === 'meetings' ? 'Meetings on this day' : 'Past calls'}>
              {meetings === null ? (
                <div className="space-y-2 py-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
              ) : tab === 'calls' ? (
                calls.length ? <CallsList meetings={calls} onEnter={enter} /> : <Empty title="No calls yet" text="Meetings you've finished show up here." />
              ) : dayList.length || (isToday && appointments.length) ? (
                <DayList meetings={dayList} appointments={isToday ? appointments : []} now={now} onEnter={enter} />
              ) : (
                <Empty title="No meetings scheduled." action={<button type="button" onClick={() => setCreating('scheduled')} className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-gold-700 hover:text-gold-800"><Plus className="h-4 w-4" /> Schedule a meeting</button>} />
              )}
              {tab === 'meetings' && upcoming.length > 0 && meetings !== null && (
                <div className="mt-3 border-t border-sand pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ivory-700">Coming up</p>
                  <ul className="mt-1 divide-y divide-sand">{upcoming.map((m) => <li key={m.id}><MeetingRow m={m} now={now} onEnter={enter} showDay /></li>)}</ul>
                </div>
              )}
            </div>

            <button type="button" onClick={() => navigate('/recordings')} className="flex w-full items-center gap-1 border-t border-sand px-5 py-3.5 text-left text-[15px] font-medium text-navy-700 hover:bg-navy-50">
              Open recordings <ChevronRight className="h-4 w-4" />
            </button>
          </aside>
        </div>
      )}

      {joinOpen && (
        <Modal open onClose={() => setJoinOpen(false)} title="Join a meeting" description="Enter a meeting code, a nickname, or paste an invite link." size="sm">
          <form onSubmit={join} className="space-y-3" noValidate>
            <input
              autoFocus
              value={joinText}
              onChange={(e) => { setJoinText(e.target.value); setJoinError(null); }}
              placeholder="FOCU-358, weekly-sync, or a link"
              aria-label="Meeting code or nickname"
              className="input-field"
            />
            {joinError && <p role="alert" className="text-sm text-burgundy-600">{joinError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setJoinOpen(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={!joinText.trim() || joining} className="btn-primary">{joining ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join'}</button>
            </div>
          </form>
        </Modal>
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

/** A big rounded-square start button with its label underneath. */
function Tile({ label, icon, onClick, tone = 'navy', disabled, hideLabel }: { label: string; icon: React.ReactNode; onClick: () => void; tone?: 'gold' | 'navy'; disabled?: boolean; hideLabel?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'flex h-[100px] w-[100px] items-center justify-center rounded-[28px] text-white shadow-[0_8px_20px_-8px_rgba(13,28,59,0.45)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-10px_rgba(13,28,59,0.5)] focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-400/40 disabled:opacity-70',
          tone === 'gold' ? 'bg-gold-400 hover:bg-gold-500' : 'bg-navy-800 hover:bg-navy-700',
        )}
      >
        {icon}
      </button>
      {!hideLabel && <span className="mt-3 text-[15px] font-medium text-navy-800">{label}</span>}
    </div>
  );
}

function roomWhen(m: Meeting, now: Date): string {
  if (m.kind === 'scheduled') return startsLabel(new Date(m.scheduled_at!), now);
  return m.kind === 'instant' ? 'Live now' : 'Ready now';
}

function Empty({ title, text, action }: { title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-navy-50 text-navy-500"><CalendarDays className="h-9 w-9" /></span>
      <p className="mt-5 text-[15px] font-semibold text-navy-900">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-ivory-700">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function DayList({ meetings, appointments, now, onEnter }: { meetings: Meeting[]; appointments: VideoAppointment[]; now: Date; onEnter: (code: string) => void }) {
  const rows = [
    ...meetings.map((m) => ({ key: m.id, at: startOf(m), node: <MeetingRow m={m} now={now} onEnter={onEnter} /> })),
    ...appointments.map((a) => ({ key: a.id, at: new Date(a.start_time), node: <AppointmentRow a={a} /> })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return <ul className="divide-y divide-sand">{rows.map((r) => <li key={r.key}>{r.node}</li>)}</ul>;
}

function MeetingRow({ m, now, onEnter, showDay }: { m: Meeting; now: Date; onEnter: (code: string) => void; showDay?: boolean }) {
  const { toast } = useToast();
  const at = startOf(m);
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl(m)); toast(m.invite_token ? 'Invite link copied. Anyone with it can join.' : 'Link copied'); } catch { toast('Could not copy the link', 'error'); }
  };
  const live = !m.ended_at && (m.kind === 'instant' || (m.kind === 'scheduled' && at <= now && now.getTime() < at.getTime() + m.duration_min * 60000));
  const when = m.kind === 'scheduled' ? (showDay ? `${at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(at)}` : fmtTime(at)) : roomWhen(m, now);
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[15px] font-semibold text-navy-900">
          <span className="truncate">{m.title}</span>
          {live && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700"><Radio className="h-3 w-3" /> Live</span>}
          {m.ended_at && <span className="shrink-0 rounded-md bg-ivory-200/60 px-1.5 py-0.5 text-[10px] font-semibold text-ivory-800">Ended</span>}
        </p>
        <p className="mt-0.5 truncate text-xs text-ivory-700">{when} · Room {m.code}{m.nickname ? ` · ${m.nickname}` : ''}{m.kind === 'scheduled' ? ` · ${m.duration_min} min` : ''}</p>
      </div>
      <button type="button" onClick={copy} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50" aria-label={`Copy invite link for ${m.title}`} title="Copy invite link"><Copy className="h-4 w-4" /></button>
      {!m.ended_at && <button type="button" onClick={() => onEnter(m.code)} aria-label={`Enter ${m.title}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-navy-800 px-3 text-sm font-semibold text-white hover:bg-navy-700"><Play className="h-3 w-3" /> Start</button>}
    </div>
  );
}

function AppointmentRow({ a }: { a: VideoAppointment }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-navy-900">{a.title}</p>
        <p className="mt-0.5 truncate text-xs text-ivory-700">{fmtTime(new Date(a.start_time))} · Calendar appointment</p>
      </div>
      <a href={a.link} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
    </div>
  );
}

function CallsList({ meetings, onEnter }: { meetings: Meeting[]; onEnter: (code: string) => void }) {
  return (
    <ul className="divide-y divide-sand">
      {meetings.map((m) => {
        const at = startOf(m);
        return (
          <li key={m.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-navy-900">{m.title}</p>
              <p className="mt-0.5 truncate text-xs text-ivory-700">{at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {fmtTime(at)} · Room {m.code} · {m.ended_at ? 'Ended' : 'Not ended'}</p>
            </div>
            {!m.ended_at && <button type="button" onClick={() => onEnter(m.code)} className="inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Rejoin</button>}
          </li>
        );
      })}
    </ul>
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
    try { await navigator.clipboard.writeText(inviteUrl(m)); toast('Link copied'); } catch { toast('Could not copy the link', 'error'); }
  };

  if (created) {
    const links = created.scheduled_at ? calendarLinks({ title: created.title, code: created.code, start: new Date(created.scheduled_at), durationMin: created.duration_min, invite_token: created.invite_token }) : null;
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
            <input readOnly value={inviteUrl(created)} aria-label="Meeting link" className="input-field min-w-0 flex-1 font-mono text-sm" />
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
