import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import {
  Activity, ArrowRight, Bell, Building2, CalendarDays, ChevronRight, ClipboardList, FileText, FolderUp,
  MessageCircle, MonitorPlay, Plus, Send, Sparkles, UserPlus, Users, Video,
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

const AI_PROMPTS = ['Summarize today’s meetings', 'What are my priorities this week?', 'Show me project updates', 'Generate meeting brief'];

/** Today: the dashboard. Every section reads real data from the workspace. */
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
        .order('start_time', { ascending: true }).limit(5),
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
      <div className="mx-auto max-w-[1280px] space-y-6">
        <Skeleton className="h-20 w-96" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <div className="grid gap-5 xl:grid-cols-3"><Skeleton className="h-[420px]" /><Skeleton className="h-[420px]" /><Skeleton className="h-[420px]" /></div>
      </div>
    );
  }

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.first_name || 'there';
  const upcoming = data?.upcomingAppointments ?? [];
  const week = data?.week ?? [];
  const weekTotal = week.reduce((n, d) => n + d.count, 0);

  return (
    <div className="mx-auto max-w-[1280px] space-y-8 pb-10">
      {/* Greeting */}
      <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[15px] text-ivory-600">{formatDate(now.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="mt-1 text-[34px] font-bold tracking-[-0.032em] text-navy-800 sm:text-[44px]">{greeting}, {firstName}</h1>
          <p className="mt-1 text-[15px] text-ivory-600">Here’s what’s happening across your workspace today.</p>
        </div>
        <div className="flex items-center gap-4">
          <p className="hidden text-right sm:block">
            <span className="block font-display text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-navy-800">{formatTime(now.toISOString())}</span>
          </p>
          <button onClick={() => navigate('/meetings')} className="btn-primary h-10"><Plus className="h-4 w-4" /> Create</button>
          <button
            onClick={() => document.getElementById('dash-notifications')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-ivory-100 text-navy-700 transition-colors hover:bg-navy-100"
            aria-label="Notifications"
          >
            <Bell className="h-[18px] w-[18px]" />
            {(data?.activity.length ?? 0) > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-gold-400" />}
          </button>
        </div>
      </section>

      {/* Quick start */}
      <section aria-label="Quick start" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <ActionCard label="New meeting" detail="Start an instant meeting" icon={Video} onClick={() => navigate('/meetings')} />
        <ActionCard label="Schedule meeting" detail="Plan for later" icon={CalendarDays} onClick={() => navigate('/calendars')} />
        <ActionCard label="AI Assistant" detail="Get AI help" icon={Sparkles} onClick={() => navigate('/ai-hub')} />
        <ActionCard label="Start webinar" detail="Broadcast to a large audience" icon={MonitorPlay} onClick={() => navigate('/webinars')} />
        <ActionCard label="Open classroom" detail="Launch a learning session" icon={Users} onClick={() => navigate('/workspace')} />
        <ActionCard label="Create workspace" detail="Build a new space" icon={Plus} onClick={() => navigate('/workspace/new')} />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        {/* Upcoming meetings */}
        <div>
          <Heading title="Upcoming meetings" subtitle="Rooms ready to enter" action="View all" onAction={() => navigate('/meetings')} />
          <div className="card mt-3 min-h-[360px] overflow-hidden">
            {upcoming.length === 0 ? (
              <Empty icon={CalendarDays} title="No upcoming meetings" detail="Your next meetings will appear here." />
            ) : (
              <ul className="divide-y divide-navy-100">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => navigate('/meetings')} className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-ivory-50">
                      <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-ivory-100 leading-none">
                        <span className="text-[10px] font-semibold uppercase text-burgundy-500">{formatDate(a.start_time, { weekday: 'short' })}</span>
                        <span className="text-[15px] font-semibold text-navy-800">{new Date(a.start_time).getDate()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-navy-800">{a.title || a.calendars?.name || 'Meeting'}</span>
                        <span className="block truncate text-[13px] text-ivory-600">{formatTime(a.start_time)}{a.contacts ? ` · ${getFullName(a.contacts)}` : ''}</span>
                      </span>
                      <span className="rounded-full bg-gold-50 px-3 py-1 text-[13px] font-semibold text-gold-700">Join</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Today overview + activity */}
        <div className="space-y-5">
          <div>
            <Heading title="Today overview" subtitle="Your collaboration pulse" />
            <div className="card mt-3 grid grid-cols-2 gap-px overflow-hidden bg-navy-100">
              <Stat label="Meetings today" value={data?.todayAppointments.length ?? 0} icon={Video} />
              <Stat label="Workspaces" value={data?.spaces.length ?? 0} icon={Building2} />
              <Stat label="Messages" value={data?.messageCount ?? 0} icon={MessageCircle} />
              <Stat label="Members" value={data?.workspaceMemberCount ?? 0} icon={Users} />
            </div>
          </div>
          <div>
            <Heading title="Activity overview" subtitle="Appointments and messages, last 7 days" />
            <div className="card mt-3 p-5">
              <div className="flex items-baseline justify-between">
                <p><span className="font-display text-[28px] font-semibold tracking-[-0.03em] text-navy-800">{weekTotal}</span> <span className="text-[13px] text-ivory-600">this week · {data?.completedCount ?? 0} completed all time</span></p>
              </div>
              <WeekBars days={week} />
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <Heading title="Recent activity" subtitle="What’s moving across your hub" action="View all" onAction={() => navigate('/conversations')} />
          <div className="card mt-3 min-h-[360px] overflow-hidden">
            {(data?.activity.length ?? 0) === 0 ? (
              <Empty icon={Activity} title="No recent activity" detail="New bookings and form submissions appear here." />
            ) : (
              <ul className="divide-y divide-navy-100">
                {data!.activity.map((it) => <ActivityRow key={it.id} item={it} />)}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
        {/* Active workspaces */}
        <div>
          <Heading title="Active workspaces" subtitle="Your team’s spaces" action="View all" onAction={() => navigate('/workspace')} />
          <div className="card mt-3 overflow-hidden">
            {(data?.spaces.length ?? 0) === 0 ? (
              <div className="flex min-h-[236px] flex-col items-center justify-center gap-3 p-6 text-center">
                <Building2 className="h-6 w-6 text-ivory-400" />
                <p className="text-[15px] font-medium text-navy-800">No workspaces yet</p>
                <button onClick={() => navigate('/workspace/new')} className="btn-secondary btn-sm">Create one</button>
              </div>
            ) : (
              <ul className="divide-y divide-navy-100">
                {data!.spaces.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => navigate('/workspace/' + s.slug)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ivory-50">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-800 text-sm font-semibold text-white">{s.name.charAt(0).toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-navy-800">{s.name}</span>
                        <span className="block truncate text-[13px] text-ivory-600">{s.memberIds.length} {s.memberIds.length === 1 ? 'member' : 'members'}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-ivory-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* AI assistant */}
        <div>
          <Heading title="AI Assistant" subtitle="Ask, summarize, or plan" />
          <div className="card mt-3 overflow-hidden">
            <form onSubmit={onAsk} className="flex gap-2 p-3">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} className="input-field h-10 flex-1 rounded-full" placeholder="Ask anything…" aria-label="Ask the AI assistant" />
              <button type="submit" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-400 text-white transition-colors hover:bg-gold-500" aria-label="Send question"><Send className="h-4 w-4" /></button>
            </form>
            <ul className="divide-y divide-navy-100 border-t border-navy-100">
              {AI_PROMPTS.map((p) => (
                <li key={p}>
                  <button onClick={() => askAI(p)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-navy-700 transition-colors hover:bg-ivory-50">
                    <Sparkles className="h-3.5 w-3.5 text-gold-400" />{p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <Heading title="Quick actions" subtitle="Common workspace tasks" />
          <div className="card mt-3 divide-y divide-navy-100 overflow-hidden">
            <QuickAction label="Share screen" detail="Present to your team" icon={FolderUp} onClick={() => navigate('/meetings')} />
            <QuickAction label="Upload document" detail="Share files with your team" icon={FileText} onClick={() => navigate('/media-library')} />
            <QuickAction label="Record meeting" detail="Record for later review" icon={Video} onClick={() => navigate('/recordings')} />
            <QuickAction label="Invite people" detail="Add members to your workspace" icon={UserPlus} onClick={() => navigate('/settings')} />
          </div>
        </div>

        {/* Notifications */}
        <div id="dash-notifications" className="scroll-mt-24">
          <Heading title="Notifications" subtitle="Signals that need attention" action="View all" onAction={() => navigate('/conversations')} />
          <div className="card mt-3 overflow-hidden">
            {(data?.activity.length ?? 0) === 0 ? (
              <Empty icon={Bell} title="No notifications yet" detail="You’re all caught up." small />
            ) : (
              <ul className="divide-y divide-navy-100">
                {data!.activity.slice(0, 4).map((it) => <ActivityRow key={it.id} item={it} compact />)}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ActionCard({ label, detail, icon: Icon, onClick }: { label: string; detail: string; icon: ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card card-hover flex min-h-[96px] flex-col items-start gap-3 p-4 text-left">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-50 text-gold-400"><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold text-navy-800">{label}</span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] text-ivory-600">{detail}</span>
      </span>
    </button>
  );
}

function Heading({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-navy-800">{title}</h2>
        <p className="mt-0.5 text-[13px] text-ivory-600">{subtitle}</p>
      </div>
      {action && onAction && <button onClick={onAction} className="flex items-center gap-1 text-sm text-gold-400 hover:underline">{action}<ArrowRight className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-white p-4">
      <p className="flex items-center gap-1.5 text-[13px] text-ivory-600"><Icon className="h-3.5 w-3.5" />{label}</p>
      <p className="mt-1 font-display text-[28px] font-semibold tabular-nums tracking-[-0.03em] text-navy-800">{value.toLocaleString()}</p>
    </div>
  );
}

/** A single-series bar chart: one bar per day, today last. Hover a bar for its count. */
function WeekBars({ days }: { days: DayCount[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <figure className="mt-4" aria-label="Appointments and messages per day, last 7 days">
      <div className="flex h-32 items-end gap-2 border-b border-navy-100">
        {days.map((d, i) => (
          <div key={d.date} className="group relative flex h-full flex-1 items-end justify-center">
            <span
              className={cn('w-full max-w-[28px] rounded-t transition-colors', i === days.length - 1 ? 'bg-gold-400' : 'bg-gold-200 group-hover:bg-gold-300')}
              style={{ height: `${Math.max(d.count ? 6 : 2, (d.count / max) * 100)}%` }}
              title={`${d.label}: ${d.count}`}
            />
            <span role="tooltip" className="pointer-events-none absolute -top-7 hidden whitespace-nowrap rounded-md bg-navy-800 px-2 py-0.5 text-xs text-white group-hover:block">{d.count}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {days.map((d) => <span key={d.date} className="flex-1 text-center text-[11px] text-ivory-600">{d.label}</span>)}
      </div>
      <table className="sr-only"><caption>Per day</caption><tbody>{days.map((d) => <tr key={d.date}><th>{d.label}</th><td>{d.count}</td></tr>)}</tbody></table>
    </figure>
  );
}

function ActivityRow({ item, compact }: { item: ActivityItem; compact?: boolean }) {
  const Icon = item.kind === 'booking' ? CalendarDays : ClipboardList;
  return (
    <li className={cn('flex items-start gap-3 px-5', compact ? 'py-3' : 'py-3.5')}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ivory-100 text-navy-600"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-navy-800">{item.title}</span>
        <span className="block truncate text-[13px] text-ivory-600">{item.detail}</span>
      </span>
      <span className="shrink-0 text-xs text-ivory-600">{timeAgo(item.at)}</span>
    </li>
  );
}

function QuickAction({ label, detail, icon: Icon, onClick }: { label: string; detail: string; icon: ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ivory-50">
      <Icon className="h-[18px] w-[18px] shrink-0 text-gold-400" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-navy-800">{label}</span>
        <span className="block text-[13px] text-ivory-600">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-ivory-400" />
    </button>
  );
}

function Empty({ icon: Icon, title, detail, small }: { icon: ComponentType<{ className?: string }>; title: string; detail: string; small?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center p-6 text-center', small ? 'min-h-[236px]' : 'min-h-[360px]')}>
      <Icon className="h-6 w-6 text-ivory-400" />
      <p className="mt-2 text-[15px] font-medium text-navy-800">{title}</p>
      <p className="mt-1 text-[13px] text-ivory-600">{detail}</p>
    </div>
  );
}
