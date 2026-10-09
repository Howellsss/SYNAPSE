import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Video, Plus, ChevronDown, ChevronLeft, ChevronRight, Link2, CalendarDays, Play, Copy, ExternalLink, Download, Loader2, Radio, MonitorUp,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { createMeeting, endMeeting, findMeeting, listMeetings, listTodaysVideoAppointments, reopenMeeting, type Meeting, type MeetingKind, type VideoAppointment } from '@/lib/meetings';
import { supabase } from '@/lib/supabase';
import { calendarLinks, inviteUrl, isPersonalRoom, isSameDay, parseJoinInput, personalNickname, startsLabel, toNickname } from '@/meetings/codes';
import { startOf, upcomingRooms } from '@/meetings/lists';
import { Popover } from '@/components/spaces/room/Popover';
import { menuItem } from '@/components/spaces/room/styles';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { cn, timeAgo } from '@/lib/utils';

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
  // Keep the clock and "in 5 min" labels fresh.
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(t); }, []);

  const [day, setDay] = useState(() => new Date());
  const isToday = isSameDay(day, now);
  const groups = useMemo(() => groupDay(meetings ?? [], day, now), [meetings, day, now]);
  const upcoming = useMemo(() => upcomingRooms(meetings ?? [], now).filter((m) => !isSameDay(startOf(m), day) && m.kind === 'scheduled').slice(0, 5), [meetings, now, day]);
  const calls = useMemo(() => (meetings ?? []).filter((m) => !isPersonalRoom(m)).filter((m) => m.ended_at || startOf(m).getTime() < now.getTime() - STALE_MS)
    .sort((a, b) => startOf(b).getTime() - startOf(a).getTime()), [meetings, now]);
  const todayCount = useMemo(() => groupDay(meetings ?? [], now, now).all.length + appointments.length, [meetings, now, appointments]);

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

  const end = async (m: Meeting) => {
    const err = await endMeeting(m.id);
    if (err) { toast(`Couldn't end it. ${err}`, 'error'); return; }
    setMeetings((list) => (list ?? []).map((x) => (x.id === m.id ? { ...x, ended_at: new Date().toISOString() } : x)));
    toast(`Ended ${m.title}.`, 'info');
  };

  const shiftDay = (n: number) => setDay((d) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });
  const dayTitle = `${isToday ? 'Today, ' : ''}${day.toLocaleDateString(undefined, isToday ? { month: 'long', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' })}`;
  const dayAppointments = isToday ? appointments : [];
  const rowProps = { now, onEnter: enter, onEnd: end, me: user.id };

  return (
    <div className="w-full pb-8">
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Meetings" className="min-w-0">
          <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-navy-800">Meetings</h1>
          <p className="mt-1 text-[14px] text-ivory-700">Start, join or schedule a call. Guests join from a link, no account needed.</p>

          {/* Everything you can start, in one row */}
          <div className="mt-5 flex flex-wrap items-start gap-2.5">
            {/* The whole split button anchors the options menu (no overflow-hidden, so the menu isn't clipped). */}
            <Popover
              label="New meeting options"
              panelClassName="left-0 top-full mt-2 w-64"
              trigger={({ open, toggle }) => (
                <div className="flex h-11 rounded-xl bg-gold-400 text-navy-900 shadow-[0_6px_16px_-8px_rgba(228,169,60,0.9)]">
                  <button type="button" onClick={() => { void startInstant(); }} disabled={startingInstant} aria-label="New meeting" className="inline-flex items-center gap-2.5 rounded-l-xl pl-2 pr-3 text-[15px] font-semibold hover:bg-gold-300 disabled:opacity-70">
                    <IconChip className="bg-navy-800 text-gold-300">{startingInstant ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}</IconChip> New meeting
                  </button>
                  <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="New meeting options" className="flex items-center rounded-r-xl border-l border-navy-900/15 px-2.5 hover:bg-gold-300">
                    <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} />
                  </button>
                </div>
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
            <button type="button" onClick={() => setCreating('scheduled')} className="inline-flex h-11 items-center gap-2.5 rounded-xl bg-white pl-2 pr-4 text-[15px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><IconChip className="bg-[#5B5BD6] text-white"><CalendarDays className="h-4 w-4" /></IconChip> Schedule</button>
            <button type="button" onClick={() => { void startInstant('share'); }} disabled={startingInstant} className="inline-flex h-11 items-center gap-2.5 rounded-xl bg-white pl-2 pr-4 text-[15px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50 disabled:opacity-70"><IconChip className="bg-green-600 text-white"><MonitorUp className="h-4 w-4" /></IconChip> Share screen</button>
            <form onSubmit={join} noValidate className="w-full sm:w-auto" aria-label="Join a meeting">
              <div className={cn('flex h-11 overflow-hidden rounded-xl bg-white ring-1 ring-inset focus-within:ring-2 focus-within:ring-gold-400', joinError ? 'ring-burgundy-500' : 'ring-navy-100')}>
                <span className="flex items-center pl-2"><IconChip className="bg-navy-800 text-white"><Plus className="h-4 w-4" strokeWidth={2.5} /></IconChip></span>
                <input
                  value={joinText}
                  onChange={(e) => { setJoinText(e.target.value); setJoinError(null); }}
                  placeholder="Enter a code or link"
                  aria-label="Meeting code or nickname"
                  aria-invalid={!!joinError}
                  className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-navy-900 placeholder:text-ivory-600 focus:outline-none sm:w-40"
                />
                <button type="submit" disabled={!joinText.trim() || joining} className="flex items-center bg-navy-800 px-4 text-[15px] font-semibold text-white hover:bg-navy-700 disabled:cursor-default disabled:hover:bg-navy-800">{joining ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join'}</button>
              </div>
            </form>
          </div>
          {joinError && <p role="alert" className="mt-2 text-sm text-burgundy-600">{joinError}</p>}

          {/* The day */}
          <div className="mt-6 overflow-hidden rounded-[14px] border border-navy-100 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 px-4 py-3 sm:px-5">
              <label className="relative inline-flex cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-[16px] font-bold text-navy-900 hover:bg-navy-50">
                {dayTitle} <ChevronDown className="h-4 w-4 text-ivory-600" />
                <input type="date" aria-label="Pick a day" value={localDate(day)} onChange={(e) => { if (e.target.value) setDay(new Date(`${e.target.value}T12:00:00`)); }} className="absolute inset-0 cursor-pointer opacity-0" />
              </label>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => shiftDay(-1)} aria-label="Previous day" className="flex h-8 w-8 items-center justify-center rounded-lg text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => shiftDay(1)} aria-label="Next day" className="flex h-8 w-8 items-center justify-center rounded-lg text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><ChevronRight className="h-4 w-4" /></button>
                {!isToday && <button type="button" onClick={() => setDay(new Date())} className="ml-1 inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Today</button>}
              </div>
              <div role="tablist" aria-label="Upcoming or past calls" className="ml-auto flex rounded-[9px] bg-navy-50 p-[3px]">
                {(['meetings', 'calls'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1.5 text-[13px] font-semibold transition', tab === t ? 'bg-white text-navy-900 shadow-[0_1px_2px_rgba(13,28,59,0.12)]' : 'text-navy-600 hover:text-navy-900')}>
                    {t === 'meetings' ? 'Upcoming' : 'Past calls'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-[320px]" aria-label={tab === 'meetings' ? 'Meetings on this day' : 'Past calls'}>
              {error ? (
                <div className="p-5"><ErrorState message={`Couldn't load meetings. ${error}`} onRetry={() => { setMeetings(null); load(); }} /></div>
              ) : meetings === null ? (
                <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
              ) : tab === 'calls' ? (
                calls.length ? <CallsList meetings={calls} onEnter={enter} /> : <Empty title="No calls yet" text="Meetings you've finished show up here." />
              ) : (
                <>
                  {groups.live.length > 0 && <Group title="Live now">{groups.live.map((m) => <MeetingRow key={m.id} m={m} {...rowProps} />)}</Group>}
                  {groups.rooms.length > 0 && <Group title="Rooms ready to use">{groups.rooms.map((m) => <MeetingRow key={m.id} m={m} {...rowProps} />)}</Group>}
                  {(groups.scheduled.length > 0 || dayAppointments.length > 0) && (
                    <Group title={isToday ? 'Later today' : 'Scheduled'}>
                      <DayList meetings={groups.scheduled} appointments={dayAppointments} {...rowProps} />
                    </Group>
                  )}
                  {groups.all.length === 0 && dayAppointments.length === 0 && (
                    <Empty title="No meetings scheduled." action={<button type="button" onClick={() => setCreating('scheduled')} className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-gold-700 hover:text-gold-800"><Plus className="h-4 w-4" /> Schedule a meeting</button>} />
                  )}
                  {upcoming.length > 0 && <Group title="Coming up">{upcoming.map((m) => <MeetingRow key={m.id} m={m} {...rowProps} showDay />)}</Group>}
                </>
              )}
            </div>
          </div>
        </section>

        <aside aria-label="At a glance" className="space-y-4">
          <div className="flex items-center gap-4 rounded-[14px] border border-navy-100 bg-white p-5">
            <div className="min-w-0">
              <p className="text-[32px] font-bold leading-none tracking-tight tabular-nums text-navy-900">{fmtTime(now)}</p>
              <p className="mt-1.5 text-sm text-ivory-700">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            </div>
            <p className="ml-auto text-right text-xs text-ivory-700"><span className="block text-[22px] font-bold leading-tight text-navy-900">{meetings === null ? '–' : todayCount}</span>today</p>
          </div>
          <PersonalRoom onEnter={enter} />
          <RecentRecordings workspaceId={workspace.id} onOpen={() => navigate('/recordings')} />
          <MyNotes onOpen={() => navigate('/ai-hub')} />
        </aside>
      </div>

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

/** A small coloured square behind a button's icon, as on Apple's app icons. */
function IconChip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span aria-hidden="true" className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]', className)}>{children}</span>;
}

/** Instant rooms nobody ended: after this long they're shown under Past calls, not as live. */
const STALE_MS = 12 * 3600000;

/** A day's meetings, split the way people think about them. */
function groupDay(meetings: Meeting[], day: Date, now: Date) {
  // Your personal room has its own card, so it isn't listed here.
  const onDay = meetings.filter((m) => !isPersonalRoom(m) && isSameDay(startOf(m), day) && (m.kind === 'scheduled' || !m.ended_at));
  const fresh = (m: Meeting) => now.getTime() - startOf(m).getTime() < STALE_MS;
  const live = onDay.filter((m) => isLive(m, now) && (m.kind !== 'instant' || fresh(m)));
  const rooms = onDay.filter((m) => m.kind === 'later' && !m.ended_at && fresh(m) && !live.includes(m));
  const scheduled = onDay.filter((m) => m.kind === 'scheduled' && !live.includes(m)).sort((a, b) => startOf(a).getTime() - startOf(b).getTime());
  return { live, rooms, scheduled, all: [...live, ...rooms, ...scheduled] };
}

function isLive(m: Meeting, now: Date): boolean {
  if (m.ended_at) return false;
  if (m.kind === 'instant') return true;
  if (m.kind !== 'scheduled') return false;
  const at = startOf(m).getTime();
  return at <= now.getTime() && now.getTime() < at + m.duration_min * 60000;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-navy-50 last:border-b-0">
      <h3 className="px-5 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-ivory-600">{title}</h3>
      <ul className="divide-y divide-navy-50">{children}</ul>
    </section>
  );
}

function roomWhen(m: Meeting, now: Date): string {
  if (m.kind === 'scheduled') return startsLabel(new Date(m.scheduled_at!), now);
  return m.kind === 'instant' ? 'Live now' : 'Ready now';
}

function Empty({ title, text, action }: { title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center px-5 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-navy-50 text-navy-500"><CalendarDays className="h-7 w-7" /></span>
      <p className="mt-4 text-[15px] font-semibold text-navy-900">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-ivory-700">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

type RowProps = { now: Date; onEnter: (code: string) => void; onEnd: (m: Meeting) => void; me: string };

function DayList({ meetings, appointments, ...rest }: RowProps & { meetings: Meeting[]; appointments: VideoAppointment[] }) {
  const rows = [
    ...meetings.map((m) => ({ key: m.id, at: startOf(m), node: <MeetingRow m={m} {...rest} /> })),
    ...appointments.map((a) => ({ key: a.id, at: new Date(a.start_time), node: <AppointmentRow a={a} /> })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return <>{rows.map((r) => <Fragment key={r.key}>{r.node}</Fragment>)}</>;
}

function MeetingRow({ m, now, onEnter, onEnd, me, showDay }: RowProps & { m: Meeting; showDay?: boolean }) {
  const { toast } = useToast();
  const at = startOf(m);
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl(m)); toast(m.invite_token ? 'Invite link copied. Anyone with it can join.' : 'Link copied'); } catch { toast('Could not copy the link', 'error'); }
  };
  const live = isLive(m, now);
  const time = m.kind === 'scheduled'
    ? (showDay ? at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : fmtTime(at))
    : live ? fmtTime(at) : 'Ready';
  const meta = m.kind === 'scheduled'
    ? `${showDay ? `${fmtTime(at)} · ` : ''}${m.duration_min} min · Room ${m.code}${m.nickname ? ` · ${m.nickname}` : ''}`
    : `${roomWhen(m, now)} · Room ${m.code}${m.nickname ? ` · ${m.nickname}` : ''}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <span aria-hidden="true" className={cn('h-10 w-1 shrink-0 rounded-full', live ? 'bg-green-600' : m.kind === 'scheduled' ? 'bg-gold-400' : 'bg-navy-800', m.ended_at && 'bg-navy-100')} />
      <span className="w-[72px] shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-navy-700">{live && m.kind === 'instant' ? <><span className="block text-[11px] font-medium text-ivory-600">Started</span>{time}</> : time}</span>
      <div className="min-w-[170px] flex-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-navy-900">
          <span className="truncate">{m.title}</span>
          {live && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700"><Radio className="h-3 w-3" /> Live</span>}
          {m.ended_at && <span className="shrink-0 rounded-full bg-navy-50 px-2 py-0.5 text-[10px] font-semibold text-ivory-700">Ended</span>}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-ivory-700">{meta}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" onClick={copy} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50" aria-label={`Copy invite link for ${m.title}`} title="Copy invite link"><Copy className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Copy invite</span></button>
        {live && m.host_id === me && <button type="button" onClick={() => onEnd(m)} aria-label={`End ${m.title}`} className="inline-flex h-[34px] items-center rounded-lg px-3 text-[13px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-burgundy-50 hover:text-burgundy-700">End</button>}
        {!m.ended_at && (
          <button type="button" onClick={() => onEnter(m.code)} aria-label={`Enter ${m.title}`} className={cn('inline-flex h-[34px] items-center gap-1 rounded-lg px-3.5 text-[13px] font-semibold text-white', live ? 'bg-green-600 hover:bg-green-500' : 'bg-navy-800 hover:bg-navy-700')}>
            <Play className="h-3 w-3" /> {live ? 'Rejoin' : 'Start'}
          </button>
        )}
      </div>
    </li>
  );
}

function AppointmentRow({ a }: { a: VideoAppointment }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <span aria-hidden="true" className="h-10 w-1 shrink-0 rounded-full bg-navy-800" />
      <span className="w-[72px] shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-navy-700">{fmtTime(new Date(a.start_time))}</span>
      <div className="min-w-[170px] flex-1">
        <p className="truncate text-[15px] font-semibold text-navy-900">{a.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-ivory-700">Calendar appointment · {Math.round((new Date(a.end_time).getTime() - new Date(a.start_time).getTime()) / 60000)} min</p>
      </div>
      <a href={a.link} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex h-[34px] shrink-0 items-center gap-1 rounded-lg bg-navy-800 px-3.5 text-[13px] font-semibold text-white hover:bg-navy-700"><ExternalLink className="h-3.5 w-3.5" /> Open link</a>
    </li>
  );
}

function CallsList({ meetings, onEnter }: { meetings: Meeting[]; onEnter: (code: string) => void }) {
  return (
    <ul className="divide-y divide-navy-50">
      {meetings.map((m) => {
        const at = startOf(m);
        return (
          <li key={m.id} className="flex items-center gap-4 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-navy-900">{m.title}</p>
              <p className="mt-0.5 truncate text-[13px] text-ivory-700">{at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {fmtTime(at)} · Room {m.code} · {m.ended_at ? 'Ended' : 'Not ended'}</p>
            </div>
            {!m.ended_at && <button type="button" onClick={() => onEnter(m.code)} className="inline-flex h-[34px] shrink-0 items-center rounded-lg px-3 text-[13px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Rejoin</button>}
          </li>
        );
      })}
    </ul>
  );
}

function SideCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[14px] border border-navy-100 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[14px] font-bold text-navy-900">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

const cardLink = 'inline-flex items-center gap-0.5 text-[13px] font-semibold text-gold-700 hover:text-gold-800';

/** Your own room: the same link every time (a "for later" room with your personal nickname). */
function PersonalRoom({ onEnter }: { onEnter: (code: string) => void }) {
  const { workspace, user, profile } = useAuth();
  const { toast } = useToast();
  const [room, setRoom] = useState<Meeting | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const nickname = user ? personalNickname(user.id) : '';
  useEffect(() => {
    if (!workspace || !user) return;
    let alive = true;
    findMeeting(workspace.id, { nickname }).then((m) => { if (alive) setRoom(m); });
    return () => { alive = false; };
  }, [workspace, user, nickname]);
  if (!workspace || !user) return null;

  const create = async () => {
    setBusy(true);
    const first = profile?.first_name?.trim();
    const { data, error } = await createMeeting({ workspaceId: workspace.id, hostId: user.id, title: first ? `${first}'s personal room` : 'My personal room', kind: 'later', nickname });
    setBusy(false);
    if (error || !data) { toast(error ?? 'Could not create your room.', 'error'); return; }
    setRoom(data);
  };
  const start = async () => {
    if (!room) return;
    // Ended last time? Open it again: it's the same room and link.
    if (room.ended_at) {
      const err = await reopenMeeting(room.id);
      if (err) { toast(`Couldn't open your room. ${err}`, 'error'); return; }
    }
    onEnter(room.code);
  };
  const copy = async () => {
    if (!room) return;
    try { await navigator.clipboard.writeText(inviteUrl(room)); toast('Your room link is copied.'); } catch { toast('Could not copy the link', 'error'); }
  };

  return (
    <SideCard title="Your personal room" action={room ? <button type="button" onClick={() => { void start(); }} className={cardLink}>Start <ChevronRight className="h-3.5 w-3.5" /></button> : undefined}>
      {room === undefined ? <Skeleton className="h-11 rounded-lg" /> : room ? (
        <>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 ring-1 ring-inset ring-navy-100">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-navy-700" title={inviteUrl(room)}>…/meetings/{room.code}</span>
            <button type="button" onClick={copy} aria-label="Copy your personal room link" className="inline-flex items-center gap-1 text-[13px] font-semibold text-navy-900 hover:text-gold-700"><Copy className="h-3.5 w-3.5" /> Copy</button>
          </div>
          <p className="mt-2 text-xs text-ivory-700">Same link every time. Good for your email signature.</p>
        </>
      ) : (
        <>
          <p className="text-sm text-ivory-700">One link that's always yours, for quick calls.</p>
          <button type="button" onClick={() => { void create(); }} disabled={busy} className="btn-secondary mt-3 w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create my room</button>
        </>
      )}
    </SideCard>
  );
}

function RecentRecordings({ workspaceId, onOpen }: { workspaceId: string; onOpen: () => void }) {
  const [items, setItems] = useState<{ id: string; title: string; duration_seconds: number | null; created_at: string; transcript: string | null }[] | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.from('recordings').select('id, title, duration_seconds, created_at, transcript').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(3)
      .then(({ data }) => { if (alive) setItems((data ?? []) as NonNullable<typeof items>); });
    return () => { alive = false; };
  }, [workspaceId]);
  return (
    <SideCard title="Recent recordings" action={<button type="button" onClick={onOpen} className={cardLink}>Open recordings <ChevronRight className="h-3.5 w-3.5" /></button>}>
      {items === null ? <Skeleton className="h-12 rounded-lg" /> : items.length === 0 ? (
        <p className="text-sm text-ivory-700">Recordings you make in meetings appear here.</p>
      ) : (
        <ul className="divide-y divide-navy-50">
          {items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-2 text-left">
                <span className="flex h-9 w-14 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-gold-400"><Play className="h-3.5 w-3.5" fill="currentColor" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-navy-900">{r.title}</span>
                  <span className="block truncate text-xs text-ivory-700">{timeAgo(r.created_at)}{r.duration_seconds ? ` · ${Math.max(1, Math.round(r.duration_seconds / 60))} min` : ''}{r.transcript ? ' · transcript' : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SideCard>
  );
}

/** Notes you wrote lately (on contacts), with a way into AI Hub. */
function MyNotes({ onOpen }: { onOpen: () => void }) {
  const { workspace, user } = useAuth();
  const [, navigate] = useRouter();
  const [items, setItems] = useState<{ id: string; content: string; contact_id: string | null }[] | null>(null);
  useEffect(() => {
    if (!workspace || !user) return;
    let alive = true;
    supabase.from('notes').select('id, content, contact_id').eq('workspace_id', workspace.id).eq('author_id', user.id).order('created_at', { ascending: false }).limit(3)
      .then(({ data }) => { if (alive) setItems((data ?? []) as NonNullable<typeof items>); });
    return () => { alive = false; };
  }, [workspace, user]);
  return (
    <SideCard title="My notes" action={<button type="button" onClick={onOpen} aria-label="My notes" className={cardLink}>Open <ChevronRight className="h-3.5 w-3.5" /></button>}>
      {items === null ? <Skeleton className="h-10 rounded-lg" /> : items.length === 0 ? (
        <p className="text-sm text-ivory-700">Notes you add to contacts show up here.</p>
      ) : (
        <ul className="divide-y divide-navy-50">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => (n.contact_id ? navigate(`/contacts/${n.contact_id}`) : onOpen())} className="block w-full truncate py-2 text-left text-[13px] text-navy-700 hover:text-navy-900">{n.content}</button>
            </li>
          ))}
        </ul>
      )}
    </SideCard>
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
