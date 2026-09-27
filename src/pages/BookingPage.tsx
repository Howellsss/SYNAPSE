import { useEffect, useState, useRef } from 'react';
import {
  Calendar as CalendarIcon, Clock, Video, Phone, MapPin, ChevronLeft, ChevronRight,
  CheckCircle2, Globe, AlertCircle, Loader2, CalendarPlus, RotateCcw, XCircle, User,
  ArrowRight, Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SchedulingEngine, type TimeSlot } from '@/lib/scheduling';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { cn, formatTimeInZone, formatDateInZone } from '@/lib/utils';
import { WorkflowEngine } from '@/lib/workflow-engine';
import { PastorToluBookingPage } from '@/pages/PastorToluBookingPage';
import { PublicGroupCalendarPage } from '@/components/calendar/PublicGroupCalendarPage';
import { mergeGroupPageConfig, type GroupPageConfig } from '@/lib/group-page-config';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { deserializeDefinition } from '@/lib/form-definition';
import type { FormDefinition } from '@/lib/form-builder-types';
import {
  resolveBookingForm,
  validateForm,
  evaluateConditions,
  extractContactInfo,
  DEFAULT_BOOKING_FIELDS,
  type ResolvedForm,
} from '@/lib/booking-form';
import type {
  Calendar as CalendarType,
  FormField,
  FormFieldCondition,
  Contact,
  Appointment,
} from '@/types';

const CALENDAR_TYPE_LABELS: Record<string, string> = {
  one_on_one: 'Personal',
  group: 'Group',
  round_robin: 'Round Robin',
  collective: 'Collective',
  event: 'Event',
  service: 'Service',
};

const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'Pacific/Auckland',
];

function isLightColor(color: string): boolean {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return true;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 160;
}

function getTimezoneOptions(currentTz: string): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    const set = new Set([...COMMON_TIMEZONES, ...all]);
    if (currentTz && !set.has(currentTz)) set.add(currentTz);
    return [...set].sort();
  } catch {
    return [...COMMON_TIMEZONES].sort();
  }
}

function convertDefinitionToFormFields(def: FormDefinition): FormField[] {
  const fields: FormField[] = [];
  for (const el of Object.values(def.elements)) {
    if (!el.field) continue;
    const f = el.field;
    fields.push({
      id: f.fieldId,
      label: f.label,
      field_type: el.type,
      required: f.required,
      placeholder: f.placeholder ?? null,
      help_text: f.description ?? null,
      default_value: f.defaultValue ?? null,
      options: f.options ?? null,
      sort_order: el.sortOrder,
      mapped_field: f.mappedContactField,
      conditions: [],
    } as FormField);
  }
  return fields.sort((a, b) => a.sort_order - b.sort_order);
}

function convertAnswersToFormData(def: FormDefinition, answers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const el of Object.values(def.elements)) {
    if (!el.field) continue;
    const val = answers[el.field.fieldId];
    if (val !== undefined) {
      result[el.field.label] = val;
    }
  }
  return result;
}

type BookingStep =
  | 'loading'
  | 'select'
  | 'host'
  | 'date'
  | 'time'
  | 'form'
  | 'confirming'
  | 'confirmed'
  | 'error'
  | 'notfound'
  | 'disqualified'
  | 'inactive';

interface HostInfo {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export function BookingPage({ slug, isGroup }: { slug: string; isGroup: boolean }) {
  // Pastor Tolu group gets a custom 4-tab booking interface
  if (isGroup && slug === 'pastor-tolu') {
    return <PastorToluBookingPage />;
  }

  const [step, setStep] = useState<BookingStep>('loading');
  const [calendar, setCalendar] = useState<CalendarType | null>(null);
  const [calendars, setCalendars] = useState<CalendarType[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [viewMonth, setViewMonth] = useState(new Date());
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [resolvedForm, setResolvedForm] = useState<ResolvedForm | null>(null);
  const [allFields, setAllFields] = useState<FormField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disqualifyMessage, setDisqualifyMessage] = useState<string | null>(null);
  const [confirmedAppt, setConfirmedAppt] = useState<{
    appointmentId: string;
    title: string;
    date: string;
    time: string;
    timezone: string;
    hostName: string;
    locationType: string;
    locationUrl: string | null;
    meetingLink: string | null;
    calendarName: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const [visitorTz, setVisitorTz] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [lockId, setLockId] = useState<string | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [groupMeta, setGroupMeta] = useState<{
    id: string;
    name: string;
    description: string | null;
    primary_color: string;
    background_color: string;
    button_color: string;
    logo_url: string | null;
    cover_url: string | null;
    font_family: string;
    layout: 'grid' | 'list';
  } | null>(null);
  const [groupPageConfig, setGroupPageConfig] = useState<GroupPageConfig>(mergeGroupPageConfig(null));
  const [groupSearch, setGroupSearch] = useState('');
  const [groupCategory, setGroupCategory] = useState('all');
  const [isEmbed, setIsEmbed] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [formDefinition, setFormDefinition] = useState<FormDefinition | null>(null);
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  const [formMeta, setFormMeta] = useState<{ name: string; description: string | null } | null>(null);
  const [formCurrentPage, setFormCurrentPage] = useState(0);

  useEffect(() => {
    if (lockId) {
      return () => {
        SchedulingEngine.releaseLock(lockId);
        if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      };
    }
  }, [lockId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === 'inline' || params.get('embed') === 'popup' || params.get('embed') === 'button') {
      setIsEmbed(true);
    }
  }, []);

  useEffect(() => {
    if (isGroup) {
      loadGroup(slug);
    } else {
      loadCalendar(slug);
    }
  }, [slug, isGroup]);

  async function loadGroup(groupSlug: string) {
    try {
      const { data: group } = await supabase
        .from('calendar_groups')
        .select('*, calendar_group_members(calendar_id, calendars(*))')
        .eq('slug', groupSlug)
        .eq('is_active', true)
        .maybeSingle();

      if (!group) {
        setStep('notfound');
        return;
      }

      const groupData = group as unknown as {
        id: string;
        name: string;
        description: string | null;
        connected_form_id: string | null;
        booking_flow: 'calendar_first' | 'form_first';
        primary_color: string;
        background_color: string;
        button_color: string;
        logo_url: string | null;
        cover_url: string | null;
        font_family: string;
        layout: 'grid' | 'list';
        page_config?: unknown;
        calendar_group_members: { calendars: CalendarType }[];
      };

      setGroupMeta({
        id: groupData.id,
        name: groupData.name,
        description: groupData.description,
        primary_color: groupData.primary_color ?? '#E4A93C',
        background_color: groupData.background_color ?? '#09132b',
        button_color: groupData.button_color ?? '#E4A93C',
        logo_url: groupData.logo_url,
        cover_url: groupData.cover_url,
        font_family: groupData.font_family ?? 'Inter',
        layout: groupData.layout ?? 'grid',
      });
      setGroupPageConfig(mergeGroupPageConfig(groupData.page_config));

      const cals = (groupData.calendar_group_members ?? [])
        .map(m => m.calendars)
        .filter((cal): cal is CalendarType => Boolean(cal) && cal.status === 'active');
      setCalendars(cals);

      if (cals.length > 0) {
        await selectGroupCalendar(cals[0], groupData.id);
      } else {
        setStep('select');
      }
      try {
        await supabase.from('calendar_group_analytics').insert({
          group_id: groupData.id,
          event_type: 'page_view',
        });
      } catch { /* non-critical */ }
    } catch (err) {
      console.error('[BookingPage] loadGroup error:', err);
      setStep('notfound');
    }
  }

  async function selectGroupCalendar(cal: CalendarType, groupId?: string) {
    setCalendar(cal);
    setSelectedHostId(null);
    setHosts([]);
    setAllFields([]);
    setFormData({});
    setFormErrors({});
    setSlots([]);
    setSelectedSlot(null);
    setConfirmedAppt(null);
    setError(null);
    setFormDefinition(null);
    setFormAnswers({});
    setFormMeta(null);
    setFormCurrentPage(0);

    if (groupId ?? groupMeta?.id) {
      try {
        await supabase.from('calendar_group_analytics').insert({
          group_id: groupId ?? groupMeta!.id,
          calendar_id: cal.id,
          event_type: 'calendar_selected',
        });
      } catch { /* non-critical */ }
    }

    let loadedHosts: HostInfo[] = [];
    if (cal.calendar_type === 'round_robin' || cal.calendar_type === 'collective') {
      try {
        const { data: hostRows } = await supabase
          .from('calendar_hosts')
          .select('user_id, is_primary, priority')
          .eq('calendar_id', cal.id)
          .order('priority');
        const hostUserIds = (hostRows ?? []).map(h => h.user_id);
        if (hostUserIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id, first_name, last_name, avatar_url')
            .in('user_id', hostUserIds);
          const hostMap = new Map((profiles ?? []).map(p => [p.user_id, p]));
          loadedHosts = (hostRows ?? []).map((host, index) => {
            const profile = hostMap.get(host.user_id);
            if (profile) return { ...profile, email: null } as HostInfo;
            return {
              user_id: host.user_id,
              first_name: `Team member ${index + 1}`,
              last_name: null,
              email: null,
              avatar_url: null,
            } as HostInfo;
          });
          setHosts(loadedHosts);
        }
      } catch { /* non-critical */ }
    }

    try {
      let customFields: FormField[] = [];
      if (cal.connected_form_id) {
        const { data: fields } = await supabase
          .from('form_fields')
          .select('*')
          .eq('form_id', cal.connected_form_id)
          .order('sort_order');
        customFields = (fields ?? []) as FormField[];

        if (customFields.length > 0) {
          const fieldIds = customFields.map(f => f.id);
          const { data: conditions } = await supabase
            .from('form_field_conditions')
            .select('*')
            .in('form_field_id', fieldIds)
            .order('sort_order');
          const conditionsMap = new Map<string, FormFieldCondition[]>();
          for (const c of (conditions ?? []) as FormFieldCondition[]) {
            const existing = conditionsMap.get(c.form_field_id) ?? [];
            existing.push(c);
            conditionsMap.set(c.form_field_id, existing);
          }
          customFields = customFields.map(f => ({
            ...f,
            conditions: conditionsMap.get(f.id) ?? [],
          }));
        }
        // Load visual form builder definition
        const { data: formRow } = await supabase
          .from('forms')
          .select('definition, name, description')
          .eq('id', cal.connected_form_id)
          .maybeSingle();
        if (formRow?.definition) {
          const def = deserializeDefinition(formRow.definition);
          if (def) {
            setFormDefinition(def);
            setFormMeta({ name: formRow.name, description: formRow.description });
            if (Object.keys(def.elements).length > 0) {
              customFields = convertDefinitionToFormFields(def);
            }
          }
        }
      }
      const resolved = resolveBookingForm(cal, customFields);
      setResolvedForm(resolved);
      setAllFields(resolved.fields);
    } catch { /* non-critical */ }

    if (cal.booking_flow === 'form_first') {
      setStep('form');
    } else if ((cal.calendar_type === 'round_robin' || cal.calendar_type === 'collective') && loadedHosts.length > 0) {
      setStep('host');
    } else {
      setStep('date');
    }
  }

  async function loadCalendar(calSlug: string) {
    try {
      // Validate one-time link token if present
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      if (token) {
        const { data: link, error: linkError } = await supabase
          .from('booking_links')
          .select('link_type, max_uses, use_count, expires_at, used_at')
          .eq('token', token)
          .maybeSingle();
        if (linkError || !link) {
          setTokenError('This booking link is invalid.');
          setStep('notfound');
          return;
        }
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
          setTokenError('This booking link has expired.');
          setStep('notfound');
          return;
        }
        if (link.link_type === 'one_time' && link.max_uses !== null && link.use_count >= link.max_uses) {
          setTokenError('This one-time booking link has already been used.');
          setStep('notfound');
          return;
        }
      }

      const { data: cals, error: calError } = await supabase
        .from('calendars')
        .select('*')
        .eq('slug', calSlug)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      if (calError || !cals || cals.length === 0) {
        // Check if calendar exists but is inactive/archived
        const { data: anyCals } = await supabase
          .from('calendars')
          .select('status')
          .eq('slug', calSlug)
          .order('created_at', { ascending: false })
          .limit(1);
        if (anyCals && anyCals.length > 0) {
          setStep('inactive');
          return;
        }
        console.error('[BookingPage] Calendar lookup failed:', calError?.message ?? 'no rows');
        setStep('notfound');
        return;
      }

      const calData = cals[0] as CalendarType;
    setCalendar(calData);

    let loadedHosts: HostInfo[] = hosts;

    if (calData.calendar_type === 'round_robin' || calData.calendar_type === 'collective') {
      const { data: hostRows } = await supabase
        .from('calendar_hosts')
        .select('user_id, is_primary, priority')
        .eq('calendar_id', calData.id)
        .order('priority');
      const hostUserIds = (hostRows ?? []).map(h => h.user_id);
      if (hostUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, first_name, last_name, avatar_url')
          .in('user_id', hostUserIds);
        const hostMap = new Map((profiles ?? []).map(p => [p.user_id, p]));
        const ordered = (hostRows ?? []).map((host, index) => {
          const profile = hostMap.get(host.user_id);
          if (profile) {
            return { ...profile, email: null } as HostInfo;
          }
          return {
            user_id: host.user_id,
            first_name: `Team member ${index + 1}`,
            last_name: null,
            email: null,
            avatar_url: null,
          } as HostInfo;
        });
        setHosts(ordered);
        loadedHosts = ordered;
      }
    }

    let customFields: FormField[] = [];
    if (calData.connected_form_id) {
      const { data: fields } = await supabase
        .from('form_fields')
        .select('*')
        .eq('form_id', calData.connected_form_id)
        .order('sort_order');
      customFields = (fields ?? []) as FormField[];

      if (customFields.length > 0) {
        const fieldIds = customFields.map(f => f.id);
        const { data: conditions } = await supabase
          .from('form_field_conditions')
          .select('*')
          .in('form_field_id', fieldIds)
          .order('sort_order');
        const conditionsMap = new Map<string, FormFieldCondition[]>();
        for (const c of (conditions ?? []) as FormFieldCondition[]) {
          const existing = conditionsMap.get(c.form_field_id) ?? [];
          existing.push(c);
          conditionsMap.set(c.form_field_id, existing);
        }
        customFields = customFields.map(f => ({
          ...f,
          conditions: conditionsMap.get(f.id) ?? [],
        }));
      }
      // Load visual form builder definition
      const { data: formRow } = await supabase
        .from('forms')
        .select('definition, name, description')
        .eq('id', calData.connected_form_id)
        .maybeSingle();
      if (formRow?.definition) {
        const def = deserializeDefinition(formRow.definition);
        if (def) {
          setFormDefinition(def);
          setFormMeta({ name: formRow.name, description: formRow.description });
          if (Object.keys(def.elements).length > 0) {
            customFields = convertDefinitionToFormFields(def);
          }
        }
      }
    }

    const resolved = resolveBookingForm(calData, customFields);
    setResolvedForm(resolved);
    setAllFields(resolved.fields);

    if (calData.booking_flow === 'form_first') {
      setStep('form');
    } else if ((calData.calendar_type === 'round_robin' || calData.calendar_type === 'collective') && loadedHosts.length > 0) {
      setStep('host');
    } else {
      setStep('date');
    }
    } catch (err) {
      console.error('[BookingPage] loadCalendar error:', err);
      setStep('notfound');
    }
  }

  async function loadSlots(date: Date) {
    if (!calendar) return;
    setLoadingSlots(true);
    setSelectedDate(date);

    const dateRange = {
      start: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      end: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59),
    };

    const availableSlots = await SchedulingEngine.getAvailableSlots(calendar, dateRange, visitorTz);

    if (selectedHostId && availableSlots.length > 0) {
      const filtered = availableSlots.filter(slot =>
        !slot.hostIds || slot.hostIds.includes(selectedHostId)
      );
      setSlots(filtered);
    } else {
      setSlots(availableSlots);
    }
    setLoadingSlots(false);
  }

  async function reserveSelectedSlot(slot: TimeSlot): Promise<boolean> {
    if (!calendar) return false;

    if (lockId) {
      await SchedulingEngine.releaseLock(lockId);
      setLockId(null);
    }
    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current);
      lockTimerRef.current = null;
    }

    const result = await SchedulingEngine.reserveSlot(
      calendar.id,
      calendar.workspace_id ?? null,
      slot.start,
      slot.end,
      crypto.randomUUID(),
      undefined,
      calendar.owner_id ?? null,
    );

    if (result.success && result.lockId) {
      setLockId(result.lockId);
      lockTimerRef.current = setInterval(async () => {
        if (result.lockId) {
          await SchedulingEngine.releaseLock(result.lockId);
        }
        setLockId(null);
        setStep('time');
        setError('This appointment time is no longer available.');
        setStep('error');
        if (lockTimerRef.current) {
          clearInterval(lockTimerRef.current);
          lockTimerRef.current = null;
        }
      }, 270000);
      return true;
    }

    setError(result.error ?? 'This time was just booked. Please select another time.');
    return false;
  }

  async function handleSlotSelect(slot: TimeSlot) {
    setSelectedSlot(slot);
    const reserved = await reserveSelectedSlot(slot);
    if (!reserved) {
      setStep('error');
      return;
    }

    if (calendar?.booking_flow === 'form_first') {
      await handleBooking(slot);
    } else {
      setStep('form');
    }
  }

  async function handleBooking(slot?: TimeSlot) {
    const effectiveSlot = slot ?? selectedSlot;
    if (!calendar) return;

    const visibleFields = getVisibleFields();
    const validation = validateForm(visibleFields, formData);
    if (!validation.valid) {
      setFormErrors(validation.errors);
      setStep('form');
      return;
    }

    const conditionResult = evaluateConditions(allFields, formData);
    if (conditionResult.disqualified) {
      setDisqualifyMessage(conditionResult.disqualifyMessage);
      setStep('disqualified');
      if (lockId) {
        await SchedulingEngine.releaseLock(lockId);
        setLockId(null);
      }
      return;
    }

    if (conditionResult.redirectUrl) {
      window.location.href = conditionResult.redirectUrl;
      return;
    }

    if (!effectiveSlot) {
      if (isGroup && !calendar && calendars.length > 0) {
        setStep('select');
        return;
      }
      if (calendar?.booking_flow === 'form_first') {
        if (hosts.length > 0) {
          setStep('host');
        } else {
          setStep('date');
        }
        return;
      }
      return;
    }

    setStep('confirming');
    setError(null);

    try {
      const slotCheck = await SchedulingEngine.checkSlot(
        calendar.id,
        effectiveSlot.start,
        effectiveSlot.end,
        selectedHostId ?? undefined,
      );

      if (!slotCheck.available) {
        if (lockId) {
          await SchedulingEngine.releaseLock(lockId);
          setLockId(null);
        }
        setError(slotCheck.reason ?? 'This time is no longer available.');
        setStep('error');
        return;
      }

      const hostId = slotCheck.hostId ?? selectedHostId;
      const contactInfo = extractContactInfo(allFields, formData);

      let contactId: string | null = null;
      if (contactInfo.email) {
        let contactLookup = supabase
          .from('contacts')
          .select('id')
          .eq('email', contactInfo.email);
        if (calendar.workspace_id) contactLookup = contactLookup.eq('workspace_id', calendar.workspace_id);
        else if (calendar.owner_id) contactLookup = contactLookup.eq('owner_id', calendar.owner_id);
        const { data: existing } = await contactLookup.maybeSingle();

        if (existing) {
          contactId = existing.id;
          await supabase.from('contacts').update({
            first_name: contactInfo.first_name || null,
            last_name: contactInfo.last_name || null,
            phone: contactInfo.phone || null,
            last_activity_at: new Date().toISOString(),
          }).eq('id', existing.id);
        }
      }

      if (!contactId) {
        const contactInsert: Record<string, unknown> = {
          first_name: contactInfo.first_name || null,
          last_name: contactInfo.last_name || null,
          email: contactInfo.email || null,
          phone: contactInfo.phone || null,
          source: 'booking_page',
        };
        if (calendar.workspace_id) contactInsert.workspace_id = calendar.workspace_id;
        else if (calendar.owner_id) contactInsert.owner_id = calendar.owner_id;
        const { data: newContact } = await supabase.from('contacts').insert(contactInsert).select().single();
        contactId = newContact?.id ?? null;
      }

      if (!contactId) {
        setError('Could not create contact record.');
        setStep('error');
        return;
      }

      const apptInsert: Record<string, unknown> = {
        calendar_id: calendar.id,
        contact_id: contactId,
        host_id: hostId,
        title: `${contactInfo.first_name} ${contactInfo.last_name} — ${calendar.name}`.trim(),
        status: 'confirmed',
        start_time: effectiveSlot.start.toISOString(),
        end_time: effectiveSlot.end.toISOString(),
        timezone: visitorTz,
        location_type: calendar.location_type,
      };
      if (calendar.workspace_id) apptInsert.workspace_id = calendar.workspace_id;
      else if (calendar.owner_id) apptInsert.owner_id = calendar.owner_id;
      const { data: appt, error: apptError } = await supabase.from('appointments').insert(apptInsert).select().single();

      if (apptError || !appt) {
        setError('Could not create appointment. The time may have been booked by someone else.');
        setStep('error');
        return;
      }

      try {
        if (resolvedForm?.formId) {
          const subInsert: Record<string, unknown> = {
            form_id: resolvedForm.formId,
            contact_id: contactId,
            appointment_id: appt.id,
            answers: formData,
            source: 'booking_page',
          };
          if (calendar.workspace_id) subInsert.workspace_id = calendar.workspace_id;
          else if (calendar.owner_id) subInsert.owner_id = calendar.owner_id;
          await supabase.from('form_submissions').insert(subInsert);
        }
      } catch { /* non-critical */ }

      try {
        await WorkflowEngine.trigger(calendar.workspace_id ?? null, 'appointment_booked', {
          contact: { id: contactId, first_name: contactInfo.first_name, last_name: contactInfo.last_name, email: contactInfo.email, phone: contactInfo.phone } as Partial<Contact> as Contact,
          appointment: { id: appt.id, title: appt.title, start_time: appt.start_time, meeting_link: appt.meeting_link } as Partial<Appointment> as Appointment,
        });
      } catch { /* non-critical */ }

      // Audit log
      try {
        const auditInsert: Record<string, unknown> = {
          action: 'appointment_booked',
          entity_type: 'appointment',
          entity_id: appt.id,
          details: { calendar_name: calendar.name, contact_email: contactInfo.email, start_time: appt.start_time },
        };
        if (calendar.workspace_id) auditInsert.workspace_id = calendar.workspace_id;
        if (calendar.owner_id) auditInsert.user_id = calendar.owner_id;
        await supabase.from('audit_logs').insert(auditInsert);
      } catch { /* non-critical */ }

      try {
        const msgInsert: Record<string, unknown> = {
          contact_id: contactId,
          appointment_id: appt.id,
          channel: 'email',
          subject: `Confirmation: ${calendar.name}`,
          body: `Hi ${contactInfo.first_name},\n\nYour appointment is confirmed!\n\nDate: ${formatDateInZone(effectiveSlot.start, visitorTz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\nTime: ${formatTimeInZone(effectiveSlot.start, visitorTz)} (${visitorTz})\nDuration: ${calendar.duration_minutes} minutes\n\nWe look forward to seeing you.\n\n— SYNAPSE`,
          status: 'queued',
        };
        if (calendar.workspace_id) msgInsert.workspace_id = calendar.workspace_id;
        else if (calendar.owner_id) msgInsert.owner_id = calendar.owner_id;
        await supabase.from('messages').insert(msgInsert);
      } catch { /* non-critical */ }

      let hostName = 'Your host';
      if (hostId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('user_id', hostId)
          .maybeSingle();
        if (profile) {
          hostName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Your host';
        }
      }

      setConfirmedAppt({
        appointmentId: appt.id,
        title: appt.title,
        date: formatDateInZone(effectiveSlot.start, visitorTz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        time: formatTimeInZone(effectiveSlot.start, visitorTz),
        timezone: visitorTz,
        hostName,
        locationType: calendar.location_type,
        locationUrl: calendar.location_url,
        meetingLink: appt.meeting_link,
        calendarName: calendar.name,
        startTime: effectiveSlot.start.toISOString(),
        endTime: effectiveSlot.end.toISOString(),
      });
      setStep('confirmed');

      // Atomically claim one-time link if present
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      if (token) {
        try {
          await supabase.rpc('claim_booking_link', { p_token: token });
        } catch { /* non-critical — booking already succeeded */ }
      }
    } catch {
      setError('Something went wrong while booking. Please try again.');
      setStep('error');
    }
  }

  function getVisibleFields(): FormField[] {
    if (allFields.length === 0) return [];
    const conditionResult = evaluateConditions(allFields, formData);
    return allFields.filter(f => conditionResult.visibleFields.has(f.id));
  }

  function handleFormChange(label: string, value: string) {
    setFormData(prev => ({ ...prev, [label]: value }));
    setFormErrors(prev => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }

  function handleFormAnswerChange(fieldId: string, value: string) {
    setFormAnswers(prev => ({ ...prev, [fieldId]: value }));
  }

  async function handleFormFirstSubmit() {
    if (!formDefinition || !calendar) return;
    const converted = convertAnswersToFormData(formDefinition, formAnswers);
    setFormData(converted);
    const conditionResult = evaluateConditions(allFields, converted);
    const visibleFields = allFields.filter(f => conditionResult.visibleFields.has(f.id));
    const validation = validateForm(visibleFields, converted);
    if (!validation.valid) {
      setFormErrors(validation.errors);
      return;
    }
    if (conditionResult.disqualified) {
      setDisqualifyMessage(conditionResult.disqualifyMessage);
      setStep('disqualified');
      return;
    }
    if (conditionResult.redirectUrl) {
      window.location.href = conditionResult.redirectUrl;
      return;
    }
    if (hosts.length > 0) {
      setStep('host');
    } else {
      setStep('date');
    }
  }

  async function handleCancelBooking(appointmentId: string) {
    await SchedulingEngine.cancelBooking(appointmentId, 'Cancelled by visitor');
    try {
      await WorkflowEngine.trigger(calendar?.workspace_id ?? null, 'appointment_cancelled', {
        appointment: { id: appointmentId } as Partial<Appointment> as Appointment,
      });
    } catch { /* non-critical */ }
    try {
      const auditInsert: Record<string, unknown> = {
        action: 'appointment_cancelled',
        entity_type: 'appointment',
        entity_id: appointmentId,
        details: { calendar_name: calendar?.name },
      };
      if (calendar?.workspace_id) auditInsert.workspace_id = calendar.workspace_id;
      if (calendar?.owner_id) auditInsert.user_id = calendar.owner_id;
      await supabase.from('audit_logs').insert(auditInsert);
    } catch { /* non-critical */ }
    setStep('date');
    setConfirmedAppt(null);
  }

  const locationIcon = calendar?.location_type === 'synapse_meeting' ? <Video className="w-4 h-4" />
    : calendar?.location_type === 'phone' ? <Phone className="w-4 h-4" />
    : calendar?.location_type === 'in_person' ? <MapPin className="w-4 h-4" />
    : <Video className="w-4 h-4" />;

  const locationLabel = calendar?.location_type === 'synapse_meeting' ? 'SYNAPSE Meeting'
    : calendar?.location_type === 'phone' ? 'Phone Call'
    : calendar?.location_type === 'in_person' ? 'In Person'
    : (calendar?.location_type ?? '').replace('_', ' ');

  // ---------- GROUP RENDER (all steps wrapped in PublicGroupCalendarPage) ----------
  if (isGroup && groupMeta && step !== 'loading' && step !== 'notfound' && step !== 'inactive') {
    // Inside the group page the form sits in the editorial right panel: drop its own title (the
    // left panel already shows it), outer card, background and padding.
    const editorialFormDefinition = formDefinition ? {
      ...formDefinition,
      header: { ...formDefinition.header, enabled: false },
      theme: {
        ...formDefinition.theme,
        layoutPreset: 'full_width' as const,
        background: { ...formDefinition.theme.background, type: 'solid' as const, color: 'transparent' },
        colors: { ...formDefinition.theme.colors, surfaceBackground: 'transparent' },
        layout: { ...formDefinition.theme.layout, pagePadding: 0 },
      },
    } : null;

    const groupRightPanel = (
      <>
        {step === 'select' && calendars.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-gray-500">This booking page doesn't have any calendars available yet.</p>
          </div>
        )}
        {step === 'form' && calendar && formDefinition && editorialFormDefinition && (
          <div className="gcal-form">
          <FormRenderer
            definition={editorialFormDefinition}
            formName={formMeta?.name ?? calendar.name}
            formDescription={formMeta?.description ?? null}
            currentPageIndex={formCurrentPage}
            currentPage={formCurrentPage}
            totalPages={formDefinition.pages.length}
            answers={formAnswers}
            onAnswerChange={handleFormAnswerChange}
            onNext={() => setFormCurrentPage(p => Math.min(p + 1, formDefinition.pages.length - 1))}
            onPrevious={() => setFormCurrentPage(p => Math.max(p - 1, 0))}
            onSubmit={handleFormFirstSubmit}
          />
          </div>
        )}
        {step === 'form' && calendar && !formDefinition && (
          <div>
            {/* Form-first shows just the fields (the left panel carries the heading); after a slot is picked, show what's being booked. */}
            <div className={cn('flex items-center gap-3 mb-6', !selectedSlot && 'hidden')}>
              {calendar.booking_flow === 'calendar_first' && selectedSlot && (
                <button onClick={() => setStep('time')} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <div>
                <h2 className="text-xl font-bold text-gray-900">Your details</h2>
                <p className="text-sm text-gray-500">
                  {selectedSlot
                    ? `${formatDateInZone(selectedSlot.start, visitorTz, { weekday: 'long', month: 'long', day: 'numeric' })} at ${formatTimeInZone(selectedSlot.start, visitorTz)}`
                    : 'Fill in your information to continue'}
                </p>
              </div>
              {lockId && (
                <span className="ml-auto text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5" /> Slot reserved
                </span>
              )}
            </div>
            <FormFields fields={getVisibleFields()} formData={formData} formErrors={formErrors} onChange={handleFormChange} />
            <button onClick={() => handleBooking()} className="gcal-btn mt-8">
              {calendar.booking_flow === 'form_first' ? (<>Check Availability <ArrowRight className="w-4 h-4" /></>) : (<>Confirm Booking <CheckCircle2 className="w-4 h-4" /></>)}
            </button>
          </div>
        )}
        {step === 'host' && calendar && hosts.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Select a team member</h2>
            <p className="text-sm text-gray-500 mb-6">Choose who you'd like to meet with.</p>
            <div className="space-y-3">
              <button onClick={() => { setSelectedHostId(null); setStep('date'); }} className={cn('w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left', selectedHostId === null ? 'border-gray-800 bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')}>
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"><User className="w-6 h-6 text-gray-500" /></div>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-800">Any available member</p><p className="text-xs text-gray-500">We'll match you with the best fit</p></div>
                {selectedHostId === null && <CheckCircle2 className="w-5 h-5 text-gray-800" />}
              </button>
              {hosts.map(host => {
                const name = `${host.first_name ?? ''} ${host.last_name ?? ''}`.trim() || 'Team Member';
                const initials = (host.first_name?.[0] ?? '') + (host.last_name?.[0] ?? '');
                return (
                  <button key={host.user_id} onClick={() => { setSelectedHostId(host.user_id); setStep('date'); }} className={cn('w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left', selectedHostId === host.user_id ? 'border-gray-800 bg-gray-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50')}>
                    {host.avatar_url ? <img src={host.avatar_url} alt={name} className="w-12 h-12 rounded-full object-cover" /> : <div className="w-12 h-12 rounded-full bg-gray-800 text-white flex items-center justify-center text-sm font-semibold">{initials || '?'}</div>}
                    <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-800">{name}</p></div>
                    {selectedHostId === host.user_id && <CheckCircle2 className="w-5 h-5 text-gray-800" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {step === 'host' && calendar && hosts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20"><Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" /><p className="text-sm text-gray-500">Loading team members...</p></div>
        )}
        {step === 'date' && calendar && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">Select a date</h2>
            <p className="text-sm text-gray-500 mb-6">Click on an available date to see time slots.</p>
            <CalendarGrid month={viewMonth} calendar={calendar} onSelect={(date) => { loadSlots(date); setStep('time'); }} onMonthChange={setViewMonth} />
          </div>
        )}
        {step === 'time' && calendar && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => hosts.length > 0 ? setStep('host') : setStep('date')} className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Select a time</h2>
                <p className="text-sm text-gray-500">{selectedDate && formatDateInZone(selectedDate, visitorTz, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              </div>
            </div>
            {loadingSlots ? (
              <div className="flex flex-col items-center justify-center py-16"><Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" /><p className="text-sm text-gray-500">Finding available times...</p></div>
            ) : slots.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4"><Clock className="w-8 h-8 text-gray-400" /></div>
                <p className="text-sm font-medium text-gray-800 mb-1">No available times on this date</p>
                <p className="text-sm text-gray-500 mb-5">Try selecting another date.</p>
                <button onClick={() => setStep('date')} className="btn-primary">Choose another date</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1">
                {slots.map((slot, i) => (
                  <button key={i} onClick={() => handleSlotSelect(slot)} className={cn('px-4 py-3.5 rounded-xl text-sm font-semibold transition-all', selectedSlot?.start.getTime() === slot.start.getTime() ? 'bg-gray-800 text-white shadow-lg' : 'bg-gray-50 text-gray-700 border-2 border-gray-200 hover:border-gray-800 hover:bg-gray-100')}>
                    {formatTimeInZone(slot.start, visitorTz)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {step === 'confirming' && (
          <div className="flex flex-col items-center justify-center py-20"><Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" /><p className="text-sm font-medium text-gray-800">Confirming your booking...</p><p className="text-xs text-gray-500 mt-1">This will only take a moment.</p></div>
        )}
        {step === 'confirmed' && confirmedAppt && (
          <ConfirmationView appt={confirmedAppt} customMessage={calendar?.custom_confirmation_message ?? null} customRedirectUrl={calendar?.custom_redirect_url ?? null} onCancel={handleCancelBooking} />
        )}
        {step === 'disqualified' && (
          <div className="text-center py-10">
            <div className="w-20 h-20 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5"><AlertCircle className="w-10 h-10 text-amber-600" /></div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Booking not available</h1>
            <p className="text-sm text-gray-600 mb-8">{disqualifyMessage ?? 'You do not meet the requirements for this booking.'}</p>
            <button onClick={() => hosts.length > 0 ? setStep('host') : setStep('date')} className="btn-primary">Back to calendar</button>
          </div>
        )}
        {step === 'error' && (
          <div className="text-center py-10">
            <div className="w-20 h-20 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5"><AlertCircle className="w-10 h-10 text-red-600" /></div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Booking failed</h1>
            <p className="text-sm text-gray-600 mb-8">{error ?? 'Please try again.'}</p>
            <button onClick={() => { hosts.length > 0 ? setStep('host') : setStep('date'); setError(null); }} className="btn-primary">View available times</button>
          </div>
        )}
      </>
    );

    const rightLabel = step === 'form' ? 'Your Details' : step === 'date' ? 'Select a Date' : step === 'time' ? 'Select a Time' : step === 'host' ? 'Choose Host' : step === 'confirmed' ? 'Confirmed' : undefined;

    return (
      <PublicGroupCalendarPage
        config={groupPageConfig}
        groupName={groupMeta.name}
        groupDescription={groupMeta.description}
        calendars={calendars}
        selectedCalendarId={calendar?.id ?? null}
        onSelectCalendar={(cal) => selectGroupCalendar(cal)}
        visitorTz={visitorTz}
        onVisitorTzChange={setVisitorTz}
        rightPanelLabel={rightLabel}
      >
        {groupRightPanel}
      </PublicGroupCalendarPage>
    );
  }

  // ---------- LOADING ----------
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gold-400 animate-spin" />
      </div>
    );
  }

  // ---------- INACTIVE ----------
  if (step === 'inactive') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <HowellsLogo className="w-8 h-8 mb-4 text-navy-800" />
        <h1 className="text-xl font-bold text-navy-800 mb-2">Calendar currently unavailable</h1>
        <p className="text-sm text-ivory-600 text-center max-w-sm">This booking page is currently unavailable. Please check back later or contact the host directly.</p>
      </div>
    );
  }

  // ---------- NOT FOUND ----------
  if (step === 'notfound') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
        <HowellsLogo className="w-8 h-8 mb-4 text-navy-800" />
        <h1 className="text-xl font-bold text-navy-800 mb-2">{tokenError ?? 'Calendar not found'}</h1>
        {!tokenError && <p className="text-sm text-ivory-600">This booking link may be invalid or the calendar is no longer available.</p>}
      </div>
    );
  }

  // ---------- MAIN BOOKING LAYOUT ----------
  const showLeftPanel = step !== 'confirmed' && step !== 'error' && step !== 'disqualified' && calendar;

  const calColor = calendar?.color ?? '#E4A93C';
  const calBg = calendar?.background_color ?? '#09132b';
  const calFont = calendar?.font_family ?? 'Inter';
  const calButton = calendar?.button_color ?? calColor;
  const calLogo = calendar?.logo_url ?? null;
  const calCover = calendar?.cover_url ?? null;
  const isLightBg = isLightColor(calBg);
  const bgText = isLightBg ? '#1a1a1a' : '#fff';
  const bgMuted = isLightBg ? '#6b6b6b' : 'rgba(255,255,255,0.5)';
  const bgBorder = isLightBg ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)';
  const bgCardBg = isLightBg ? '#fff' : 'rgba(255,255,255,0.05)';

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: calBg, fontFamily: calFont }}>
      {/* Header */}
      {!isEmbed && (
        <header className="border-b px-6 py-4 flex items-center gap-2.5" style={{ borderColor: bgBorder, backgroundColor: calBg }}>
          {calLogo ? (
            <img src={calLogo} alt="" className="w-6 h-6 rounded-lg object-cover" />
          ) : (
            <span style={{ color: calColor }}><HowellsLogo className="w-5 h-5" /></span>
          )}
          <span className="text-lg font-bold" style={{ color: bgText }}>SYNAPSE</span>
        </header>
      )}

      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-5xl">
          {showLeftPanel ? (
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 lg:gap-8">
              {/* Left: Calendar info panel */}
              <div className="border rounded-3xl p-8 flex flex-col relative overflow-hidden" style={{ borderColor: bgBorder, backgroundColor: bgCardBg }}>
                {calCover && (
                  <div className="absolute top-0 left-0 right-0 h-32 overflow-hidden">
                    <img src={calCover} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  </div>
                )}
                <div className="flex-1" style={{ position: 'relative', zIndex: 1, paddingTop: calCover ? '8rem' : 0 }}>
                  <div className="flex items-center gap-3 mb-2">
                    {calLogo && <img src={calLogo} alt="" className="w-10 h-10 rounded-xl object-cover" />}
                    <h1 className="text-3xl font-bold" style={{ color: calColor, fontFamily: calFont }}>{calendar!.name}</h1>
                  </div>
                  {calendar!.description && (
                    <p className="text-sm mb-6 leading-relaxed" style={{ color: bgMuted }}>{calendar!.description}</p>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center gap-3" style={{ color: bgText }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${calColor}20` }}>
                        <Clock className="w-5 h-5" style={{ color: calColor }} />
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide" style={{ color: bgMuted }}>Duration</p>
                        <p className="text-sm font-medium">{calendar!.duration_minutes} minutes</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3" style={{ color: bgText }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${calColor}20` }}>
                        {locationIcon}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide" style={{ color: bgMuted }}>Location</p>
                        <p className="text-sm font-medium capitalize">{locationLabel}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3" style={{ color: bgText }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${calColor}20` }}>
                        <User className="w-5 h-5" style={{ color: calColor }} />
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide" style={{ color: bgMuted }}>Type</p>
                        <p className="text-sm font-medium">{CALENDAR_TYPE_LABELS[calendar!.calendar_type] ?? calendar!.calendar_type}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timezone selector */}
                <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${bgBorder}` }}>
                  <div className="flex items-center gap-2" style={{ color: bgMuted }}>
                    <Globe className="w-4 h-4" style={{ color: calColor }} />
                    <select
                      value={visitorTz}
                      onChange={(e) => setVisitorTz(e.target.value)}
                      className="bg-transparent text-sm border-none cursor-pointer focus:outline-none"
                      style={{ color: bgText }}
                    >
                      {getTimezoneOptions(visitorTz).map((tz: string) => <option key={tz} value={tz} className="bg-white text-navy-800">{tz}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Right: Booking steps */}
              <div className="bg-white rounded-3xl shadow-2xl overflow-hidden min-h-[520px] flex flex-col">
                {/* Step indicator */}
                <div className="flex items-center gap-2 px-8 pt-6 pb-2">
                  <StepIndicator step={step} />
                </div>

                <div className="flex-1 px-8 pb-8 pt-4 overflow-y-auto">
                  {/* Host selection */}
                  {step === 'host' && calendar && hosts.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-navy-800 mb-1">Select a team member</h2>
                      <p className="text-sm text-ivory-600 mb-6">Choose who you'd like to meet with.</p>
                      <div className="space-y-3">
                        <button
                          onClick={() => { setSelectedHostId(null); setStep('date'); }}
                          className={cn(
                            'w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left',
                            selectedHostId === null
                              ? 'border-navy-800 bg-navy-50'
                              : 'border-navy-100 hover:border-navy-300 hover:bg-ivory-50'
                          )}
                        >
                          <div className="w-12 h-12 rounded-full bg-ivory-100 flex items-center justify-center">
                            <User className="w-6 h-6 text-ivory-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-navy-800">Any available member</p>
                            <p className="text-xs text-ivory-500">We'll match you with the best fit</p>
                          </div>
                          {selectedHostId === null && <CheckCircle2 className="w-5 h-5 text-navy-800" />}
                        </button>
                        {hosts.map(host => {
                          const name = `${host.first_name ?? ''} ${host.last_name ?? ''}`.trim() || 'Team Member';
                          const initials = (host.first_name?.[0] ?? '') + (host.last_name?.[0] ?? '');
                          return (
                            <button
                              key={host.user_id}
                              onClick={() => { setSelectedHostId(host.user_id); setStep('date'); }}
                              className={cn(
                                'w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left',
                                selectedHostId === host.user_id
                                  ? 'border-navy-800 bg-navy-50'
                                  : 'border-navy-100 hover:border-navy-300 hover:bg-ivory-50'
                              )}
                            >
                              {host.avatar_url ? (
                                <img src={host.avatar_url} alt={name} className="w-12 h-12 rounded-full object-cover" />
                              ) : (
                                <div className="w-12 h-12 rounded-full bg-navy-800 text-white flex items-center justify-center text-sm font-semibold">
                                  {initials || '?'}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-navy-800">{name}</p>
                                {host.first_name && <p className="text-xs text-ivory-500 truncate">{host.first_name}</p>}
                              </div>
                              {selectedHostId === host.user_id && <CheckCircle2 className="w-5 h-5 text-navy-800" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Host selection loading / fallback */}
                  {step === 'host' && calendar && hosts.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20">
                      <Loader2 className="w-8 h-8 text-gold-500 animate-spin mb-3" />
                      <p className="text-sm text-ivory-600">Loading team members...</p>
                    </div>
                  )}

                  {/* Date selection */}
                  {step === 'date' && calendar && (
                    <div>
                      <h2 className="text-xl font-bold text-navy-800 mb-1">Select a date</h2>
                      <p className="text-sm text-ivory-600 mb-6">Click on an available date to see time slots.</p>
                      <CalendarGrid
                        month={viewMonth}
                        calendar={calendar}
                        onSelect={(date) => { loadSlots(date); setStep('time'); }}
                        onMonthChange={setViewMonth}
                      />
                    </div>
                  )}

                  {/* Time selection */}
                  {step === 'time' && calendar && (
                    <div>
                      <div className="flex items-center gap-3 mb-6">
                        <button
                          onClick={() => hosts.length > 0 ? setStep('host') : setStep('date')}
                          className="w-9 h-9 rounded-xl bg-ivory-100 hover:bg-ivory-200 flex items-center justify-center text-navy-700 transition-colors"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div>
                          <h2 className="text-xl font-bold text-navy-800">Select a time</h2>
                          <p className="text-sm text-ivory-600">
                            {selectedDate && formatDateInZone(selectedDate, visitorTz, { weekday: 'long', month: 'long', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      {loadingSlots ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <Loader2 className="w-8 h-8 text-gold-500 animate-spin mb-3" />
                          <p className="text-sm text-ivory-600">Finding available times...</p>
                        </div>
                      ) : slots.length === 0 ? (
                        <div className="text-center py-16">
                          <div className="w-16 h-16 rounded-2xl bg-ivory-100 flex items-center justify-center mx-auto mb-4">
                            <Clock className="w-8 h-8 text-ivory-400" />
                          </div>
                          <p className="text-sm font-medium text-navy-800 mb-1">No available times on this date</p>
                          <p className="text-sm text-ivory-500 mb-5">Try selecting another date.</p>
                          <button onClick={() => setStep('date')} className="btn-primary">Choose another date</button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1">
                          {slots.map((slot, i) => (
                            <button
                              key={i}
                              onClick={() => handleSlotSelect(slot)}
                              className={cn(
                                'px-4 py-3.5 rounded-xl text-sm font-semibold transition-all',
                                selectedSlot?.start.getTime() === slot.start.getTime()
                                  ? 'bg-navy-800 text-white shadow-lg'
                                  : 'bg-ivory-50 text-navy-700 border-2 border-navy-100 hover:border-navy-800 hover:bg-navy-50'
                              )}
                            >
                              {formatTimeInZone(slot.start, visitorTz)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Form / Details */}
                  {step === 'form' && calendar && formDefinition && (
                    <FormRenderer
                      definition={formDefinition}
                      formName={formMeta?.name ?? calendar.name}
                      formDescription={formMeta?.description ?? null}
                      currentPageIndex={formCurrentPage}
                      currentPage={formCurrentPage}
                      totalPages={formDefinition.pages.length}
                      answers={formAnswers}
                      onAnswerChange={handleFormAnswerChange}
                      onNext={() => setFormCurrentPage(p => Math.min(p + 1, formDefinition.pages.length - 1))}
                      onPrevious={() => setFormCurrentPage(p => Math.max(p - 1, 0))}
                      onSubmit={handleFormFirstSubmit}
                    />
                  )}
                  {step === 'form' && calendar && !formDefinition && (
                    <div>
                      <div className="flex items-center gap-3 mb-6">
                        {calendar.booking_flow === 'calendar_first' && selectedSlot && (
                          <button
                            onClick={() => setStep('time')}
                            className="w-9 h-9 rounded-xl bg-ivory-100 hover:bg-ivory-200 flex items-center justify-center text-navy-700 transition-colors"
                          >
                            <ChevronLeft className="w-5 h-5" />
                          </button>
                        )}
                        <div>
                          <h2 className="text-xl font-bold text-navy-800">Your details</h2>
                          <p className="text-sm text-ivory-600">
                            {selectedSlot
                              ? `${formatDateInZone(selectedSlot.start, visitorTz, { weekday: 'long', month: 'long', day: 'numeric' })} at ${formatTimeInZone(selectedSlot.start, visitorTz)}`
                              : 'Fill in your information to continue'
                            }
                          </p>
                        </div>
                        {lockId && (
                          <span className="ml-auto text-xs text-gold-700 bg-gold-50 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium">
                            <Clock className="w-3.5 h-3.5" />
                            Slot reserved
                          </span>
                        )}
                      </div>
                      <FormFields
                        fields={getVisibleFields()}
                        formData={formData}
                        formErrors={formErrors}
                        onChange={handleFormChange}
                      />
                      <button
                        onClick={() => handleBooking()}
                        className="w-full mt-6 text-white py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-lg hover:opacity-90"
                        style={{ backgroundColor: calButton }}
                      >
                        {calendar.booking_flow === 'form_first' ? (
                          <>Check Availability <ArrowRight className="w-4 h-4" /></>
                        ) : (
                          <>Confirm Booking <CheckCircle2 className="w-4 h-4" /></>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Confirming */}
                  {step === 'confirming' && (
                    <div className="flex flex-col items-center justify-center py-20">
                      <Loader2 className="w-10 h-10 text-gold-500 animate-spin mb-4" />
                      <p className="text-sm font-medium text-navy-800">Confirming your booking...</p>
                      <p className="text-xs text-ivory-500 mt-1">This will only take a moment.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Full-width views for confirmed / error / disqualified */
            <div className="max-w-lg mx-auto">
              {step === 'confirmed' && confirmedAppt && (
                <ConfirmationView
                  appt={confirmedAppt}
                  customMessage={calendar?.custom_confirmation_message ?? null}
                  customRedirectUrl={calendar?.custom_redirect_url ?? null}
                  onCancel={handleCancelBooking}
                />
              )}

              {step === 'disqualified' && (
                <div className="bg-white rounded-3xl shadow-2xl p-10 text-center">
                  <div className="w-20 h-20 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5">
                    <AlertCircle className="w-10 h-10 text-amber-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-navy-800 mb-3">Booking not available</h1>
                  <p className="text-sm text-ivory-600 mb-8">{disqualifyMessage ?? 'You do not meet the requirements for this booking.'}</p>
                  <button onClick={() => hosts.length > 0 ? setStep('host') : setStep('date')} className="btn-primary">Back to calendar</button>
                </div>
              )}

              {step === 'error' && (
                <div className="bg-white rounded-3xl shadow-2xl p-10 text-center">
                  <div className="w-20 h-20 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5">
                    <AlertCircle className="w-10 h-10 text-red-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-navy-800 mb-3">Booking failed</h1>
                  <p className="text-sm text-ivory-600 mb-8">{error ?? 'Please try again.'}</p>
                  <button onClick={() => { hosts.length > 0 ? setStep('host') : setStep('date'); setError(null); }} className="btn-primary">View available times</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// STEP INDICATOR
// ============================================================
function StepIndicator({ step }: { step: BookingStep }) {
  const steps: { key: string; label: string; active: boolean; done: boolean }[] = [
    { key: 'date', label: 'Date', active: step === 'date', done: ['time', 'form', 'confirming', 'confirmed'].includes(step) },
    { key: 'time', label: 'Time', active: step === 'time', done: ['form', 'confirming', 'confirmed'].includes(step) },
    { key: 'form', label: 'Details', active: step === 'form' || step === 'confirming', done: step === 'confirmed' },
  ];

  if (step === 'host') {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-7 h-7 rounded-full bg-navy-800 text-white flex items-center justify-center text-xs font-bold">1</span>
        <span className="font-medium text-navy-800">Choose host</span>
        <ChevronRight className="w-4 h-4 text-ivory-400" />
        <span className="w-7 h-7 rounded-full bg-ivory-100 text-ivory-400 flex items-center justify-center text-xs font-bold">2</span>
        <span className="text-ivory-400">Date</span>
        <ChevronRight className="w-4 h-4 text-ivory-400" />
        <span className="w-7 h-7 rounded-full bg-ivory-100 text-ivory-400 flex items-center justify-center text-xs font-bold">3</span>
        <span className="text-ivory-400">Time</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          {i > 0 && <ChevronRight className="w-4 h-4 text-ivory-300" />}
          <span className={cn(
            'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
            s.done ? 'bg-green-100 text-green-700' : s.active ? 'bg-navy-800 text-white' : 'bg-ivory-100 text-ivory-400'
          )}>
            {s.done ? '✓' : i + 1}
          </span>
          <span className={cn('font-medium', s.active ? 'text-navy-800' : s.done ? 'text-green-700' : 'text-ivory-400')}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// FORM FIELDS RENDERER
// ============================================================
function FormFields({
  fields,
  formData,
  formErrors,
  onChange,
  primaryColor = '#16233f',
}: {
  fields: FormField[];
  formData: Record<string, string>;
  formErrors: Record<string, string>;
  onChange: (label: string, value: string) => void;
  primaryColor?: string;
}) {
  return (
    <div className="space-y-4">
      {fields.map(field => {
        if (field.field_type === 'hidden') return null;
        const value = formData[field.label] ?? '';
        const error = formErrors[field.label];

        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-navy-800 mb-1.5">
              {field.label}{field.required && <span className="text-red-500"> *</span>}
            </label>
            {field.help_text && <p className="text-xs text-ivory-500 mb-2">{field.help_text}</p>}

            {field.field_type === 'long_text' ? (
              <textarea
                className="w-full px-4 py-3 rounded-xl border-2 border-navy-100 text-sm text-navy-800 placeholder-ivory-400 focus:border-navy-800 focus:outline-none transition-colors min-h-[100px] resize-y"
                value={value}
                onChange={(e) => onChange(field.label, e.target.value)}
                placeholder={field.placeholder ?? ''}
              />
            ) : field.field_type === 'dropdown' ? (
              <select
                className="w-full px-4 py-3 rounded-xl border-2 border-navy-100 text-sm text-navy-800 focus:border-navy-800 focus:outline-none transition-colors"
                value={value}
                onChange={(e) => onChange(field.label, e.target.value)}
              >
                <option value="">Select...</option>
                {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : field.field_type === 'radio' ? (
              <div className="space-y-2">
                {field.options?.map(opt => (
                  <label key={opt} className="flex items-center gap-2.5 text-sm text-navy-700 cursor-pointer">
                    <input
                      type="radio"
                      name={field.label}
                      value={opt}
                      checked={value === opt}
                      onChange={(e) => onChange(field.label, e.target.value)}
                      className="text-navy-800"
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ) : field.field_type === 'checkbox' ? (
              <div className="space-y-2">
                {field.options?.map(opt => {
                  const checked = value.split(',').includes(opt);
                  return (
                    <label key={opt} className="flex items-center gap-2.5 text-sm text-navy-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const vals = value ? value.split(',') : [];
                          const next = e.target.checked
                            ? [...vals, opt]
                            : vals.filter(v => v !== opt);
                          onChange(field.label, next.join(','));
                        }}
                        className="rounded text-navy-800"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            ) : field.field_type === 'multi_select' ? (
              <div className="space-y-2">
                {field.options?.map(opt => {
                  const checked = value.split(',').includes(opt);
                  return (
                    <label key={opt} className="flex items-center gap-2.5 text-sm text-navy-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const vals = value ? value.split(',') : [];
                          const next = e.target.checked
                            ? [...vals, opt]
                            : vals.filter(v => v !== opt);
                          onChange(field.label, next.join(','));
                        }}
                        className="rounded text-navy-800"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            ) : field.field_type === 'consent' ? (
              <label className="flex items-start gap-2.5 text-sm text-navy-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value === 'true'}
                  onChange={(e) => onChange(field.label, e.target.checked ? 'true' : '')}
                  className="rounded text-navy-800 mt-0.5"
                />
                <span>{field.placeholder ?? 'I agree to the terms'}</span>
              </label>
            ) : field.field_type === 'date' ? (
              <input
                type="date"
                className="w-full px-4 py-3 rounded-xl border-2 border-navy-100 text-sm text-navy-800 focus:border-navy-800 focus:outline-none transition-colors"
                value={value}
                onChange={(e) => onChange(field.label, e.target.value)}
              />
            ) : field.field_type === 'time' ? (
              <input
                type="time"
                className="w-full px-4 py-3 rounded-xl border-2 border-navy-100 text-sm text-navy-800 focus:border-navy-800 focus:outline-none transition-colors"
                value={value}
                onChange={(e) => onChange(field.label, e.target.value)}
              />
            ) : field.field_type === 'number' ? (
              <input
                type="number"
                className="w-full px-4 py-3 rounded-xl border-2 border-navy-100 text-sm text-navy-800 focus:border-navy-800 focus:outline-none transition-colors"
                value={value}
                onChange={(e) => onChange(field.label, e.target.value)}
                placeholder={field.placeholder ?? ''}
              />
            ) : field.field_type === 'file_upload' ? (
              <input
                type="file"
                className="w-full px-4 py-3 rounded-xl border-2 border-navy-100 text-sm text-navy-800 focus:border-navy-800 focus:outline-none transition-colors"
                onChange={(e) => onChange(field.label, e.target.files?.[0]?.name ?? '')}
              />
            ) : (
              <input
                type={field.field_type === 'email' ? 'email' : 'text'}
                className="w-full px-4 py-3 rounded-xl border-2 border-navy-100 text-sm text-navy-800 placeholder-ivory-400 focus:outline-none transition-colors"
                style={{ '--booking-accent': primaryColor } as React.CSSProperties}
                value={value}
                onChange={(e) => onChange(field.label, e.target.value)}
                placeholder={field.placeholder ?? ''}
              />
            )}
            {error && <p className="text-xs text-red-500 mt-1.5 font-medium">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// CONFIRMATION VIEW
// ============================================================
function ConfirmationView({
  appt,
  customMessage,
  customRedirectUrl,
  onCancel,
}: {
  appt: {
    appointmentId: string;
    title: string;
    date: string;
    time: string;
    timezone: string;
    hostName: string;
    locationType: string;
    locationUrl: string | null;
    meetingLink: string | null;
    calendarName: string;
    startTime: string;
    endTime: string;
  };
  customMessage: string | null;
  customRedirectUrl: string | null;
  onCancel: (id: string) => void;
}) {
  const locationLabel = appt.locationType === 'synapse_meeting' ? 'SYNAPSE Meeting'
    : appt.locationType === 'phone' ? 'Phone Call'
    : appt.locationType === 'in_person' ? 'In Person'
    : appt.locationType.replace('_', ' ');

  function addToCalendar() {
    const start = new Date(appt.startTime);
    const end = new Date(appt.endTime);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const title = encodeURIComponent(appt.calendarName);
    const details = encodeURIComponent(`Appointment with ${appt.hostName}`);
    const location = encodeURIComponent(appt.meetingLink ?? appt.locationUrl ?? locationLabel);
    const dates = `${fmt(start)}/${fmt(end)}`;
    window.open(
      `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`,
      '_blank',
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-2xl p-10 text-center">
      <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 className="w-10 h-10 text-green-600" />
      </div>
      <h1 className="text-3xl font-bold text-navy-800 mb-2">You're booked!</h1>
      <p className="text-sm text-ivory-600 mb-8">
        {customMessage ?? 'A confirmation email has been sent to you.'}
      </p>
      <div className="bg-ivory-50 rounded-2xl p-6 text-left space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-ivory-600">Calendar</span>
          <span className="text-sm font-medium text-navy-700">{appt.calendarName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-ivory-600">Appointment</span>
          <span className="text-sm font-medium text-navy-700">{appt.title}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-ivory-600">Date</span>
          <span className="text-sm font-medium text-navy-700">{appt.date}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-ivory-600">Time</span>
          <span className="text-sm font-medium text-navy-700">{appt.time}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-ivory-600">Timezone</span>
          <span className="text-sm font-medium text-navy-700">{appt.timezone}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-ivory-600">Host</span>
          <span className="text-sm font-medium text-navy-700">{appt.hostName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-ivory-600">Location</span>
          <span className="text-sm font-medium text-navy-700 capitalize">
            {appt.meetingLink ? (
              <a href={appt.meetingLink} target="_blank" rel="noopener noreferrer" className="text-gold-700 hover:text-gold-600">
                {locationLabel}
              </a>
            ) : appt.locationUrl ? (
              <a href={appt.locationUrl} target="_blank" rel="noopener noreferrer" className="text-gold-700 hover:text-gold-600">
                {locationLabel}
              </a>
            ) : (
              locationLabel
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-center mt-8">
        <button onClick={addToCalendar} className="btn-secondary btn-sm">
          <CalendarPlus className="w-4 h-4" />
          Add to Calendar
        </button>
        <button
          onClick={() => window.location.reload()}
          className="btn-secondary btn-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Reschedule
        </button>
        <button
          onClick={() => onCancel(appt.appointmentId)}
          className="btn-secondary btn-sm text-red-600"
        >
          <XCircle className="w-4 h-4" />
          Cancel
        </button>
      </div>

      {customRedirectUrl && (
        <p className="text-xs text-ivory-500 mt-6">
          <a href={customRedirectUrl} className="text-gold-700 hover:text-gold-600">Continue →</a>
        </p>
      )}
    </div>
  );
}

// ============================================================
// Calendar Grid
// ============================================================
function CalendarGrid({
  month,
  calendar,
  onSelect,
  onMonthChange,
}: {
  month: Date;
  calendar: CalendarType;
  onSelect: (date: Date) => void;
  onMonthChange: (date: Date) => void;
}) {
  const [availableDays, setAvailableDays] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAvailableDays();
  }, [month, calendar.id]);

  async function checkAvailableDays() {
    setLoading(true);
    const days = new Set<number>();
    const year = month.getFullYear();
    const mo = month.getMonth();
    const daysInMonth = new Date(year, mo + 1, 0).getDate();
    const now = new Date();
    const maxHorizon = new Date(now.getTime() + calendar.max_booking_horizon_days * 24 * 60 * 60 * 1000);

    const { data: rules } = await supabase
      .from('availability_rules')
      .select('day_of_week')
      .eq('calendar_id', calendar.id);
    const activeDays = new Set((rules ?? []).map(r => r.day_of_week));
    if (activeDays.size === 0) {
      [1, 2, 3, 4, 5].forEach(d => activeDays.add(d));
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, mo, d);
      if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) continue;
      if (date > maxHorizon) continue;
      if (activeDays.has(date.getDay())) {
        days.add(d);
      }
    }
    setAvailableDays(days);
    setLoading(false);
  }

  const year = month.getFullYear();
  const mo = month.getMonth();
  const firstDay = new Date(year, mo, 1).getDay();
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === mo && today.getFullYear() === year;

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => {
            const prev = new Date(month);
            prev.setMonth(prev.getMonth() - 1);
            onMonthChange(prev);
          }}
          className="w-10 h-10 rounded-xl bg-ivory-50 hover:bg-ivory-100 flex items-center justify-center text-navy-700 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-base font-semibold text-navy-800">
          {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          onClick={() => {
            const next = new Date(month);
            next.setMonth(next.getMonth() + 1);
            onMonthChange(next);
          }}
          className="w-10 h-10 rounded-xl bg-ivory-50 hover:bg-ivory-100 flex items-center justify-center text-navy-700 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-1.5 mb-2">
        {dayLabels.map((d, i) => (
          <div key={i} className="text-center text-xs font-semibold text-ivory-500 py-2">{d}</div>
        ))}
      </div>

      {/* Calendar days */}
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const date = new Date(year, mo, day);
          const isPast = isCurrentMonth && day < today.getDate();
          const isAvailable = availableDays.has(day) && !isPast;
          const isToday = isCurrentMonth && day === today.getDate();

          return (
            <button
              key={day}
              disabled={!isAvailable || loading}
              onClick={() => onSelect(date)}
              className={cn(
                'aspect-square rounded-xl text-sm font-medium transition-all relative',
                isAvailable && !loading
                  ? 'bg-ivory-50 text-navy-700 border-2 border-navy-100 hover:border-navy-800 hover:bg-navy-800 hover:text-white hover:scale-105 cursor-pointer'
                  : 'text-ivory-300 cursor-not-allowed',
                isToday && isAvailable && 'ring-2 ring-gold-400 ring-offset-1',
              )}
            >
              {day}
              {isAvailable && !loading && (
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gold-400" />
              )}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-gold-500 animate-spin" />
        </div>
      )}

      <div className="flex items-center gap-4 mt-5 text-xs text-ivory-500">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gold-400" />
          <span>Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-ivory-300" />
          <span>Unavailable</span>
        </div>
      </div>
    </div>
  );
}
