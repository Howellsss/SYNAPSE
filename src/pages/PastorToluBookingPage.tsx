import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Clock, ChevronLeft, ChevronRight, CheckCircle2,
  Loader2, CalendarPlus, RotateCcw, XCircle, User, ArrowRight,
  Mail, Building2, MessageSquare, Heart, AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SchedulingEngine, type TimeSlot } from '@/lib/scheduling';
import { cn, formatTimeInZone, formatDateInZone } from '@/lib/utils';
import { WorkflowEngine } from '@/lib/workflow-engine';
import type { Calendar as CalendarType, Contact, Appointment } from '@/types';

// ============================================================
// CONSTANTS
// ============================================================
const BURGUNDY = '#641D26';
const GOLD = '#E9AA32';
const NAVY = '#FFFFFF';
const WHITE = '#FFFFFF';
const DARK_TEXT = '#071A3D';
const MUTED_GRAY = '#8B8B8B';

const COUNSELING_CALENDAR_ID = 'a75500db-2323-4760-ae4f-d6ec515bbdb1';
const INVITE_FORM_ID = 'd1a00000-0000-4000-8000-000000000001';
const COUNSELING_FORM_ID = 'bb221ac5-b255-424f-a119-b9871bb8ed19';
const CORPORATE_FORM_ID = 'c7515303-0587-4923-b649-bf008abcc60e';
const GENERAL_CONTACT_FORM_ID = '11150458-7ab1-4fd5-9ecf-7be5cf0a76ce';
const WORKSPACE_ID = 'c505e65d-b276-499f-ba27-4cd4dcc4a184';

type TabKey = 'invite' | 'counseling' | 'corporate' | 'contact';

interface TabConfig {
  key: TabKey;
  number: string;
  label: string;
  icon: typeof User;
  headline: string;
  description: string;
  buttonLabel: string;
}

const TABS: TabConfig[] = [
  {
    key: 'invite',
    number: '01',
    label: 'INVITE PASTOR TOLU',
    icon: Mail,
    headline: 'Invite Pastor Tolu',
    description: 'Extend an invitation for Pastor Tolu to minister at your upcoming event, conference, or service.',
    buttonLabel: 'SUBMIT INVITATION',
  },
  {
    key: 'counseling',
    number: '02',
    label: 'COUNSELLING',
    icon: Heart,
    headline: 'Counselling',
    description: 'Book a private counselling session with Pastor Tolu. Select a time that works for you.',
    buttonLabel: 'CONFIRM BOOKING',
  },
  {
    key: 'corporate',
    number: '03',
    label: 'CORPORATE CONSULTING',
    icon: Building2,
    headline: 'Corporate Consulting',
    description: 'Request a corporate briefing for your organization, brand, or leadership team.',
    buttonLabel: 'REQUEST CORPORATE BRIEFING',
  },
  {
    key: 'contact',
    number: '04',
    label: 'GENERAL CONTACT',
    icon: MessageSquare,
    headline: 'General Contact',
    description: 'Have a question or message for Pastor Tolu? Reach out and we will get back to you.',
    buttonLabel: 'SEND MESSAGE',
  },
];


// ============================================================
// MAIN COMPONENT
// ============================================================
export function PastorToluBookingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('invite');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [visitorTz] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );

  // Counseling-specific state
  const [counselingCalendar, setCounselingCalendar] = useState<CalendarType | null>(null);
  const [viewMonth, setViewMonth] = useState(new Date());
  const [availableDays, setAvailableDays] = useState<Set<number>>(new Set());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [lockId, setLockId] = useState<string | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [confirmedAppt, setConfirmedAppt] = useState<{
    appointmentId: string;
    title: string;
    date: string;
    time: string;
    timezone: string;
    hostName: string;
    locationType: string;
    meetingLink: string | null;
    calendarName: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  // Form data for each tab
  const [inviteData, setInviteData] = useState<Record<string, string>>({});
  const [counselingData, setCounselingData] = useState<Record<string, string>>({});
  const [corporateData, setCorporateData] = useState<Record<string, string>>({});
  const [contactData, setContactData] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Load counseling calendar on mount
  useEffect(() => {
    loadCounselingCalendar();
  }, []);

  // Release lock on unmount
  useEffect(() => {
    if (lockId) {
      return () => {
        SchedulingEngine.releaseLock(lockId);
        if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      };
    }
  }, [lockId]);

  // Check available days when month changes
  useEffect(() => {
    if (counselingCalendar) {
      checkAvailableDays();
    }
  }, [viewMonth, counselingCalendar]);

  const loadCounselingCalendar = async () => {
    try {
      const { data: cal, error } = await supabase
        .from('calendars')
        .select('*')
        .eq('id', COUNSELING_CALENDAR_ID)
        .eq('status', 'active')
        .maybeSingle();
      if (error || !cal) {
        setCalendarLoading(false);
        return;
      }
      setCounselingCalendar(cal as CalendarType);
      setCalendarLoading(false);
    } catch {
      setCalendarLoading(false);
    }
  };

  const checkAvailableDays = async () => {
    if (!counselingCalendar) return;
    const days = new Set<number>();
    const year = viewMonth.getFullYear();
    const mo = viewMonth.getMonth();
    const daysInMonth = new Date(year, mo + 1, 0).getDate();
    const now = new Date();
    const maxHorizon = new Date(now.getTime() + counselingCalendar.max_booking_horizon_days * 24 * 60 * 60 * 1000);

    const { data: rules } = await supabase
      .from('availability_rules')
      .select('day_of_week')
      .eq('calendar_id', counselingCalendar.id);
    const activeDays = new Set((rules ?? []).map((r: { day_of_week: number }) => r.day_of_week));
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
  };

  const loadSlots = async (date: Date) => {
    if (!counselingCalendar) return;
    setLoadingSlots(true);
    setSelectedDate(date);

    const dateRange = {
      start: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      end: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59),
    };

    const availableSlots = await SchedulingEngine.getAvailableSlots(counselingCalendar, dateRange, visitorTz);
    setSlots(availableSlots);
    setLoadingSlots(false);
  };

  const handleSlotSelect = async (slot: TimeSlot) => {
    if (!counselingCalendar) return;
    setSelectedSlot(slot);

    // Release previous lock
    if (lockId) {
      await SchedulingEngine.releaseLock(lockId);
      setLockId(null);
    }
    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current);
      lockTimerRef.current = null;
    }

    const result = await SchedulingEngine.reserveSlot(
      counselingCalendar.id,
      counselingCalendar.workspace_id ?? null,
      slot.start,
      slot.end,
      crypto.randomUUID(),
      undefined,
      counselingCalendar.owner_id ?? null,
    );

    if (result.success && result.lockId) {
      setLockId(result.lockId);
      lockTimerRef.current = setInterval(async () => {
        if (result.lockId) {
          await SchedulingEngine.releaseLock(result.lockId);
        }
        setLockId(null);
        setSubmitError('This appointment time is no longer available.');
        setSubmitState('error');
        if (lockTimerRef.current) {
          clearInterval(lockTimerRef.current);
          lockTimerRef.current = null;
        }
      }, 270000);
    }
  };

  const validateField = (label: string, value: string, type: string, required: boolean): string | null => {
    if (required && !value.trim()) return `${label} is required`;
    if (!value.trim()) return null;
    if (type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) return 'Please enter a valid email address';
    }
    return null;
  };

  // ============================================================
  // CRM CONTACT UPSERT
  // ============================================================
  const upsertContact = async (email: string, firstName: string, lastName?: string, phone?: string): Promise<string | null> => {
    if (!email) return null;

    let contactId: string | null = null;
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', email)
      .eq('workspace_id', WORKSPACE_ID)
      .maybeSingle();

    if (existing) {
      contactId = existing.id;
      await supabase.from('contacts').update({
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phone || null,
        last_activity_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      const { data: newContact } = await supabase.from('contacts').insert({
        first_name: firstName || null,
        last_name: lastName || null,
        email,
        phone: phone || null,
        source: 'booking_page',
        workspace_id: WORKSPACE_ID,
      }).select().single();
      contactId = newContact?.id ?? null;
    }

    return contactId;
  };

  const saveFormSubmission = async (formId: string, contactId: string | null, answers: Record<string, string>, appointmentId?: string) => {
    try {
      await supabase.from('form_submissions').insert({
        form_id: formId,
        contact_id: contactId,
        appointment_id: appointmentId ?? null,
        answers,
        source: 'booking_page',
        workspace_id: WORKSPACE_ID,
      });
    } catch { /* non-critical */ }
  };

  // ============================================================
  // SUBMIT HANDLERS
  // ============================================================
  const handleInviteSubmit = async () => {
    const fields: { label: string; type: string; required: boolean }[] = [
      { label: 'Organisation/Church Name', type: 'text', required: true },
      { label: 'Contact Person Email', type: 'email', required: true },
      { label: 'Event Title', type: 'text', required: true },
      { label: 'Proposed Event Date', type: 'date', required: true },
      { label: 'Expected Attendance', type: 'dropdown', required: true },
      { label: 'Venue Physical Address', type: 'long_text', required: true },
      { label: 'Brief Event Overview', type: 'long_text', required: true },
    ];

    const errors: Record<string, string> = {};
    for (const f of fields) {
      const err = validateField(f.label, inviteData[f.label] ?? '', f.type, f.required);
      if (err) errors[f.label] = err;
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setSubmitState('submitting');

    try {
      const email = inviteData['Contact Person Email'] ?? '';
      const contactId = await upsertContact(email, inviteData['Organisation/Church Name'] ?? '');
      await saveFormSubmission(INVITE_FORM_ID, contactId, inviteData);
      setSubmitState('success');
    } catch {
      setSubmitError('Something went wrong. Please try again.');
      setSubmitState('error');
    }
  };

  const handleCounselingSubmit = async () => {
    const fields: { label: string; type: string; required: boolean }[] = [
      { label: 'Full Name', type: 'first_name', required: true },
      { label: 'Primary Contact Email', type: 'email', required: true },
      { label: 'Relationship Status', type: 'radio', required: true },
      { label: 'What Would You Like Guidance On?', type: 'long_text', required: true },
    ];

    const errors: Record<string, string> = {};
    for (const f of fields) {
      const err = validateField(f.label, counselingData[f.label] ?? '', f.type, f.required);
      if (err) errors[f.label] = err;
    }
    if (!selectedSlot) {
      errors['_slot'] = 'Please select an available time slot';
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setSubmitState('submitting');
    setSubmitError(null);

    try {
      if (!counselingCalendar || !selectedSlot) return;

      const slotCheck = await SchedulingEngine.checkSlot(
        counselingCalendar.id,
        selectedSlot.start,
        selectedSlot.end,
      );

      if (!slotCheck.available) {
        if (lockId) {
          await SchedulingEngine.releaseLock(lockId);
          setLockId(null);
        }
        setSubmitError(slotCheck.reason ?? 'This time is no longer available.');
        setSubmitState('error');
        return;
      }

      const email = counselingData['Primary Contact Email'] ?? '';
      const fullName = counselingData['Full Name'] ?? '';
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0] || fullName;
      const lastName = nameParts.slice(1).join(' ') || '';
      const contactId = await upsertContact(email, firstName, lastName);

      if (!contactId) {
        setSubmitError('Could not create contact record.');
        setSubmitState('error');
        return;
      }

      const hostId = slotCheck.hostId;
      const apptInsert: Record<string, unknown> = {
        calendar_id: counselingCalendar.id,
        contact_id: contactId,
        host_id: hostId,
        title: `${fullName} — ${counselingCalendar.name}`.trim(),
        status: 'confirmed',
        start_time: selectedSlot.start.toISOString(),
        end_time: selectedSlot.end.toISOString(),
        timezone: visitorTz,
        location_type: counselingCalendar.location_type,
        workspace_id: WORKSPACE_ID,
      };
      const { data: appt, error: apptError } = await supabase.from('appointments').insert(apptInsert).select().single();

      if (apptError || !appt) {
        setSubmitError('Could not create appointment. The time may have been booked.');
        setSubmitState('error');
        return;
      }

      await saveFormSubmission(COUNSELING_FORM_ID, contactId, counselingData, appt.id);

      try {
        await WorkflowEngine.trigger(WORKSPACE_ID, 'appointment_booked', {
          contact: { id: contactId, first_name: firstName, last_name: lastName, email } as Partial<Contact> as Contact,
          appointment: { id: appt.id, title: appt.title, start_time: appt.start_time, meeting_link: appt.meeting_link } as Partial<Appointment> as Appointment,
        });
      } catch { /* non-critical */ }

      try {
        await supabase.from('audit_logs').insert({
          action: 'appointment_booked',
          entity_type: 'appointment',
          entity_id: appt.id,
          workspace_id: WORKSPACE_ID,
          details: { calendar_name: counselingCalendar.name, contact_email: email, start_time: appt.start_time },
        });
      } catch { /* non-critical */ }

      try {
        await supabase.from('messages').insert({
          contact_id: contactId,
          appointment_id: appt.id,
          channel: 'email',
          subject: `Confirmation: ${counselingCalendar.name}`,
          body: `Hi ${firstName},\n\nYour counselling session is confirmed!\n\nDate: ${formatDateInZone(selectedSlot.start, visitorTz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\nTime: ${formatTimeInZone(selectedSlot.start, visitorTz)} (${visitorTz})\nDuration: ${counselingCalendar.duration_minutes} minutes\n\nWe look forward to seeing you.\n\n— Pastor Tolu's Team`,
          status: 'queued',
          workspace_id: WORKSPACE_ID,
        });
      } catch { /* non-critical */ }

      let hostName = 'Pastor Tolu';
      if (hostId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('user_id', hostId)
          .maybeSingle();
        if (profile) {
          hostName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Pastor Tolu';
        }
      }

      setConfirmedAppt({
        appointmentId: appt.id,
        title: appt.title,
        date: formatDateInZone(selectedSlot.start, visitorTz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        time: formatTimeInZone(selectedSlot.start, visitorTz),
        timezone: visitorTz,
        hostName,
        locationType: counselingCalendar.location_type,
        meetingLink: appt.meeting_link,
        calendarName: counselingCalendar.name,
        startTime: selectedSlot.start.toISOString(),
        endTime: selectedSlot.end.toISOString(),
      });
      setSubmitState('success');
    } catch {
      setSubmitError('Something went wrong while booking. Please try again.');
      setSubmitState('error');
    }
  };

  const handleCorporateSubmit = async () => {
    const fields: { label: string; type: string; required: boolean }[] = [
      { label: 'Company or Brand Name', type: 'text', required: true },
      { label: 'Industry', type: 'text', required: true },
      { label: 'Consultation Core Target', type: 'dropdown', required: true },
      { label: 'Message Details', type: 'long_text', required: true },
      { label: 'Contact Email', type: 'email', required: true },
    ];

    const errors: Record<string, string> = {};
    for (const f of fields) {
      const err = validateField(f.label, corporateData[f.label] ?? '', f.type, f.required);
      if (err) errors[f.label] = err;
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setSubmitState('submitting');

    try {
      const email = corporateData['Contact Email'] ?? '';
      const companyName = corporateData['Company or Brand Name'] ?? '';
      const contactId = await upsertContact(email, companyName);
      await saveFormSubmission(CORPORATE_FORM_ID, contactId, corporateData);
      setSubmitState('success');
    } catch {
      setSubmitError('Something went wrong. Please try again.');
      setSubmitState('error');
    }
  };

  const handleContactSubmit = async () => {
    const fields: { label: string; type: string; required: boolean }[] = [
      { label: 'Your Name', type: 'first_name', required: true },
      { label: 'Your Email', type: 'email', required: true },
      { label: 'Subject', type: 'text', required: true },
      { label: 'Message', type: 'long_text', required: true },
    ];

    const errors: Record<string, string> = {};
    for (const f of fields) {
      const err = validateField(f.label, contactData[f.label] ?? '', f.type, f.required);
      if (err) errors[f.label] = err;
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setSubmitState('submitting');

    try {
      const email = contactData['Your Email'] ?? '';
      const name = contactData['Your Name'] ?? '';
      const contactId = await upsertContact(email, name);
      await saveFormSubmission(GENERAL_CONTACT_FORM_ID, contactId, contactData);

      // Also save as a message
      try {
        await supabase.from('messages').insert({
          contact_id: contactId,
          channel: 'email',
          direction: 'inbound',
          subject: contactData['Subject'] ?? '',
          body: contactData['Message'] ?? '',
          status: 'queued',
          workspace_id: WORKSPACE_ID,
        });
      } catch { /* non-critical */ }

      setSubmitState('success');
    } catch {
      setSubmitError('Something went wrong. Please try again.');
      setSubmitState('error');
    }
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setSubmitState('idle');
    setSubmitError(null);
    setFormErrors({});
    setConfirmedAppt(null);
    if (tab !== 'counseling') {
      setSelectedSlot(null);
      setSelectedDate(null);
      setSlots([]);
    }
  };

  const handleCancelBooking = async (appointmentId: string) => {
    await SchedulingEngine.cancelBooking(appointmentId, 'Cancelled by visitor');
    try {
      await WorkflowEngine.trigger(WORKSPACE_ID, 'appointment_cancelled', {
        appointment: { id: appointmentId } as Partial<Appointment> as Appointment,
      });
    } catch { /* non-critical */ }
    setConfirmedAppt(null);
    setSubmitState('idle');
    setSelectedSlot(null);
    setSelectedDate(null);
    setSlots([]);
  };

  const activeTabConfig = TABS.find(t => t.key === activeTab)!;
  const setFormData = activeTab === 'invite' ? setInviteData
    : activeTab === 'counseling' ? setCounselingData
    : activeTab === 'corporate' ? setCorporateData
    : setContactData;

  const handleFieldChange = useCallback((label: string, value: string) => {
    setFormData(prev => ({ ...prev, [label]: value }));
    setFormErrors(prev => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }, [setFormData]);

  // ============================================================
  // RENDER
  // ============================================================

  if (submitState === 'success' && activeTab === 'counseling' && confirmedAppt) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: NAVY }}>
        <PastorToluHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white rounded-2xl shadow-2xl p-10 text-center">
            <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold mb-2" style={{ color: DARK_TEXT, fontFamily: 'Playfair Display, Georgia, serif' }}>You're booked!</h1>
            <p className="text-sm text-gray-500 mb-8">A confirmation email has been sent to you.</p>
            <div className="bg-gray-50 rounded-2xl p-6 text-left space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Appointment</span>
                <span className="text-sm font-medium" style={{ color: DARK_TEXT }}>{confirmedAppt.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Date</span>
                <span className="text-sm font-medium" style={{ color: DARK_TEXT }}>{confirmedAppt.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Time</span>
                <span className="text-sm font-medium" style={{ color: DARK_TEXT }}>{confirmedAppt.time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Timezone</span>
                <span className="text-sm font-medium" style={{ color: DARK_TEXT }}>{confirmedAppt.timezone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Host</span>
                <span className="text-sm font-medium" style={{ color: DARK_TEXT }}>{confirmedAppt.hostName}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 justify-center mt-8">
              <button onClick={() => {
                const start = new Date(confirmedAppt.startTime);
                const end = new Date(confirmedAppt.endTime);
                const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
                const title = encodeURIComponent(confirmedAppt.calendarName);
                const dates = `${fmt(start)}/${fmt(end)}`;
                window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}`, '_blank');
              }} className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-gray-50" style={{ borderColor: '#e0e0e0', color: DARK_TEXT }}>
                <CalendarPlus className="w-4 h-4 inline mr-1.5" /> Add to Calendar
              </button>
              <button onClick={() => handleTabChange('counseling')} className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-gray-50" style={{ borderColor: '#e0e0e0', color: DARK_TEXT }}>
                <RotateCcw className="w-4 h-4 inline mr-1.5" /> Book Another
              </button>
              <button onClick={() => handleCancelBooking(confirmedAppt.appointmentId)} className="px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 transition-colors hover:bg-red-50">
                <XCircle className="w-4 h-4 inline mr-1.5" /> Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (submitState === 'success' && activeTab !== 'counseling') {
    const successMessages: Record<TabKey, string> = {
      invite: 'Your invitation has been submitted successfully. We will review it and get back to you.',
      counseling: '',
      corporate: 'Your corporate briefing request has been submitted. We will be in touch shortly.',
      contact: 'Your message has been sent. We will get back to you as soon as possible.',
    };
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: NAVY }}>
        <PastorToluHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white rounded-2xl shadow-2xl p-10 text-center">
            <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold mb-3" style={{ color: DARK_TEXT, fontFamily: 'Playfair Display, Georgia, serif' }}>Thank you</h1>
            <p className="text-sm text-gray-500 mb-8">{successMessages[activeTab]}</p>
            <button
              onClick={() => handleTabChange(activeTab)}
              className="px-6 py-3 rounded-xl font-semibold text-sm text-white transition-all hover:opacity-90"
              style={{ backgroundColor: GOLD }}
            >
              Submit Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: NAVY }}>
      <PastorToluHeader />

      {/* Tab Navigation */}
      <nav className="border-b" style={{ borderColor: 'rgba(0,0,0,0.08)', backgroundColor: NAVY }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={cn(
                    'flex items-center gap-2.5 px-5 py-4 text-sm font-medium transition-all relative border-b-2',
                    isActive ? 'border-b-2' : 'border-b-2 border-transparent'
                  )}
                  style={{
                    color: isActive ? BURGUNDY : MUTED_GRAY,
                    borderBottomColor: isActive ? GOLD : 'transparent',
                    backgroundColor: isActive ? '#f5f5f5' : 'transparent',
                  }}
                >
                  <Icon className="w-4 h-4" style={{ color: isActive ? GOLD : MUTED_GRAY }} />
                  <span className="font-mono text-xs tracking-wider">{tab.number}</span>
                  <span className="font-semibold tracking-wide">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content: Burgundy panel + White form area */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-0 rounded-2xl overflow-hidden shadow-2xl" style={{ minHeight: '600px' }}>
          {/* Left: Burgundy info panel */}
          <div className="p-8 sm:p-10 flex flex-col justify-center" style={{ backgroundColor: BURGUNDY }}>
            <div className="font-mono text-sm tracking-widest mb-6" style={{ color: GOLD }}>
              {activeTabConfig.number}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold mb-4 leading-tight" style={{ color: WHITE, fontFamily: 'Playfair Display, Georgia, serif' }}>
              {activeTabConfig.headline}
            </h1>
            <p className="text-sm leading-relaxed mb-8" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {activeTabConfig.description}
            </p>
            <div className="flex items-center gap-3 mt-auto pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(233,170,50,0.15)' }}>
                <activeTabConfig.icon className="w-5 h-5" style={{ color: GOLD }} />
              </div>
              <div>
                <p className="text-xs font-mono tracking-wider" style={{ color: GOLD }}>PASTOR TOLU</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Booking & Enquiries</p>
              </div>
            </div>
          </div>

          {/* Right: White form area */}
          <div className="p-8 sm:p-10 flex flex-col" style={{ backgroundColor: WHITE }}>
            {submitState === 'error' && (
              <div className="mb-6 p-4 rounded-xl flex items-start gap-3" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">Submission failed</p>
                  <p className="text-xs text-red-600 mt-0.5">{submitError ?? 'Please try again.'}</p>
                </div>
              </div>
            )}

            {/* === INVITE PASTOR TOLU FORM === */}
            {activeTab === 'invite' && (
              <InviteForm
                data={inviteData}
                errors={formErrors}
                onChange={handleFieldChange}
                onSubmit={handleInviteSubmit}
                submitting={submitState === 'submitting'}
                buttonLabel={activeTabConfig.buttonLabel}
              />
            )}

            {/* === COUNSELING FORM === */}
            {activeTab === 'counseling' && (
              <CounselingForm
                data={counselingData}
                errors={formErrors}
                onChange={handleFieldChange}
                onSubmit={handleCounselingSubmit}
                submitting={submitState === 'submitting'}
                buttonLabel={activeTabConfig.buttonLabel}
                calendarLoading={calendarLoading}
                viewMonth={viewMonth}
                availableDays={availableDays}
                selectedDate={selectedDate}
                slots={slots}
                loadingSlots={loadingSlots}
                selectedSlot={selectedSlot}
                visitorTz={visitorTz}
                onMonthChange={setViewMonth}
                onDateSelect={(date) => { loadSlots(date); }}
                onSlotSelect={handleSlotSelect}
                lockId={lockId}
              />
            )}

            {/* === CORPORATE CONSULTING FORM === */}
            {activeTab === 'corporate' && (
              <CorporateForm
                data={corporateData}
                errors={formErrors}
                onChange={handleFieldChange}
                onSubmit={handleCorporateSubmit}
                submitting={submitState === 'submitting'}
                buttonLabel={activeTabConfig.buttonLabel}
              />
            )}

            {/* === GENERAL CONTACT FORM === */}
            {activeTab === 'contact' && (
              <ContactForm
                data={contactData}
                errors={formErrors}
                onChange={handleFieldChange}
                onSubmit={handleContactSubmit}
                submitting={submitState === 'submitting'}
                buttonLabel={activeTabConfig.buttonLabel}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// HEADER
// ============================================================
function PastorToluHeader() {
  return (
    <header className="border-b px-6 py-4 flex items-center justify-center" style={{ borderColor: 'rgba(0,0,0,0.08)', backgroundColor: NAVY }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: BURGUNDY }}>
          <User className="w-5 h-5" style={{ color: GOLD }} />
        </div>
        <span className="text-lg font-bold tracking-wide" style={{ color: '#1a1a1a', fontFamily: 'Playfair Display, Georgia, serif' }}>
          Pastor Tolu
        </span>
      </div>
    </header>
  );
}

// ============================================================
// SHARED FIELD COMPONENTS
// ============================================================
function FieldLabel({ label, required }: { label: string; required: boolean }) {
  return (
    <label className="block text-xs font-mono uppercase tracking-wider mb-2" style={{ color: DARK_TEXT }}>
      {label}{required && <span style={{ color: GOLD }}> *</span>}
    </label>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-xs text-red-500 mt-1.5 font-medium">{error}</p>;
}

const inputClass = 'w-full px-4 py-3 rounded-lg border text-sm text-navy-800 placeholder-gray-400 focus:outline-none transition-colors';
const inputStyle = { borderColor: '#e0e0e0' };

function TextInput({ label, value, onChange, placeholder, required, error, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required: boolean;
  error?: string;
  type?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <input
        type={type}
        className={inputClass}
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={(e) => { e.target.style.borderColor = GOLD; }}
        onBlur={(e) => { e.target.style.borderColor = '#e0e0e0'; }}
      />
      <FieldError error={error} />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, required, error }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required: boolean;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <textarea
        className={cn(inputClass, 'min-h-[100px] resize-y')}
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={(e) => { e.target.style.borderColor = GOLD; }}
        onBlur={(e) => { e.target.style.borderColor = '#e0e0e0'; }}
      />
      <FieldError error={error} />
    </div>
  );
}

function Dropdown({ label, value, onChange, options, required, error }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required: boolean;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <select
        className={inputClass}
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => { e.target.style.borderColor = GOLD; }}
        onBlur={(e) => { e.target.style.borderColor = '#e0e0e0'; }}
      >
        <option value="">Select...</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
      <FieldError error={error} />
    </div>
  );
}

function RadioGroup({ label, value, onChange, options, required, error }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required: boolean;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <div className="flex flex-wrap gap-3">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              'px-5 py-2.5 rounded-lg text-sm font-medium transition-all border-2',
              value === opt ? 'text-white' : 'bg-white'
            )}
            style={value === opt
              ? { backgroundColor: BURGUNDY, borderColor: BURGUNDY, color: WHITE }
              : { borderColor: '#e0e0e0', color: DARK_TEXT }
            }
          >
            {opt}
          </button>
        ))}
      </div>
      <FieldError error={error} />
    </div>
  );
}

function SubmitButton({ label, onClick, submitting }: { label: string; onClick: () => void; submitting: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={submitting}
      className="w-full mt-8 py-4 rounded-xl font-semibold text-sm tracking-wider transition-all flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
      style={{ backgroundColor: GOLD, color: DARK_TEXT }}
    >
      {submitting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          PROCESSING...
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="w-4 h-4" />
        </>
      )}
    </button>
  );
}

// ============================================================
// INVITE PASTOR TOLU FORM
// ============================================================
function InviteForm({ data, errors, onChange, onSubmit, submitting, buttonLabel }: {
  data: Record<string, string>;
  errors: Record<string, string>;
  onChange: (label: string, value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
}) {
  return (
    <div className="space-y-5 overflow-y-auto">
      <TextInput
        label="Organisation/Church Name"
        value={data['Organisation/Church Name'] ?? ''}
        onChange={(v) => onChange('Organisation/Church Name', v)}
        placeholder="Enter organisation or church name"
        required
        error={errors['Organisation/Church Name']}
      />
      <TextInput
        label="Contact Person Email"
        type="email"
        value={data['Contact Person Email'] ?? ''}
        onChange={(v) => onChange('Contact Person Email', v)}
        placeholder="you@example.com"
        required
        error={errors['Contact Person Email']}
      />
      <TextInput
        label="Event Title"
        value={data['Event Title'] ?? ''}
        onChange={(v) => onChange('Event Title', v)}
        placeholder="Name of the event"
        required
        error={errors['Event Title']}
      />
      <div>
        <FieldLabel label="Proposed Event Date" required />
        <input
          type="date"
          className={inputClass}
          style={inputStyle}
          value={data['Proposed Event Date'] ?? ''}
          onChange={(e) => onChange('Proposed Event Date', e.target.value)}
          onFocus={(e) => { e.target.style.borderColor = GOLD; }}
          onBlur={(e) => { e.target.style.borderColor = '#e0e0e0'; }}
        />
        <FieldError error={errors['Proposed Event Date']} />
      </div>
      <Dropdown
        label="Expected Attendance"
        value={data['Expected Attendance'] ?? ''}
        onChange={(v) => onChange('Expected Attendance', v)}
        options={['Under 50', '50-100', '100-500', '500-1000', '1000+']}
        required
        error={errors['Expected Attendance']}
      />
      <TextArea
        label="Venue Physical Address"
        value={data['Venue Physical Address'] ?? ''}
        onChange={(v) => onChange('Venue Physical Address', v)}
        placeholder="Full address of the venue"
        required
        error={errors['Venue Physical Address']}
      />
      <TextArea
        label="Brief Event Overview"
        value={data['Brief Event Overview'] ?? ''}
        onChange={(v) => onChange('Brief Event Overview', v)}
        placeholder="Tell us about your event..."
        required
        error={errors['Brief Event Overview']}
      />
      <SubmitButton label={buttonLabel} onClick={onSubmit} submitting={submitting} />
    </div>
  );
}

// ============================================================
// COUNSELING FORM
// ============================================================
function CounselingForm({ data, errors, onChange, onSubmit, submitting, buttonLabel,
  calendarLoading, viewMonth, availableDays, selectedDate, slots, loadingSlots, selectedSlot,
  visitorTz, onMonthChange, onDateSelect, onSlotSelect, lockId
}: {
  data: Record<string, string>;
  errors: Record<string, string>;
  onChange: (label: string, value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
  calendarLoading: boolean;
  viewMonth: Date;
  availableDays: Set<number>;
  selectedDate: Date | null;
  slots: TimeSlot[];
  loadingSlots: boolean;
  selectedSlot: TimeSlot | null;
  visitorTz: string;
  onMonthChange: (d: Date) => void;
  onDateSelect: (d: Date) => void;
  onSlotSelect: (slot: TimeSlot) => void;
  lockId: string | null;
}) {
  const year = viewMonth.getFullYear();
  const mo = viewMonth.getMonth();
  const firstDay = new Date(year, mo, 1).getDay();
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === mo && today.getFullYear() === year;
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-5 overflow-y-auto">
      <TextInput
        label="Full Name"
        value={data['Full Name'] ?? ''}
        onChange={(v) => onChange('Full Name', v)}
        placeholder="Enter your full name"
        required
        error={errors['Full Name']}
      />
      <TextInput
        label="Primary Contact Email"
        type="email"
        value={data['Primary Contact Email'] ?? ''}
        onChange={(v) => onChange('Primary Contact Email', v)}
        placeholder="you@example.com"
        required
        error={errors['Primary Contact Email']}
      />
      <RadioGroup
        label="Relationship Status"
        value={data['Relationship Status'] ?? ''}
        onChange={(v) => onChange('Relationship Status', v)}
        options={['Single', 'Courting', 'Married']}
        required
        error={errors['Relationship Status']}
      />
      <TextArea
        label="What Would You Like Guidance On?"
        value={data['What Would You Like Guidance On?'] ?? ''}
        onChange={(v) => onChange('What Would You Like Guidance On?', v)}
        placeholder="Share what you would like guidance on..."
        required
        error={errors['What Would You Like Guidance On?']}
      />

      {/* Available slot selector */}
      <div>
        <FieldLabel label="Select Available Time" required />
        {calendarLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
          </div>
        ) : (
          <>
            {/* Calendar grid */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => {
                    const prev = new Date(viewMonth);
                    prev.setMonth(prev.getMonth() - 1);
                    onMonthChange(prev);
                  }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
                  style={{ border: '1px solid #e0e0e0' }}
                >
                  <ChevronLeft className="w-4 h-4" style={{ color: DARK_TEXT }} />
                </button>
                <span className="text-sm font-semibold" style={{ color: DARK_TEXT }}>
                  {viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  onClick={() => {
                    const next = new Date(viewMonth);
                    next.setMonth(next.getMonth() + 1);
                    onMonthChange(next);
                  }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
                  style={{ border: '1px solid #e0e0e0' }}
                >
                  <ChevronRight className="w-4 h-4" style={{ color: DARK_TEXT }} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {dayLabels.map((d, i) => (
                  <div key={i} className="text-center text-xs font-medium py-1" style={{ color: MUTED_GRAY }}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const date = new Date(year, mo, day);
                  const isPast = isCurrentMonth && day < today.getDate();
                  const isAvailable = availableDays.has(day) && !isPast;
                  const isSelected = selectedDate && date.getTime() === new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()).getTime();

                  return (
                    <button
                      key={day}
                      disabled={!isAvailable}
                      onClick={() => onDateSelect(date)}
                      className={cn(
                        'aspect-square rounded-lg text-xs font-medium transition-all relative',
                        isAvailable ? 'cursor-pointer' : 'cursor-not-allowed',
                        isSelected ? 'text-white' : ''
                      )}
                      style={isSelected
                        ? { backgroundColor: BURGUNDY, color: WHITE }
                        : isAvailable
                        ? { backgroundColor: '#f9f9f9', border: '1px solid #e0e0e0', color: DARK_TEXT }
                        : { color: '#d0d0d0' }
                      }
                    >
                      {day}
                      {isAvailable && !isSelected && (
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ backgroundColor: GOLD }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time slots */}
            {selectedDate && (
              <div className="mt-4">
                <p className="text-xs font-mono uppercase tracking-wider mb-3" style={{ color: DARK_TEXT }}>
                  {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </p>
                {loadingSlots ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: GOLD }} />
                  </div>
                ) : slots.length === 0 ? (
                  <div className="text-center py-6">
                    <Clock className="w-8 h-8 mx-auto mb-2" style={{ color: '#d0d0d0' }} />
                    <p className="text-sm" style={{ color: MUTED_GRAY }}>No available times on this date</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
                    {slots.map((slot, i) => (
                      <button
                        key={i}
                        onClick={() => onSlotSelect(slot)}
                        className={cn(
                          'px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                          selectedSlot?.start.getTime() === slot.start.getTime() ? 'text-white' : ''
                        )}
                        style={selectedSlot?.start.getTime() === slot.start.getTime()
                          ? { backgroundColor: BURGUNDY, color: WHITE }
                          : { backgroundColor: '#f9f9f9', border: '1px solid #e0e0e0', color: DARK_TEXT }
                        }
                      >
                        {formatTimeInZone(slot.start, visitorTz)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {lockId && (
              <div className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: GOLD }}>
                <Clock className="w-3.5 h-3.5" />
                <span>Slot reserved — confirm your booking</span>
              </div>
            )}

            {errors['_slot'] && (
              <p className="text-xs text-red-500 mt-2 font-medium">{errors['_slot']}</p>
            )}
          </>
        )}
      </div>

      <SubmitButton label={buttonLabel} onClick={onSubmit} submitting={submitting} />
    </div>
  );
}

// ============================================================
// CORPORATE CONSULTING FORM
// ============================================================
function CorporateForm({ data, errors, onChange, onSubmit, submitting, buttonLabel }: {
  data: Record<string, string>;
  errors: Record<string, string>;
  onChange: (label: string, value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
}) {
  return (
    <div className="space-y-5 overflow-y-auto">
      <TextInput
        label="Company or Brand Name"
        value={data['Company or Brand Name'] ?? ''}
        onChange={(v) => onChange('Company or Brand Name', v)}
        placeholder="Enter company or brand name"
        required
        error={errors['Company or Brand Name']}
      />
      <TextInput
        label="Industry"
        value={data['Industry'] ?? ''}
        onChange={(v) => onChange('Industry', v)}
        placeholder="e.g. Technology, Finance, Healthcare"
        required
        error={errors['Industry']}
      />
      <Dropdown
        label="Consultation Core Target"
        value={data['Consultation Core Target'] ?? ''}
        onChange={(v) => onChange('Consultation Core Target', v)}
        options={['Leadership Development', 'Strategic Planning', 'Team Building', 'Organizational Culture', 'Brand Strategy', 'Other']}
        required
        error={errors['Consultation Core Target']}
      />
      <TextArea
        label="Message Details"
        value={data['Message Details'] ?? ''}
        onChange={(v) => onChange('Message Details', v)}
        placeholder="Tell us about your consulting needs..."
        required
        error={errors['Message Details']}
      />
      <TextInput
        label="Contact Email"
        type="email"
        value={data['Contact Email'] ?? ''}
        onChange={(v) => onChange('Contact Email', v)}
        placeholder="you@company.com"
        required
        error={errors['Contact Email']}
      />
      <SubmitButton label={buttonLabel} onClick={onSubmit} submitting={submitting} />
    </div>
  );
}

// ============================================================
// GENERAL CONTACT FORM
// ============================================================
function ContactForm({ data, errors, onChange, onSubmit, submitting, buttonLabel }: {
  data: Record<string, string>;
  errors: Record<string, string>;
  onChange: (label: string, value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
}) {
  return (
    <div className="space-y-5 overflow-y-auto">
      <TextInput
        label="Your Name"
        value={data['Your Name'] ?? ''}
        onChange={(v) => onChange('Your Name', v)}
        placeholder="Enter your name"
        required
        error={errors['Your Name']}
      />
      <TextInput
        label="Your Email"
        type="email"
        value={data['Your Email'] ?? ''}
        onChange={(v) => onChange('Your Email', v)}
        placeholder="you@example.com"
        required
        error={errors['Your Email']}
      />
      <TextInput
        label="Subject"
        value={data['Subject'] ?? ''}
        onChange={(v) => onChange('Subject', v)}
        placeholder="What is this about?"
        required
        error={errors['Subject']}
      />
      <TextArea
        label="Message"
        value={data['Message'] ?? ''}
        onChange={(v) => onChange('Message', v)}
        placeholder="How can we help you?"
        required
        error={errors['Message']}
      />
      <SubmitButton label={buttonLabel} onClick={onSubmit} submitting={submitting} />
    </div>
  );
}
