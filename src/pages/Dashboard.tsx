import { useEffect, useState, type ComponentType } from 'react';
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  FolderUp,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
  UserPlus,
  Users,
  Video,
  Workflow,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/States';
import { formatDate, formatTime, getFullName } from '@/lib/utils';
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
}

interface ActionCardProps {
  label: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  onClick: () => void;
}

export function Dashboard() {
  const { profile, workspace } = useAuth();
  const [, navigate] = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    void loadDashboard(workspace.id);
  }, [workspace]);

  async function loadDashboard(workspaceId: string): Promise<void> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [todayRes, upcomingRes, contactsRes, membersRes, completedRes, messagesRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, contacts(*), calendars(*)')
        .eq('workspace_id', workspaceId)
        .in('status', ['confirmed', 'pending'])
        .gte('start_time', todayStart.toISOString())
        .lte('start_time', todayEnd.toISOString())
        .order('start_time', { ascending: true }),
      supabase
        .from('appointments')
        .select('*, contacts(*), calendars(*)')
        .eq('workspace_id', workspaceId)
        .in('status', ['confirmed', 'pending'])
        .gte('start_time', now.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .order('start_time', { ascending: true })
        .limit(5),
      supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('workspace_members').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'completed'),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    ]);

    setData({
      todayAppointments: (todayRes.data ?? []) as DashboardAppointment[],
      upcomingAppointments: (upcomingRes.data ?? []) as DashboardAppointment[],
      contactCount: contactsRes.count ?? 0,
      workspaceMemberCount: membersRes.count ?? 0,
      completedCount: completedRes.count ?? 0,
      messageCount: messagesRes.count ?? 0,
    });
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-20" />)}
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <Skeleton className="h-[430px] xl:col-span-8" />
          <Skeleton className="h-[430px] xl:col-span-4" />
        </div>
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.first_name || 'there';
  const appointments = data?.upcomingAppointments ?? [];
  const recentAppointments = [...(data?.todayAppointments ?? []), ...appointments].slice(0, 5);

  const formattedDate = formatDate(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const formattedTime = formatTime(new Date().toISOString());

  return (
    <div className="space-y-4 pb-8">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ivory-500">{formattedDate}</p>
          <h1 className="mt-1 text-[28px] font-bold tracking-[-0.04em] text-navy-800 sm:text-[32px]">
            {greeting}, <span className="text-blue-600">{firstName}</span>
          </h1>
          <p className="mt-1 text-xs text-ivory-600">Here&apos;s what&apos;s happening in your collaboration hub today.</p>
        </div>
        <div className="flex items-center gap-4 xl:text-right">
          <div className="hidden sm:block">
            <p className="text-[10px] font-semibold text-ivory-500">{formattedDate}</p>
            <p className="text-2xl font-bold leading-none text-navy-800">{formattedTime}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/meetings')} className="btn-primary px-4"><Plus className="h-4 w-4" />Create</button>
            <button className="flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 bg-white text-ivory-600 transition hover:border-blue-300 hover:text-blue-700" aria-label="Notifications"><Bell className="h-4 w-4" /></button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <ActionCard label="New Meeting" detail="Start an instant meeting" icon={Video} tone="bg-blue-50 text-blue-600" onClick={() => navigate('/meetings')} />
        <ActionCard label="Schedule Meeting" detail="Plan for later" icon={CalendarDays} tone="bg-emerald-50 text-emerald-600" onClick={() => navigate('/calendars')} />
        <ActionCard label="AI Assistant" detail="Get AI help" icon={Sparkles} tone="bg-sky-50 text-sky-600" onClick={() => navigate('/ai-hub')} />
        <ActionCard label="Start Webinar" detail="Broadcast to a large audience" icon={Activity} tone="bg-amber-50 text-amber-600" onClick={() => navigate('/webinars')} />
        <ActionCard label="Open Classroom" detail="Launch a learning session" icon={Users} tone="bg-cyan-50 text-cyan-600" onClick={() => navigate('/workspace')} />
        <ActionCard label="Create Workspace" detail="Build a new space" icon={Plus} tone="bg-rose-50 text-rose-600" onClick={() => navigate('/workspace')} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <SectionHeading title="Upcoming Meetings" subtitle="Rooms that are ready to enter" action="View all" onAction={() => navigate('/meetings')} />
          <div className="card mt-3 min-h-[326px] divide-y divide-navy-100">
            {appointments.length === 0 ? <EmptyPanel icon={CalendarDays} title="No upcoming meetings" detail="Your next meetings will appear here." /> : appointments.slice(0, 3).map((appointment) => <MeetingRow key={appointment.id} appointment={appointment} onClick={() => navigate('/meetings')} />)}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <div>
            <SectionHeading title="Today Overview" subtitle="Your collaboration pulse" />
            <div className="card mt-3 grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              <OverviewStat label="Meetings" value={data?.todayAppointments.length ?? 0} detail="Live agenda" icon={Video} tone="blue" />
              <OverviewStat label="Workspaces" value={1} detail="Active spaces" icon={Users} tone="green" />
              <OverviewStat label="Messages" value={data?.messageCount ?? 0} detail="New messages" icon={MessageCircle} tone="amber" />
              <OverviewStat label="Members" value={data?.workspaceMemberCount ?? 0} detail="In your hub" icon={Users} tone="rose" />
            </div>
          </div>
          <div>
            <SectionHeading title="Activity Overview" subtitle="Collaboration activity over the last seven days" action="This week" />
            <div className="card mt-3 min-h-[204px] overflow-hidden p-4">
              <div className="flex items-start justify-between"><div><p className="text-2xl font-bold text-navy-800">{(data?.completedCount ?? 0) + (data?.messageCount ?? 0)}</p><p className="text-xs text-ivory-500">Completed actions</p></div><span className="rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-600">This week</span></div>
              <ActivityChart />
            </div>
          </div>
        </div>

        <div className="xl:col-span-4">
          <SectionHeading title="Recent Activity" subtitle="What&apos;s moving across your hub" action="View all" onAction={() => navigate('/conversations')} />
          <div className="card mt-3 min-h-[326px] divide-y divide-navy-100">
            {recentAppointments.length === 0 ? <EmptyPanel icon={Activity} title="No recent activity" detail="New workspace activity will appear here." /> : recentAppointments.map((appointment) => <div key={appointment.id} className="flex items-center gap-3 px-4 py-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Video className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-navy-700">{appointment.title || 'Meeting scheduled'}</p><p className="text-[10px] text-ivory-500">{formatTime(appointment.start_time)}</p></div><MoreHorizontal className="h-4 w-4 text-ivory-400" /></div>)}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <SectionHeading title="Active Workspaces" subtitle="Spaces with recent movement" action="View all" onAction={() => navigate('/workspace')} />
          <div className="card mt-3 divide-y divide-navy-100"><WorkspaceRow name={workspace?.name || 'My Workspace'} detail={`${data?.workspaceMemberCount ?? 0} members · ${data?.contactCount ?? 0} contacts`} color="bg-navy-800" /><WorkspaceRow name="Team Space" detail="Shared projects and conversations" color="bg-blue-600" /><WorkspaceRow name="Events Space" detail="Events, webinars, and planning" color="bg-cyan-600" /></div>
        </div>
        <div>
          <SectionHeading title="AI Assistant" subtitle="Ask, summarize, or plan" />
          <div className="card mt-3 overflow-hidden"><div className="flex gap-2 p-3"><input className="input-field h-9 flex-1 text-xs" placeholder="Ask anything..." /><button className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700" aria-label="Send question"><Send className="h-3.5 w-3.5" /></button></div><div className="divide-y divide-navy-100 border-t border-navy-100">{['Summarize today’s meetings', 'What are my priorities this week?', 'Show me project updates', 'Generate meeting brief'].map((prompt) => <button key={prompt} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-navy-600 transition hover:bg-blue-50 hover:text-blue-600"><Sparkles className="h-3 w-3 text-blue-500" />{prompt}</button>)}</div></div>
        </div>
        <div>
          <SectionHeading title="Quick Actions" subtitle="Common workspace tasks" />
          <div className="card mt-3 divide-y divide-navy-100"><QuickAction label="Share Screen" detail="Present to your team" icon={FolderUp} onClick={() => navigate('/meetings')} /><QuickAction label="Upload Document" detail="Share files with your team" icon={FileText} onClick={() => navigate('/media-library')} /><QuickAction label="Record Meeting" detail="Record for later review" icon={Video} onClick={() => navigate('/meetings')} /><QuickAction label="Invite People" detail="Add members to your workspace" icon={UserPlus} onClick={() => navigate('/workspace')} /></div>
        </div>
        <div>
          <SectionHeading title="Notifications" subtitle="Signals that need attention" action="View all" onAction={() => navigate('/conversations')} />
          <div className="card mt-3 flex min-h-[228px] flex-col items-center justify-center p-6 text-center"><Bell className="h-7 w-7 text-ivory-400" /><p className="mt-2 text-xs font-semibold text-navy-600">No notifications yet</p><p className="mt-1 text-[10px] text-ivory-500">You&apos;re all caught up.</p></div>
        </div>
      </section>
    </div>
  );
}

function ActionCard({ label, detail, icon: Icon, tone, onClick }: ActionCardProps) {
  return (
    <button onClick={onClick} className="card card-hover flex min-h-[74px] items-center gap-3 p-3 text-left">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><span className="block truncate text-[11px] font-bold text-navy-700">{label}</span><span className="mt-0.5 block truncate text-[9px] text-ivory-500">{detail}</span></span>
    </button>
  );
}

function SectionHeading({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div><h2 className="text-sm font-bold text-navy-800">{title}</h2><p className="mt-0.5 text-[10px] text-ivory-500">{subtitle}</p></div>
      {action && onAction && <button onClick={onAction} className="flex items-center gap-1 text-[10px] font-semibold text-gold-700 hover:text-gold-600">{action}<ArrowRight className="h-3 w-3" /></button>}
    </div>
  );
}

function MeetingRow({ appointment, onClick }: { appointment: DashboardAppointment; onClick: () => void }) {
  const contact = appointment.contacts;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ivory-50">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Video className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-navy-700">{appointment.title || appointment.calendars?.name || 'Focus room'}</p><p className="mt-0.5 text-[10px] text-ivory-500">{formatDate(appointment.start_time, { weekday: 'short', month: 'short', day: 'numeric' })} · {formatTime(appointment.start_time)}</p></div>
      <span className="hidden text-[10px] text-ivory-500 sm:block">{getFullName(contact ?? { first_name: null, last_name: null })}</span>
      <span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-600">Join</span>
    </button>
  );
}

function WorkspaceRow({ name, detail, color }: { name: string; detail: string; color: string }) {
  return <div className="flex items-center gap-3 px-4 py-3"><div className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white ${color}`}>{name.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-navy-700">{name}</p><p className="truncate text-[10px] text-ivory-500">{detail}</p></div><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /></div>;
}

function OverviewStat({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: ComponentType<{ className?: string }>; tone: 'blue' | 'green' | 'amber' | 'rose' }) {
  const tones = { blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600' };
  return <div className="flex items-start gap-2 rounded-xl bg-white p-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></span><div><p className="text-[9px] text-ivory-500">{label}</p><p className="text-lg font-bold leading-tight text-navy-800">{value}</p><p className="text-[9px] text-ivory-500">{detail}</p></div></div>;
}

function QuickAction({ label, detail, icon: Icon, onClick }: { label: string; detail: string; icon: ComponentType<{ className?: string }>; onClick: () => void }) {
  return <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ivory-50"><Icon className="h-4 w-4 shrink-0 text-blue-600" /><span><span className="block text-[11px] font-semibold text-navy-700">{label}</span><span className="block text-[9px] text-ivory-500">{detail}</span></span></button>;
}

function EmptyPanel({ icon: Icon, title, detail }: { icon: ComponentType<{ className?: string }>; title: string; detail: string }) {
  return <div className="flex min-h-28 flex-col items-center justify-center p-5 text-center"><Icon className="h-5 w-5 text-ivory-400" /><p className="mt-2 text-xs font-semibold text-navy-600">{title}</p><p className="mt-1 text-[10px] text-ivory-500">{detail}</p></div>;
}

function ActivityChart() {
  return (
    <div className="mt-4 overflow-hidden">
      <svg viewBox="0 0 700 180" className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label="Weekly activity chart">
        <defs><linearGradient id="activityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4f7df3" stopOpacity="0.18" /><stop offset="100%" stopColor="#4f7df3" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 144 C45 136 58 72 116 76 C165 79 166 124 214 112 C267 99 288 46 339 58 C387 70 394 137 448 132 C500 127 524 130 563 116 C608 101 641 104 700 52 L700 180 L0 180 Z" fill="url(#activityFill)" />
        <path d="M0 144 C45 136 58 72 116 76 C165 79 166 124 214 112 C267 99 288 46 339 58 C387 70 394 137 448 132 C500 127 524 130 563 116 C608 101 641 104 700 52" fill="none" stroke="#4f7df3" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        <circle cx="339" cy="58" r="5" fill="#4f7df3" stroke="white" strokeWidth="3" />
      </svg>
      <div className="flex justify-between px-1 text-[9px] text-ivory-400"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
    </div>
  );
}
