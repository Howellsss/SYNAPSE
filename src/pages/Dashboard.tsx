import { useEffect, useState, type ComponentType } from 'react';
import { Building2, CalendarDays, ChevronRight, MessageCircle, Plus, Users, Video } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
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
  messageCount: number;
}

/** "Today": what's next, the day's schedule and a few honest numbers. */
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

    const [todayRes, upcomingRes, contactsRes, membersRes, messagesRes] = await Promise.all([
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
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    ]);

    setData({
      todayAppointments: (todayRes.data ?? []) as DashboardAppointment[],
      upcomingAppointments: (upcomingRes.data ?? []) as DashboardAppointment[],
      contactCount: contactsRes.count ?? 0,
      workspaceMemberCount: membersRes.count ?? 0,
      messageCount: messagesRes.count ?? 0,
    });
    setLoading(false);
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.first_name || 'there';
  const today = formatDate(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' });

  if (loading) {
    return (
      <div className="mx-auto max-w-[1080px] space-y-8">
        <Skeleton className="h-16 w-80" />
        <div className="grid gap-5 lg:grid-cols-5"><Skeleton className="h-60 lg:col-span-3" /><Skeleton className="h-60 lg:col-span-2" /></div>
        <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      </div>
    );
  }

  const next = data?.upcomingAppointments[0] ?? null;
  const todayList = data?.todayAppointments ?? [];

  return (
    <div className="mx-auto max-w-[1080px] space-y-9 pb-10">
      <header>
        <p className="text-[15px] text-ivory-600">{today}</p>
        <h1 className="mt-1 text-[34px] font-bold tracking-[-0.032em] text-navy-800 sm:text-[44px]">{greeting}, {firstName}</h1>
      </header>

      <div className="grid gap-5 lg:grid-cols-5">
        <section aria-label="Up next" className="card flex flex-col gap-5 p-7 lg:col-span-3">
          {next ? (
            <>
              <span className="inline-flex items-center gap-2 self-start rounded-full bg-gold-50 px-3 py-1 text-[13px] font-semibold text-gold-700">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-400" /> Up next · {startsIn(next.start_time)}
              </span>
              <div>
                <h2 className="text-[26px] font-semibold tracking-[-0.022em] text-navy-800">{next.title || next.calendars?.name || 'Appointment'}</h2>
                <p className="mt-1 text-[15px] text-ivory-600">
                  {formatTime(next.start_time)}{next.end_time ? ` – ${formatTime(next.end_time)}` : ''}
                  {next.contacts ? ` · with ${getFullName(next.contacts)}` : ''}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2.5">
                <button onClick={() => navigate('/meetings')} className="btn-primary h-11 px-6 text-[15px]"><Video className="h-4 w-4" /> Join</button>
                <button onClick={() => navigate('/calendars')} className="btn-secondary h-11 px-6 text-[15px]">Open calendar</button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-[26px] font-semibold tracking-[-0.022em] text-navy-800">Nothing scheduled this week</h2>
              <p className="text-[15px] text-ivory-600">Start a meeting now, or share a booking page so people can pick a time.</p>
              <div className="mt-auto flex flex-wrap gap-2.5">
                <button onClick={() => navigate('/meetings')} className="btn-primary h-11 px-6 text-[15px]"><Video className="h-4 w-4" /> New meeting</button>
                <button onClick={() => navigate('/calendars')} className="btn-secondary h-11 px-6 text-[15px]">Booking pages</button>
              </div>
            </>
          )}
        </section>

        <section aria-label="At a glance" className="card p-7 lg:col-span-2">
          <h2 className="text-[17px] font-semibold text-navy-800">At a glance</h2>
          <dl className="mt-3 divide-y divide-navy-100">
            <Stat label="Today's appointments" value={todayList.length} />
            <Stat label="Contacts" value={data?.contactCount ?? 0} />
            <Stat label="Messages" value={data?.messageCount ?? 0} />
            <Stat label="People on your team" value={data?.workspaceMemberCount ?? 0} />
          </dl>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-label="Today">
          <SectionTitle title="Today" action="Calendar" onAction={() => navigate('/calendars')} />
          <div className="card mt-3 overflow-hidden">
            {todayList.length === 0 ? (
              <Empty icon={CalendarDays} title="A clear day" detail="Appointments booked for today show up here." />
            ) : (
              <ul className="divide-y divide-navy-100">
                {todayList.map((a) => (
                  <li key={a.id} className="flex items-center gap-4 px-5 py-3.5">
                    <span className="w-14 text-sm font-semibold tabular-nums text-navy-800">{formatTime(a.start_time)}</span>
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: a.calendars?.color || '#4350E6' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-navy-800">{a.title || a.calendars?.name || 'Appointment'}</span>
                      <span className="block truncate text-[13px] text-ivory-600">{a.contacts ? getFullName(a.contacts) : a.calendars?.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label="Start something">
          <SectionTitle title="Start something" />
          <div className="card mt-3 divide-y divide-navy-100 overflow-hidden">
            <Shortcut icon={Video} title="New meeting" detail="Get a link and start now" onClick={() => navigate('/meetings')} />
            <Shortcut icon={Building2} title="Enter a workspace" detail="Walk over to talk to your team" onClick={() => navigate('/workspace')} />
            <Shortcut icon={Users} title="Add a contact" detail="Keep every conversation in one place" onClick={() => navigate('/contacts')} />
            <Shortcut icon={MessageCircle} title="Conversations" detail="Email and texts in one inbox" onClick={() => navigate('/conversations')} />
            <Shortcut icon={Plus} title="New booking page" detail="Let people pick a time" onClick={() => navigate('/calendars')} />
          </div>
        </section>
      </div>
    </div>
  );
}

function startsIn(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 1) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `today at ${formatTime(iso)}` : formatDate(iso, { weekday: 'long' });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-[15px] text-ivory-600">{label}</dt>
      <dd className="font-display text-[28px] font-semibold tabular-nums tracking-[-0.03em] text-navy-800">{value.toLocaleString()}</dd>
    </div>
  );
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-xl font-semibold tracking-[-0.015em] text-navy-800">{title}</h2>
      {action && onAction && <button onClick={onAction} className="text-sm text-gold-400 hover:underline">{action}</button>}
    </div>
  );
}

function Shortcut({ icon: Icon, title, detail, onClick }: { icon: ComponentType<{ className?: string }>; title: string; detail: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-ivory-50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-50 text-gold-400"><Icon className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-navy-800">{title}</span>
        <span className="block text-[13px] text-ivory-600">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-ivory-400" />
    </button>
  );
}

function Empty({ icon: Icon, title, detail }: { icon: ComponentType<{ className?: string }>; title: string; detail: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
      <Icon className="h-6 w-6 text-ivory-400" />
      <p className="mt-2 text-[15px] font-medium text-navy-800">{title}</p>
      <p className="mt-1 text-[13px] text-ivory-600">{detail}</p>
    </div>
  );
}
