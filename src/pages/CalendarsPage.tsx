import { useEffect, useState, useCallback, useMemo, type ComponentType } from 'react';
import {
  Calendar, Plus, Search, Clock, Users, Video, MapPin, Copy, List, X,
  ChevronLeft, ChevronRight, CalendarDays, Calendar as CalendarIcon,
  User, UserCheck, UsersRound, CalendarClock, Briefcase, Send, Edit, CheckCircle2,
  XCircle, Clock3, AlertTriangle, Filter, Eye, EyeOff, Globe,
  Settings as SettingsIcon, SlidersHorizontal, Calendar as CalendarLucide,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Avatar } from '@/components/ui/Avatar';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, Skeleton, ErrorState } from '@/components/ui/States';
import { formatDate, formatTimeInZone, formatDateInZone, getFullName, cn } from '@/lib/utils';
import { useRouter } from '@/lib/router';
import { CalendarSettingsPage } from '@/pages/CalendarSettingsPage';
import { CreateCalendarWizard } from '@/components/calendar/CreateCalendarWizard';
import { TimezoneSelect } from '@/components/ui/TimezoneSelect';
import type {
  Calendar as CalendarType, Appointment, Contact, AvailabilityRule,
  CalendarType as CalType, LocationType, AppointmentStatus, FormSubmission,
} from '@/types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 56;

const CALENDAR_TYPES: { value: CalType; label: string; icon: typeof User; desc: string }[] = [
  { value: 'one_on_one', label: 'One-on-One', icon: User, desc: 'One host with one participant' },
  { value: 'group', label: 'Group', icon: Users, desc: 'One host with multiple participants' },
  { value: 'round_robin', label: 'Round Robin', icon: UserCheck, desc: 'Multiple hosts, one assigned per booking' },
  { value: 'collective', label: 'Collective', icon: UsersRound, desc: 'All required hosts must be available' },
  { value: 'event', label: 'Event', icon: CalendarClock, desc: 'Events, webinars, classes with capacity' },
  { value: 'service', label: 'Service', icon: Briefcase, desc: 'Service-based appointment with optional pricing' },
];

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; border: string; bg: string; text: string; dot: string }> = {
  confirmed: { label: 'Confirmed', border: 'border-l-green-500', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  pending: { label: 'Pending', border: 'border-l-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  cancelled: { label: 'Cancelled', border: 'border-l-red-500', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  rescheduled: { label: 'Rescheduled', border: 'border-l-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  completed: { label: 'Completed', border: 'border-l-navy-400', bg: 'bg-navy-50', text: 'text-navy-600', dot: 'bg-navy-400' },
  no_show: { label: 'No-show', border: 'border-l-burgundy-500', bg: 'bg-burgundy-400/10', text: 'text-burgundy-600', dot: 'bg-burgundy-500' },
};

const STATUS_ICONS: Record<AppointmentStatus, ComponentType<{ className?: string }>> = {
  confirmed: CheckCircle2,
  pending: Clock3,
  cancelled: XCircle,
  rescheduled: CalendarClock,
  completed: CheckCircle2,
  no_show: AlertTriangle,
};

type CalendarView = 'day' | 'week' | 'month';
type TabType = 'calendar' | 'list' | 'settings';

interface AppointmentWithRelations extends Appointment {
  contacts: Contact | null;
  calendars: CalendarType | null;
  // Not an appointments column today, so the list shows a blank line under the title.
  description?: string | null;
}

// ============================================================
// MAIN PAGE
// ============================================================
export function CalendarsPage() {
  const { workspace, user } = useAuth();
  const [, navigate] = useRouter();
  const [tab, setTab] = useState<TabType>('calendar');
  const [calendars, setCalendars] = useState<CalendarType[]>([]);
  const [appointments, setAppointments] = useState<AppointmentWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Calendar state
  const [view, setView] = useState<CalendarView>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [displayTimezone, setDisplayTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCalendars, setVisibleCalendars] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<AppointmentStatus>>(new Set());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithRelations | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<CalendarType | null>(null);
  const [showManage, setShowManage] = useState(false);
  const isMobile = useIsMobile();

  const loadData = useCallback(async () => {
    if (!workspace && !user) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    const filters: string[] = [];
    if (workspace) filters.push(`workspace_id.eq.${workspace.id}`);
    if (user) filters.push(`owner_id.eq.${user.id}`);
    const orFilter = filters.join(',');
    let calQuery = supabase.from('calendars').select('*').order('created_at', { ascending: false });
    if (orFilter) calQuery = calQuery.or(orFilter);

    const calRes = await calQuery;
    if (calRes.error) {
      setError(true);
      setLoading(false);
      return;
    }
    const calData = (calRes.data ?? []) as CalendarType[];
    const calIds = calData.map(c => c.id);

    let apptQuery = supabase
      .from('appointments')
      .select('*, contacts(*), calendars(*)')
      .order('start_time', { ascending: true });
    if (calIds.length > 0) apptQuery = apptQuery.in('calendar_id', calIds);
    else apptQuery = apptQuery.eq('calendar_id', '00000000-0000-0000-0000-000000000000');

    const apptRes = await apptQuery;
    if (apptRes.error) {
      setError(true);
      setLoading(false);
      return;
    }
    const apptData = (apptRes.data ?? []) as AppointmentWithRelations[];
    setCalendars(calData);
    setAppointments(apptData);
    setVisibleCalendars(new Set(calIds));
    setLoading(false);
  }, [workspace, user]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filter appointments
  const filteredAppointments = useMemo(() => {
    let result = appointments;
    if (visibleCalendars.size < calendars.length) {
      result = result.filter(a => visibleCalendars.has(a.calendar_id));
    }
    if (statusFilter.size > 0) {
      result = result.filter(a => statusFilter.has(a.status));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => {
        const contactName = getFullName(a.contacts ?? { first_name: null, last_name: null }).toLowerCase();
        return (
          a.title.toLowerCase().includes(q) ||
          contactName.includes(q) ||
          (a.calendars?.name ?? '').toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [appointments, visibleCalendars, statusFilter, searchQuery, calendars.length]);

  const toggleCalendarVisible = (calId: string) => {
    setVisibleCalendars(prev => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      return next;
    });
  };

  const toggleStatusFilter = (status: AppointmentStatus) => {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() - 1);
    else if (view === 'week') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setCurrentDate(d);
  };
  const goNext = () => {
    const d = new Date(currentDate);
    if (view === 'day') d.setDate(d.getDate() + 1);
    else if (view === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setCurrentDate(d);
  };

  const headerLabel = useMemo(() => {
    if (view === 'month') return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (view === 'day') return formatDate(currentDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    // week
    const weekStart = getWeekStart(currentDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    if (sameMonth) return `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
    return `${MONTHS[weekStart.getMonth()].slice(0, 3)} ${weekStart.getDate()} – ${MONTHS[weekEnd.getMonth()].slice(0, 3)} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
  }, [currentDate, view]);

  return (
    <div className="relative flex h-full flex-col">
      {/* Top Calendar Navigation */}
      <div className="border-b border-navy-100 bg-white">
        <div className="flex items-center justify-between px-6 pt-4">
          {/* Tabs */}
          <div className="flex gap-1">
            {(['calendar', 'list', 'settings'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
                  tab === t ? 'text-gold-700 border-gold-400' : 'text-ivory-600 border-transparent hover:text-navy-700'
                )}
              >
                {t === 'calendar' && <CalendarDays className="h-4 w-4" />}
                {t === 'list' && <List className="h-4 w-4" />}
                {t === 'settings' && <SettingsIcon className="h-4 w-4" />}
                {t === 'calendar' ? 'Calendar view' : t === 'list' ? 'Appointment list view' : 'Calendar settings'}
              </button>
            ))}
          </div>

          {tab !== 'settings' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowManage(true)}
                className="flex items-center gap-1.5 rounded-lg border border-navy-100 px-3 py-1.5 text-xs font-semibold text-ivory-700 transition hover:bg-ivory-50"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Manage view
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          )}
        </div>

        {tab === 'calendar' && (
          <>
            {/* Controls Row */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-3">
              {/* Date Navigation */}
              <div className="flex items-center gap-1">
                <button onClick={goPrev} className="flex h-8 w-8 items-center justify-center rounded-lg border border-navy-100 text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700" aria-label="Previous">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={goToday} className="rounded-lg border border-navy-100 px-3 py-1.5 text-xs font-semibold text-ivory-700 transition hover:bg-ivory-50">
                  Today
                </button>
                <button onClick={goNext} className="flex h-8 w-8 items-center justify-center rounded-lg border border-navy-100 text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700" aria-label="Next">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Date Label / Picker */}
              <div className="relative">
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-ivory-50"
                >
                  {headerLabel}
                  <CalendarDays className="h-3.5 w-3.5 text-ivory-500" />
                </button>
                {showDatePicker && (
                  <DatePicker
                    currentDate={currentDate}
                    onSelect={(d) => { setCurrentDate(d); setShowDatePicker(false); }}
                    onClose={() => setShowDatePicker(false)}
                  />
                )}
              </div>

              {/* View Selector */}
              <div className="flex items-center gap-0.5 rounded-lg border border-navy-100 bg-ivory-50 p-0.5">
                {(['day', 'week', 'month'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-semibold capitalize transition',
                      view === v ? 'bg-white text-navy-800 shadow-sm' : 'text-ivory-600 hover:text-navy-700'
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>

              {/* Timezone */}
              <div className="flex items-center gap-1.5">
                <TimezoneSelect value={displayTimezone} onChange={setDisplayTimezone} className="w-44" />
              </div>

              {/* Search */}
              <div className="relative flex-1 min-w-[140px] max-w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ivory-400" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search appointments..."
                  className="w-full rounded-lg border border-navy-100 bg-ivory-50 py-1.5 pl-8 pr-3 text-xs text-navy-700 placeholder:text-ivory-400 outline-none focus:border-gold-300 focus:bg-white"
                />
              </div>

              {/* Filter Button */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition',
                  showFilters || statusFilter.size > 0 ? 'border-gold-300 bg-gold-50 text-gold-700' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50'
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {statusFilter.size > 0 && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gold-400 text-[9px] text-white">{statusFilter.size}</span>}
              </button>
            </div>

            {/* Filter Panel */}
            {showFilters && (
              <div className="border-t border-navy-100 bg-ivory-50/50 px-6 py-3">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Calendar visibility */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ivory-600">Calendars:</span>
                    {calendars.map(cal => (
                      <button
                        key={cal.id}
                        onClick={() => toggleCalendarVisible(cal.id)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                          visibleCalendars.has(cal.id) ? 'border-navy-200 bg-white text-navy-700' : 'border-navy-100 bg-ivory-50 text-ivory-400'
                        )}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: visibleCalendars.has(cal.id) ? cal.color : '#cbd5e1' }} />
                        {cal.name}
                        {visibleCalendars.has(cal.id) ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                    ))}
                  </div>

                  <div className="h-5 w-px bg-navy-100" />

                  {/* Status filters */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ivory-600">Status:</span>
                    {(Object.keys(STATUS_CONFIG) as AppointmentStatus[]).map(status => (
                      <button
                        key={status}
                        onClick={() => toggleStatusFilter(status)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                          statusFilter.has(status) ? `${STATUS_CONFIG[status].bg} ${STATUS_CONFIG[status].text} border-current` : 'border-navy-100 bg-white text-ivory-500 hover:text-navy-700'
                        )}
                      >
                        <span className={cn('h-2 w-2 rounded-full', STATUS_CONFIG[status].dot)} />
                        {STATUS_CONFIG[status].label}
                      </button>
                    ))}
                  </div>

                  {(statusFilter.size > 0 || visibleCalendars.size < calendars.length) && (
                    <button
                      onClick={() => { setStatusFilter(new Set()); setVisibleCalendars(new Set(calendars.map(c => c.id))); }}
                      className="text-xs font-semibold text-burgundy-600 hover:text-burgundy-700"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'calendar' && (
          <>
            {loading ? (
              <CalendarSkeleton view={view} />
            ) : error ? (
              <div className="flex h-full items-center justify-center">
                <ErrorState message="We couldn't load your appointments." onRetry={loadData} />
              </div>
            ) : filteredAppointments.length === 0 && calendars.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={<Calendar className="w-7 h-7" />}
                  title="No appointments yet"
                  description="Your scheduled appointments will appear here."
                  action={
                    <button onClick={() => setShowCreate(true)} className="btn-primary">
                      <Plus className="w-4 h-4" />
                      Create Calendar
                    </button>
                  }
                />
              </div>
            ) : isMobile ? (
              <MobileAgendaView
                currentDate={currentDate}
                appointments={filteredAppointments}
                calendars={calendars}
                visibleCalendars={visibleCalendars}
                displayTimezone={displayTimezone}
                onAppointmentClick={setSelectedAppt}
              />
            ) : view === 'month' ? (
              <MonthView
                currentDate={currentDate}
                appointments={filteredAppointments}
                calendars={calendars}
                visibleCalendars={visibleCalendars}
                displayTimezone={displayTimezone}
                onAppointmentClick={setSelectedAppt}
                onDayClick={(d) => { setCurrentDate(d); setView('day'); }}
              />
            ) : view === 'day' ? (
              <DayView
                currentDate={currentDate}
                appointments={filteredAppointments}
                calendars={calendars}
                visibleCalendars={visibleCalendars}
                displayTimezone={displayTimezone}
                onAppointmentClick={setSelectedAppt}
              />
            ) : (
              <WeekView
                currentDate={currentDate}
                appointments={filteredAppointments}
                calendars={calendars}
                visibleCalendars={visibleCalendars}
                displayTimezone={displayTimezone}
                onAppointmentClick={setSelectedAppt}
              />
            )}
          </>
        )}

        {tab === 'list' && (
          <AppointmentListView
            appointments={filteredAppointments}
            calendars={calendars}
            visibleCalendars={visibleCalendars}
            displayTimezone={displayTimezone}
            loading={loading}
            error={error}
            onRetry={loadData}
            onAppointmentClick={setSelectedAppt}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            statusFilter={statusFilter}
            toggleStatusFilter={toggleStatusFilter}
          />
        )}

        {tab === 'settings' && (
          <CalendarSettingsPage />
        )}
      </div>

      {/* Create Calendar Wizard */}
      {showCreate && (
        <CreateCalendarWizard
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); setTab('settings'); loadData(); }}
        />
      )}

      {/* Edit Calendar Drawer */}
      {editingCalendar && (
        <EditCalendarDrawer
          calendar={editingCalendar}
          onClose={() => setEditingCalendar(null)}
          onUpdated={() => { setEditingCalendar(null); loadData(); }}
        />
      )}

      {/* Appointment Detail Drawer */}
      {selectedAppt && (
        <AppointmentDetailDrawer
          appointment={selectedAppt}
          displayTimezone={displayTimezone}
          onClose={() => setSelectedAppt(null)}
          onUpdated={loadData}
          onContactClick={(contactId) => { navigate(`/contacts?contact=${contactId}`); }}
        />
      )}

      {/* Manage View Drawer */}
      {showManage && (
        <ManageViewDrawer
          calendars={calendars}
          visibleCalendars={visibleCalendars}
          toggleCalendarVisible={toggleCalendarVisible}
          onClose={() => setShowManage(false)}
          onEditCalendar={(cal) => { setShowManage(false); setEditingCalendar(cal); }}
          workspaceId={workspace?.id ?? null}
        />
      )}
    </div>
  );
}

// ============================================================
// MOBILE HOOK
// ============================================================
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

// ============================================================
// MOBILE AGENDA VIEW
// ============================================================
function MobileAgendaView({
  currentDate, appointments, visibleCalendars, displayTimezone, onAppointmentClick,
}: {
  currentDate: Date;
  appointments: AppointmentWithRelations[];
  calendars: CalendarType[];
  visibleCalendars: Set<string>;
  displayTimezone: string;
  onAppointmentClick: (appt: AppointmentWithRelations) => void;
}) {
  const visibleAppts = appointments.filter(a => visibleCalendars.has(a.calendar_id));
  const dayAppts = getAppointmentsForDay(visibleAppts, currentDate, displayTimezone);

  return (
    <div className="h-full overflow-y-auto p-4">
      <p className="mb-3 text-sm font-semibold text-navy-800">
        {formatDateInZone(currentDate, displayTimezone, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      {dayAppts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Calendar className="h-8 w-8 text-ivory-300" />
          <p className="mt-2 text-sm font-semibold text-navy-600">No appointments</p>
          <p className="mt-1 text-xs text-ivory-500">No appointments scheduled for this day.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {dayAppts.map(appt => {
            const cal = appt.calendars;
            const statusCfg = STATUS_CONFIG[appt.status];
            const StatusIcon = STATUS_ICONS[appt.status];
            return (
              <button
                key={appt.id}
                onClick={() => onAppointmentClick(appt)}
                className={cn(
                  'w-full overflow-hidden rounded-xl border-l-[3px] bg-white p-4 text-left shadow-sm transition hover:shadow-md',
                  statusCfg.border
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-navy-800">{appt.title}</p>
                    <p className="mt-0.5 text-xs text-navy-600">
                      {formatTimeInZone(appt.start_time, displayTimezone)} – {formatTimeInZone(appt.end_time, displayTimezone)}
                    </p>
                  </div>
                  <StatusIcon className={cn('h-4 w-4 shrink-0', statusCfg.text)} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {cal && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cal.color }} />}
                  <span className="text-xs text-ivory-600">{cal?.name}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Avatar firstName={appt.contacts?.first_name} lastName={appt.contacts?.last_name} size="sm" />
                  <span className="text-xs font-medium text-navy-700">
                    {getFullName(appt.contacts ?? { first_name: null, last_name: null })}
                  </span>
                  <span className={cn('ml-auto text-[10px] font-semibold', statusCfg.text)}>{statusCfg.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// APPOINTMENT LIST VIEW
// ============================================================
function AppointmentListView({
  appointments, calendars, visibleCalendars, displayTimezone, loading, error,
  onRetry, onAppointmentClick, searchQuery, setSearchQuery, statusFilter, toggleStatusFilter,
}: {
  appointments: AppointmentWithRelations[];
  calendars: CalendarType[];
  visibleCalendars: Set<string>;
  displayTimezone: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onAppointmentClick: (appt: AppointmentWithRelations) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  statusFilter: Set<AppointmentStatus>;
  toggleStatusFilter: (s: AppointmentStatus) => void;
}) {
  const [sortBy, setSortBy] = useState<'date_asc' | 'date_desc' | 'name'>('date_asc');
  const [calendarFilter, setCalendarFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    let result = appointments.filter(a => visibleCalendars.has(a.calendar_id));
    if (calendarFilter !== 'all') result = result.filter(a => a.calendar_id === calendarFilter);
    if (statusFilter.size > 0) result = result.filter(a => statusFilter.has(a.status));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => {
        const contactName = getFullName(a.contacts ?? { first_name: null, last_name: null }).toLowerCase();
        return a.title.toLowerCase().includes(q) || contactName.includes(q) || (a.calendars?.name ?? '').toLowerCase().includes(q);
      });
    }
    if (sortBy === 'date_asc') result.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    else if (sortBy === 'date_desc') result.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    else if (sortBy === 'name') result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [appointments, visibleCalendars, calendarFilter, statusFilter, searchQuery, sortBy]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-navy-100 bg-white px-6 py-3">
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ivory-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search appointments..."
            className="w-full rounded-lg border border-navy-100 bg-ivory-50 py-2 pl-9 pr-3 text-sm text-navy-700 placeholder:text-ivory-400 outline-none focus:border-gold-300 focus:bg-white"
          />
        </div>
        <select value={calendarFilter} onChange={e => setCalendarFilter(e.target.value)} className="rounded-lg border border-navy-100 bg-ivory-50 px-3 py-2 text-sm font-medium text-navy-700 outline-none">
          <option value="all">All calendars</option>
          {calendars.map(cal => <option key={cal.id} value={cal.id}>{cal.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5 rounded-lg border border-navy-100 bg-ivory-50 px-2.5 py-2">
          <span className="text-xs text-ivory-500">Sort:</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as 'date_asc' | 'date_desc' | 'name')} className="bg-transparent text-sm font-medium text-navy-700 outline-none cursor-pointer">
            <option value="date_asc">Date (earliest)</option>
            <option value="date_desc">Date (latest)</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          {(Object.keys(STATUS_CONFIG) as AppointmentStatus[]).map(status => (
            <button
              key={status}
              onClick={() => toggleStatusFilter(status)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
                statusFilter.has(status) ? `${STATUS_CONFIG[status].bg} ${STATUS_CONFIG[status].text} border-current` : 'border-navy-100 bg-white text-ivory-500 hover:text-navy-700'
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', STATUS_CONFIG[status].dot)} />
              {STATUS_CONFIG[status].label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <ErrorState message="We couldn't load your appointments." onRetry={onRetry} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<List className="w-7 h-7" />}
              title="No appointments found"
              description="Try adjusting your filters or search query."
            />
          </div>
        ) : (
          <div className="card overflow-hidden p-0">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_140px_160px_120px_100px] gap-3 border-b border-navy-100 bg-ivory-50 px-4 py-2.5 text-xs font-semibold text-ivory-600">
              <span>Appointment</span>
              <span>Contact</span>
              <span>Calendar</span>
              <span>Date & Time</span>
              <span>Status</span>
            </div>
            {/* Rows */}
            <div className="divide-y divide-navy-50">
              {filtered.map(appt => {
                const cal = appt.calendars;
                const statusCfg = STATUS_CONFIG[appt.status];
                const StatusIcon = STATUS_ICONS[appt.status];
                return (
                  <button
                    key={appt.id}
                    onClick={() => onAppointmentClick(appt)}
                    className="grid w-full grid-cols-[1fr_140px_160px_120px_100px] items-center gap-3 px-4 py-3 text-left transition hover:bg-ivory-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy-800">{appt.title}</p>
                      <p className="text-xs text-ivory-500 truncate">{appt.description || '\u00a0'}</p>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar firstName={appt.contacts?.first_name} lastName={appt.contacts?.last_name} size="sm" />
                      <span className="truncate text-xs font-medium text-navy-700">
                        {getFullName(appt.contacts ?? { first_name: null, last_name: null })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      {cal && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: cal.color }} />}
                      <span className="truncate text-xs text-ivory-600">{cal?.name ?? '\u2014'}</span>
                    </div>
                    <div className="text-xs text-ivory-600">
                      <p className="font-medium text-navy-700">{formatDateInZone(new Date(appt.start_time), displayTimezone, { month: 'short', day: 'numeric' })}</p>
                      <p>{formatTimeInZone(appt.start_time, displayTimezone)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusIcon className={cn('h-3.5 w-3.5', statusCfg.text)} />
                      <span className={cn('text-xs font-semibold', statusCfg.text)}>{statusCfg.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MANAGE VIEW DRAWER
// ============================================================
type ViewByType = 'all' | 'appointments' | 'block_slots';

interface CalendarGroupInfo {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceMemberInfo {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
}

function ManageViewDrawer({
  calendars, visibleCalendars, toggleCalendarVisible, onClose, onEditCalendar, workspaceId,
}: {
  calendars: CalendarType[];
  visibleCalendars: Set<string>;
  toggleCalendarVisible: (id: string) => void;
  onClose: () => void;
  onEditCalendar: (cal: CalendarType) => void;
  workspaceId: string | null;
}) {
  const [viewByType, setViewByType] = useState<ViewByType>('all');
  const [showBufferTime, setShowBufferTime] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedCalendars, setSelectedCalendars] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [usersOpen, setUsersOpen] = useState(false);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([]);
  const [groups, setGroups] = useState<CalendarGroupInfo[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .then(({ data }) => {
        const userIds = (data ?? []).map(m => m.user_id);
        if (userIds.length === 0) { setMembers([]); return; }
        supabase
          .from('profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', userIds)
          .then(({ data: profiles }) => {
            setMembers((profiles ?? []) as WorkspaceMemberInfo[]);
          });
      });
    const groupFilters: string[] = [];
    if (workspaceId) groupFilters.push(`workspace_id.eq.${workspaceId}`);
    const groupOrFilter = groupFilters.join(',');
    let groupQuery = supabase
      .from('calendar_groups')
      .select('id, name, slug')
      .order('name');
    if (groupOrFilter) groupQuery = groupQuery.or(groupOrFilter);
    groupQuery.then(({ data }) => {
        setGroups((data ?? []) as CalendarGroupInfo[]);
      });
  }, [workspaceId]);

  const filteredCalendars = useMemo(() => {
    let result = calendars;
    if (viewByType === 'appointments') {
      result = result.filter(c => c.calendar_type !== 'event' && c.calendar_type !== 'service');
    } else if (viewByType === 'block_slots') {
      result = result.filter(c => c.calendar_type === 'event' || c.calendar_type === 'service');
    }
    if (selectedCalendars.size > 0) {
      result = result.filter(c => selectedCalendars.has(c.id));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [calendars, viewByType, selectedCalendars, searchQuery]);

  const toggleSet = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  return (
    <Drawer open onClose={onClose} title="Manage view" width="md" overlay={false}>
      <div className="space-y-5 px-1">
        {/* View by type */}
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ivory-500">View by type</h3>
          <div className="flex flex-wrap gap-2">
            {([['all', 'All'], ['appointments', 'Appointments'], ['block_slots', 'Block slots']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setViewByType(val)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                  viewByType === val
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-navy-100 bg-white text-ivory-600 hover:bg-ivory-50 hover:text-navy-700'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 cursor-pointer">
            <button
              onClick={() => setShowBufferTime(!showBufferTime)}
              className={cn(
                'relative h-5 w-9 rounded-full transition',
                showBufferTime ? 'bg-blue-600' : 'bg-navy-200'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition',
                  showBufferTime ? 'left-4' : 'left-0.5'
                )}
              />
            </button>
            <span className="text-xs font-medium text-navy-700">Show buffer time</span>
          </label>
        </div>

        {/* Filters */}
        <div className="border-t border-navy-100 pt-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ivory-500">Filters</h3>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ivory-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search users, calendars, or groups"
              className="w-full rounded-lg border border-navy-100 bg-ivory-50 py-2 pl-8 pr-3 text-xs text-navy-700 placeholder:text-ivory-400 outline-none focus:border-gold-300 focus:bg-white"
            />
          </div>

          {/* Users dropdown */}
          <div className="mb-2">
            <button
              onClick={() => { setUsersOpen(!usersOpen); setCalendarsOpen(false); setGroupsOpen(false); }}
              className="flex w-full items-center justify-between rounded-lg border border-navy-100 bg-white px-3 py-2 text-xs font-medium text-navy-700 transition hover:bg-ivory-50"
            >
              <span className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-ivory-500" />
                Users{selectedUsers.size > 0 && ` (${selectedUsers.size})`}
              </span>
              <ChevronRight className={cn('h-3.5 w-3.5 text-ivory-400 transition', usersOpen && 'rotate-90')} />
            </button>
            {usersOpen && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-navy-100 bg-white p-1 shadow-sm">
                {members.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-ivory-400">No users found</p>
                ) : (
                  members.map(m => {
                    const checked = selectedUsers.has(m.user_id);
                    return (
                      <button
                        key={m.user_id}
                        onClick={() => toggleSet(selectedUsers, m.user_id, setSelectedUsers)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-navy-700 transition hover:bg-ivory-50"
                      >
                        <span className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border transition',
                          checked ? 'border-blue-600 bg-blue-600' : 'border-navy-200'
                        )}>
                          {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
                        </span>
                        {getFullName({ first_name: m.first_name, last_name: m.last_name })}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Calendars dropdown */}
          <div className="mb-2">
            <button
              onClick={() => { setCalendarsOpen(!calendarsOpen); setUsersOpen(false); setGroupsOpen(false); }}
              className="flex w-full items-center justify-between rounded-lg border border-navy-100 bg-white px-3 py-2 text-xs font-medium text-navy-700 transition hover:bg-ivory-50"
            >
              <span className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5 text-ivory-500" />
                Calendars{selectedCalendars.size > 0 && ` (${selectedCalendars.size})`}
              </span>
              <ChevronRight className={cn('h-3.5 w-3.5 text-ivory-400 transition', calendarsOpen && 'rotate-90')} />
            </button>
            {calendarsOpen && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-navy-100 bg-white p-1 shadow-sm">
                {calendars.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-ivory-400">No calendars found</p>
                ) : (
                  calendars.map(cal => {
                    const checked = selectedCalendars.has(cal.id);
                    return (
                      <button
                        key={cal.id}
                        onClick={() => toggleSet(selectedCalendars, cal.id, setSelectedCalendars)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-navy-700 transition hover:bg-ivory-50"
                      >
                        <span className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border transition',
                          checked ? 'border-blue-600 bg-blue-600' : 'border-navy-200'
                        )}>
                          {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
                        </span>
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cal.color }} />
                        <span className="truncate">{cal.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Groups dropdown */}
          <div className="mb-2">
            <button
              onClick={() => { setGroupsOpen(!groupsOpen); setUsersOpen(false); setCalendarsOpen(false); }}
              className="flex w-full items-center justify-between rounded-lg border border-navy-100 bg-white px-3 py-2 text-xs font-medium text-navy-700 transition hover:bg-ivory-50"
            >
              <span className="flex items-center gap-2">
                <UsersRound className="h-3.5 w-3.5 text-ivory-500" />
                Groups{selectedGroups.size > 0 && ` (${selectedGroups.size})`}
              </span>
              <ChevronRight className={cn('h-3.5 w-3.5 text-ivory-400 transition', groupsOpen && 'rotate-90')} />
            </button>
            {groupsOpen && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-navy-100 bg-white p-1 shadow-sm">
                {groups.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-ivory-400">No groups found</p>
                ) : (
                  groups.map(g => {
                    const checked = selectedGroups.has(g.id);
                    return (
                      <button
                        key={g.id}
                        onClick={() => toggleSet(selectedGroups, g.id, setSelectedGroups)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-navy-700 transition hover:bg-ivory-50"
                      >
                        <span className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border transition',
                          checked ? 'border-blue-600 bg-blue-600' : 'border-navy-200'
                        )}>
                          {checked && <CheckCircle2 className="h-3 w-3 text-white" />}
                        </span>
                        <span className="truncate">{g.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Calendar list */}
        <div className="border-t border-navy-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-navy-800">
            Calendars ({filteredCalendars.length})
          </h3>
          {filteredCalendars.length === 0 ? (
            <div className="rounded-xl border border-dashed border-navy-200 p-6 text-center">
              <CalendarLucide className="w-6 h-6 text-ivory-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-navy-600">No calendars match</p>
              <p className="text-xs text-ivory-500 mt-1">Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredCalendars.map(cal => {
                const typeInfo = CALENDAR_TYPES.find(t => t.value === cal.calendar_type);
                const TypeIcon = typeInfo?.icon ?? CalendarLucide;
                const isVisible = visibleCalendars.has(cal.id);
                return (
                  <div key={cal.id} className="rounded-xl border border-navy-100 bg-white p-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${cal.color}15` }}>
                        <TypeIcon className="w-4 h-4" style={{ color: cal.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-navy-800 truncate">{cal.name}</p>
                          <span className={cn(
                            'status-pill text-[10px] shrink-0',
                            cal.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-ivory-100 text-ivory-600'
                          )}>
                            {cal.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-xs text-ivory-600 mt-0.5">
                          {typeInfo?.label ?? cal.calendar_type} \u00b7 {cal.duration_minutes}min
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-navy-50">
                      <button
                        onClick={() => toggleCalendarVisible(cal.id)}
                        className={cn(
                          'flex items-center gap-1.5 text-xs font-medium transition',
                          isVisible ? 'text-navy-700' : 'text-ivory-500'
                        )}
                      >
                        {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        {isVisible ? 'Visible' : 'Hidden'}
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onEditCalendar(cal)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700"
                        >
                          <Edit className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => window.open(`${window.location.origin}/book/${cal.slug}`, '_blank')}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ivory-600 transition hover:bg-ivory-50 hover:text-navy-700"
                        >
                          <Eye className="h-3 w-3" />
                          Preview
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ============================================================
// DATE UTILITIES
// ============================================================
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

function getAppointmentTopOffset(startTime: string, timezone: string): number {
  const d = new Date(startTime);
  const parts = formatTimeInZone(d, timezone).match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!parts) return 0;
  let hour = parseInt(parts[1]);
  const minute = parseInt(parts[2]);
  const ampm = parts[3].toUpperCase();
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return (hour + minute / 60) * HOUR_HEIGHT;
}

function getAppointmentHeight(startTime: string, endTime: string, timezone: string): number {
  const start = getAppointmentTopOffset(startTime, timezone);
  const end = getAppointmentTopOffset(endTime, timezone);
  return Math.max(end - start, 24);
}

function getAppointmentsForDay(appointments: AppointmentWithRelations[], day: Date, timezone: string): AppointmentWithRelations[] {
  return appointments.filter(a => {
    const apptDate = new Date(a.start_time);
    const apptDayStr = formatDateInZone(apptDate, timezone, { year: 'numeric', month: 'numeric', day: 'numeric' });
    const dayStr = formatDateInZone(day, timezone, { year: 'numeric', month: 'numeric', day: 'numeric' });
    return apptDayStr === dayStr;
  });
}

// ============================================================
// WEEK VIEW
// ============================================================
function WeekView({
  currentDate, appointments, visibleCalendars, displayTimezone, onAppointmentClick,
}: {
  currentDate: Date;
  appointments: AppointmentWithRelations[];
  calendars: CalendarType[];
  visibleCalendars: Set<string>;
  displayTimezone: string;
  onAppointmentClick: (appt: AppointmentWithRelations) => void;
}) {
  const weekStart = getWeekStart(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="flex h-full flex-col">
      {/* Day headers */}
      <div className="flex border-b border-navy-100 bg-white">
        <div className="w-14 shrink-0 border-r border-navy-100" />
        {days.map((day, i) => (
          <div key={i} className="flex-1 border-r border-navy-100 last:border-r-0 px-2 py-2 text-center">
            <p className="text-xs font-semibold text-ivory-500">{DAYS_SHORT[day.getDay()]}</p>
            <p className={cn(
              'mt-0.5 text-lg font-bold',
              isToday(day) ? 'text-gold-600' : 'text-navy-800'
            )}>
              {day.getDate()}
            </p>
          </div>
        ))}
      </div>

      {/* Scrollable calendar grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          {/* Time axis */}
          <div className="w-14 shrink-0 border-r border-navy-100">
            {HOURS.map(hour => (
              <div key={hour} style={{ height: HOUR_HEIGHT }} className="relative border-b border-navy-50">
                <span className="absolute -top-2 right-1.5 text-[10px] text-ivory-400">
                  {hour === 0 ? '' : formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, dayIdx) => {
            const dayAppts = getAppointmentsForDay(
              appointments.filter(a => visibleCalendars.has(a.calendar_id)),
              day,
              displayTimezone
            );
            return (
              <div key={dayIdx} className="relative flex-1 border-r border-navy-100 last:border-r-0">
                {HOURS.map(hour => (
                  <div key={hour} style={{ height: HOUR_HEIGHT }} className="border-b border-navy-50" />
                ))}
                {/* Appointments */}
                {dayAppts.map(appt => {
                  const top = getAppointmentTopOffset(appt.start_time, displayTimezone);
                  const height = getAppointmentHeight(appt.start_time, appt.end_time, displayTimezone);
                  const cal = appt.calendars;
                  const statusCfg = STATUS_CONFIG[appt.status];
                  return (
                    <button
                      key={appt.id}
                      onClick={() => onAppointmentClick(appt)}
                      className={cn(
                        'absolute left-1 right-1 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left transition hover:z-10 hover:shadow-md',
                        statusCfg.border, statusCfg.bg
                      )}
                      style={{ top, height: Math.max(height, 22) }}
                    >
                      <p className="truncate text-[10px] font-bold text-navy-800">{appt.title}</p>
                      <p className="truncate text-[9px] text-navy-600">
                        {formatTimeInZone(appt.start_time, displayTimezone)}
                      </p>
                      {height > 40 && (
                        <p className="truncate text-[9px] text-ivory-600">
                          {getFullName(appt.contacts ?? { first_name: null, last_name: null })}
                        </p>
                      )}
                      {height > 56 && cal && (
                        <p className="truncate text-[8px] text-ivory-500">{cal.name}</p>
                      )}
                    </button>
                  );
                })}
                {/* Current time indicator */}
                {isToday(day) && <CurrentTimeIndicator timezone={displayTimezone} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DAY VIEW
// ============================================================
function DayView({
  currentDate, appointments, visibleCalendars, displayTimezone, onAppointmentClick,
}: {
  currentDate: Date;
  appointments: AppointmentWithRelations[];
  calendars: CalendarType[];
  visibleCalendars: Set<string>;
  displayTimezone: string;
  onAppointmentClick: (appt: AppointmentWithRelations) => void;
}) {
  const dayAppts = getAppointmentsForDay(
    appointments.filter(a => visibleCalendars.has(a.calendar_id)),
    currentDate,
    displayTimezone
  );

  return (
    <div className="flex h-full flex-col">
      {/* Day header */}
      <div className="flex border-b border-navy-100 bg-white">
        <div className="w-14 shrink-0 border-r border-navy-100" />
        <div className="flex-1 px-4 py-2">
          <p className="text-xs font-semibold text-ivory-500">{DAYS[currentDate.getDay()]}</p>
          <p className={cn('text-lg font-bold', isToday(currentDate) ? 'text-gold-600' : 'text-navy-800')}>
            {formatDate(currentDate, { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          {/* Time axis */}
          <div className="w-14 shrink-0 border-r border-navy-100">
            {HOURS.map(hour => (
              <div key={hour} style={{ height: HOUR_HEIGHT }} className="relative border-b border-navy-50">
                <span className="absolute -top-2 right-1.5 text-[10px] text-ivory-400">
                  {hour === 0 ? '' : formatHourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day column */}
          <div className="relative flex-1">
            {HOURS.map(hour => (
              <div key={hour} style={{ height: HOUR_HEIGHT }} className="border-b border-navy-50" />
            ))}
            {dayAppts.map(appt => {
              const top = getAppointmentTopOffset(appt.start_time, displayTimezone);
              const height = getAppointmentHeight(appt.start_time, appt.end_time, displayTimezone);
              const cal = appt.calendars;
              const statusCfg = STATUS_CONFIG[appt.status];
              const StatusIcon = STATUS_ICONS[appt.status];
              return (
                <button
                  key={appt.id}
                  onClick={() => onAppointmentClick(appt)}
                  className={cn(
                    'absolute left-2 right-2 overflow-hidden rounded-lg border-l-[3px] px-2.5 py-1.5 text-left transition hover:z-10 hover:shadow-md',
                    statusCfg.border, statusCfg.bg
                  )}
                  style={{ top, height: Math.max(height, 28) }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <p className="truncate text-xs font-bold text-navy-800">{appt.title}</p>
                    <StatusIcon className="h-3 w-3 shrink-0 text-ivory-500" />
                  </div>
                  <p className="text-[10px] text-navy-600">
                    {formatTimeInZone(appt.start_time, displayTimezone)} – {formatTimeInZone(appt.end_time, displayTimezone)}
                  </p>
                  <p className="truncate text-[10px] text-ivory-600">
                    {getFullName(appt.contacts ?? { first_name: null, last_name: null })}
                  </p>
                  {height > 56 && cal && (
                    <p className="truncate text-[9px] text-ivory-500">{cal.name}</p>
                  )}
                </button>
              );
            })}
            {isToday(currentDate) && <CurrentTimeIndicator timezone={displayTimezone} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MONTH VIEW
// ============================================================
function MonthView({
  currentDate, appointments, visibleCalendars, displayTimezone, onAppointmentClick, onDayClick,
}: {
  currentDate: Date;
  appointments: AppointmentWithRelations[];
  calendars: CalendarType[];
  visibleCalendars: Set<string>;
  displayTimezone: string;
  onAppointmentClick: (appt: AppointmentWithRelations) => void;
  onDayClick: (date: Date) => void;
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];

  for (let i = 0; i < startOffset; i++) {
    const d = new Date(year, month, 1 - startOffset + i);
    currentWeek.push(d);
  }
  for (let day = 1; day <= totalDays; day++) {
    currentWeek.push(new Date(year, month, day));
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      const last = currentWeek[currentWeek.length - 1];
      currentWeek.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    }
    weeks.push(currentWeek);
  }

  const visibleAppts = appointments.filter(a => visibleCalendars.has(a.calendar_id));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Day headers */}
      <div className="flex border-b border-navy-100 bg-white">
        {DAYS_SHORT.map(day => (
          <div key={day} className="flex-1 px-2 py-2 text-center text-xs font-semibold text-ivory-500">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-rows-1">
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="flex border-b border-navy-100" style={{ minHeight: 100 }}>
              {week.map((day, dayIdx) => {
                const isCurrentMonth = day.getMonth() === month;
                const dayAppts = getAppointmentsForDay(visibleAppts, day, displayTimezone);
                return (
                  <div
                    key={dayIdx}
                    onClick={() => onDayClick(day)}
                    className={cn(
                      'flex-1 border-r border-navy-100 last:border-r-0 p-1 transition cursor-pointer hover:bg-ivory-50',
                      !isCurrentMonth && 'bg-ivory-50/50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                        isToday(day) ? 'bg-gold-400 text-white' : isCurrentMonth ? 'text-navy-700' : 'text-ivory-400'
                      )}>
                        {day.getDate()}
                      </span>
                      {dayAppts.length > 0 && (
                        <span className="text-[9px] font-medium text-ivory-400">{dayAppts.length}</span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {dayAppts.slice(0, 3).map(appt => {
                        const cal = appt.calendars;
                        return (
                          <button
                            key={appt.id}
                            onClick={(e) => { e.stopPropagation(); onAppointmentClick(appt); }}
                            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition hover:bg-navy-50"
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cal?.color ?? '#64748b' }} />
                            <span className="truncate text-[9px] text-navy-600">
                              {formatTimeInZone(appt.start_time, displayTimezone)} {appt.title}
                            </span>
                          </button>
                        );
                      })}
                      {dayAppts.length > 3 && (
                        <p className="px-1 text-[9px] text-ivory-400">+{dayAppts.length - 3} more</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CURRENT TIME INDICATOR
// ============================================================
function CurrentTimeIndicator({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);
  const top = getAppointmentTopOffset(now.toISOString(), timezone);
  return (
    <div className="pointer-events-none absolute left-0 right-0 z-5" style={{ top }}>
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-1" />
        <div className="h-px flex-1 bg-red-500" />
      </div>
    </div>
  );
}

// ============================================================
// DATE PICKER
// ============================================================
function DatePicker({ currentDate, onSelect, onClose }: { currentDate: Date; onSelect: (d: Date) => void; onClose: () => void }) {
  const [viewDate, setViewDate] = useState(new Date(currentDate));
  const [pickerView, setPickerView] = useState<'days' | 'months' | 'years'>('days');
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-date-picker]')) onClose();
    };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const days: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= totalDays; d++) days.push(new Date(year, month, d));
  while (days.length < 42) days.push(null);

  return (
    <div data-date-picker className="absolute left-0 top-full mt-1 z-50 w-72 rounded-xl border border-navy-100 bg-white p-3 shadow-lg">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => {
          if (pickerView === 'days') { setViewDate(new Date(year, month - 1, 1)); }
          else if (pickerView === 'months') { setViewDate(new Date(year - 1, 0, 1)); }
          else { setViewDate(new Date(year - 10, 0, 1)); }
        }} className="flex h-7 w-7 items-center justify-center rounded-lg text-ivory-600 hover:bg-ivory-50">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => setPickerView(pickerView === 'days' ? 'months' : pickerView === 'months' ? 'years' : 'days')}
          className="text-sm font-semibold text-navy-800 hover:text-gold-600"
        >
          {pickerView === 'days' && `${MONTHS[month]} ${year}`}
          {pickerView === 'months' && `${year}`}
          {pickerView === 'years' && `${year - (year % 10)} – ${year - (year % 10) + 9}`}
        </button>
        <button onClick={() => {
          if (pickerView === 'days') { setViewDate(new Date(year, month + 1, 1)); }
          else if (pickerView === 'months') { setViewDate(new Date(year + 1, 0, 1)); }
          else { setViewDate(new Date(year + 10, 0, 1)); }
        }} className="flex h-7 w-7 items-center justify-center rounded-lg text-ivory-600 hover:bg-ivory-50">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Days view */}
      {pickerView === 'days' && (
        <>
          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {DAYS_SHORT.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-ivory-400">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d, i) => {
              if (!d) return <div key={i} />;
              const selected = isSameDay(d, currentDate);
              const today = isToday(d);
              return (
                <button
                  key={i}
                  onClick={() => onSelect(d)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition',
                    selected ? 'bg-gold-400 text-white font-bold' : today ? 'bg-gold-50 text-gold-700 font-semibold' : 'text-navy-600 hover:bg-ivory-50'
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Months view */}
      {pickerView === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((m, i) => (
            <button
              key={m}
              onClick={() => { setViewDate(new Date(year, i, 1)); setPickerView('days'); }}
              className={cn(
                'rounded-lg py-2 text-xs font-medium transition',
                i === month ? 'bg-gold-50 text-gold-700 font-semibold' : 'text-navy-600 hover:bg-ivory-50'
              )}
            >
              {m.slice(0, 3)}
            </button>
          ))}
        </div>
      )}

      {/* Years view */}
      {pickerView === 'years' && (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 10 }, (_, i) => {
            const y = year - (year % 10) + i;
            return (
              <button
                key={y}
                onClick={() => { setViewDate(new Date(y, month, 1)); setPickerView('months'); }}
                className={cn(
                  'rounded-lg py-2 text-xs font-medium transition',
                  y === year ? 'bg-gold-50 text-gold-700 font-semibold' : 'text-navy-600 hover:bg-ivory-50'
                )}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CALENDAR SKELETON
// ============================================================
function CalendarSkeleton({ view }: { view: CalendarView }) {
  if (view === 'month') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex border-b border-navy-100">
          {DAYS_SHORT.map(d => <div key={d} className="flex-1 px-2 py-2"><Skeleton className="h-4 w-8" /></div>)}
        </div>
        <div className="flex-1 p-2">
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-navy-100">
        <div className="w-14 border-r border-navy-100" />
        {Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => (
          <div key={i} className="flex-1 px-2 py-2"><Skeleton className="h-8 w-full" /></div>
        ))}
      </div>
      <div className="flex-1 p-2">
        <div className="flex gap-1">
          {Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => (
            <div key={i} className="flex-1 space-y-1">
              {Array.from({ length: 12 }, (_, j) => <Skeleton key={j} className="h-14 w-full" />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// APPOINTMENT DETAIL DRAWER
// ============================================================
function AppointmentDetailDrawer({
  appointment, displayTimezone, onClose, onUpdated, onContactClick,
}: {
  appointment: AppointmentWithRelations;
  displayTimezone: string;
  onClose: () => void;
  onUpdated: () => void;
  onContactClick: (contactId: string) => void;
}) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [formSubmissions, setFormSubmissions] = useState<FormSubmission[]>([]);
  const [, setLoadingSubs] = useState(true);

  useEffect(() => {
    supabase
      .from('form_submissions')
      .select('*')
      .eq('appointment_id', appointment.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setFormSubmissions((data ?? []) as FormSubmission[]);
        setLoadingSubs(false);
      });
  }, [appointment.id]);

  const updateStatus = async (status: AppointmentStatus) => {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', appointment.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Appointment marked as ${status}`);
    onUpdated();
    onClose();
  };

  const copyMeetingLink = () => {
    if (appointment.meeting_link) {
      navigator.clipboard.writeText(appointment.meeting_link);
      toast('Meeting link copied');
    } else {
      toast('No meeting link available', 'error');
    }
  };

  const sendReminder = () => {
    toast('Reminder sent to contact');
  };

  const contact = appointment.contacts;
  const calendar = appointment.calendars;
  const StatusIcon = STATUS_ICONS[appointment.status];

  return (
    <Drawer
      open
      onClose={onClose}
      title={appointment.title}
      description={`${formatDateInZone(appointment.start_time, displayTimezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${formatTimeInZone(appointment.start_time, displayTimezone)}`}
      width="xl"
    >
      <div className="p-6 space-y-6">
        {/* Status */}
        <div className="flex items-center gap-3">
          <div className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5', STATUS_CONFIG[appointment.status].bg)}>
            <StatusIcon className={cn('h-4 w-4', STATUS_CONFIG[appointment.status].text)} />
            <span className={cn('text-sm font-semibold', STATUS_CONFIG[appointment.status].text)}>
              {STATUS_CONFIG[appointment.status].label}
            </span>
          </div>
        </div>

        {/* Details */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ivory-500">Details</h3>
          <div className="space-y-2.5">
            <DetailRow icon={CalendarIcon} label="Calendar" value={calendar?.name ?? '—'} color={calendar?.color} />
            <DetailRow icon={Clock} label="Date" value={formatDateInZone(appointment.start_time, displayTimezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} />
            <DetailRow icon={Clock} label="Start" value={formatTimeInZone(appointment.start_time, displayTimezone)} />
            <DetailRow icon={Clock} label="End" value={formatTimeInZone(appointment.end_time, displayTimezone)} />
            <DetailRow icon={Globe} label="Timezone" value={displayTimezone} />
            <DetailRow icon={MapPin} label="Location" value={appointment.location_type.replace('_', ' ')} />
            {appointment.meeting_link && <DetailRow icon={Video} label="Meeting Link" value={appointment.meeting_link} />}
            <DetailRow icon={User} label="Host" value={profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'You' : 'You'} />
            <DetailRow icon={CalendarClock} label="Created" value={formatDate(appointment.created_at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} />
          </div>
        </div>

        {/* Contact */}
        {contact && (
          <div className="pt-4 border-t border-navy-100">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ivory-500">Contact</h3>
            <button
              onClick={() => onContactClick(contact.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-ivory-50 p-3 text-left transition hover:bg-ivory-100"
            >
              <Avatar firstName={contact.first_name} lastName={contact.last_name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-700">{getFullName(contact)}</p>
                <p className="truncate text-xs text-ivory-600">{contact.email || contact.phone || '—'}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-ivory-400" />
            </button>
          </div>
        )}

        {/* Form Responses */}
        {formSubmissions.length > 0 && (
          <div className="pt-4 border-t border-navy-100">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ivory-500">Form Responses</h3>
            <div className="space-y-3">
              {formSubmissions.map(sub => (
                <div key={sub.id} className="rounded-xl bg-ivory-50 p-3">
                  <p className="mb-2 text-xs font-semibold text-navy-600">Submitted {formatDate(sub.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                  <div className="space-y-1.5">
                    {Object.entries(sub.answers).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-3">
                        <span className="text-xs text-ivory-600">{key}</span>
                        <span className="text-right text-xs font-medium text-navy-700">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {appointment.notes && (
          <div className="pt-4 border-t border-navy-100">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ivory-500">Notes</h3>
            <p className="rounded-xl bg-ivory-50 p-3 text-sm text-navy-700">{appointment.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="pt-4 border-t border-navy-100">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ivory-500">Actions</h3>
          <div className="flex flex-wrap gap-2">
            {appointment.status === 'pending' && (
              <button onClick={() => updateStatus('confirmed')} className="btn-primary btn-sm">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Confirm
              </button>
            )}
            {appointment.status !== 'completed' && appointment.status !== 'cancelled' && (
              <>
                <button onClick={() => updateStatus('completed')} className="btn-secondary btn-sm">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Mark Completed
                </button>
                <button onClick={() => updateStatus('no_show')} className="btn-secondary btn-sm">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Mark No-show
                </button>
                <button onClick={() => updateStatus('rescheduled')} className="btn-secondary btn-sm">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Reschedule
                </button>
                <button onClick={() => updateStatus('cancelled')} className="btn-danger btn-sm">
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </button>
              </>
            )}
            <button onClick={sendReminder} className="btn-secondary btn-sm">
              <Send className="h-3.5 w-3.5" />
              Send Reminder
            </button>
            <button onClick={copyMeetingLink} className="btn-secondary btn-sm">
              <Copy className="h-3.5 w-3.5" />
              Copy Link
            </button>
            <button className="btn-secondary btn-sm">
              <Edit className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function DetailRow({ icon: Icon, label, value, color }: { icon: typeof Clock; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-ivory-500" />
      <span className="w-24 shrink-0 text-xs text-ivory-600">{label}</span>
      <span className="flex-1 text-sm font-medium text-navy-700">
        {color && <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: color }} />}
        {value}
      </span>
    </div>
  );
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

// ============================================================
// CREATE CALENDAR WIZARD
// ============================================================
// Old CreateCalendarWizard moved to @/components/calendar/CreateCalendarWizard

// ============================================================
// EDIT CALENDAR DRAWER
// ============================================================
function EditCalendarDrawer({ calendar, onClose, onUpdated }: { calendar: CalendarType; onClose: () => void; onUpdated: () => void }) {
  const { toast } = useToast();
  const { workspace, user } = useAuth();
  const [tab, setTab] = useState<'details' | 'availability' | 'hosts' | 'forms'>('details');
  const [form, setForm] = useState({
    name: calendar.name, description: calendar.description || '', slug: calendar.slug,
    duration_minutes: calendar.duration_minutes, location_type: calendar.location_type,
    timezone: calendar.timezone, buffer_before_minutes: calendar.buffer_before_minutes,
    buffer_after_minutes: calendar.buffer_after_minutes, min_booking_notice_minutes: calendar.min_booking_notice_minutes,
    max_booking_horizon_days: calendar.max_booking_horizon_days, capacity: calendar.capacity,
    booking_flow: calendar.booking_flow ?? 'calendar_first',
    form_mode: calendar.form_mode ?? 'default',
    connected_form_id: calendar.connected_form_id ?? '',
    custom_confirmation_message: calendar.custom_confirmation_message ?? '',
    custom_redirect_url: calendar.custom_redirect_url ?? '',
  });
  const [availability, setAvailability] = useState<Record<number, { start: string; end: string }[]>>({});
  const [hosts, setHosts] = useState<{ id: string; user_id: string; is_primary: boolean; profiles: { first_name: string | null; last_name: string | null; email: string | null } | null }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; first_name: string | null; last_name: string | null; email: string | null }[]>([]);
  const [attachedForms, setAttachedForms] = useState<{ id: string; name: string; status: string }[]>([]);
  const [availableForms, setAvailableForms] = useState<{ id: string; name: string; status: string }[]>([]);

  useEffect(() => {
    supabase.from('availability_rules').select('*').eq('calendar_id', calendar.id).then(({ data }) => {
      const rules: Record<number, { start: string; end: string }[]> = {};
      for (const r of (data ?? []) as AvailabilityRule[]) {
        if (!rules[r.day_of_week]) rules[r.day_of_week] = [];
        rules[r.day_of_week].push({ start: r.start_time, end: r.end_time });
      }
      setAvailability(rules);
    });
    supabase.from('calendar_hosts').select('id, user_id, is_primary, profiles(first_name, last_name, email)').eq('calendar_id', calendar.id).then(({ data }) => {
      setHosts((data ?? []) as unknown as typeof hosts);
    });
    supabase.from('forms').select('id, name, status').eq('calendar_id', calendar.id).then(({ data }) => {
      setAttachedForms((data ?? []) as typeof attachedForms);
    });
    supabase.from('forms').select('id, name, status').is('calendar_id', null).then(({ data }) => {
      setAvailableForms((data ?? []) as typeof availableForms);
    });
    if (workspace) {
      supabase.from('workspace_members').select('user_id').eq('workspace_id', workspace.id).eq('status', 'active').then(({ data: memberRows }) => {
        const memberUserIds = (memberRows ?? []).map((m: { user_id: string }) => m.user_id);
        const allUserIds = new Set(memberUserIds);
        if (user) allUserIds.add(user.id);
        const ids = Array.from(allUserIds);
        if (ids.length === 0) return;
        supabase.from('profiles').select('user_id, first_name, last_name, email').in('user_id', ids).then(({ data: profRows }) => {
          setMembers((profRows ?? []) as typeof members);
        });
      });
    }
  }, [calendar.id, workspace, user]);

  const saveDetails = async () => {
    const { error } = await supabase.from('calendars').update({
      name: form.name, description: form.description, slug: form.slug,
      duration_minutes: form.duration_minutes, location_type: form.location_type,
      timezone: form.timezone, buffer_before_minutes: form.buffer_before_minutes,
      buffer_after_minutes: form.buffer_after_minutes, min_booking_notice_minutes: form.min_booking_notice_minutes,
      max_booking_horizon_days: form.max_booking_horizon_days, capacity: form.capacity,
      booking_flow: form.booking_flow, form_mode: form.form_mode,
      connected_form_id: form.connected_form_id || null,
      custom_confirmation_message: form.custom_confirmation_message || null,
      custom_redirect_url: form.custom_redirect_url || null,
    }).eq('id', calendar.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Calendar updated');
    onUpdated();
  };

  const saveAvailability = async () => {
    await supabase.from('availability_rules').delete().eq('calendar_id', calendar.id);
    const rules: { calendar_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
    for (const [dayStr, intervals] of Object.entries(availability)) {
      const day = parseInt(dayStr);
      for (const interval of intervals) {
        rules.push({ calendar_id: calendar.id, day_of_week: day, start_time: interval.start, end_time: interval.end });
      }
    }
    if (rules.length > 0) await supabase.from('availability_rules').insert(rules);
    toast('Availability saved');
    onUpdated();
  };

  return (
    <Drawer open onClose={onClose} title={`Edit ${calendar.name}`} width="lg">
      <div className="p-6 space-y-5">
        <div className="flex gap-1 border-b border-navy-100">
          {(['details', 'availability', 'hosts', 'forms'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-all', tab === t ? 'text-gold-700 border-gold-400' : 'text-ivory-600 border-transparent hover:text-navy-700')}>{t}</button>
          ))}
        </div>
        {tab === 'details' && (
          <div className="space-y-4">
            <div><label className="block text-sm font-medium text-navy-700 mb-1.5">Name</label><input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-navy-700 mb-1.5">Description</label><textarea className="input-field min-h-[60px]" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-navy-700 mb-1.5">URL Slug</label><input className="input-field" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} /></div>
              <div><label className="block text-sm font-medium text-navy-700 mb-1.5">Duration (min)</label><select className="input-field" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: parseInt(e.target.value) })}>{[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} min</option>)}</select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-navy-700 mb-1.5">Location</label><select className="input-field" value={form.location_type} onChange={e => setForm({ ...form, location_type: e.target.value as LocationType })}><option value="synapse_meeting">SYNAPSE Meeting</option><option value="phone">Phone</option><option value="in_person">In Person</option><option value="custom">Custom</option><option value="none">No Location</option></select></div>
              <div><label className="block text-sm font-medium text-navy-700 mb-1.5">Timezone</label><TimezoneSelect value={form.timezone} onChange={tz => setForm({ ...form, timezone: tz })} /></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Booking Flow</label>
              <select className="input-field" value={form.booking_flow} onChange={e => setForm({ ...form, booking_flow: e.target.value as typeof form.booking_flow })}>
                <option value="calendar_first">Calendar first (pick time, then form)</option>
                <option value="form_first">Form first (fill form, then pick time)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Form Mode</label>
              <select className="input-field" value={form.form_mode} onChange={e => setForm({ ...form, form_mode: e.target.value as typeof form.form_mode, connected_form_id: e.target.value === 'default' ? '' : form.connected_form_id })}>
                <option value="default">Default Form</option>
                <option value="custom">Custom Form</option>
              </select>
            </div>
            {form.form_mode === 'custom' && (
              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Connected Form</label>
                <select className="input-field" value={form.connected_form_id} onChange={e => setForm({ ...form, connected_form_id: e.target.value })}>
                  <option value="">Choose a form...</option>
                  {[...attachedForms, ...availableForms].map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Custom Confirmation Message</label>
              <textarea className="input-field min-h-[60px]" value={form.custom_confirmation_message} onChange={e => setForm({ ...form, custom_confirmation_message: e.target.value })} placeholder="Thank you for booking!" />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Redirect URL (optional)</label>
              <input className="input-field" value={form.custom_redirect_url} onChange={e => setForm({ ...form, custom_redirect_url: e.target.value })} placeholder="https://your-site.com/thank-you" />
            </div>
            <button onClick={saveDetails} className="btn-primary w-full">Save Changes</button>
          </div>
        )}
        {tab === 'availability' && (
          <div className="space-y-3">
            <p className="text-sm text-ivory-600">Click a day to toggle availability.</p>
            {DAYS.map((day, dayIdx) => {
              const intervals = availability[dayIdx] || [];
              const isActive = intervals.length > 0;
              return (
                <div key={dayIdx} className="flex items-center gap-3 flex-wrap">
                  <div className="w-24">
                    <button onClick={() => { const na = { ...availability }; if (isActive) { na[dayIdx] = []; } else { na[dayIdx] = [{ start: '09:00', end: '17:00' }]; } setAvailability(na); }} className={cn('text-sm font-medium', isActive ? 'text-navy-700' : 'text-ivory-500')}>{isActive && <span className="text-gold-500 mr-1.5">●</span>}{day}</button>
                  </div>
                  {isActive && (
                    <div className="flex items-center gap-2 flex-1 flex-wrap">
                      {intervals.map((interval, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input type="time" className="input-field py-1.5 text-sm" value={interval.start} onChange={e => { const na = { ...availability }; na[dayIdx][i].start = e.target.value; setAvailability(na); }} />
                          <span className="text-ivory-400">—</span>
                          <input type="time" className="input-field py-1.5 text-sm" value={interval.end} onChange={e => { const na = { ...availability }; na[dayIdx][i].end = e.target.value; setAvailability(na); }} />
                        </div>
                      ))}
                      <button onClick={() => { const na = { ...availability }; na[dayIdx].push({ start: '13:00', end: '17:00' }); setAvailability(na); }} className="text-sm text-gold-700 hover:text-gold-600 font-medium">+ Add</button>
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={saveAvailability} className="btn-primary w-full mt-4">Save Availability</button>
          </div>
        )}
        {tab === 'hosts' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-navy-700">Current Hosts</p>
              {hosts.length === 0 ? <p className="text-sm text-ivory-500">No hosts assigned.</p> : hosts.map(h => (
                <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50">
                  <Avatar firstName={h.profiles?.first_name} lastName={h.profiles?.last_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-navy-700">{h.profiles?.first_name} {h.profiles?.last_name}</p>
                    <p className="text-xs text-ivory-600">{h.profiles?.email}</p>
                  </div>
                  {h.is_primary && <span className="text-xs font-medium text-gold-700 bg-gold-50 px-2 py-0.5 rounded-full">Primary</span>}
                  <button onClick={async () => { await supabase.from('calendar_hosts').delete().eq('calendar_id', calendar.id).eq('user_id', h.user_id); setHosts(hosts.filter(x => x.user_id !== h.user_id)); toast('Host removed'); }} className="text-ivory-400 hover:text-burgundy-600"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            {(() => {
              const available = members.filter(m => !hosts.some(h => h.user_id === m.user_id));
              if (available.length === 0) return null;
              return (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-navy-700">Add Host</p>
                  {available.map(m => (
                    <div key={m.user_id} className="flex items-center justify-between rounded-xl border border-navy-100 p-3">
                      <div className="flex items-center gap-2">
                        <Avatar firstName={m.first_name} lastName={m.last_name} size="sm" />
                        <div>
                          <p className="text-sm font-medium text-navy-700">{m.first_name} {m.last_name}</p>
                          <p className="text-xs text-ivory-600">{m.email}</p>
                        </div>
                      </div>
                      <button onClick={async () => { const { error } = await supabase.from('calendar_hosts').insert({ calendar_id: calendar.id, user_id: m.user_id, is_primary: hosts.length === 0 }); if (error) { toast('Something went wrong. Please try again.', 'error'); return; } const { data: newHost } = await supabase.from('calendar_hosts').select('id, user_id, is_primary, profiles(first_name, last_name, email)').eq('calendar_id', calendar.id).eq('user_id', m.user_id).single(); if (newHost) setHosts([...hosts, newHost as unknown as typeof hosts[0]]); toast('Host added'); }} className="text-xs text-gold-700 hover:text-gold-600 font-medium">+ Add</button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
        {tab === 'forms' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-navy-700 mb-2">Attached Forms</p>
              {attachedForms.length === 0 ? <p className="text-sm text-ivory-500">No forms attached to this calendar.</p> : (
                <div className="space-y-2">
                  {attachedForms.map(f => (
                    <div key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-ivory-50">
                      <span className="text-sm font-medium text-navy-700">{f.name}</span>
                      <button onClick={async () => { await supabase.from('forms').update({ calendar_id: null }).eq('id', f.id); setAvailableForms([...availableForms, f]); setAttachedForms(attachedForms.filter(x => x.id !== f.id)); toast('Form detached'); }} className="text-xs text-burgundy-600 hover:text-burgundy-700 font-medium">Detach</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {availableForms.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-navy-700 mb-2">Available Forms</p>
                <div className="space-y-2">
                  {availableForms.map(f => (
                    <div key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-ivory-50">
                      <span className="text-sm font-medium text-navy-700">{f.name}</span>
                      <button onClick={async () => { await supabase.from('forms').update({ calendar_id: calendar.id }).eq('id', f.id); setAttachedForms([...attachedForms, f]); setAvailableForms(availableForms.filter(x => x.id !== f.id)); toast('Form attached'); }} className="text-xs text-gold-700 hover:text-gold-600 font-medium">Attach</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
