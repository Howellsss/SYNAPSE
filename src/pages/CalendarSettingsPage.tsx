import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Calendar,
  Plus,
  Search,
  Clock,
  Users,
  Copy,
  Share2,
  ChevronLeft,
  User,
  UserCheck,
  UsersRound,
  CalendarClock,
  Briefcase,
  Edit,
  Eye,
  Copy as Duplicate,
  Trash2,
  Power,
  ExternalLink,
  Link2,
  Code,
  X,
  CheckCircle2,
  Filter,
  ArrowUpDown,
  Globe,
  Bell,
  Mail,
  CreditCard,
  Zap,
  Settings as SettingsIcon,
  CalendarDays,
  Lock,
  Sparkles,
  Palette,
  Save,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, Skeleton, ErrorState } from '@/components/ui/States';
import { formatDate, getFullName, cn, slugify } from '@/lib/utils';
import { useRouter } from '@/lib/router';
import { generateEmbedCode } from '@/lib/booking-form';
import { TimezoneSelect } from '@/components/ui/TimezoneSelect';
import { GroupCalendarManager } from '@/components/calendar/GroupCalendarManager';
import { CreateCalendarWizard } from '@/components/calendar/CreateCalendarWizard';
import type {
  Calendar as CalendarType, CalendarType as CalType, LocationType,
  AvailabilityRule, CalendarHost, Profile, Form,
} from '@/types';
import { FileText } from 'lucide-react';
import { publicOrigin } from '@/lib/publicUrl';

// ============================================================
// TYPES
// ============================================================
interface CalendarWithHosts extends CalendarType {
  calendar_hosts?: (CalendarHost & { profiles?: Profile | null })[];
  appointment_count?: number;
}

interface GroupCalendarWithMembers {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  is_active: boolean;
  primary_color: string;
  layout: 'grid' | 'list';
  created_at: string;
  updated_at: string;
  calendar_group_members: { calendar_id: string; sort_order: number; calendars: CalendarType | null }[];
}

type DetailTab = 'general' | 'availability' | 'booking_page' | 'forms' | 'notifications' | 'reminders' | 'limits' | 'hosts' | 'integrations' | 'payments' | 'appearance' | 'advanced';

const CALENDAR_TYPES: { value: CalType; label: string; icon: typeof User; desc: string; isGroup?: boolean }[] = [
  { value: 'one_on_one', label: 'Personal', icon: User, desc: 'One host with one participant' },
  { value: 'round_robin', label: 'Round Robin', icon: UserCheck, desc: 'Multiple hosts, one assigned per booking' },
  { value: 'collective', label: 'Collective', icon: UsersRound, desc: 'All required hosts must be available' },
  { value: 'event', label: 'Event', icon: CalendarClock, desc: 'Events with capacity for multiple attendees' },
  { value: 'service', label: 'Service Booking', icon: Briefcase, desc: 'Service-based appointment with pricing' },
];

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  active: { label: 'Active', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  inactive: { label: 'Inactive', bg: 'bg-ivory-100', text: 'text-ivory-700', dot: 'bg-ivory-600' },
  archived: { label: 'Archived', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

const DETAIL_TABS: { id: DetailTab; label: string; icon: typeof SettingsIcon }[] = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'availability', label: 'Availability', icon: CalendarDays },
  { id: 'booking_page', label: 'Booking Page', icon: Globe },
  { id: 'forms', label: 'Forms', icon: Edit },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'reminders', label: 'Reminders', icon: Clock },
  { id: 'limits', label: 'Limits', icon: Lock },
  { id: 'hosts', label: 'Hosts', icon: Users },
  { id: 'integrations', label: 'Integrations', icon: Zap },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'advanced', label: 'Advanced', icon: Sparkles },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'created_desc', label: 'Recently created' },
  { value: 'updated_desc', label: 'Recently updated' },
];

// ============================================================
// MAIN PAGE
// ============================================================
export function CalendarSettingsPage() {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [calendars, setCalendars] = useState<CalendarWithHosts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [hostFilter, setHostFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState('updated_desc');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCalendar, setSelectedCalendar] = useState<CalendarWithHosts | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [shareCalendar, setShareCalendar] = useState<CalendarWithHosts | null>(null);
  const [deleteCalendar, setDeleteCalendar] = useState<CalendarWithHosts | null>(null);
  const [duplicateCalendar, setDuplicateCalendar] = useState<CalendarWithHosts | null>(null);
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [groups, setGroups] = useState<GroupCalendarWithMembers[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<{ user_id: string; profile: Profile }[]>([]);

  const loadData = useCallback(async () => {
    if (!workspace && !user) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    const calFilters: string[] = [];
    if (workspace) calFilters.push(`workspace_id.eq.${workspace.id}`);
    if (user) calFilters.push(`owner_id.eq.${user.id}`);
    const calOrFilter = calFilters.join(',');
    let calQuery = supabase.from('calendars').select('*').order('created_at', { ascending: false });
    if (calOrFilter) calQuery = calQuery.or(calOrFilter);
    const calRes = await calQuery;
    const calIds = (calRes.data ?? []).map((c: { id: string }) => c.id);
    let apptQuery = supabase.from('appointments').select('calendar_id');
    if (calIds.length > 0) apptQuery = apptQuery.in('calendar_id', calIds);
    else apptQuery = apptQuery.eq('calendar_id', '00000000-0000-0000-0000-000000000000');
    let membersRes: { data: { user_id: string }[] | null } = { data: [] };
    if (workspace) {
      membersRes = await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspace.id).eq('status', 'active');
    }
    const apptRes = await apptQuery;
    if (calRes.error) {
      setError(true);
      setLoading(false);
      return;
    }
    const calendarRows = (calRes.data ?? []) as CalendarWithHosts[];
    const allCalIds = calendarRows.map(calendar => calendar.id);
    const hostRes = allCalIds.length > 0
      ? await supabase.from('calendar_hosts').select('*').in('calendar_id', allCalIds)
      : { data: [], error: null };
    const hostRows = (hostRes.data ?? []) as CalendarHost[];
    const hostIds = [...new Set(hostRows.map(host => host.user_id))];
    const memberIds = ((membersRes.data ?? []) as { user_id: string }[]).map(member => member.user_id);
    const profileIds = [...new Set([...hostIds, ...memberIds])];
    const profileRes = profileIds.length > 0
      ? await supabase.from('profiles').select('*').in('user_id', profileIds)
      : { data: [], error: null };
    const profiles = (profileRes.data ?? []) as Profile[];
    const profileMap = new Map(profiles.map(profile => [profile.user_id, profile]));
    const hostsByCalendar = new Map<string, (CalendarHost & { profiles?: Profile | null })[]>();
    hostRows.forEach(host => {
      const currentHosts = hostsByCalendar.get(host.calendar_id) ?? [];
      currentHosts.push({ ...host, profiles: profileMap.get(host.user_id) ?? null });
      hostsByCalendar.set(host.calendar_id, currentHosts);
    });
    const apptCounts: Record<string, number> = {};
    (apptRes.data ?? []).forEach((appointment: { calendar_id: string }) => {
      apptCounts[appointment.calendar_id] = (apptCounts[appointment.calendar_id] || 0) + 1;
    });
    setCalendars(calendarRows.map(calendar => ({
      ...calendar,
      calendar_hosts: hostsByCalendar.get(calendar.id) ?? [],
      appointment_count: apptCounts[calendar.id] || 0,
    })));

    // Load group calendars
    const groupFilters: string[] = [];
    if (workspace) groupFilters.push(`workspace_id.eq.${workspace.id}`);
    if (user) groupFilters.push(`owner_id.eq.${user.id}`);
    const groupOrFilter = groupFilters.join(',');
    let groupQuery = supabase
      .from('calendar_groups')
      .select('*, calendar_group_members(calendar_id, sort_order, calendars(*))')
      .order('created_at', { ascending: false });
    if (groupOrFilter) groupQuery = groupQuery.or(groupOrFilter);
    const groupRes = await groupQuery;
    if (!groupRes.error && groupRes.data) {
      setGroups(groupRes.data as unknown as GroupCalendarWithMembers[]);
    }

    setWorkspaceMembers(
      memberIds
        .map((userId: string) => ({ user_id: userId, profile: profileMap.get(userId) }))
        .filter((member: { user_id: string; profile: Profile | undefined }): member is { user_id: string; profile: Profile } => Boolean(member.profile))
    );
    setLoading(false);
  }, [workspace, user]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filter and sort
  const filteredCalendars = useMemo(() => {
    let result = [...calendars];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q) || c.slug.toLowerCase().includes(q));
    }
    if (typeFilter !== 'all') result = result.filter(c => c.calendar_type === typeFilter);
    if (statusFilter !== 'all') result = result.filter(c => c.status === statusFilter);
    if (hostFilter !== 'all') result = result.filter(c => c.calendar_hosts?.some(h => h.user_id === hostFilter));
    if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'created_desc') result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    else if (sortBy === 'updated_desc') result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return result;
  }, [calendars, searchQuery, typeFilter, statusFilter, hostFilter, sortBy]);

  const handleDuplicate = async () => {
    if (!duplicateCalendar || !user) return;
    const cal = duplicateCalendar;
    const newSlug = `${cal.slug}-copy`;
    const insertData: Record<string, unknown> = {
      name: `${cal.name} (Copy)`,
      description: cal.description,
      slug: newSlug,
      calendar_type: cal.calendar_type,
      duration_minutes: cal.duration_minutes,
      slot_interval_minutes: cal.slot_interval_minutes,
      location_type: cal.location_type,
      color: cal.color,
      timezone: cal.timezone,
      status: 'inactive',
      capacity: cal.capacity,
      buffer_before_minutes: cal.buffer_before_minutes,
      buffer_after_minutes: cal.buffer_after_minutes,
      min_booking_notice_minutes: cal.min_booking_notice_minutes,
      max_booking_horizon_days: cal.max_booking_horizon_days,
      max_bookings_per_day: cal.max_bookings_per_day,
      max_bookings_per_week: cal.max_bookings_per_week,
      max_bookings_per_month: cal.max_bookings_per_month,
      cancellation_policy: cal.cancellation_policy,
      booking_flow: cal.booking_flow,
    };
    if (workspace) insertData.workspace_id = workspace.id;
    else insertData.owner_id = user.id;
    const { data: newCal, error } = await supabase.from('calendars').insert(insertData).select().single();
    if (error) { toast('Something went wrong. Please try again.', 'error'); return; }
    // Copy availability rules
    const { data: rules } = await supabase.from('availability_rules').select('*').eq('calendar_id', cal.id);
    if (rules && rules.length > 0) {
      await supabase.from('availability_rules').insert(
        rules.map((r: AvailabilityRule) => ({
          calendar_id: newCal.id, day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time, sort_order: r.sort_order,
        }))
      );
    }
    // Copy hosts
    const { data: hosts } = await supabase.from('calendar_hosts').select('*').eq('calendar_id', cal.id);
    if (hosts && hosts.length > 0) {
      await supabase.from('calendar_hosts').insert(
        hosts.map((h: CalendarHost) => ({ calendar_id: newCal.id, user_id: h.user_id, priority: h.priority, weight: h.weight, is_primary: h.is_primary }))
      );
    }
    toast('Calendar duplicated as draft');
    setDuplicateCalendar(null);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteCalendar) return;
    if (deleteCalendar.appointment_count && deleteCalendar.appointment_count > 0) {
      await supabase.from('calendars').update({ status: 'archived' }).eq('id', deleteCalendar.id);
      toast('Calendar archived — existing appointments preserved');
    } else {
      await supabase.from('calendars').delete().eq('id', deleteCalendar.id);
      toast('Calendar deleted');
    }
    setDeleteCalendar(null);
    loadData();
  };

  const toggleStatus = async (cal: CalendarWithHosts) => {
    const newStatus = cal.status === 'active' ? 'inactive' : 'active';
    await supabase.from('calendars').update({ status: newStatus }).eq('id', cal.id);
    toast(newStatus === 'active' ? 'Calendar activated' : 'Calendar deactivated');
    loadData();
  };

  // If a calendar is selected, show detail view
  if (selectedCalendar) {
    return (
      <CalendarDetailView
        calendar={selectedCalendar}
        onBack={() => { setSelectedCalendar(null); loadData(); }}
        onShare={() => setShareCalendar(selectedCalendar)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-navy-100 bg-white px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-navy-800">Calendar Settings</h1>
            <p className="mt-1 text-sm text-ivory-600">Create and manage the booking calendars people use to schedule time with you.</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary btn-sm shrink-0">
            <Plus className="w-4 h-4" />
            Create Calendar
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 bg-white px-6 py-3">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ivory-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search calendars..."
            className="w-full rounded-lg border border-navy-100 bg-ivory-50 py-2 pl-9 pr-3 text-sm text-navy-700 placeholder:text-ivory-400 outline-none focus:border-gold-300 focus:bg-white"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition', showFilters || typeFilter !== 'all' || statusFilter !== 'all' || hostFilter !== 'all' ? 'border-gold-300 bg-gold-50 text-gold-700' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}
        >
          <Filter className="h-4 w-4" />
          Filters
          {(typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (hostFilter !== 'all' ? 1 : 0) > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold-400 text-[10px] text-navy-800">
              {(typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (hostFilter !== 'all' ? 1 : 0)}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1.5 rounded-lg border border-navy-100 bg-ivory-50 px-2.5 py-2">
          <ArrowUpDown className="h-3.5 w-3.5 text-ivory-500" />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-transparent text-sm font-medium text-navy-700 outline-none cursor-pointer">
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="border-b border-navy-100 bg-ivory-50/50 px-6 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ivory-600">Type:</span>
              <button onClick={() => setTypeFilter('all')} className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium transition', typeFilter === 'all' ? 'border-navy-200 bg-white text-navy-700' : 'border-navy-100 text-ivory-500 hover:text-navy-700')}>All</button>
              {CALENDAR_TYPES.map(t => (
                <button key={t.value} onClick={() => setTypeFilter(t.value)} className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium transition', typeFilter === t.value ? 'border-navy-200 bg-white text-navy-700' : 'border-navy-100 text-ivory-500 hover:text-navy-700')}>{t.label}</button>
              ))}
            </div>
            <div className="h-5 w-px bg-navy-100" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ivory-600">Status:</span>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <button key={key} onClick={() => setStatusFilter(key)} className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition', statusFilter === key ? `${cfg.bg} ${cfg.text} border-current` : 'border-navy-100 text-ivory-500 hover:text-navy-700')}>
                  <span className={cn('h-2 w-2 rounded-full', cfg.dot)} />
                  {cfg.label}
                </button>
              ))}
            </div>
            {workspaceMembers.length > 0 && (
              <>
                <div className="h-5 w-px bg-navy-100" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ivory-600">Host:</span>
                  <select value={hostFilter} onChange={e => setHostFilter(e.target.value)} className="rounded-lg border border-navy-100 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 outline-none">
                    <option value="all">All hosts</option>
                    {workspaceMembers.map(m => (
                      <option key={m.user_id} value={m.user_id}>{getFullName(m.profile)}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {(typeFilter !== 'all' || statusFilter !== 'all' || hostFilter !== 'all') && (
              <button onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setHostFilter('all'); }} className="text-xs font-semibold text-burgundy-600 hover:text-burgundy-700">Clear all</button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44" />)}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <ErrorState message="We couldn't load your calendars." onRetry={loadData} />
          </div>
        ) : (
          <>
            {/* Individual Calendars */}
            {filteredCalendars.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={<Calendar className="w-7 h-7" />}
                  title={calendars.length === 0 ? "Create your first calendar" : "No calendars match your filters"}
                  description={calendars.length === 0 ? "Give people an easy way to book time with you." : "Try adjusting your search or filters."}
                  action={calendars.length === 0 ? (
                    <button onClick={() => setShowCreate(true)} className="btn-primary">
                      <Plus className="w-4 h-4" />
                      Create Calendar
                    </button>
                  ) : (
                    <button onClick={() => { setSearchQuery(''); setTypeFilter('all'); setStatusFilter('all'); setHostFilter('all'); }} className="btn-secondary">Clear filters</button>
                  )}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCalendars.map(cal => (
                  <CalendarCard
                    key={cal.id}
                    calendar={cal}
                    onOpen={() => setSelectedCalendar(cal)}
                    onShare={() => setShareCalendar(cal)}
                    onDuplicate={() => setDuplicateCalendar(cal)}
                    onToggleStatus={() => toggleStatus(cal)}
                    onDelete={() => setDeleteCalendar(cal)}
                  />
                ))}
              </div>
            )}

            {/* Group Calendars */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-ivory-500">Group Calendars</h2>
                  <p className="mt-0.5 text-xs text-ivory-500">Combine multiple calendars into one booking link.</p>
                </div>
                <button
                  onClick={() => setShowGroupManager(true)}
                  className="btn-secondary btn-sm shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Manage Groups
                </button>
              </div>
              {groups.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groups.map(grp => (
                    <GroupCalendarCard
                      key={grp.id}
                      group={grp}
                      onOpen={() => navigate(`/calendars/groups/${grp.id}`)}
                      onPreview={() => window.open(`${publicOrigin()}/group/${grp.slug}`, '_blank')}
                      onCopyLink={() => {
                        navigator.clipboard.writeText(`${publicOrigin()}/group/${grp.slug}`);
                        toast('Group link copied');
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-navy-200 p-6 text-center">
                  <UsersRound className="mx-auto h-7 w-7 text-ivory-400" />
                  <p className="mt-2 text-sm font-semibold text-navy-700">No group calendars yet</p>
                  <p className="mt-1 text-xs text-ivory-500">Create a group to combine multiple calendars under one booking link.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Group Calendar Manager Modal */}
      {showGroupManager && (workspace || user) && (
        <GroupCalendarManager
          workspaceId={workspace?.id ?? null}
          ownerFallbackId={user?.id ?? null}
          calendars={calendars}
          onClose={() => setShowGroupManager(false)}
          onSaved={() => loadData()}
          onOpenSettings={(gid) => { setShowGroupManager(false); navigate(`/calendars/groups/${gid}`); }}
        />
      )}

      {/* Create Calendar Wizard */}
      {showCreate && (
        <CreateCalendarWizard onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadData(); }} />
      )}

      {/* Share Modal */}
      {shareCalendar && (
        <ShareCalendarModal calendar={shareCalendar} onClose={() => setShareCalendar(null)} />
      )}

      {/* Duplicate Confirmation */}
      {duplicateCalendar && (
        <ConfirmDialog
          open
          onClose={() => setDuplicateCalendar(null)}
          onConfirm={handleDuplicate}
          title="Duplicate Calendar"
          message={`Create a draft copy of "${duplicateCalendar.name}"? Configuration and availability will be copied. Existing appointments will not be duplicated.`}
          confirmLabel="Duplicate"
        />
      )}

      {/* Delete Confirmation */}
      {deleteCalendar && (
        <ConfirmDialog
          open
          onClose={() => setDeleteCalendar(null)}
          onConfirm={handleDelete}
          title={deleteCalendar.appointment_count && deleteCalendar.appointment_count > 0 ? "Archive Calendar" : "Delete Calendar"}
          message={deleteCalendar.appointment_count && deleteCalendar.appointment_count > 0
            ? `This calendar has ${deleteCalendar.appointment_count} appointment(s). It will be archived to preserve historical data instead of being permanently deleted.`
            : `Are you sure you want to permanently delete "${deleteCalendar.name}"? This cannot be undone.`}
          confirmLabel={deleteCalendar.appointment_count && deleteCalendar.appointment_count > 0 ? "Archive" : "Delete"}
          danger={!(deleteCalendar.appointment_count && deleteCalendar.appointment_count > 0)}
        />
      )}
    </div>
  );
}

// ============================================================
// CALENDAR CARD
// ============================================================
function CalendarCard({
  calendar, onOpen, onShare, onDuplicate, onToggleStatus, onDelete,
}: {
  calendar: CalendarWithHosts;
  onOpen: () => void;
  onShare: () => void;
  onDuplicate: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const typeInfo = CALENDAR_TYPES.find(t => t.value === calendar.calendar_type);
  const statusCfg = STATUS_CONFIG[calendar.status] ?? STATUS_CONFIG.inactive;
  const bookingUrl = `${publicOrigin()}/book/${calendar.slug}`;
  const TypeIcon = typeInfo?.icon ?? Calendar;
  const hosts = calendar.calendar_hosts ?? [];

  return (
    <div className="card card-hover p-5 relative">
      {/* Top: icon + name + status */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${calendar.color}15` }}>
            <TypeIcon className="w-5 h-5" style={{ color: calendar.color }} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-800 truncate">{calendar.name}</h3>
            <p className="text-xs text-ivory-600">{typeInfo?.label ?? calendar.calendar_type}</p>
          </div>
        </div>
        <span className={cn('status-pill shrink-0', statusCfg.bg, statusCfg.text)}>
          <span className={cn('w-1.5 h-1.5 rounded-full', statusCfg.dot)} />
          {statusCfg.label}
        </span>
      </div>

      {/* Description */}
      {calendar.description && (
        <p className="text-xs text-ivory-600 mb-3 line-clamp-2">{calendar.description}</p>
      )}

      {/* Details */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-ivory-600">
          <Clock className="w-3.5 h-3.5 text-ivory-400" />
          <span>{calendar.duration_minutes} min</span>
          <span className="text-ivory-300">·</span>
          <Globe className="w-3.5 h-3.5 text-ivory-400" />
          <span className="truncate">{calendar.timezone}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-ivory-600">
          <Users className="w-3.5 h-3.5 text-ivory-400" />
          <span className="truncate">
            {hosts.length > 0 ? hosts.map(h => getFullName(h.profiles ?? { first_name: null, last_name: null })).join(', ') : 'No hosts'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-ivory-600">
          <Link2 className="w-3.5 h-3.5 text-ivory-400" />
          <span className="truncate text-navy-600 font-medium">/book/{calendar.slug}</span>
        </div>
      </div>

      {/* Footer: updated + actions */}
      <div className="flex items-center justify-between pt-3 border-t border-sand">
        <span className="text-[10px] text-ivory-400">Updated {formatDate(calendar.updated_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <div className="flex items-center gap-1">
          <button onClick={onOpen} className="rounded-lg p-1.5 text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700" title="Open">
            <ExternalLink className="w-4 h-4" />
          </button>
          <button onClick={onShare} className="rounded-lg p-1.5 text-ivory-600 transition hover:bg-ivory-50 hover:text-gold-700" title="Share">
            <Share2 className="w-4 h-4" />
          </button>
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="rounded-lg p-1.5 text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700" title="More">
              <SettingsIcon className="w-4 h-4" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-xl border border-navy-100 bg-white py-1.5 shadow-lg">
                  <button onClick={() => { setShowMenu(false); onOpen(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-navy-700 hover:bg-ivory-50">
                    <Edit className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => { setShowMenu(false); onShare(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-navy-700 hover:bg-ivory-50">
                    <Share2 className="w-3.5 h-3.5" /> Share
                  </button>
                  <button onClick={() => { setShowMenu(false); window.open(bookingUrl, '_blank'); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-navy-700 hover:bg-ivory-50">
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </button>
                  <button onClick={() => { setShowMenu(false); onDuplicate(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-navy-700 hover:bg-ivory-50">
                    <Duplicate className="w-3.5 h-3.5" /> Duplicate
                  </button>
                  <div className="my-1 h-px bg-navy-50" />
                  <button onClick={() => { setShowMenu(false); onToggleStatus(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-navy-700 hover:bg-ivory-50">
                    <Power className="w-3.5 h-3.5" /> {calendar.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => { setShowMenu(false); onDelete(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-burgundy-600 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// GROUP CALENDAR CARD
// ============================================================
function GroupCalendarCard({
  group, onOpen, onPreview, onCopyLink,
}: {
  group: GroupCalendarWithMembers;
  onOpen: () => void;
  onPreview: () => void;
  onCopyLink: () => void;
}) {
  const memberCals = (group.calendar_group_members ?? [])
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(m => m.calendars)
    .filter(Boolean) as CalendarType[];
  const accent = group.primary_color ?? '#E4A93C';

  return (
    <div className="card card-hover p-5 relative">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}15` }}>
            <UsersRound className="w-5 h-5" style={{ color: accent }} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-800 truncate">{group.name}</h3>
            <p className="text-xs text-ivory-600">Group · {memberCals.length} calendar{memberCals.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <span className={cn('status-pill shrink-0', group.is_active !== false ? 'bg-green-50 text-green-700' : 'bg-ivory-100 text-ivory-700')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', group.is_active !== false ? 'bg-green-500' : 'bg-ivory-600')} />
          {group.is_active !== false ? 'Active' : 'Hidden'}
        </span>
      </div>

      {group.description && (
        <p className="text-xs text-ivory-600 mb-3 line-clamp-2">{group.description}</p>
      )}

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-ivory-600">
          <Link2 className="w-3.5 h-3.5 text-ivory-400" />
          <span className="truncate text-navy-600 font-medium">/group/{group.slug}</span>
        </div>
        {memberCals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {memberCals.slice(0, 3).map(cal => (
              <span key={cal.id} className="rounded-md bg-ivory-100 px-2 py-0.5 text-[10px] font-medium text-ivory-700 truncate max-w-[120px]">
                {cal.name}
              </span>
            ))}
            {memberCals.length > 3 && (
              <span className="rounded-md bg-ivory-100 px-2 py-0.5 text-[10px] font-medium text-ivory-500">
                +{memberCals.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-sand">
        <span className="text-[10px] text-ivory-400">Updated {formatDate(group.updated_at ?? group.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <div className="flex items-center gap-1">
          <button onClick={onOpen} className="rounded-lg p-1.5 text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700" title="Settings">
            <SettingsIcon className="w-4 h-4" />
          </button>
          <button onClick={onPreview} className="rounded-lg p-1.5 text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700" title="Preview">
            <Eye className="w-4 h-4" />
          </button>
          <button onClick={onCopyLink} className="rounded-lg p-1.5 text-ivory-600 transition hover:bg-ivory-50 hover:text-gold-700" title="Copy link">
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CALENDAR DETAIL VIEW (Tabbed)
// ============================================================
// The editable settings of one calendar, shared by the detail page's tabs.
function initialSettingsForm(calendar: CalendarType) {
  return {
    name: calendar.name,
    description: calendar.description || '',
    slug: calendar.slug,
    duration_minutes: calendar.duration_minutes,
    slot_interval_minutes: calendar.slot_interval_minutes,
    location_type: calendar.location_type,
    color: calendar.color,
    timezone: calendar.timezone,
    buffer_before_minutes: calendar.buffer_before_minutes,
    buffer_after_minutes: calendar.buffer_after_minutes,
    min_booking_notice_minutes: calendar.min_booking_notice_minutes,
    max_booking_horizon_days: calendar.max_booking_horizon_days,
    max_bookings_per_day: calendar.max_bookings_per_day,
    max_bookings_per_week: calendar.max_bookings_per_week,
    max_bookings_per_month: calendar.max_bookings_per_month,
    capacity: calendar.capacity,
    cancellation_policy: calendar.cancellation_policy,
    booking_flow: calendar.booking_flow,
    form_mode: calendar.form_mode ?? 'default',
    connected_form_id: calendar.connected_form_id ?? null,
    custom_confirmation_message: calendar.custom_confirmation_message ?? '',
    custom_redirect_url: calendar.custom_redirect_url ?? '',
    logo_url: calendar.logo_url ?? '',
    cover_url: calendar.cover_url ?? '',
    background_color: calendar.background_color ?? '#FAF6F0',
    button_color: calendar.button_color ?? calendar.color ?? '#8B2635',
    font_family: calendar.font_family ?? 'Inter',
  };
}

type SettingsForm = ReturnType<typeof initialSettingsForm>;

function CalendarDetailView({
  calendar, onBack, onShare,
}: {
  calendar: CalendarWithHosts;
  onBack: () => void;
  onShare: () => void;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DetailTab>('general');
  const [form, setForm] = useState(() => initialSettingsForm(calendar));
  const [saving, setSaving] = useState(false);
  const typeInfo = CALENDAR_TYPES.find(t => t.value === calendar.calendar_type);
  const TypeIcon = typeInfo?.icon ?? Calendar;
  const statusCfg = STATUS_CONFIG[calendar.status] ?? STATUS_CONFIG.inactive;

  const saveGeneral = async () => {
    setSaving(true);
    const { error } = await supabase.from('calendars').update({
      name: form.name, description: form.description, slug: form.slug,
      duration_minutes: form.duration_minutes, slot_interval_minutes: form.slot_interval_minutes,
      location_type: form.location_type, color: form.color, timezone: form.timezone,
      buffer_before_minutes: form.buffer_before_minutes, buffer_after_minutes: form.buffer_after_minutes,
      min_booking_notice_minutes: form.min_booking_notice_minutes, max_booking_horizon_days: form.max_booking_horizon_days,
      max_bookings_per_day: form.max_bookings_per_day, max_bookings_per_week: form.max_bookings_per_week,
      max_bookings_per_month: form.max_bookings_per_month, capacity: form.capacity,
      cancellation_policy: form.cancellation_policy, booking_flow: form.booking_flow,
      form_mode: form.form_mode, connected_form_id: form.connected_form_id,
      custom_confirmation_message: form.custom_confirmation_message || null,
      custom_redirect_url: form.custom_redirect_url || null,
      logo_url: form.logo_url || null,
      cover_url: form.cover_url || null,
      background_color: form.background_color,
      button_color: form.button_color,
      font_family: form.font_family,
    }).eq('id', calendar.id);
    setSaving(false);
    if (error) { toast('Something went wrong. Please try again.', 'error'); return; }
    toast('Calendar updated');
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header with back + share */}
      <div className="border-b border-navy-100 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-lg border border-navy-100 text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700 shrink-0">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${calendar.color}15` }}>
              <TypeIcon className="w-5 h-5" style={{ color: calendar.color }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-navy-800 truncate">{calendar.name}</h1>
                <span className={cn('status-pill shrink-0', statusCfg.bg, statusCfg.text)}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', statusCfg.dot)} />
                  {statusCfg.label}
                </span>
              </div>
              <p className="text-xs text-ivory-600">{typeInfo?.label} · {calendar.duration_minutes}min · {calendar.timezone}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => window.open(`${publicOrigin()}/book/${calendar.slug}`, '_blank')} className="btn-secondary btn-sm">
              <Eye className="w-4 h-4" />
              Preview
            </button>
            <button onClick={onShare} className="btn-primary btn-sm">
              <Share2 className="w-4 h-4" />
              Share
            </button>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-navy-100 bg-white px-6 overflow-x-auto">
        {DETAIL_TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-all',
                activeTab === tab.id ? 'text-gold-700 border-gold-400' : 'text-ivory-600 border-transparent hover:text-navy-700'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {activeTab === 'general' && (
            <GeneralTab form={form} setForm={setForm} saving={saving} onSave={saveGeneral} calendarType={calendar.calendar_type} />
          )}
          {activeTab === 'availability' && (
            <AvailabilityTab calendarId={calendar.id} />
          )}
          {activeTab === 'booking_page' && (
            <BookingPageTab calendar={calendar} form={form} setForm={setForm} saving={saving} onSave={saveGeneral} />
          )}
          {activeTab === 'forms' && (
            <FormsTab calendarId={calendar.id} form={form} setForm={setForm} saving={saving} onSave={saveGeneral} />
          )}
          {activeTab === 'notifications' && (
            <NotificationsTab calendarId={calendar.id} />
          )}
          {activeTab === 'reminders' && (
            <RemindersTab calendarId={calendar.id} />
          )}
          {activeTab === 'limits' && (
            <LimitsTab form={form} setForm={setForm} saving={saving} onSave={saveGeneral} />
          )}
          {activeTab === 'hosts' && (
            <HostsTab calendarId={calendar.id} />
          )}
          {activeTab === 'integrations' && (
            <IntegrationsTab calendarId={calendar.id} />
          )}
          {activeTab === 'payments' && (
            <PaymentsTab />
          )}
          {activeTab === 'appearance' && (
            <AppearanceTab form={form} setForm={setForm} saving={saving} onSave={saveGeneral} />
          )}
          {activeTab === 'advanced' && (
            <AdvancedTab calendar={calendar} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// GENERAL TAB
// ============================================================
function GeneralTab({ form, setForm, saving, onSave, calendarType }: {
  form: SettingsForm; setForm: (f: SettingsForm) => void; saving: boolean; onSave: () => void; calendarType: CalType;
}) {
  return (
    <div className="space-y-5">
      <SettingsSection title="Basic Information">
        <Field label="Calendar Name">
          <input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })} />
        </Field>
        <Field label="Description">
          <textarea className="input-field min-h-[70px]" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What is this calendar for?" />
        </Field>
        <Field label="URL Slug">
          <input className="input-field" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} />
        </Field>
        <Field label="Calendar Color">
          <div className="flex items-center gap-2">
            <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-10 w-12 rounded-lg border border-navy-100 cursor-pointer" />
            <span className="text-sm text-ivory-600">{form.color}</span>
          </div>
        </Field>
      </SettingsSection>

      <SettingsSection title="Meeting Details">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration (minutes)">
            <select className="input-field" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: parseInt(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </Field>
          <Field label="Slot Interval (minutes)">
            <select className="input-field" value={form.slot_interval_minutes} onChange={e => setForm({ ...form, slot_interval_minutes: parseInt(e.target.value) })}>
              {[15, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </Field>
        </div>
        <Field label="Location">
          <select className="input-field" value={form.location_type} onChange={e => setForm({ ...form, location_type: e.target.value as LocationType })}>
            <option value="synapse_meeting">SYNAPSE Meeting</option>
            <option value="phone">Phone</option>
            <option value="in_person">In Person</option>
            <option value="custom">Custom</option>
            <option value="none">No Location</option>
          </select>
        </Field>
        <Field label="Timezone">
          <TimezoneSelect value={form.timezone} onChange={tz => setForm({ ...form, timezone: tz })} />
        </Field>
        {(calendarType === 'event' || calendarType === 'group') && (
          <Field label="Capacity">
            <input type="number" className="input-field" value={form.capacity} onChange={e => setForm({ ...form, capacity: parseInt(e.target.value) || 1 })} />
          </Field>
        )}
      </SettingsSection>

      <SettingsSection title="Booking Flow">
        <Field label="Booking Flow Order">
          <select className="input-field" value={form.booking_flow} onChange={e => setForm({ ...form, booking_flow: e.target.value as SettingsForm['booking_flow'] })}>
            <option value="calendar_first">Calendar first (pick time, then fill form)</option>
            <option value="form_first">Form first (fill form, then pick time)</option>
          </select>
        </Field>
        <Field label="Cancellation Policy">
          <select className="input-field" value={form.cancellation_policy} onChange={e => setForm({ ...form, cancellation_policy: e.target.value })}>
            <option value="any_time">Any time</option>
            <option value="24_hours">24 hours before</option>
            <option value="48_hours">48 hours before</option>
            <option value="no_cancel">No cancellation</option>
          </select>
        </Field>
      </SettingsSection>

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// AVAILABILITY TAB
// ============================================================
function AvailabilityTab({ calendarId }: { calendarId: string }) {
  const { toast } = useToast();
  const [availability, setAvailability] = useState<Record<number, { start: string; end: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('availability_rules').select('*').eq('calendar_id', calendarId).then(({ data }) => {
      const rules: Record<number, { start: string; end: string }[]> = {};
      ((data ?? []) as AvailabilityRule[]).forEach((r) => {
        if (!rules[r.day_of_week]) rules[r.day_of_week] = [];
        rules[r.day_of_week].push({ start: r.start_time, end: r.end_time });
      });
      const formatted: Record<number, { start: string; end: string }[]> = {};
      for (const [k, v] of Object.entries(rules)) {
        formatted[parseInt(k)] = v.map((item) => ({ start: item.start, end: item.end }));
      }
      setAvailability(formatted);
      setLoading(false);
    });
  }, [calendarId]);

  const save = async () => {
    setSaving(true);
    await supabase.from('availability_rules').delete().eq('calendar_id', calendarId);
    const rules: { calendar_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
    for (const [dayStr, intervals] of Object.entries(availability)) {
      const day = parseInt(dayStr);
      for (const interval of intervals) {
        rules.push({ calendar_id: calendarId, day_of_week: day, start_time: interval.start, end_time: interval.end });
      }
    }
    if (rules.length > 0) await supabase.from('availability_rules').insert(rules);
    setSaving(false);
    toast('Availability saved');
  };

  if (loading) return <div className="space-y-3">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;

  return (
    <div className="space-y-5">
      <SettingsSection title="Weekly Availability" description="Set when people can book time on this calendar.">
        <div className="space-y-2">
          {DAYS.map((day, dayIdx) => {
            const intervals = availability[dayIdx] || [];
            const isActive = intervals.length > 0;
            return (
              <div key={dayIdx} className="flex items-center gap-3 py-2 border-b border-sand last:border-b-0">
                <div className="w-28 shrink-0">
                  <button onClick={() => {
                    const na = { ...availability };
                    if (isActive) na[dayIdx] = [];
                    else na[dayIdx] = [{ start: '09:00', end: '17:00' }];
                    setAvailability(na);
                  }} className={cn('text-sm font-medium', isActive ? 'text-navy-700' : 'text-ivory-500')}>
                    {isActive && <span className="text-gold-500 mr-1.5">●</span>}{day}
                  </button>
                </div>
                {isActive && (
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    {intervals.map((interval, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="time" className="input-field py-1.5 text-sm" value={interval.start} onChange={e => {
                          const na = { ...availability }; na[dayIdx][i].start = e.target.value; setAvailability(na);
                        }} />
                        <span className="text-ivory-400">—</span>
                        <input type="time" className="input-field py-1.5 text-sm" value={interval.end} onChange={e => {
                          const na = { ...availability }; na[dayIdx][i].end = e.target.value; setAvailability(na);
                        }} />
                        {intervals.length > 1 && (
                          <button onClick={() => {
                            const na = { ...availability }; na[dayIdx].splice(i, 1); setAvailability(na);
                          }} className="text-ivory-400 hover:text-burgundy-600"><X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => {
                      const na = { ...availability }; na[dayIdx].push({ start: '13:00', end: '17:00' }); setAvailability(na);
                    }} className="text-sm text-gold-700 hover:text-gold-600 font-medium">+ Add</button>
                  </div>
                )}
                {!isActive && <span className="text-sm text-ivory-400">Unavailable</span>}
              </div>
            );
          })}
        </div>
      </SettingsSection>
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Availability'}</button>
      </div>
    </div>
  );
}

// ============================================================
// BOOKING PAGE TAB
// ============================================================
function BookingPageTab({ calendar, form, setForm, saving, onSave }: { calendar: CalendarType; form: SettingsForm; setForm: (f: SettingsForm) => void; saving: boolean; onSave: () => void }) {
  const bookingUrl = `${publicOrigin()}/book/${calendar.slug}`;
  const { toast } = useToast();
  const [embedType, setEmbedType] = useState<'inline' | 'popup' | 'button'>('inline');
  const [buttonText, setButtonText] = useState('Book Now');
  const copyLink = () => { navigator.clipboard.writeText(bookingUrl); toast('Booking link copied'); };

  const embedCode = generateEmbedCode(calendar.slug, { type: embedType, buttonText, width: '100%', height: '600px' });

  return (
    <div className="space-y-5">
      <SettingsSection title="Public Booking Page" description="This is where people go to book time with you.">
        <div className="rounded-xl border border-navy-100 bg-ivory-50 p-4">
          <p className="text-xs font-semibold text-ivory-600 mb-1">Booking URL</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-white border border-navy-100 px-3 py-2 text-sm text-navy-700">{bookingUrl}</code>
            <button onClick={copyLink} className="btn-secondary btn-sm shrink-0"><Copy className="w-3.5 h-3.5" />Copy</button>
          </div>
        </div>
        <button onClick={() => window.open(bookingUrl, '_blank')} className="btn-secondary btn-sm">
          <ExternalLink className="w-4 h-4" /> Open Booking Page
        </button>
      </SettingsSection>

      <SettingsSection title="Custom Confirmation" description="Customize what visitors see after booking.">
        <Field label="Custom Confirmation Message">
          <textarea className="input-field min-h-[70px]" value={form.custom_confirmation_message ?? ''} onChange={e => setForm({ ...form, custom_confirmation_message: e.target.value })} placeholder="Thank you for booking! We look forward to meeting you." />
        </Field>
        <Field label="Redirect URL (optional)">
          <input className="input-field" value={form.custom_redirect_url ?? ''} onChange={e => setForm({ ...form, custom_redirect_url: e.target.value })} placeholder="https://your-site.com/thank-you" />
          <p className="text-xs text-ivory-500 mt-1">If set, visitors will be redirected after booking instead of seeing the confirmation page.</p>
        </Field>
        <button onClick={onSave} disabled={saving} className="btn-primary btn-sm">{saving ? 'Saving...' : 'Save Settings'}</button>
      </SettingsSection>

      <SettingsSection title="Embed Code" description="Embed this calendar on any website.">
        <div className="flex gap-2 mb-3">
          {(['inline', 'popup', 'button'] as const).map(t => (
            <button key={t} onClick={() => setEmbedType(t)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all', embedType === t ? 'bg-navy-800 text-ivory-100' : 'bg-ivory-50 text-navy-600 border border-navy-100 hover:bg-ivory-100')}>{t}</button>
          ))}
        </div>
        {embedType === 'button' && (
          <Field label="Button Text">
            <input className="input-field" value={buttonText} onChange={e => setButtonText(e.target.value)} />
          </Field>
        )}
        <div className="rounded-xl border border-navy-100 bg-ivory-50 p-4">
          <pre className="text-xs text-navy-700 overflow-x-auto whitespace-pre-wrap"><code>{embedCode}</code></pre>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(embedCode); toast('Embed code copied'); }} className="btn-secondary btn-sm">
          <Code className="w-4 h-4" /> Copy Embed Code
        </button>
      </SettingsSection>
    </div>
  );
}

// ============================================================
// FORMS TAB
// ============================================================
function FormsTab({ calendarId, form, setForm, saving, onSave }: { calendarId: string; form: SettingsForm; setForm: (f: SettingsForm) => void; saving: boolean; onSave: () => void }) {
  const { toast } = useToast();
  const [attachedForms, setAttachedForms] = useState<Form[]>([]);
  const [availableForms, setAvailableForms] = useState<Form[]>([]);
  const [allForms, setAllForms] = useState<Form[]>([]);

  useEffect(() => {
    supabase.from('forms').select('*').eq('calendar_id', calendarId).then(({ data }) => setAttachedForms((data ?? []) as Form[]));
    supabase.from('forms').select('*').is('calendar_id', null).then(({ data }) => setAvailableForms((data ?? []) as Form[]));
    supabase.from('forms').select('*').then(({ data }) => setAllForms((data ?? []) as Form[]));
  }, [calendarId]);

  const attach = async (formItem: Form) => {
    await supabase.from('forms').update({ calendar_id: calendarId }).eq('id', formItem.id);
    setAttachedForms([...attachedForms, formItem]);
    setAvailableForms(availableForms.filter(f => f.id !== formItem.id));
    setForm({ ...form, connected_form_id: formItem.id, form_mode: 'custom' });
    toast('Form attached');
  };
  const detach = async (formItem: Form) => {
    await supabase.from('forms').update({ calendar_id: null }).eq('id', formItem.id);
    setAvailableForms([...availableForms, formItem]);
    setAttachedForms(attachedForms.filter(f => f.id !== formItem.id));
    if (form.connected_form_id === formItem.id) {
      setForm({ ...form, connected_form_id: null, form_mode: 'default' });
    }
    toast('Form detached');
  };

  const connectedForm = allForms.find(f => f.id === form.connected_form_id);

  return (
    <div className="space-y-5">
      <SettingsSection title="Booking Form Mode" description="Choose whether this calendar uses the default booking form or a custom form.">
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => { setForm({ ...form, form_mode: 'default', connected_form_id: null }); }} className={cn('p-4 rounded-xl border-2 text-left transition-all', form.form_mode === 'default' ? 'border-gold-400 bg-gold-50/30' : 'border-navy-100 hover:border-navy-200')}>
            <FileText className="w-5 h-5 text-navy-700 mb-2" />
            <p className="text-sm font-semibold text-navy-800">Default Form</p>
            <p className="text-xs text-ivory-600 mt-0.5">First Name, Last Name, Phone, Email, Additional Info</p>
          </button>
          <button onClick={() => { setForm({ ...form, form_mode: 'custom' }); }} className={cn('p-4 rounded-xl border-2 text-left transition-all', form.form_mode === 'custom' ? 'border-gold-400 bg-gold-50/30' : 'border-navy-100 hover:border-navy-200')}>
            <FileText className="w-5 h-5 text-navy-700 mb-2" />
            <p className="text-sm font-semibold text-navy-800">Custom Form</p>
            <p className="text-xs text-ivory-600 mt-0.5">Attach an existing SYNAPSE form</p>
          </button>
        </div>
        {form.form_mode === 'custom' && (
          <div className="mt-3">
            <Field label="Select Form">
              <select className="input-field" value={form.connected_form_id ?? ''} onChange={e => setForm({ ...form, connected_form_id: e.target.value || null })}>
                <option value="">Choose a form...</option>
                {[...attachedForms, ...availableForms].map(f => (
                  <option key={f.id} value={f.id}>{f.name} ({f.status})</option>
                ))}
              </select>
            </Field>
            {connectedForm && (
              <p className="text-xs text-ivory-500 mt-1.5">
                Selected: <span className="font-medium text-navy-700">{connectedForm.name}</span> — {connectedForm.type}
              </p>
            )}
          </div>
        )}
        <button onClick={onSave} disabled={saving} className="btn-primary btn-sm mt-3">{saving ? 'Saving...' : 'Save Form Settings'}</button>
      </SettingsSection>

      <SettingsSection title="Attached Forms" description="Forms that users fill out when booking on this calendar.">
        {attachedForms.length === 0 ? (
          <p className="text-sm text-ivory-500 py-4 text-center">No forms attached to this calendar.</p>
        ) : (
          <div className="space-y-2">
            {attachedForms.map(f => (
              <div key={f.id} className="flex items-center justify-between rounded-xl bg-ivory-50 p-3">
                <div>
                  <p className="text-sm font-medium text-navy-700">{f.name}</p>
                  <p className="text-xs text-ivory-600 capitalize">{f.status} · {f.type}</p>
                </div>
                <button onClick={() => detach(f)} className="text-xs text-burgundy-600 hover:text-burgundy-700 font-medium">Detach</button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
      {availableForms.length > 0 && (
        <SettingsSection title="Available Forms" description="Forms not yet attached to a calendar.">
          <div className="space-y-2">
            {availableForms.map(f => (
              <div key={f.id} className="flex items-center justify-between rounded-xl bg-ivory-50 p-3">
                <div>
                  <p className="text-sm font-medium text-navy-700">{f.name}</p>
                  <p className="text-xs text-ivory-600 capitalize">{f.status} · {f.type}</p>
                </div>
                <button onClick={() => attach(f)} className="text-xs text-gold-700 hover:text-gold-600 font-medium">Attach</button>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}
    </div>
  );
}

// ============================================================
// NOTIFICATIONS TAB
// ============================================================
function NotificationsTab(_props: { calendarId: string }) {
  return (
    <SettingsSection title="Notification Rules" description="Configure who gets notified and how when bookings happen.">
      <div className="space-y-3">
        {['booking_confirmation', 'booking_cancellation', 'rescheduling', 'host_notification'].map(event => (
          <div key={event} className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
            <div className="flex items-center gap-2">
              {event.includes('cancellation') ? <X className="w-4 h-4 text-red-500" /> : event.includes('confirmation') ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Bell className="w-4 h-4 text-navy-500" />}
              <span className="text-sm font-medium text-navy-700 capitalize">{event.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="status-pill bg-blue-50 text-blue-700"><Mail className="w-3 h-3" /> Email</span>
              <span className="status-pill bg-ivory-100 text-ivory-600">Both</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-ivory-500 mt-3">Notification templates and custom messaging can be configured in Workflows.</p>
    </SettingsSection>
  );
}

// ============================================================
// REMINDERS TAB
// ============================================================
function RemindersTab(_props: { calendarId: string }) {
  return (
    <SettingsSection title="Booking Reminders" description="Send automated reminders before appointments.">
      <div className="space-y-3">
        {[{ label: '24 hours before', channel: 'Email' }, { label: '1 hour before', channel: 'SMS' }].map((r, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gold-500" />
              <span className="text-sm font-medium text-navy-700">{r.label}</span>
            </div>
            <span className="status-pill bg-blue-50 text-blue-700">{r.channel}</span>
          </div>
        ))}
        <button className="btn-secondary btn-sm w-full"><Plus className="w-4 h-4" /> Add Reminder</button>
      </div>
    </SettingsSection>
  );
}

// ============================================================
// LIMITS TAB
// ============================================================
function LimitsTab({ form, setForm, saving, onSave }: { form: SettingsForm; setForm: (f: SettingsForm) => void; saving: boolean; onSave: () => void; }) {
  return (
    <div className="space-y-5">
      <SettingsSection title="Booking Limits" description="Control how far in advance and how often people can book.">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Buffer Before (min)">
            <input type="number" className="input-field" value={form.buffer_before_minutes} onChange={e => setForm({ ...form, buffer_before_minutes: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Buffer After (min)">
            <input type="number" className="input-field" value={form.buffer_after_minutes} onChange={e => setForm({ ...form, buffer_after_minutes: parseInt(e.target.value) || 0 })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min Booking Notice (min)">
            <input type="number" className="input-field" value={form.min_booking_notice_minutes} onChange={e => setForm({ ...form, min_booking_notice_minutes: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Max Booking Horizon (days)">
            <input type="number" className="input-field" value={form.max_booking_horizon_days} onChange={e => setForm({ ...form, max_booking_horizon_days: parseInt(e.target.value) || 0 })} />
          </Field>
        </div>
      </SettingsSection>
      <SettingsSection title="Rate Limits" description="Limit how many bookings can be made per period.">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Per Day">
            <input type="number" className="input-field" value={form.max_bookings_per_day ?? ''} onChange={e => setForm({ ...form, max_bookings_per_day: e.target.value ? parseInt(e.target.value) : null })} placeholder="No limit" />
          </Field>
          <Field label="Per Week">
            <input type="number" className="input-field" value={form.max_bookings_per_week ?? ''} onChange={e => setForm({ ...form, max_bookings_per_week: e.target.value ? parseInt(e.target.value) : null })} placeholder="No limit" />
          </Field>
          <Field label="Per Month">
            <input type="number" className="input-field" value={form.max_bookings_per_month ?? ''} onChange={e => setForm({ ...form, max_bookings_per_month: e.target.value ? parseInt(e.target.value) : null })} placeholder="No limit" />
          </Field>
        </div>
      </SettingsSection>
      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Limits'}</button>
      </div>
    </div>
  );
}

// ============================================================
// HOSTS TAB
// ============================================================
function HostsTab({ calendarId }: { calendarId: string }) {
  const { toast } = useToast();
  const { workspace } = useAuth();
  const [hosts, setHosts] = useState<(CalendarHost & { profiles?: Profile | null })[]>([]);
  const [members, setMembers] = useState<{ user_id: string; profile: Profile }[]>([]);

  const loadHosts = useCallback(async () => {
    const { data: hostRows } = await supabase.from('calendar_hosts').select('*').eq('calendar_id', calendarId);
    const userIds = [...new Set((hostRows ?? []).map((h: CalendarHost) => h.user_id))];
    const profileMap = new Map<string, Profile>();
    if (userIds.length > 0) {
      const { data: profRows } = await supabase.from('profiles').select('*').in('user_id', userIds);
      (profRows ?? []).forEach((p: Profile) => profileMap.set(p.user_id, p));
    }
    setHosts((hostRows ?? []).map((h: CalendarHost) => ({ ...h, profiles: profileMap.get(h.user_id) ?? null })));
  }, [calendarId]);

  useEffect(() => {
    loadHosts();
    (async () => {
      const allUserIds = new Set<string>();
      if (workspace) {
        const { data: memberRows } = await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspace.id).eq('status', 'active');
        (memberRows ?? []).forEach((m: { user_id: string }) => allUserIds.add(m.user_id));
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user) allUserIds.add(user.id);
      let memberProfiles: Profile[] = [];
      const ids = Array.from(allUserIds);
      if (ids.length > 0) {
        const { data: profRows } = await supabase.from('profiles').select('*').in('user_id', ids);
        memberProfiles = (profRows ?? []) as Profile[];
      }
      setMembers(memberProfiles.map(p => ({ user_id: p.user_id, profile: p })));
    })();
  }, [calendarId, workspace, loadHosts]);

  const addHost = async (userId: string) => {
    const { error } = await supabase.from('calendar_hosts').insert({ calendar_id: calendarId, user_id: userId, is_primary: hosts.length === 0 });
    if (error) { toast('Something went wrong. Please try again.', 'error'); return; }
    toast('Host added');
    loadHosts();
  };

  const removeHost = async (userId: string) => {
    await supabase.from('calendar_hosts').delete().eq('calendar_id', calendarId).eq('user_id', userId);
    toast('Host removed');
    setHosts(hosts.filter(h => h.user_id !== userId));
  };

  const availableMembers = members.filter(m => !hosts.some(h => h.user_id === m.user_id));

  return (
    <div className="space-y-5">
      <SettingsSection title="Calendar Hosts" description="People who can be assigned to appointments on this calendar.">
        <div className="space-y-2">
          {hosts.length === 0 && <p className="text-sm text-ivory-500 py-4 text-center">No hosts assigned.</p>}
          {hosts.map(h => (
            <div key={h.user_id} className="flex items-center gap-3 rounded-xl bg-ivory-50 p-3">
              <Avatar firstName={h.profiles?.first_name} lastName={h.profiles?.last_name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-navy-700">{getFullName(h.profiles ?? { first_name: null, last_name: null })}</p>
                <p className="text-xs text-ivory-600">{(h.profiles as { email?: string | null } | null)?.email ?? ''}</p>
              </div>
              {h.is_primary && <span className="text-xs font-medium text-gold-700 bg-gold-50 px-2 py-0.5 rounded-md">Primary</span>}
              <button onClick={() => removeHost(h.user_id)} className="text-ivory-400 hover:text-burgundy-600"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </SettingsSection>
      {availableMembers.length > 0 && (
        <SettingsSection title="Add Host">
          <div className="space-y-2">
            {availableMembers.map(m => (
              <div key={m.user_id} className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
                <div className="flex items-center gap-2">
                  <Avatar firstName={m.profile.first_name} lastName={m.profile.last_name} size="sm" />
                  <span className="text-sm font-medium text-navy-700">{getFullName(m.profile)}</span>
                </div>
                <button onClick={() => addHost(m.user_id)} className="text-xs text-gold-700 hover:text-gold-600 font-medium">+ Add</button>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}
    </div>
  );
}

// ============================================================
// INTEGRATIONS TAB
// ============================================================
function IntegrationsTab(_props: { calendarId: string }) {
  const integrations = [
    { provider: 'Google Calendar', icon: Calendar, connected: true, desc: 'Sync bookings with Google Calendar' },
    { provider: 'Outlook', icon: Mail, connected: false, desc: 'Sync bookings with Outlook' },
    { provider: 'Stripe', icon: CreditCard, connected: false, desc: 'Accept payments for paid bookings' },
  ];
  return (
    <SettingsSection title="Integrations" description="Connect external services to this calendar.">
      <div className="space-y-2">
        {integrations.map(i => (
          <div key={i.provider} className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-ivory-50 flex items-center justify-center"><i.icon className="w-4 h-4 text-navy-600" /></div>
              <div>
                <p className="text-sm font-medium text-navy-700">{i.provider}</p>
                <p className="text-xs text-ivory-600">{i.desc}</p>
              </div>
            </div>
            {i.connected ? (
              <span className="status-pill bg-green-50 text-green-700"><CheckCircle2 className="w-3 h-3" /> Connected</span>
            ) : (
              <button className="btn-secondary btn-sm">Connect</button>
            )}
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

// ============================================================
// PAYMENTS TAB
// ============================================================
function PaymentsTab() {
  return (
    <SettingsSection title="Payment Settings" description="Charge for bookings on this calendar.">
      <div className="rounded-xl border border-navy-100 bg-ivory-50 p-4 text-center">
        <CreditCard className="w-8 h-8 text-ivory-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-navy-700">No payment configured</p>
        <p className="text-xs text-ivory-600 mt-1">Connect Stripe to start charging for appointments.</p>
        <button className="btn-primary btn-sm mt-3"><CreditCard className="w-4 h-4" /> Connect Stripe</button>
      </div>
    </SettingsSection>
  );
}

// ============================================================
// ADVANCED TAB
// ============================================================
// ============================================================
// APPEARANCE TAB
// ============================================================
function AppearanceTab({ form, setForm, saving, onSave }: {
  form: SettingsForm; setForm: (f: SettingsForm) => void; saving: boolean; onSave: () => void;
}) {
  const fontOptions = ['Inter', 'Georgia', 'system-ui', 'Arial', 'Helvetica', 'Times New Roman'];

  return (
    <div className="space-y-5">
      <SettingsSection title="Branding Images" description="Add a logo and cover image to personalize the booking page.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Logo URL">
            <input
              value={form.logo_url}
              onChange={e => setForm({ ...form, logo_url: e.target.value })}
              placeholder="https://..."
              className="input-field"
            />
          </Field>
          <Field label="Cover image URL">
            <input
              value={form.cover_url}
              onChange={e => setForm({ ...form, cover_url: e.target.value })}
              placeholder="https://..."
              className="input-field"
            />
          </Field>
        </div>
        {form.logo_url && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-navy-100 bg-ivory-50 p-3">
            <img src={form.logo_url} alt="Logo preview" className="w-10 h-10 rounded-lg object-cover" />
            <span className="text-xs text-ivory-600">Logo preview</span>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Colors" description="Customize the colors shown on the booking page.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Primary / accent color">
            <div className="flex items-center gap-2">
              <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-navy-100" />
              <input value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="flex-1 rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
          </Field>
          <Field label="Background color">
            <div className="flex items-center gap-2">
              <input type="color" value={form.background_color} onChange={e => setForm({ ...form, background_color: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-navy-100" />
              <input value={form.background_color} onChange={e => setForm({ ...form, background_color: e.target.value })} className="flex-1 rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
          </Field>
        </div>
        <Field label="Button color">
          <div className="flex items-center gap-2">
            <input type="color" value={form.button_color} onChange={e => setForm({ ...form, button_color: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-navy-100" />
            <input value={form.button_color} onChange={e => setForm({ ...form, button_color: e.target.value })} className="flex-1 rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </div>
        </Field>
      </SettingsSection>

      <SettingsSection title="Typography" description="Choose the font family for the booking page.">
        <Field label="Font family">
          <select value={form.font_family} onChange={e => setForm({ ...form, font_family: e.target.value })} className="input-field">
            {fontOptions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
      </SettingsSection>

      <SettingsSection title="Live Preview">
        <div className="rounded-xl border border-navy-100 overflow-hidden">
          <div className="p-6" style={{ backgroundColor: form.background_color, fontFamily: form.font_family }}>
            {form.cover_url && (
              <div className="relative h-24 rounded-lg overflow-hidden mb-4">
                <img src={form.cover_url} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex items-center gap-3 mb-4">
              {form.logo_url ? (
                <img src={form.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${form.color}20` }}>
                  <Calendar className="w-4 h-4" style={{ color: form.color }} />
                </div>
              )}
              <span className="text-sm font-bold" style={{ color: form.color }}>{form.name || 'Calendar name'}</span>
            </div>
            <p className="text-sm mb-4" style={{ color: '#6b6b6b' }}>{form.description || 'Calendar description appears here.'}</p>
            <button className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: form.button_color }}>
              Book Now
            </button>
          </div>
        </div>
      </SettingsSection>

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving} className="btn-primary">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Appearance'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// ADVANCED TAB
// ============================================================
function AdvancedTab({ calendar }: { calendar: CalendarWithHosts }) {
  const { toast } = useToast();
  return (
    <div className="space-y-5">
      <SettingsSection title="Advanced Settings">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
            <div>
              <p className="text-sm font-medium text-navy-700">Calendar ID</p>
              <p className="text-xs text-ivory-600 font-mono">{calendar.id}</p>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(calendar.id); toast('ID copied'); }} className="text-xs text-gold-700 font-medium">Copy</button>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
            <div>
              <p className="text-sm font-medium text-navy-700">Created</p>
              <p className="text-xs text-ivory-600">{formatDate(calendar.created_at, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
            <div>
              <p className="text-sm font-medium text-navy-700">Total Appointments</p>
              <p className="text-xs text-ivory-600">{calendar.appointment_count ?? 0}</p>
            </div>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="Danger Zone">
        <div className="rounded-xl border border-red-200 bg-red-50/30 p-4">
          <p className="text-sm font-medium text-red-700">Archive or Delete</p>
          <p className="text-xs text-ivory-600 mt-1">Archiving preserves appointment history. Deletion is permanent and only available for calendars with no appointments.</p>
        </div>
      </SettingsSection>
    </div>
  );
}

// ============================================================
// SHARE MODAL
// ============================================================
interface OneTimeLink { id: string; token: string; created_at: string; used_at: string | null; expires_at: string | null }

function ShareCalendarModal({ calendar, onClose }: { calendar: CalendarType; onClose: () => void }) {
  const { toast } = useToast();
  const { workspace, user } = useAuth();
  const [oneTimeLinks, setOneTimeLinks] = useState<OneTimeLink[]>([]);
  const [generating, setGenerating] = useState(false);
  const [expiryHours, setExpiryHours] = useState('24');
  const [linkToDelete, setLinkToDelete] = useState<string | null>(null);
  const bookingUrl = `${publicOrigin()}/book/${calendar.slug}`;

  useEffect(() => {
    supabase.from('booking_links').select('id, token, created_at, used_at, expires_at').eq('calendar_id', calendar.id).eq('link_type', 'one_time').order('created_at', { ascending: false }).then(({ data }) => {
      setOneTimeLinks((data ?? []) as OneTimeLink[]);
    });
  }, [calendar.id]);

  const generateOneTimeLink = async () => {
    if (!user) return;
    setGenerating(true);
    const linkData: Record<string, unknown> = {
      calendar_id: calendar.id,
      link_type: 'one_time',
      max_uses: 1,
      created_by: user.id,
    };
    if (workspace) linkData.workspace_id = workspace.id;
    else linkData.owner_id = user.id;
    const hours = parseInt(expiryHours, 10);
    if (hours > 0) linkData.expires_at = new Date(Date.now() + hours * 3600000).toISOString();
    const { data, error } = await supabase.from('booking_links').insert(linkData).select('id, token, created_at, used_at, expires_at').single();
    setGenerating(false);
    if (error) { toast('Something went wrong. Please try again.', 'error'); return; }
    setOneTimeLinks([data as OneTimeLink, ...oneTimeLinks]);
    toast('One-time link generated');
    // Audit log
    try {
      const auditInsert: Record<string, unknown> = {
        action: 'one_time_link_generated',
        entity_type: 'calendar',
        entity_id: calendar.id,
        details: { link_id: (data as OneTimeLink | null)?.id },
      };
      if (calendar.workspace_id) auditInsert.workspace_id = calendar.workspace_id;
      if (calendar.owner_id) auditInsert.user_id = calendar.owner_id;
      await supabase.from('audit_logs').insert(auditInsert);
    } catch { /* non-critical */ }
  };

  const deleteLink = async (linkId: string) => {
    const { error } = await supabase.from('booking_links').delete().eq('id', linkId);
    if (error) { toast('Could not delete link.', 'error'); return; }
    setOneTimeLinks(oneTimeLinks.filter(l => l.id !== linkId));
    setLinkToDelete(null);
    toast('Link revoked');
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast(`${label} copied`);
    // Audit log for calendar shared
    try {
      const auditInsert: Record<string, unknown> = {
        action: 'calendar_shared',
        entity_type: 'calendar',
        entity_id: calendar.id,
        details: { label },
      };
      if (calendar.workspace_id) auditInsert.workspace_id = calendar.workspace_id;
      if (calendar.owner_id) auditInsert.user_id = calendar.owner_id;
      supabase.from('audit_logs').insert(auditInsert);
    } catch { /* non-critical */ }
  };

  const [embedType, setEmbedType] = useState<'inline' | 'popup' | 'button'>('inline');
  const [buttonText, setButtonText] = useState('Book Now');
  const embedCode = generateEmbedCode(calendar.slug, { type: embedType, buttonText, width: '100%', height: '600px' });

  return (
    <Modal open onClose={onClose} title={`Share ${calendar.name}`} size="lg">
      <div className="space-y-5">
        {/* Permanent Link */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="w-4 h-4 text-navy-600" />
            <h3 className="text-sm font-semibold text-navy-800">Permanent Booking Link</h3>
          </div>
          <p className="text-xs text-ivory-600 mb-2">This link never expires. Share it anywhere.</p>
          <div className="flex items-center gap-2">
            <input readOnly value={bookingUrl} className="flex-1 rounded-lg border border-navy-100 bg-ivory-50 px-3 py-2 text-sm text-navy-700 outline-none" />
            <button onClick={() => copyToClipboard(bookingUrl, 'Booking link')} className="btn-secondary btn-sm shrink-0"><Copy className="w-3.5 h-3.5" /> Copy</button>
          </div>
        </div>

        {/* Embed Code */}
        <div className="pt-4 border-t border-navy-100">
          <div className="flex items-center gap-2 mb-2">
            <Code className="w-4 h-4 text-navy-600" />
            <h3 className="text-sm font-semibold text-navy-800">Embed Code</h3>
          </div>
          <p className="text-xs text-ivory-600 mb-3">Embed this calendar on any website. The widget adapts to desktop, tablet, and mobile automatically.</p>
          <div className="flex gap-2 mb-3">
            {(['inline', 'popup', 'button'] as const).map(t => (
              <button key={t} onClick={() => setEmbedType(t)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all', embedType === t ? 'bg-navy-800 text-ivory-100' : 'bg-ivory-50 text-navy-600 border border-navy-100 hover:bg-ivory-100')}>{t}</button>
            ))}
          </div>
          {embedType === 'button' && (
            <div className="mb-3">
              <input className="input-field" value={buttonText} onChange={e => setButtonText(e.target.value)} placeholder="Button text" />
            </div>
          )}
          <div className="rounded-xl border border-navy-100 bg-ivory-50 p-4">
            <pre className="text-xs text-navy-700 overflow-x-auto whitespace-pre-wrap"><code>{embedCode}</code></pre>
          </div>
          <button onClick={() => copyToClipboard(embedCode, 'Embed code')} className="btn-secondary btn-sm mt-2">
            <Copy className="w-3.5 h-3.5" /> Copy Embed Code
          </button>
        </div>

        {/* One-Time Links */}
        <div className="pt-4 border-t border-navy-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-navy-600" />
              <h3 className="text-sm font-semibold text-navy-800">One-Time Booking Links</h3>
            </div>
            <button onClick={generateOneTimeLink} disabled={generating} className="btn-primary btn-sm">
              <Plus className="w-3.5 h-3.5" /> {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
          <p className="text-xs text-ivory-600 mb-3">Secure, single-use links that expire after one booking or after the time limit.</p>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-ivory-600">Expires in:</label>
            <select value={expiryHours} onChange={e => setExpiryHours(e.target.value)} className="rounded-lg border border-navy-100 bg-white px-2.5 py-1.5 text-xs text-navy-700 outline-none">
              <option value="1">1 hour</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">7 days</option>
              <option value="0">Never</option>
            </select>
          </div>
          {oneTimeLinks.length === 0 ? (
            <p className="text-sm text-ivory-500 py-4 text-center bg-ivory-50 rounded-lg">No one-time links generated yet.</p>
          ) : (
            <div className="space-y-2">
              {oneTimeLinks.map(link => {
                const url = `${publicOrigin()}/book/${calendar.slug}?token=${link.token}`;
                const isUsed = !!link.used_at;
                const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
                const isDead = isUsed || isExpired;
                const expiryLabel = link.expires_at
                  ? `Expires ${new Date(link.expires_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                  : 'No expiry';
                return (
                  <div key={link.id} className="flex items-center gap-2 rounded-lg border border-navy-100 p-2.5">
                    <span className={cn('flex h-2 w-2 rounded-full shrink-0', isDead ? 'bg-ivory-400' : 'bg-green-500')} />
                    <div className="flex-1 min-w-0">
                      <input readOnly value={url} className={cn('w-full rounded-md bg-ivory-50 px-2.5 py-1.5 text-xs outline-none font-mono', isDead && 'line-through text-ivory-400')} />
                      <p className="text-[10px] text-ivory-500 mt-1">{isUsed ? 'Used' : isExpired ? 'Expired' : 'Active'} · {expiryLabel}</p>
                    </div>
                    {!isUsed && <button onClick={() => copyToClipboard(url, 'One-time link')} className="text-ivory-600 hover:text-navy-700 shrink-0"><Copy className="w-3.5 h-3.5" /></button>}
                    <button onClick={() => setLinkToDelete(link.id)} className="text-ivory-400 hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="pt-4 border-t border-navy-100">
          <button onClick={() => window.open(bookingUrl, '_blank')} className="btn-secondary btn-sm w-full">
            <ExternalLink className="w-4 h-4" /> Preview Booking Page
          </button>
        </div>
      </div>

      {linkToDelete && (
        <ConfirmDialog
          open
          title="Revoke this link?"
          message="This will permanently delete the link. Anyone who tries to use it will see an error."
          confirmLabel="Revoke"
          onConfirm={() => deleteLink(linkToDelete)}
          onClose={() => setLinkToDelete(null)}
        />
      )}
    </Modal>
  );
}

// ============================================================
// CREATE CALENDAR MODAL
// ============================================================
// ============================================================
// SHARED UI HELPERS
// ============================================================
function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-navy-800">{title}</h3>
      {description && <p className="text-xs text-ivory-600 mt-0.5 mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-navy-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
