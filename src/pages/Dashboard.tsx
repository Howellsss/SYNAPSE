import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import {
  Activity, ArrowRight, Bell, CalendarDays, ClipboardList, FileText, FolderUp, MessageCircle,
  MoreHorizontal, Plus, Send, Sparkles, UserPlus, Users, Video,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { listSpaces, type SpaceWithMembers } from '@/lib/spaces';
import { recentActivity, weeklyActivity, type ActivityItem, type DayCount } from '@/lib/activity';
import { Skeleton } from '@/components/ui/States';
import { cn, formatDate, formatTime, getFullName, timeAgo } from '@/lib/utils';
import { useRouter } from '@/lib/router';
import type { Appointment, Contact, Calendar as CalendarType } from '@/types';

interface DashboardAppointment extends Appointment {
  contacts: Contact | null;
  calendars: CalendarType | null;
}

interface DashboardData {
  todayAppointments: DashboardAppointment[];
  upcomingAppointments: DashboardAppointment[];
  contactCount: number;
  workspaceMemberCount: number;
  completedCount: number;
  messageCount: number;
  spaces: SpaceWithMembers[];
  activity: ActivityItem[];
  week: DayCount[];
}

type Tone = 'blue' | 'green' | 'sky' | 'amber' | 'cyan' | 'rose';
const TONES: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
  cyan: 'bg-cyan-50 text-cyan-600',
  rose: 'bg-rose-50 text-rose-600',
};
const SPACE_COLORS = ['bg-navy-800', 'bg-blue-600', 'bg-cyan-600', 'bg-emerald-600', 'bg-amber-500'];
const AI_PROMPTS = ['Summarize today’s meetings', 'What are my priorities this week?', 'Show me project updates', 'Generate meeting brief'];

export function Dashboard() {
  const { profile, workspace } = useAuth();
  const [, navigate] = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    void loadDashboard(workspace.id);
  }, [workspace]);

  async function loadDashboard(workspaceId: string): Promise<void> {
    const start = new Date();
    const todayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const todayEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59);
    const weekEnd = new Date(start);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [todayRes, upcomingRes, contactsRes, membersRes, completedRes, messagesRes, spacesRes, activity, week] = await Promise.all([
      supabase.from('appointments').select('*, contacts(*), calendars(*)').eq('workspace_id', workspaceId)
        .in('status', ['confirmed', 'pending']).gte('start_time', todayStart.toISOString()).lte('start_time', todayEnd.toISOString())
        .order('start_time', { ascending: true }),
      supabase.from('appointments').select('*, contacts(*), calendars(*)').eq('workspace_id', workspaceId)
        .in('status', ['confirmed', 'pending']).gte('start_time', start.toISOString()).lte('start_time', weekEnd.toISOString())
        .order('start_time', { ascending: true }).limit(6),
      supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('workspace_members').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'completed'),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      listSpaces(workspaceId).catch(() => ({ data: [] as SpaceWithMembers[], error: null })),
      recentActivity(workspaceId).catch(() => [] as ActivityItem[]),
      weeklyActivity(workspaceId).catch(() => [] as DayCount[]),
    ]);

    setData({
      todayAppointments: (todayRes.data ?? []) as DashboardAppointment[],
      upcomingAppointments: (upcomingRes.data ?? []) as DashboardAppointment[],
      contactCount: contactsRes.count ?? 0,
      workspaceMemberCount: membersRes.count ?? 0,
      completedCount: completedRes.count ?? 0,
      messageCount: messagesRes.count ?? 0,
      spaces: spacesRes.data ?? [],
      activity,
      week,
    });
    setLoading(false);
  }

  const askAI = (q: string) => navigate('/ai-hub' + (q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''));
  const onAsk = (e: FormEvent) => { e.preventDefault(); askAI(question); };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3"><Skeleton className="h-[520px]" /><Skeleton className="h-[520px]" /><Skeleton className="h-[520px]" /></div>
      </div>
    );
  }

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.first_name || 'there';
  const longDate = formatDate(now.toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const upcoming = data?.upcomingAppointments ?? [];
  const week = data?.week ?? [];
  const weekTotal = week.reduce((n, d) => n + d.count, 0);

  return (
    <div className="space-y-7 pb-10">
      {/* Greeting */}
      <section className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ivory-600">{longDate}</p>
          <h1 className="mt-2 text-[34px] font-bold tracking-[-0.035em] text-navy-800 sm:text-[44px]">
            {greeting}, <span className="text-blue-600">{firstName}</span>
          </h1>
          <p className="mt-1.5 text-[15px] text-ivory-700">Here&apos;s what&apos;s happening in your collaboration hub today.</p>
        </div>
        <div className="flex items-center gap-5 xl:text-right">
          <div className="hidden sm:block">
            <p className="text-xs font-semibold text-ivory-600">{longDate}</p>
            <p className="font-display text-[32px] font-bold leading-none tracking-[-0.03em] tabular-nums text-navy-800">{formatTime(now.toISOString())}</p>
          </div>
          <button onClick={() => navigate('/meetings')} className="btn-primary h-12 px-6 text-[15px]"><Plus className="h-5 w-5" />Create</button>
          <button
            onClick={() => document.getElementById('dash-notifications')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="relative flex h-12 w-12 items-center justify-center rounded-full border border-navy-100 bg-white text-ivory-700 transition hover:border-blue-300 hover:text-blue-700"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {(data?.activity.length ?? 0) > 0 && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-gold-400" />}
          </button>
        </div>
      </section>

      {/* Quick start */}
      <section aria-label="Quick start" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <ActionCard label="New Meeting" detail="Start an instant meeting" icon={Video} tone="blue" onClick={() => navigate('/meetings')} />
        <ActionCard label="Schedule Meeting" detail="Plan for later" icon={CalendarDays} tone="green" onClick={() => navigate('/calendars')} />
        <ActionCard label="AI Assistant" detail="Get AI help" icon={Sparkles} tone="sky" onClick={() => navigate('/ai-hub')} />
        <ActionCard label="Start Webinar" detail="Broadcast to a large audience" icon={Activity} tone="amber" onClick={() => navigate('/webinars')} />
        <ActionCard label="Open Classroom" detail="Launch a learning session" icon={Users} tone="cyan" onClick={() => navigate('/workspace')} />
        <ActionCard label="Create Workspace" detail="Build a new space" icon={Plus} tone="rose" onClick={() => navigate('/workspace/new')} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Upcoming meetings */}
        <div className="flex flex-col">
          <SectionHeading title="Upcoming Meetings" subtitle="Rooms that are ready to enter" action="View all" onAction={() => navigate('/meetings')} />
          <div className="card mt-3 min-h-[520px] flex-1 divide-y divide-navy-100 overflow-hidden">
            {upcoming.length === 0
              ? <EmptyPanel icon={CalendarDays} title="No upcoming meetings" detail="Your next meetings will appear here." />
              : upcoming.map((a) => <MeetingRow key={a.id} appointment={a} onClick={() => navigate('/meetings')} />)}
          </div>
        </div>

        {/* Today overview + activity */}
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeading title="Today Overview" subtitle="Your collaboration pulse" />
            <div className="card mt-3 grid grid-cols-2 gap-2 p-4 2xl:grid-cols-4">
              <OverviewStat label="Meetings" value={data?.todayAppointments.length ?? 0} detail="Live agenda" icon={Video} tone="blue" />
              <OverviewStat label="Workspaces" value={Math.max(1, data?.spaces.length ?? 0)} detail="Active spaces" icon={Users} tone="green" />
              <OverviewStat label="Messages" value={data?.messageCount ?? 0} detail="New messages" icon={MessageCircle} tone="amber" />
              <OverviewStat label="Members" value={data?.workspaceMemberCount ?? 0} detail="In your hub" icon={Users} tone="rose" />
            </div>
          </div>
          <div className="flex flex-1 flex-col">
            <SectionHeading title="Activity Overview" subtitle="Collaboration activity over the last seven days" />
            <div className="card mt-3 flex-1 overflow-hidden p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-[34px] font-bold leading-none tracking-[-0.03em] text-navy-800">{weekTotal + (data?.completedCount ?? 0)}</p>
                  <p className="mt-1.5 text-sm text-ivory-700">Completed actions</p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">This week</span>
              </div>
              <ActivityChart days={week} />
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="flex flex-col">
          <SectionHeading title="Recent Activity" subtitle="What&apos;s moving across your hub" action="View all" onAction={() => navigate('/conversations')} />
          <div className="card mt-3 min-h-[520px] flex-1 divide-y divide-navy-100 overflow-hidden">
            {(data?.activity.length ?? 0) === 0
              ? <EmptyPanel icon={Activity} title="No recent activity" detail="New workspace activity will appear here." />
              : data!.activity.map((it) => <ActivityRow key={it.id} item={it} />)}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 2xl:grid-cols-4">
        {/* Active workspaces */}
        <div>
          <SectionHeading title="Active Workspaces" subtitle="Spaces with recent movement" action="View all" onAction={() => navigate('/workspace')} />
          <div className="card mt-3 divide-y divide-navy-100 overflow-hidden">
            <WorkspaceRow name={workspace?.name || 'My Workspace'} detail={`${data?.workspaceMemberCount ?? 0} members · ${data?.contactCount ?? 0} contacts`} color={SPACE_COLORS[0]} onClick={() => navigate('/settings')} />
            {(data?.spaces ?? []).slice(0, 4).map((s, i) => (
              <WorkspaceRow key={s.id} name={s.name} detail={`${s.memberIds.length} ${s.memberIds.length === 1 ? 'member' : 'members'}`} color={SPACE_COLORS[(i + 1) % SPACE_COLORS.length]} onClick={() => navigate('/workspace/' + s.slug)} />
            ))}
            {(data?.spaces.length ?? 0) === 0 && (
              <button onClick={() => navigate('/workspace/new')} className="flex w-full items-center gap-4 px-5 py-4 text-left text-sm font-medium text-gold-700 transition hover:bg-paper">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-navy-200 text-navy-500"><Plus className="h-4 w-4" /></span>
                Create a workspace
              </button>
            )}
          </div>
        </div>

        {/* AI assistant */}
        <div>
          <SectionHeading title="AI Assistant" subtitle="Ask, summarize, or plan" />
          <div className="card mt-3 overflow-hidden">
            <form onSubmit={onAsk} className="flex gap-2 p-4">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} className="input-field h-11 flex-1" placeholder="Ask anything..." aria-label="Ask the AI assistant" />
              <button type="submit" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700" aria-label="Send question"><Send className="h-4 w-4" /></button>
            </form>
            <div className="divide-y divide-navy-100 border-t border-navy-100">
              {AI_PROMPTS.map((p) => (
                <button key={p} onClick={() => askAI(p)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-navy-700 transition hover:bg-blue-50 hover:text-blue-600">
                  <Sparkles className="h-4 w-4 text-blue-500" />{p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <SectionHeading title="Quick Actions" subtitle="Common workspace tasks" />
          <div className="card mt-3 divide-y divide-navy-100 overflow-hidden">
            <QuickAction label="Share Screen" detail="Present to your team" icon={FolderUp} onClick={() => navigate('/meetings')} />
            <QuickAction label="Upload Document" detail="Share files with your team" icon={FileText} onClick={() => navigate('/media-library')} />
            <QuickAction label="Record Meeting" detail="Record for later review" icon={Video} onClick={() => navigate('/meetings')} />
            <QuickAction label="Invite People" detail="Add members to your workspace" icon={UserPlus} onClick={() => navigate('/settings')} />
          </div>
        </div>

        {/* Notifications */}
        <div id="dash-notifications" className="scroll-mt-24">
          <SectionHeading title="Notifications" subtitle="Signals that need attention" action="View all" onAction={() => navigate('/conversations')} />
          <div className="card mt-3 min-h-[268px] divide-y divide-navy-100 overflow-hidden">
            {(data?.activity.length ?? 0) === 0
              ? <EmptyPanel icon={Bell} title="No notifications yet" detail="You&apos;re all caught up." short />
              : data!.activity.slice(0, 4).map((it) => <ActivityRow key={it.id} item={it} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

function ActionCard({ label, detail, icon: Icon, tone, onClick }: { label: string; detail: string; icon: ComponentType<{ className?: string }>; tone: Tone; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card card-hover flex min-h-[96px] items-center gap-4 px-5 py-4 text-left">
      <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', TONES[tone])}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-navy-800">{label}</span>
        <span className="mt-0.5 block text-[13px] text-ivory-700">{detail}</span>
      </span>
    </button>
  );
}

function SectionHeading({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[19px] font-bold tracking-[-0.015em] text-navy-800">{title}</h2>
        <p className="mt-0.5 text-[13px] text-ivory-700">{subtitle}</p>
      </div>
      {action && onAction && <button onClick={onAction} className="flex items-center gap-1 text-sm font-semibold text-gold-700 hover:text-gold-600">{action}<ArrowRight className="h-4 w-4" /></button>}
    </div>
  );
}

function MeetingRow({ appointment, onClick }: { appointment: DashboardAppointment; onClick: () => void }) {
  const contact = appointment.contacts;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-paper">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Video className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-navy-700">{appointment.title || appointment.calendars?.name || 'Focus room'}</span>
        <span className="mt-0.5 block text-[13px] text-ivory-700">{formatDate(appointment.start_time, { weekday: 'short', month: 'short', day: 'numeric' })} · {formatTime(appointment.start_time)}{contact ? ` · ${getFullName(contact)}` : ''}</span>
      </span>
      <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600">Join</span>
    </button>
  );
}

function WorkspaceRow({ name, detail, color, onClick }: { name: string; detail: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-paper">
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white', color)}>{name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-navy-700">{name}</span>
        <span className="block truncate text-[13px] text-ivory-700">{detail}</span>
      </span>
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
    </button>
  );
}

function OverviewStat({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: ComponentType<{ className?: string }>; tone: 'blue' | 'green' | 'amber' | 'rose' }) {
  return (
    <div className="flex items-start gap-3 rounded-xl p-3">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TONES[tone])}><Icon className="h-[18px] w-[18px]" /></span>
      <div>
        <p className="text-xs text-ivory-700">{label}</p>
        <p className="font-display text-[26px] font-bold leading-tight tabular-nums text-navy-800">{value.toLocaleString()}</p>
        <p className="text-xs text-ivory-700">{detail}</p>
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = item.kind === 'booking' ? CalendarDays : ClipboardList;
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-navy-700">{item.title}</p>
        <p className="truncate text-[13px] text-ivory-700">{item.detail}</p>
      </div>
      <span className="shrink-0 text-xs text-ivory-700">{timeAgo(item.at)}</span>
      <MoreHorizontal className="h-4 w-4 shrink-0 text-ivory-500" />
    </div>
  );
}

function QuickAction({ label, detail, icon: Icon, onClick }: { label: string; detail: string; icon: ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-paper">
      <Icon className="h-5 w-5 shrink-0 text-blue-600" />
      <span>
        <span className="block text-[15px] font-semibold text-navy-700">{label}</span>
        <span className="block text-[13px] text-ivory-700">{detail}</span>
      </span>
    </button>
  );
}

function EmptyPanel({ icon: Icon, title, detail, short }: { icon: ComponentType<{ className?: string }>; title: string; detail: string; short?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center p-6 text-center', short ? 'min-h-[268px]' : 'min-h-[520px]')}>
      <Icon className="h-7 w-7 text-ivory-500" />
      <p className="mt-3 text-[15px] font-semibold text-navy-700">{title}</p>
      <p className="mt-1 text-[13px] text-ivory-700">{detail}</p>
    </div>
  );
}

/** Smooth area chart of the last seven days (real counts). */
function ActivityChart({ days }: { days: DayCount[] }) {
  const W = 700; const H = 200; const pad = 12;
  const max = Math.max(1, ...days.map((d) => d.count));
  const pts = days.map((d, i) => [days.length > 1 ? (i / (days.length - 1)) * W : W / 2, H - pad - (d.count / max) * (H - pad * 3)] as const);
  // Catmull-Rom to cubic Bézier for a soft line.
  let line = pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] ?? p2;
    line += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  const area = line ? `${line} L${W} ${H} L0 ${H} Z` : '';
  const peak = days.reduce((best, d, i) => (d.count > days[best].count ? i : best), 0);
  return (
    <figure className="mt-6" aria-label="Collaboration activity over the last seven days">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="activityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4f7df3" stopOpacity="0.2" /><stop offset="100%" stopColor="#4f7df3" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill="url(#activityFill)" />
        <path d={line} fill="none" stroke="#4f7df3" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        {pts.length > 0 && days[peak].count > 0 && <circle cx={pts[peak][0]} cy={pts[peak][1]} r="5" fill="#4f7df3" stroke="white" strokeWidth="3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-2 flex justify-between px-1 text-xs text-ivory-700">
        {days.map((d) => <span key={d.date} title={`${d.label}: ${d.count}`}>{d.label}</span>)}
      </div>
      <table className="sr-only"><caption>Activity per day</caption><tbody>{days.map((d) => <tr key={d.date}><th>{d.label}</th><td>{d.count}</td></tr>)}</tbody></table>
    </figure>
  );
}
