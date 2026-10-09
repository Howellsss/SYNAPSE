import { useState, useEffect, useMemo } from 'react';
import {
  User, UserCheck, UsersRound, CalendarClock, Briefcase, Calendar as CalendarIcon,
  ChevronRight, ChevronLeft, Check, Plus, X, Clock, Video, Phone, MapPin,
  Bell, Mail, MessageSquare, CreditCard, FileText, Eye, Copy, ArrowRight,
  Settings as SettingsIcon, Layers,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { cn, slugify } from '@/lib/utils';
import type { CalendarType as CalType, LocationType } from '@/types';
import { TimezoneSelect } from '@/components/ui/TimezoneSelect';
import { publicOrigin } from '@/lib/publicUrl';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CALENDAR_TYPE_OPTIONS = [
  {
    value: 'one_on_one' as CalType,
    label: 'Personal',
    icon: User,
    desc: 'One host with one participant',
    useCases: ['Consultation', 'Coaching', 'Counselling', 'Discovery Call', 'Personal Meeting'],
    color: '#3b82f6',
  },
  {
    value: 'round_robin' as CalType,
    label: 'Round Robin',
    icon: UserCheck,
    desc: 'Multiple hosts, one assigned automatically per booking',
    useCases: ['Sales rotation', 'Support rotation', 'Lead distribution'],
    color: '#10b981',
  },
  {
    value: 'collective' as CalType,
    label: 'Collective',
    icon: UsersRound,
    desc: 'All required hosts must be simultaneously available',
    useCases: ['Panel interview', 'Group consultation', 'Team meeting'],
    color: '#8b5cf6',
  },
  {
    value: 'event' as CalType,
    label: 'Event',
    icon: CalendarClock,
    desc: 'One event with multiple participants',
    useCases: ['Webinars', 'Seminars', 'Classes', 'Workshops', 'Public sessions'],
    color: '#f59e0b',
  },
  {
    value: 'service' as CalType,
    label: 'Service Booking',
    icon: Briefcase,
    desc: 'Service-based business scheduling with pricing',
    useCases: ['Hair appointment', 'Therapy session', 'Legal consultation', 'Photography', 'Coaching package'],
    color: '#ef4444',
  },
  {
    value: 'group' as CalType,
    label: 'Group Calendar',
    icon: Layers,
    desc: 'Container combining multiple calendars behind one booking URL',
    useCases: ['Combine Coaching + Counselling + Consultation under one link'],
    color: '#06b6d4',
  },
];

const LOCATION_OPTIONS: { value: LocationType; label: string; icon: typeof Video }[] = [
  { value: 'synapse_meeting', label: 'SYNAPSE Meeting', icon: Video },
  { value: 'phone', label: 'Phone', icon: Phone },
  { value: 'in_person', label: 'In Person', icon: MapPin },
  { value: 'custom', label: 'Custom', icon: MapPin },
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

const STRATEGIES = [
  { value: 'balanced', label: 'Balanced Distribution', desc: 'Distribute bookings evenly across all hosts' },
  { value: 'least_recently_booked', label: 'Least Recently Booked', desc: 'Assign to the host who was booked least recently' },
  { value: 'priority_order', label: 'Priority Order', desc: 'Assign by host priority ranking' },
  { value: 'weighted', label: 'Weighted Distribution', desc: 'Assign based on host weight values' },
];

interface WizardForm {
  name: string;
  description: string;
  slug: string;
  calendar_type: CalType;
  duration_minutes: number;
  customDuration: string;
  slot_interval_minutes: number;
  location_type: LocationType;
  location_url: string;
  timezone: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_booking_notice_minutes: number;
  max_booking_horizon_days: number;
  capacity: number;
  booking_flow: 'calendar_first' | 'form_first';
  round_robin_strategy: string;
  price: string;
  currency: string;
  color: string;
  selectedHosts: Set<string>;
  selectedGroupCalendars: Set<string>;
  connected_form_id: string;
  notifications: { email: boolean; sms: boolean; in_app: boolean };
  reminders: { value: string; unit: 'minutes' | 'hours' | 'days' }[];
}

interface MemberInfo {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
}

interface GroupCalendarInfo {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

interface FormInfo {
  id: string;
  name: string;
  status: string;
}

const COLOR_OPTIONS = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

function getStepsForType(type: CalType): string[] {
  const base = ['Type', 'Details'];
  if (type === 'group') return [...base, 'Calendars', 'Form', 'Appearance', 'Review'];
  if (type === 'service') return [...base, 'Host', 'Duration', 'Location', 'Availability', 'Form', 'Payment', 'Review'];
  if (type === 'event') return [...base, 'Host', 'Date & Time', 'Location', 'Capacity', 'Form', 'Payment', 'Review'];
  if (type === 'round_robin') return [...base, 'Hosts', 'Strategy', 'Duration', 'Location', 'Availability', 'Form', 'Notifications', 'Reminders', 'Payment', 'Appearance', 'Review'];
  if (type === 'collective') return [...base, 'Hosts', 'Duration', 'Location', 'Availability', 'Form', 'Notifications', 'Reminders', 'Payment', 'Appearance', 'Review'];
  return [...base, 'Host', 'Duration', 'Location', 'Availability', 'Form', 'Notifications', 'Reminders', 'Payment', 'Appearance', 'Review'];
}

export function CreateCalendarWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [typeSelected, setTypeSelected] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdCalendar, setCreatedCalendar] = useState<{ id: string; slug: string; name: string } | null>(null);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [existingCalendars, setExistingCalendars] = useState<GroupCalendarInfo[]>([]);
  const [forms, setForms] = useState<FormInfo[]>([]);

  const [form, setForm] = useState<WizardForm>({
    name: '', description: '', slug: '', calendar_type: 'one_on_one',
    duration_minutes: 30, customDuration: '', slot_interval_minutes: 30,
    location_type: 'synapse_meeting', location_url: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    buffer_before_minutes: 0, buffer_after_minutes: 0, min_booking_notice_minutes: 120,
    max_booking_horizon_days: 60, capacity: 1, booking_flow: 'calendar_first',
    round_robin_strategy: 'balanced', price: '', currency: 'USD', color: '#3b82f6',
    selectedHosts: new Set(), selectedGroupCalendars: new Set(),
    connected_form_id: '', notifications: { email: true, sms: false, in_app: true },
    reminders: [{ value: '24', unit: 'hours' }],
  });

  const [availability, setAvailability] = useState<Record<number, { start: string; end: string }[]>>({
    1: [{ start: '09:00', end: '17:00' }], 2: [{ start: '09:00', end: '17:00' }],
    3: [{ start: '09:00', end: '17:00' }], 4: [{ start: '09:00', end: '17:00' }],
    5: [{ start: '09:00', end: '17:00' }], 0: [], 6: [],
  });

  const steps = useMemo(() => getStepsForType(form.calendar_type), [form.calendar_type]);

  useEffect(() => {
    if (!user) return;
    if (workspace) {
      supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspace.id)
        .eq('status', 'active')
        .then(({ data }) => {
          const memberUserIds = (data ?? []).map(m => m.user_id);
          const allUserIds = new Set(memberUserIds);
          allUserIds.add(user.id);
          const ids = Array.from(allUserIds);
          if (ids.length === 0) return;
          supabase
            .from('profiles')
            .select('user_id, first_name, last_name')
            .in('user_id', ids)
            .then(({ data: profiles }) => setMembers((profiles ?? []) as MemberInfo[]));
        });
    } else {
      supabase
        .from('profiles')
        .select('user_id, first_name, last_name')
        .eq('user_id', user.id)
        .then(({ data: profiles }) => setMembers((profiles ?? []) as MemberInfo[]));
    }

    let calQuery = supabase
      .from('calendars')
      .select('id, name, slug, color')
      .neq('calendar_type', 'group')
      .order('name');
    if (workspace) calQuery = calQuery.eq('workspace_id', workspace.id);
    else calQuery = calQuery.eq('owner_id', user.id);
    calQuery.then(({ data }) => setExistingCalendars((data ?? []) as GroupCalendarInfo[]));

    let formQuery = supabase
      .from('forms')
      .select('id, name, status')
      .order('name');
    if (workspace) formQuery = formQuery.eq('workspace_id', workspace.id);
    else formQuery = formQuery.eq('owner_id', user.id);
    formQuery.then(({ data }) => setForms((data ?? []) as FormInfo[]));
  }, [workspace, user]);

  useEffect(() => {
    if (user && typeSelected && form.selectedHosts.size === 0 && form.calendar_type !== 'group') {
      setForm(f => ({ ...f, selectedHosts: new Set([user.id]) }));
    }
  }, [user, typeSelected, form.selectedHosts.size, form.calendar_type]);

  const updateForm = (patch: Partial<WizardForm>) => setForm(f => ({ ...f, ...patch }));

  const toggleHost = (userId: string) => {
    const next = new Set(form.selectedHosts);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    updateForm({ selectedHosts: next });
  };

  const toggleGroupCalendar = (calId: string) => {
    const next = new Set(form.selectedGroupCalendars);
    if (next.has(calId)) next.delete(calId);
    else next.add(calId);
    updateForm({ selectedGroupCalendars: next });
  };

  const getDuration = () => {
    if (form.duration_minutes === 0 && form.customDuration) return parseInt(form.customDuration) || 30;
    return form.duration_minutes;
  };

  const handleCreate = async () => {
    if (!user) {
      toast('You must be signed in to create a calendar.', 'error');
      return;
    }
    setCreating(true);
    const slug = form.slug || slugify(form.name);
    const duration = getDuration();

    if (form.calendar_type === 'group') {
      const groupInsert: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        slug,
        connected_form_id: form.connected_form_id || null,
        booking_flow: form.booking_flow,
      };
      if (workspace) groupInsert.workspace_id = workspace.id;
      else groupInsert.owner_id = user.id;

      const { data: group, error } = await supabase.from('calendar_groups').insert(groupInsert).select().single();
      if (error) {
        toast(error.message, 'error');
        setCreating(false);
        return;
      }
      const members = Array.from(form.selectedGroupCalendars).map((calId, i) => ({
        group_id: group.id, calendar_id: calId, sort_order: i,
      }));
      if (members.length > 0) {
        await supabase.from('calendar_group_members').insert(members);
      }
      setCreatedCalendar({ id: group.id, slug, name: form.name });
      setCreating(false);
      return;
    }

    const insertData: Record<string, unknown> = {
      name: form.name,
      description: form.description || null,
      slug,
      calendar_type: form.calendar_type,
      duration_minutes: duration,
      slot_interval_minutes: form.slot_interval_minutes,
      location_type: form.location_type,
      location_url: form.location_url || null,
      timezone: form.timezone,
      buffer_before_minutes: form.buffer_before_minutes,
      buffer_after_minutes: form.buffer_after_minutes,
      min_booking_notice_minutes: form.min_booking_notice_minutes,
      max_booking_horizon_days: form.max_booking_horizon_days,
      capacity: form.capacity,
      booking_flow: form.booking_flow,
      color: form.color,
      status: 'active',
    };
    if (workspace) insertData.workspace_id = workspace.id;
    else insertData.owner_id = user.id;

    if (form.calendar_type === 'round_robin') {
      insertData.round_robin_strategy = form.round_robin_strategy;
    }
    if (form.calendar_type === 'service' && form.price) {
      insertData.price = parseFloat(form.price);
      insertData.currency = form.currency;
    }
    insertData.form_mode = form.connected_form_id ? 'custom' : 'default';
    if (form.connected_form_id) {
      insertData.connected_form_id = form.connected_form_id;
    }

    const { data: cal, error } = await supabase.from('calendars').insert(insertData).select().single();
    if (error) {
      toast(error.message, 'error');
      setCreating(false);
      return;
    }

    const hostEntries = Array.from(form.selectedHosts).map((userId, i) => ({
      calendar_id: cal.id,
      user_id: userId,
      is_primary: i === 0,
      priority: i + 1,
      weight: form.round_robin_strategy === 'weighted' ? 1 : 0,
    }));
    if (hostEntries.length > 0) {
      await supabase.from('calendar_hosts').insert(hostEntries);
    }

    const rules: { calendar_id: string; day_of_week: number; start_time: string; end_time: string }[] = [];
    for (const [dayStr, intervals] of Object.entries(availability)) {
      const day = parseInt(dayStr);
      for (const interval of intervals) {
        rules.push({ calendar_id: cal.id, day_of_week: day, start_time: interval.start, end_time: interval.end });
      }
    }
    if (rules.length > 0) {
      await supabase.from('availability_rules').insert(rules);
    }

    if (form.connected_form_id) {
      await supabase.from('forms').update({ calendar_id: cal.id }).eq('id', form.connected_form_id);
    }

    setCreatedCalendar({ id: cal.id, slug, name: form.name });
    setCreating(false);
  };

  // ---- Success screen ----
  if (createdCalendar) {
    const bookingUrl = `${publicOrigin()}/book/${createdCalendar.slug}`;
    return (
      <Modal open onClose={onClose} size="md">
        <div className="flex flex-col items-center text-center py-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-navy-800">Calendar created successfully</h2>
          <p className="mt-1 text-sm text-ivory-600">{createdCalendar.name} is ready to use.</p>

          <div className="mt-6 w-full rounded-xl border border-navy-100 bg-ivory-50 p-4">
            <p className="text-xs font-medium text-ivory-500">Booking URL</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs text-navy-700 border border-navy-100">{bookingUrl}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(bookingUrl); toast('Link copied to clipboard'); }}
                className="flex items-center gap-1 rounded-lg bg-navy-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-700"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          </div>

          <div className="mt-6 grid w-full grid-cols-2 gap-3">
            <button
              onClick={() => { onCreated(); }}
              className="flex items-center justify-center gap-2 rounded-xl border border-navy-200 bg-white px-4 py-3 text-sm font-semibold text-navy-700 transition hover:bg-ivory-50"
            >
              <CalendarIcon className="h-4 w-4" />
              View in Calendar
            </button>
            <button
              onClick={() => window.open(bookingUrl, '_blank')}
              className="flex items-center justify-center gap-2 rounded-xl border border-navy-200 bg-white px-4 py-3 text-sm font-semibold text-navy-700 transition hover:bg-ivory-50"
            >
              <Eye className="h-4 w-4" />
              Preview Booking Page
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(bookingUrl); toast('Link copied to clipboard'); }}
              className="flex items-center justify-center gap-2 rounded-xl border border-navy-200 bg-white px-4 py-3 text-sm font-semibold text-navy-700 transition hover:bg-ivory-50"
            >
              <Copy className="h-4 w-4" />
              Copy Link
            </button>
            <button
              onClick={() => { onClose(); onCreated(); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-gold-400 px-4 py-3 text-sm font-semibold text-navy-800 transition hover:bg-gold-300"
            >
              <SettingsIcon className="h-4 w-4" />
              Go to Calendar Settings
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---- Type selection screen ----
  if (!typeSelected) {
    return (
      <Modal open onClose={onClose} title="Create Calendar" description="Choose the type of calendar you want to create" size="xl">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CALENDAR_TYPE_OPTIONS.map(t => (
            <button
              key={t.value}
              onClick={() => {
                updateForm({
                  calendar_type: t.value,
                  color: t.color,
                  capacity: t.value === 'event' ? 50 : t.value === 'group' ? 10 : 1,
                });
                setTypeSelected(true);
                setStep(1);
              }}
              className="group relative overflow-hidden rounded-2xl border-2 border-navy-100 bg-white p-5 text-left transition-all hover:border-navy-200 hover:shadow-md"
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl transition"
                style={{ backgroundColor: `${t.color}15` }}
              >
                <t.icon className="h-6 w-6" style={{ color: t.color }} />
              </div>
              <p className="mt-3 text-sm font-bold text-navy-800">{t.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-ivory-600">{t.desc}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {t.useCases.slice(0, 3).map(uc => (
                  <span key={uc} className="rounded-md bg-ivory-100 px-1.5 py-0.5 text-[10px] font-medium text-ivory-600">{uc}</span>
                ))}
              </div>
              <ArrowRight className="absolute right-4 top-4 h-4 w-4 text-ivory-300 transition group-hover:text-navy-400 group-hover:translate-x-1" />
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  // ---- Wizard steps ----
  const currentStepName = steps[step];
  const isLastStep = step === steps.length - 1;

  const canProceed = () => {
    if (currentStepName === 'Details') return form.name.trim().length > 0;
    if (currentStepName === 'Host' || currentStepName === 'Hosts') {
      if (form.calendar_type === 'collective') return form.selectedHosts.size >= 2;
      return form.selectedHosts.size >= 1;
    }
    if (currentStepName === 'Calendars') return form.selectedGroupCalendars.size >= 1;
    return true;
  };

  return (
    <Modal open onClose={onClose} title={`Create ${CALENDAR_TYPE_OPTIONS.find(t => t.value === form.calendar_type)?.label} Calendar`} size="lg">
      {/* Stepper */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto pb-1">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <div className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold shrink-0 transition',
              i < step ? 'bg-green-500 text-white' : i === step ? 'bg-gold-400 text-navy-800' : 'bg-ivory-100 text-ivory-500'
            )}>
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className={cn('text-[11px] font-medium whitespace-nowrap', i <= step ? 'text-navy-700' : 'text-ivory-500')}>{s}</span>
            {i < steps.length - 1 && <div className={cn('h-px w-4', i < step ? 'bg-green-400' : 'bg-navy-100')} />}
          </div>
        ))}
      </div>

      <div className="min-h-[280px]">
        {/* DETAILS */}
        {currentStepName === 'Details' && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Calendar Name</label>
              <input
                className="input-field"
                value={form.name}
                onChange={e => updateForm({ name: e.target.value, slug: slugify(e.target.value) })}
                placeholder="e.g. Executive Consultation"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Slug</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ivory-500">/book/</span>
                <input
                  className="input-field flex-1"
                  value={form.slug}
                  onChange={e => updateForm({ slug: e.target.value })}
                  placeholder="executive-consultation"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Description</label>
              <textarea
                className="input-field min-h-[60px]"
                value={form.description}
                onChange={e => updateForm({ description: e.target.value })}
                placeholder="One-on-one consultation with me."
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Color</label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => updateForm({ color: c })}
                    className={cn('h-8 w-8 rounded-lg border-2 transition', form.color === c ? 'border-navy-800 scale-110' : 'border-transparent')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* HOST / HOSTS */}
        {(currentStepName === 'Host' || currentStepName === 'Hosts') && (
          <div className="space-y-3">
            <p className="text-sm text-ivory-600">
              {form.calendar_type === 'collective'
                ? 'Select at least two hosts. All must be available for a booking to succeed.'
                : form.calendar_type === 'round_robin'
                ? 'Select one or more hosts. SYNAPSE will assign the best available host automatically.'
                : 'Select a host for this calendar.'}
            </p>
            {members.length === 0 ? (
              <p className="text-sm text-ivory-500">No team members found.</p>
            ) : (
              <div className="space-y-2">
                {members.map(m => {
                  const selected = form.selectedHosts.has(m.user_id);
                  return (
                    <button
                      key={m.user_id}
                      onClick={() => toggleHost(m.user_id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition',
                        selected ? 'border-blue-500 bg-blue-50/50' : 'border-navy-100 hover:border-navy-200'
                      )}
                    >
                      <span className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-md border-2 transition',
                        selected ? 'border-blue-600 bg-blue-600' : 'border-navy-200'
                      )}>
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <Avatar firstName={m.first_name} lastName={m.last_name} size="sm" />
                      <span className="text-sm font-medium text-navy-700">
                        {m.first_name ?? ''} {m.last_name ?? ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STRATEGY (round robin only) */}
        {currentStepName === 'Strategy' && (
          <div className="space-y-3">
            <p className="text-sm text-ivory-600">Choose how SYNAPSE assigns hosts for each booking.</p>
            {STRATEGIES.map(s => (
              <button
                key={s.value}
                onClick={() => updateForm({ round_robin_strategy: s.value })}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition',
                  form.round_robin_strategy === s.value ? 'border-blue-500 bg-blue-50/50' : 'border-navy-100 hover:border-navy-200'
                )}
              >
                <span className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                  form.round_robin_strategy === s.value ? 'border-blue-600 bg-blue-600' : 'border-navy-200'
                )}>
                  {form.round_robin_strategy === s.value && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
                <div>
                  <p className="text-sm font-semibold text-navy-800">{s.label}</p>
                  <p className="mt-0.5 text-xs text-ivory-600">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* DURATION */}
        {currentStepName === 'Duration' && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Duration</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map(m => (
                  <button
                    key={m}
                    onClick={() => updateForm({ duration_minutes: m, customDuration: '' })}
                    className={cn(
                      'rounded-lg border-2 px-4 py-2 text-sm font-semibold transition',
                      form.duration_minutes === m && !form.customDuration ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-navy-100 text-navy-700 hover:border-navy-200'
                    )}
                  >
                    {m} min
                  </button>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input-field w-20 py-2"
                    value={form.customDuration}
                    onChange={e => updateForm({ customDuration: e.target.value, duration_minutes: 0 })}
                    placeholder="Custom"
                  />
                  <span className="text-sm text-ivory-500">min</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Slot Interval (min)</label>
                <select
                  className="input-field"
                  value={form.slot_interval_minutes}
                  onChange={e => updateForm({ slot_interval_minutes: parseInt(e.target.value) })}
                >
                  {[15, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Timezone</label>
                <TimezoneSelect value={form.timezone} onChange={tz => updateForm({ timezone: tz })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Buffer Before (min)</label>
                <input type="number" className="input-field" value={form.buffer_before_minutes} onChange={e => updateForm({ buffer_before_minutes: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Buffer After (min)</label>
                <input type="number" className="input-field" value={form.buffer_after_minutes} onChange={e => updateForm({ buffer_after_minutes: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
          </div>
        )}

        {/* LOCATION */}
        {currentStepName === 'Location' && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Location</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {LOCATION_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => updateForm({ location_type: o.value })}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border-2 p-3 text-sm font-medium transition',
                      form.location_type === o.value ? 'border-blue-500 bg-blue-50/50 text-blue-700' : 'border-navy-100 text-navy-700 hover:border-navy-200'
                    )}
                  >
                    <o.icon className="h-4 w-4" />
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {form.location_type === 'custom' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Custom Location URL</label>
                <input className="input-field" value={form.location_url} onChange={e => updateForm({ location_url: e.target.value })} placeholder="https://..." />
              </div>
            )}
          </div>
        )}

        {/* AVAILABILITY */}
        {currentStepName === 'Availability' && (
          <div className="space-y-3">
            <p className="text-sm text-ivory-600">Set your weekly working hours. Click a day to toggle it on/off.</p>
            {DAYS.map((day, dayIdx) => {
              const intervals = availability[dayIdx] || [];
              const isActive = intervals.length > 0;
              return (
                <div key={dayIdx} className="flex items-center gap-3 flex-wrap">
                  <div className="w-28">
                    <button
                      onClick={() => {
                        const na = { ...availability };
                        if (isActive) na[dayIdx] = [];
                        else na[dayIdx] = [{ start: '09:00', end: '17:00' }];
                        setAvailability(na);
                      }}
                      className={cn('text-sm font-medium transition-colors', isActive ? 'text-navy-700' : 'text-ivory-500')}
                    >
                      {isActive && <span className="mr-1.5 text-blue-500">●</span>}
                      {day}
                    </button>
                  </div>
                  {isActive && (
                    <div className="flex items-center gap-2 flex-1 flex-wrap">
                      {intervals.map((interval, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="time"
                            className="input-field py-1.5 text-sm"
                            value={interval.start}
                            onChange={e => { const na = { ...availability }; na[dayIdx][i].start = e.target.value; setAvailability(na); }}
                          />
                          <span className="text-ivory-400">—</span>
                          <input
                            type="time"
                            className="input-field py-1.5 text-sm"
                            value={interval.end}
                            onChange={e => { const na = { ...availability }; na[dayIdx][i].end = e.target.value; setAvailability(na); }}
                          />
                          {intervals.length > 1 && (
                            <button
                              onClick={() => { const na = { ...availability }; na[dayIdx].splice(i, 1); setAvailability(na); }}
                              className="text-ivory-400 hover:text-burgundy-600"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => { const na = { ...availability }; na[dayIdx].push({ start: '13:00', end: '17:00' }); setAvailability(na); }}
                        className="text-sm font-medium text-blue-600 hover:text-blue-500"
                      >
                        + Add
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* DATE & TIME (event only) */}
        {currentStepName === 'Date & Time' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Event Date</label>
                <input type="date" className="input-field" onChange={() => updateForm({} as Partial<WizardForm>)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Timezone</label>
                <TimezoneSelect value={form.timezone} onChange={tz => updateForm({ timezone: tz })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">Start Time</label>
                <input type="time" className="input-field" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-navy-700">End Time</label>
                <input type="time" className="input-field" />
              </div>
            </div>
            <p className="text-xs text-ivory-500">Event date and time are set when scheduling individual events from this calendar.</p>
          </div>
        )}

        {/* CAPACITY */}
        {currentStepName === 'Capacity' && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Attendee Capacity</label>
              <input
                type="number"
                className="input-field"
                value={form.capacity}
                onChange={e => updateForm({ capacity: parseInt(e.target.value) || 1 })}
                min={1}
              />
              <p className="mt-1 text-xs text-ivory-500">Maximum number of participants who can register.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Max Bookings Per Day</label>
              <input type="number" className="input-field" placeholder="No limit" />
            </div>
          </div>
        )}

        {/* CALENDARS (group calendar) */}
        {currentStepName === 'Calendars' && (
          <div className="space-y-3">
            <p className="text-sm text-ivory-600">
              Select existing calendars to include in this group. The group calendar will produce one booking URL where visitors can choose from these calendars.
            </p>
            {existingCalendars.length === 0 ? (
              <p className="text-sm text-ivory-500">No non-group calendars found. Create individual calendars first.</p>
            ) : (
              <div className="space-y-2">
                {existingCalendars.map(cal => {
                  const selected = form.selectedGroupCalendars.has(cal.id);
                  return (
                    <button
                      key={cal.id}
                      onClick={() => toggleGroupCalendar(cal.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition',
                        selected ? 'border-blue-500 bg-blue-50/50' : 'border-navy-100 hover:border-navy-200'
                      )}
                    >
                      <span className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-md border-2 transition',
                        selected ? 'border-blue-600 bg-blue-600' : 'border-navy-200'
                      )}>
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cal.color ?? '#3b82f6' }} />
                      <span className="text-sm font-medium text-navy-700">{cal.name}</span>
                      <span className="ml-auto text-xs text-ivory-500">/book/{cal.slug}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* FORM */}
        {currentStepName === 'Form' && (
          <div className="space-y-3">
            <label className="mb-1.5 block text-sm font-medium text-navy-700">Booking Form</label>
            <div className="space-y-2">
              <button
                onClick={() => updateForm({ connected_form_id: '' })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition',
                  !form.connected_form_id ? 'border-blue-500 bg-blue-50/50' : 'border-navy-100 hover:border-navy-200'
                )}
              >
                <FileText className="h-4 w-4 text-ivory-500" />
                <span className="text-sm font-medium text-navy-700">Default form (name & email)</span>
              </button>
              {forms.map(f => (
                <button
                  key={f.id}
                  onClick={() => updateForm({ connected_form_id: f.id })}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition',
                    form.connected_form_id === f.id ? 'border-blue-500 bg-blue-50/50' : 'border-navy-100 hover:border-navy-200'
                  )}
                >
                  <FileText className="h-4 w-4 text-ivory-500" />
                  <span className="text-sm font-medium text-navy-700">{f.name}</span>
                  <span className={cn('ml-auto text-xs', f.status === 'active' ? 'text-green-600' : 'text-ivory-500')}>{f.status}</span>
                </button>
              ))}
              <button
                className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-navy-200 p-3 text-left transition hover:border-navy-300"
              >
                <Plus className="h-4 w-4 text-ivory-500" />
                <span className="text-sm font-medium text-ivory-600">Create new form</span>
              </button>
            </div>
          </div>
        )}

        {/* NOTIFICATIONS */}
        {currentStepName === 'Notifications' && (
          <div className="space-y-3">
            <p className="text-sm text-ivory-600">Choose how attendees and hosts are notified of bookings.</p>
            {([
              { key: 'email' as const, icon: Mail, label: 'Email', desc: 'Send booking confirmation and updates via email' },
              { key: 'sms' as const, icon: MessageSquare, label: 'SMS', desc: 'Send text message notifications' },
              { key: 'in_app' as const, icon: Bell, label: 'In-app', desc: 'Show notifications within SYNAPSE' },
            ]).map(n => (
              <button
                key={n.key}
                onClick={() => updateForm({ notifications: { ...form.notifications, [n.key]: !form.notifications[n.key] } })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition',
                  form.notifications[n.key] ? 'border-blue-500 bg-blue-50/50' : 'border-navy-100 hover:border-navy-200'
                )}
              >
                <n.icon className="h-5 w-5 text-navy-600" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-navy-800">{n.label}</p>
                  <p className="text-xs text-ivory-600">{n.desc}</p>
                </div>
                <span className={cn(
                  'relative h-6 w-11 rounded-full transition',
                  form.notifications[n.key] ? 'bg-blue-600' : 'bg-navy-200'
                )}>
                  <span className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition',
                    form.notifications[n.key] ? 'left-5' : 'left-0.5'
                  )} />
                </span>
              </button>
            ))}
          </div>
        )}

        {/* REMINDERS */}
        {currentStepName === 'Reminders' && (
          <div className="space-y-3">
            <p className="text-sm text-ivory-600">Configure when reminders are sent before appointments.</p>
            {form.reminders.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm text-ivory-600">Send</span>
                <input
                  type="number"
                  className="input-field w-20 py-1.5"
                  value={r.value}
                  onChange={e => {
                    const next = [...form.reminders];
                    next[i] = { ...next[i], value: e.target.value };
                    updateForm({ reminders: next });
                  }}
                />
                <select
                  className="input-field py-1.5"
                  value={r.unit}
                  onChange={e => {
                    const next = [...form.reminders];
                    next[i] = { ...next[i], unit: e.target.value as 'minutes' | 'hours' | 'days' };
                    updateForm({ reminders: next });
                  }}
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                <span className="text-sm text-ivory-600">before</span>
                {form.reminders.length > 1 && (
                  <button
                    onClick={() => updateForm({ reminders: form.reminders.filter((_, idx) => idx !== i) })}
                    className="text-ivory-400 hover:text-burgundy-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => updateForm({ reminders: [...form.reminders, { value: '1', unit: 'hours' }] })}
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              + Add reminder
            </button>
          </div>
        )}

        {/* PAYMENT */}
        {currentStepName === 'Payment' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border-2 border-navy-100 p-4">
              <CreditCard className="h-5 w-5 text-navy-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-navy-800">Require Payment</p>
                <p className="text-xs text-ivory-600">Charge participants at the time of booking</p>
              </div>
              <span className={cn(
                'relative h-6 w-11 rounded-full transition',
                form.price ? 'bg-blue-600' : 'bg-navy-200'
              )}>
                <button
                  onClick={() => updateForm({ price: form.price ? '' : '50' })}
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition',
                    form.price ? 'left-5' : 'left-0.5'
                  )}
                />
              </span>
            </div>
            {form.price && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-navy-700">Price</label>
                  <input
                    type="number"
                    className="input-field"
                    value={form.price}
                    onChange={e => updateForm({ price: e.target.value })}
                    placeholder="50.00"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-navy-700">Currency</label>
                  <select
                    className="input-field"
                    value={form.currency}
                    onChange={e => updateForm({ currency: e.target.value })}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="NGN">NGN (₦)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* APPEARANCE */}
        {currentStepName === 'Appearance' && (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Calendar Color</label>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => updateForm({ color: c })}
                    className={cn('h-8 w-8 rounded-lg border-2 transition', form.color === c ? 'border-navy-800 scale-110' : 'border-transparent')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-navy-700">Booking Flow</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => updateForm({ booking_flow: 'calendar_first' })}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border-2 p-3 text-sm font-medium transition',
                    form.booking_flow === 'calendar_first' ? 'border-blue-500 bg-blue-50/50 text-blue-700' : 'border-navy-100 text-navy-700 hover:border-navy-200'
                  )}
                >
                  <CalendarIcon className="h-4 w-4" />
                  Calendar first
                </button>
                <button
                  onClick={() => updateForm({ booking_flow: 'form_first' })}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border-2 p-3 text-sm font-medium transition',
                    form.booking_flow === 'form_first' ? 'border-blue-500 bg-blue-50/50 text-blue-700' : 'border-navy-100 text-navy-700 hover:border-navy-200'
                  )}
                >
                  <FileText className="h-4 w-4" />
                  Form first
                </button>
              </div>
            </div>
          </div>
        )}

        {/* REVIEW */}
        {currentStepName === 'Review' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-ivory-50 p-4">
              <h3 className="mb-3 text-sm font-bold text-navy-800">Review & Publish</h3>
              <div className="space-y-2">
                <ReviewRow label="Name" value={form.name} />
                <ReviewRow label="Type" value={CALENDAR_TYPE_OPTIONS.find(t => t.value === form.calendar_type)?.label ?? form.calendar_type} />
                <ReviewRow label="Slug" value={`/book/${form.slug || slugify(form.name)}`} />
                {form.description && <ReviewRow label="Description" value={form.description} />}
                {form.calendar_type !== 'group' && (
                  <>
                    <ReviewRow label="Duration" value={`${getDuration()} min`} />
                    <ReviewRow label="Location" value={LOCATION_OPTIONS.find(l => l.value === form.location_type)?.label ?? form.location_type} />
                    <ReviewRow label="Hosts" value={`${form.selectedHosts.size} host${form.selectedHosts.size !== 1 ? 's' : ''}`} />
                    <ReviewRow label="Available Days" value={`${Object.values(availability).filter(v => v.length > 0).length} days`} />
                    {form.calendar_type === 'round_robin' && (
                      <ReviewRow label="Strategy" value={STRATEGIES.find(s => s.value === form.round_robin_strategy)?.label ?? form.round_robin_strategy} />
                    )}
                    {form.calendar_type === 'event' && (
                      <ReviewRow label="Capacity" value={`${form.capacity}`} />
                    )}
                    {form.calendar_type === 'service' && form.price && (
                      <ReviewRow label="Price" value={`${form.currency} ${form.price}`} />
                    )}
                  </>
                )}
                {form.calendar_type === 'group' && (
                  <ReviewRow label="Included Calendars" value={`${form.selectedGroupCalendars.size} calendar${form.selectedGroupCalendars.size !== 1 ? 's' : ''}`} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => {
            if (step === 1) { setTypeSelected(false); setStep(0); }
            else setStep(step - 1);
          }}
          className="btn-secondary"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        {isLastStep ? (
          <button
            onClick={handleCreate}
            disabled={creating || !form.name}
            className="btn-primary"
          >
            {creating ? (
              <>
                <Clock className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Create Calendar
              </>
            )}
          </button>
        ) : (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="btn-primary"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </Modal>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-sm text-ivory-600">{label}</span>
      <span className="text-right text-sm font-medium text-navy-700">{value}</span>
    </div>
  );
}
