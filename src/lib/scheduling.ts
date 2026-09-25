import { supabase } from '@/lib/supabase';
import type {
  Calendar,
  AvailabilityRule,
  AvailabilityOverride,
  Appointment,
  CalendarHost,
} from '@/types';

// ============================================================
// TYPES
// ============================================================

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
  hostId?: string;
  hostIds?: string[];
}

export interface AvailabilityResult {
  slots: TimeSlot[];
  date: Date;
}

export type RoundRobinStrategy =
  | 'balanced'
  | 'least_recently_booked'
  | 'priority_order'
  | 'weighted';

export interface BookingRequest {
  calendarId: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  hostId?: string;
  contactInfo: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  formSubmission?: Record<string, string>;
  notes?: string;
  bookedBy?: string;
}

export interface BookingResult {
  success: boolean;
  appointment?: Appointment;
  contact?: { id: string };
  error?: string;
}

export interface SlotCheckResult {
  available: boolean;
  reason?: string;
  hostId?: string;
}

interface ExternalBusyPeriod {
  start_time: string;
  end_time: string;
}

interface ExistingAppointment {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  host_id: string | null;
}

// ============================================================
// TIMEZONE UTILITIES
// ============================================================

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function parseTimeToUtc(date: Date, timeStr: string, timezone: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '0';
  const tzDateStr = `${get('year')}-${get('month')}-${get('day')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const utcDate = new Date(tzDateStr + 'Z');
  const offsetMs = getTimezoneOffsetMs(date, timezone);
  return new Date(utcDate.getTime() + offsetMs);
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '0';
  const asUtc = Date.UTC(
    parseInt(get('year')), parseInt(get('month')) - 1, parseInt(get('day')),
    parseInt(get('hour')) === 24 ? 0 : parseInt(get('hour')), parseInt(get('minute')), 0
  );
  return date.getTime() - asUtc;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// ============================================================
// SCHEDULING ENGINE
// ============================================================

export class SchedulingEngine {
  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  /**
   * Get available slots for a calendar within a date range.
   * All inputs from the spec are considered: working hours, overrides,
   * blackouts, existing appointments, external conflicts, buffers,
   * minimum notice, booking horizon, booking limits, host availability,
   * capacity, calendar type, round robin, collective, event, service.
   */
  static async getAvailableSlots(
    calendar: Calendar,
    dateRange: { start: Date; end: Date },
    visitorTimezone: string = calendar.timezone,
  ): Promise<TimeSlot[]> {
    const now = new Date();
    const minNoticeMs = calendar.min_booking_notice_minutes * MS_PER_MINUTE;
    const earliestBookable = new Date(now.getTime() + minNoticeMs);
    const maxHorizonDate = new Date(now.getTime() + calendar.max_booking_horizon_days * MS_PER_DAY);

    // Gather hosts
    const hosts = await this.getCalendarHosts(calendar.id);
    const hostIds = hosts.map(h => h.user_id);

    // For each day in range, generate and filter slots
    const allSlots: TimeSlot[] = [];
    const cursor = new Date(dateRange.start);
    cursor.setHours(0, 0, 0, 0);

    while (cursor <= dateRange.end) {
      const daySlots = await this.getSlotsForDay(calendar, cursor, visitorTimezone, hostIds, hosts);
      for (const slot of daySlots) {
        if (slot.start < earliestBookable) continue;
        if (slot.start > maxHorizonDate) continue;
        allSlots.push(slot);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    // Apply booking limits
    const limits = await this.checkBookingLimits(calendar, dateRange.start);
    if (!limits.canBook) return [];

    return allSlots;
  }

  /**
   * Check if a specific slot is available right now (fresh check).
   * Used at booking time — never trust previously displayed availability.
   */
  static async checkSlot(
    calendarId: string,
    start: Date,
    end: Date,
    hostId?: string,
  ): Promise<SlotCheckResult> {
    const { data: calData, error: calErr } = await supabase
      .from('calendars')
      .select('*')
      .eq('id', calendarId)
      .maybeSingle();

    if (calErr || !calData) {
      return { available: false, reason: 'Calendar not found.' };
    }
    const calendar = calData as Calendar;

    // 1. Minimum notice
    const minNoticeMs = calendar.min_booking_notice_minutes * MS_PER_MINUTE;
    if (new Date().getTime() + minNoticeMs > start.getTime()) {
      return { available: false, reason: 'This time no longer meets the minimum booking notice.' };
    }

    // 2. Booking horizon
    const maxHorizon = new Date(new Date().getTime() + calendar.max_booking_horizon_days * MS_PER_DAY);
    if (start > maxHorizon) {
      return { available: false, reason: 'This time is beyond the booking horizon.' };
    }

    // 3. Buffers
    const bufferBefore = calendar.buffer_before_minutes * MS_PER_MINUTE;
    const bufferAfter = calendar.buffer_after_minutes * MS_PER_MINUTE;
    const checkStart = new Date(start.getTime() - bufferBefore);
    const checkEnd = new Date(end.getTime() + bufferAfter);

    // 4. Existing SYNAPSE appointments
    const { data: existing } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, status, host_id')
      .eq('calendar_id', calendarId)
      .in('status', ['confirmed', 'pending'])
      .gte('start_time', new Date(checkStart.getTime() - MS_PER_HOUR).toISOString())
      .lte('end_time', new Date(checkEnd.getTime() + MS_PER_HOUR).toISOString());

    const existingAppts = (existing ?? []) as ExistingAppointment[];

    // 5. Capacity check for group/event
    if (calendar.calendar_type === 'event' || (calendar.calendar_type === 'group' && calendar.capacity > 1)) {
      const sameSlotCount = existingAppts.filter(a => {
        const aStart = new Date(a.start_time);
        return aStart.getTime() === start.getTime();
      }).length;
      if (sameSlotCount >= calendar.capacity) {
        return { available: false, reason: 'This event is full.' };
      }
    } else {
      // For one-on-one, round_robin, collective, service: check conflict
      const hasConflict = existingAppts.some(a => {
        const aStart = new Date(a.start_time);
        const aEnd = new Date(a.end_time);
        return overlaps(checkStart, checkEnd, aStart, aEnd);
      });
      if (hasConflict) {
        return { available: false, reason: 'This time was just booked. Please select another time.' };
      }
    }

    // 6. External conflicts
    const hosts = await this.getCalendarHosts(calendarId);
    const checkHostIds = hostId ? [hostId] : hosts.map(h => h.user_id);

    if (checkHostIds.length > 0) {
      const { data: extBusy } = await supabase
        .from('external_busy_periods')
        .select('start_time, end_time')
        .in('user_id', checkHostIds)
        .gte('start_time', new Date(checkStart.getTime() - MS_PER_HOUR).toISOString())
        .lte('end_time', new Date(checkEnd.getTime() + MS_PER_HOUR).toISOString());

      const hasExternal = (extBusy ?? []).some((b: ExternalBusyPeriod) => {
        const bStart = new Date(b.start_time);
        const bEnd = new Date(b.end_time);
        return overlaps(checkStart, checkEnd, bStart, bEnd);
      });
      if (hasExternal) {
        return { available: false, reason: 'This time conflicts with an external calendar.' };
      }
    }

    // 7. Booking limits
    const limits = await this.checkBookingLimits(calendar, start);
    if (!limits.canBook) {
      return { available: false, reason: limits.reason };
    }

    // 8. Round Robin host selection
    if (calendar.calendar_type === 'round_robin') {
      // If visitor selected a specific host, validate that host
      if (hostId) {
        const hostApptConflict = existingAppts.some(a => {
          if (a.host_id !== hostId) return false;
          const aStart = new Date(a.start_time);
          const aEnd = new Date(a.end_time);
          return overlaps(checkStart, checkEnd, aStart, aEnd);
        });
        if (hostApptConflict) {
          return { available: false, reason: 'This host is not available at this time.' };
        }
        return { available: true, hostId };
      }
      // Otherwise auto-select via strategy
      const selectedHost = await this.selectRoundRobinHost(calendar, start, end, hosts);
      if (!selectedHost) {
        return { available: false, reason: 'No hosts available for this time.' };
      }
      return { available: true, hostId: selectedHost };
    }

    // 9. Collective host intersection
    if (calendar.calendar_type === 'collective') {
      const allAvailable = await this.checkCollectiveAvailability(start, end, checkHostIds, checkStart, checkEnd);
      if (!allAvailable) {
        return { available: false, reason: 'Not all required hosts are available.' };
      }
      return { available: true, hostId: checkHostIds[0] };
    }

    // 10. Host-specific conflict check for one_on_one / service
    if (hostId && calendar.calendar_type !== 'group' && calendar.calendar_type !== 'event') {
      const hostConflict = existingAppts.some(a => {
        if (a.host_id !== hostId) return false;
        const aStart = new Date(a.start_time);
        const aEnd = new Date(a.end_time);
        return overlaps(checkStart, checkEnd, aStart, aEnd);
      });
      if (hostConflict) {
        return { available: false, reason: 'This host has a conflict at this time.' };
      }
    }

    return { available: true, hostId: hostId ?? checkHostIds[0] };
  }

  /**
   * Reserve a slot atomically. Returns a lockId that must be released
   * after the booking transaction completes.
   */
  static async reserveSlot(
    calendarId: string,
    workspaceId: string | null,
    start: Date,
    end: Date,
    lockedBy: string,
    hostId?: string,
    ownerId?: string | null,
  ): Promise<{ success: boolean; lockId?: string; error?: string }> {
    // Clean up expired locks first
    await supabase
      .from('booking_locks')
      .delete()
      .lt('expires_at', new Date().toISOString());

    const lockDuration = 5 * MS_PER_MINUTE; // 5 minute lock
    const expiresAt = new Date(new Date().getTime() + lockDuration);

    const lockInsert: Record<string, unknown> = {
      calendar_id: calendarId,
      slot_start: start.toISOString(),
      slot_end: end.toISOString(),
      host_id: hostId ?? null,
      locked_by: lockedBy,
      expires_at: expiresAt.toISOString(),
    };
    if (workspaceId) lockInsert.workspace_id = workspaceId;
    else if (ownerId) lockInsert.owner_id = ownerId;

    const { data, error } = await supabase
      .from('booking_locks')
      .insert(lockInsert)
      .select('id')
      .maybeSingle();

    if (error) {
      // Unique constraint violation = slot already locked
      if (error.code === '23505') {
        return { success: false, error: 'This time was just booked. Please select another time.' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, lockId: data?.id };
  }

  /**
   * Release a booking lock.
   */
  static async releaseLock(lockId: string): Promise<void> {
    await supabase.from('booking_locks').delete().eq('id', lockId);
  }

  /**
   * Create a booking with full transactional safety.
   * Steps: re-check availability → acquire lock → create contact → create appointment
   * → (form submission) → release lock.
   */
  static async createBooking(req: BookingRequest): Promise<BookingResult> {
    const { data: calData, error: calErr } = await supabase
      .from('calendars')
      .select('*')
      .eq('id', req.calendarId)
      .maybeSingle();
    if (calErr || !calData) {
      return { success: false, error: 'Calendar not found.' };
    }
    const calendar = calData as Calendar;

    // 1. Re-check slot availability
    const slotCheck = await this.checkSlot(req.calendarId, req.startTime, req.endTime, req.hostId);
    if (!slotCheck.available) {
      return { success: false, error: slotCheck.reason ?? 'Slot not available.' };
    }

    const effectiveHostId = slotCheck.hostId ?? req.hostId;
    const workspaceId = calendar.workspace_id;
    const ownerId = calendar.owner_id;

    // 2. Acquire atomic lock
    const lock = await this.reserveSlot(
      req.calendarId, workspaceId, req.startTime, req.endTime,
      req.bookedBy ?? effectiveHostId ?? 'system', effectiveHostId, ownerId,
    );
    if (!lock.success || !lock.lockId) {
      return { success: false, error: lock.error ?? 'Could not reserve slot.' };
    }

    try {
      // 3. Create or find contact
      let contactId: string | null = null;
      if (req.contactInfo.email) {
        let contactLookup = supabase
          .from('contacts')
          .select('id')
          .eq('email', req.contactInfo.email);
        if (workspaceId) contactLookup = contactLookup.eq('workspace_id', workspaceId);
        else if (ownerId) contactLookup = contactLookup.eq('owner_id', ownerId);
        const { data: existingContact } = await contactLookup.maybeSingle();

        if (existingContact) {
          contactId = existingContact.id;
          if (req.contactInfo.first_name || req.contactInfo.last_name || req.contactInfo.phone) {
            await supabase.from('contacts').update({
              first_name: req.contactInfo.first_name ?? null,
              last_name: req.contactInfo.last_name ?? null,
              phone: req.contactInfo.phone ?? null,
            }).eq('id', contactId);
          }
        } else {
          const contactInsert: Record<string, unknown> = {
            first_name: req.contactInfo.first_name ?? null,
            last_name: req.contactInfo.last_name ?? null,
            email: req.contactInfo.email,
            phone: req.contactInfo.phone ?? null,
          };
          if (workspaceId) contactInsert.workspace_id = workspaceId;
          else if (ownerId) contactInsert.owner_id = ownerId;
          const { data: newContact, error: contactErr } = await supabase
            .from('contacts')
            .insert(contactInsert)
            .select('id')
            .maybeSingle();
          if (contactErr || !newContact) {
            return { success: false, error: 'Could not create contact.' };
          }
          contactId = newContact.id;
        }
      }

      // 4. Create appointment
      const apptInsert: Record<string, unknown> = {
        calendar_id: req.calendarId,
        contact_id: contactId,
        host_id: effectiveHostId ?? null,
        title: calendar.name,
        status: 'confirmed',
        start_time: req.startTime.toISOString(),
        end_time: req.endTime.toISOString(),
        timezone: req.timezone,
        location_type: calendar.location_type,
        notes: req.notes ?? null,
      };
      if (workspaceId) apptInsert.workspace_id = workspaceId;
      else if (ownerId) apptInsert.owner_id = ownerId;
      const { data: appt, error: apptErr } = await supabase
        .from('appointments')
        .insert(apptInsert)
        .select('*')
        .maybeSingle();

      if (apptErr || !appt) {
        return { success: false, error: apptErr?.message ?? 'Could not create appointment.' };
      }

      // 5. Form submission
      if (req.formSubmission && calendar.connected_form_id) {
        const subInsert: Record<string, unknown> = {
          form_id: calendar.connected_form_id,
          contact_id: contactId,
          appointment_id: appt.id,
          answers: req.formSubmission,
          source: 'booking_page',
        };
        if (workspaceId) subInsert.workspace_id = workspaceId;
        else if (ownerId) subInsert.owner_id = ownerId;
        await supabase.from('form_submissions').insert(subInsert);
      }

      return {
        success: true,
        appointment: appt as Appointment,
        contact: contactId ? { id: contactId } : undefined,
      };
    } finally {
      // 6. Release lock
      await this.releaseLock(lock.lockId);
    }
  }

  /**
   * Cancel a booking.
   */
  static async cancelBooking(
    appointmentId: string,
    reason?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
      .from('appointments')
      .update({
        status: 'cancelled',
        cancellation_reason: reason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  /**
   * Reschedule a booking.
   * Cancels the old appointment and creates a new one at the new time
   * after re-checking availability.
   */
  static async rescheduleBooking(
    appointmentId: string,
    newStart: Date,
    newEnd: Date,
    timezone: string,
  ): Promise<BookingResult> {
    const { data: appt, error: apptErr } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .maybeSingle();

    if (apptErr || !appt) {
      return { success: false, error: 'Appointment not found.' };
    }
    const oldAppt = appt as Appointment;

    // Check new slot
    const slotCheck = await this.checkSlot(oldAppt.calendar_id, newStart, newEnd, oldAppt.host_id ?? undefined);
    if (!slotCheck.available) {
      return { success: false, error: slotCheck.reason ?? 'New time not available.' };
    }

    // Update appointment
    const { data: updated, error: updateErr } = await supabase
      .from('appointments')
      .update({
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
        timezone,
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .select('*')
      .maybeSingle();

    if (updateErr || !updated) {
      return { success: false, error: updateErr?.message ?? 'Could not reschedule.' };
    }

    return { success: true, appointment: updated as Appointment };
  }

  // ----------------------------------------------------------
  // INTERNAL: SLOT GENERATION
  // ----------------------------------------------------------

  private static async getSlotsForDay(
    calendar: Calendar,
    date: Date,
    timezone: string,
    hostIds: string[],
    hosts: CalendarHost[],
  ): Promise<TimeSlot[]> {
    const dayOfWeek = date.getDay();

    // 1. Get availability rules for this day
    const { data: rules } = await supabase
      .from('availability_rules')
      .select('*')
      .eq('calendar_id', calendar.id)
      .eq('day_of_week', dayOfWeek)
      .order('sort_order');

    const calendarRules: AvailabilityRule[] = rules && rules.length > 0
      ? rules as AvailabilityRule[]
      : dayOfWeek >= 1 && dayOfWeek <= 5
        ? [{
            id: `default-${calendar.id}-${dayOfWeek}`,
            calendar_id: calendar.id,
            day_of_week: dayOfWeek,
            start_time: '09:00',
            end_time: '17:00',
            sort_order: 0,
          }]
        : [];

    if (calendarRules.length === 0) return [];

    // 2. Check for overrides
    const dateStr = date.toISOString().split('T')[0];
    const { data: overrides } = await supabase
      .from('availability_overrides')
      .select('*')
      .eq('calendar_id', calendar.id)
      .eq('override_date', dateStr);

    // Blackout = no slots
    const blackouts = (overrides ?? []).filter((o: AvailabilityOverride) => o.type === 'blackout');
    if (blackouts.length > 0) return [];

    // Available overrides replace regular rules
    const availableOverrides = (overrides ?? []).filter((o: AvailabilityOverride) => o.type === 'available');
    const effectiveRules: AvailabilityRule[] = availableOverrides.length > 0
      ? availableOverrides.map((o, i) => ({
          id: 'override-' + i,
          calendar_id: calendar.id,
          day_of_week: dayOfWeek,
          start_time: o.start_time ?? '09:00',
          end_time: o.end_time ?? '17:00',
          sort_order: i,
        }))
      : calendarRules;

    if (effectiveRules.length === 0) return [];

    // 3. Generate base slots (timezone-aware)
    const slots = this.generateBaseSlots(calendar, date, effectiveRules, calendar.timezone);
    if (slots.length === 0) return [];

    // 4. Fetch existing appointments and external busy for this day (with buffer)
    const bufferMs = Math.max(calendar.buffer_before_minutes, calendar.buffer_after_minutes) * MS_PER_MINUTE;
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    const rangeStart = new Date(dayStart.getTime() - bufferMs - MS_PER_HOUR);
    const rangeEnd = new Date(dayEnd.getTime() + bufferMs + MS_PER_HOUR);

    const { data: existingAppts } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, status, host_id')
      .eq('calendar_id', calendar.id)
      .in('status', ['confirmed', 'pending'])
      .gte('start_time', rangeStart.toISOString())
      .lte('end_time', rangeEnd.toISOString());

    const appts = (existingAppts ?? []) as ExistingAppointment[];

    // External busy periods
    let externalBusy: ExternalBusyPeriod[] = [];
    if (hostIds.length > 0) {
      const { data: busy } = await supabase
        .from('external_busy_periods')
        .select('start_time, end_time')
        .in('user_id', hostIds)
        .gte('start_time', rangeStart.toISOString())
        .lte('end_time', rangeEnd.toISOString());
      externalBusy = (busy ?? []) as ExternalBusyPeriod[];
    }

    // 5. Filter slots based on calendar type
    const bufferBeforeMs = calendar.buffer_before_minutes * MS_PER_MINUTE;
    const bufferAfterMs = calendar.buffer_after_minutes * MS_PER_MINUTE;

    const result: TimeSlot[] = [];

    for (const slot of slots) {
      const slotCheckStart = new Date(slot.start.getTime() - bufferBeforeMs);
      const slotCheckEnd = new Date(slot.end.getTime() + bufferAfterMs);

      // Check internal conflicts
      const hasInternalConflict = appts.some(a => {
        const aStart = new Date(a.start_time);
        const aEnd = new Date(a.end_time);
        return overlaps(slotCheckStart, slotCheckEnd, aStart, aEnd);
      });

      // Check external conflicts
      const hasExternalConflict = externalBusy.some(b => {
        const bStart = new Date(b.start_time);
        const bEnd = new Date(b.end_time);
        return overlaps(slotCheckStart, slotCheckEnd, bStart, bEnd);
      });

      if (calendar.calendar_type === 'event' || (calendar.calendar_type === 'group' && calendar.capacity > 1)) {
        // Capacity-based: slot is available if current bookings < capacity
        const currentCount = appts.filter(a => {
          const aStart = new Date(a.start_time);
          return aStart.getTime() === slot.start.getTime();
        }).length;
        if (currentCount >= calendar.capacity) continue;
        if (hasExternalConflict) continue;
        result.push({ ...slot, available: true });
      } else if (calendar.calendar_type === 'round_robin') {
        // Round robin: slot available if at least one host is free
        if (hasExternalConflict) continue;
        const availableHosts = await this.getAvailableHostsForSlot(hosts, slot, appts, externalBusy, bufferBeforeMs, bufferAfterMs);
        if (availableHosts.length === 0) continue;
        result.push({ ...slot, available: true, hostIds: availableHosts });
      } else if (calendar.calendar_type === 'collective') {
        // Collective: all hosts must be free
        if (hasExternalConflict) continue;
        const allFree = await this.checkCollectiveAvailability(slot.start, slot.end, hostIds, slotCheckStart, slotCheckEnd);
        if (!allFree) continue;
        result.push({ ...slot, available: true, hostIds });
      } else {
        // one_on_one, service
        if (hasInternalConflict) continue;
        if (hasExternalConflict) continue;
        result.push({ ...slot, available: true });
      }
    }

    return result;
  }

  /**
   * Generate base time slots from availability rules.
   * Times are interpreted in the calendar's timezone and converted to UTC.
   */
  private static generateBaseSlots(
    calendar: Calendar,
    date: Date,
    rules: AvailabilityRule[],
    calendarTimezone: string,
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const durationMs = calendar.duration_minutes * MS_PER_MINUTE;
    const intervalMs = (calendar.slot_interval_minutes || calendar.duration_minutes) * MS_PER_MINUTE;

    for (const rule of rules) {
      const periodStart = parseTimeToUtc(date, rule.start_time, calendarTimezone);
      const periodEnd = parseTimeToUtc(date, rule.end_time, calendarTimezone);

      let current = new Date(periodStart);
      while (current.getTime() + durationMs <= periodEnd.getTime()) {
        const slotEnd = new Date(current.getTime() + durationMs);
        slots.push({
          start: new Date(current),
          end: slotEnd,
          available: true,
        });
        current = new Date(current.getTime() + intervalMs);
      }
    }

    return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  // ----------------------------------------------------------
  // INTERNAL: HOST AVAILABILITY
  // ----------------------------------------------------------

  private static async getCalendarHosts(calendarId: string): Promise<CalendarHost[]> {
    const { data } = await supabase
      .from('calendar_hosts')
      .select('*')
      .eq('calendar_id', calendarId)
      .order('priority');
    return (data ?? []) as CalendarHost[];
  }

  private static async isHostAvailable(
    hostId: string,
    startTime: Date,
    endTime: Date,
    checkStart: Date,
    checkEnd: Date,
    appts: ExistingAppointment[],
    externalBusy: ExternalBusyPeriod[],
  ): Promise<boolean> {
    const apptConflict = appts.some(a => {
      if (a.host_id !== hostId) return false;
      return overlaps(checkStart, checkEnd, new Date(a.start_time), new Date(a.end_time));
    });
    if (apptConflict) return false;

    const extConflict = externalBusy.some(b =>
      overlaps(checkStart, checkEnd, new Date(b.start_time), new Date(b.end_time))
    );
    return !extConflict;
  }

  private static async getAvailableHostsForSlot(
    hosts: CalendarHost[],
    slot: TimeSlot,
    appts: ExistingAppointment[],
    externalBusy: ExternalBusyPeriod[],
    bufferBeforeMs: number,
    bufferAfterMs: number,
  ): Promise<string[]> {
    const available: string[] = [];
    const checkStart = new Date(slot.start.getTime() - bufferBeforeMs);
    const checkEnd = new Date(slot.end.getTime() + bufferAfterMs);

    for (const host of hosts) {
      const hostApptConflict = appts.some(a => {
        if (a.host_id !== host.user_id) return false;
        const aStart = new Date(a.start_time);
        const aEnd = new Date(a.end_time);
        return overlaps(checkStart, checkEnd, aStart, aEnd);
      });
      if (hostApptConflict) continue;

      const hostExtConflict = externalBusy.some(b => {
        const bStart = new Date(b.start_time);
        const bEnd = new Date(b.end_time);
        return overlaps(checkStart, checkEnd, bStart, bEnd);
      });
      if (hostExtConflict) continue;

      available.push(host.user_id);
    }
    return available;
  }

  // ----------------------------------------------------------
  // INTERNAL: ROUND ROBIN
  // ----------------------------------------------------------

  private static async selectRoundRobinHost(
    calendar: Calendar,
    startTime: Date,
    endTime: Date,
    hosts: CalendarHost[],
  ): Promise<string | null> {
    const hostIds = hosts.map(h => h.user_id);
    if (hostIds.length === 0) return null;
    if (hostIds.length === 1) return hostIds[0];

    const bufferBeforeMs = calendar.buffer_before_minutes * MS_PER_MINUTE;
    const bufferAfterMs = calendar.buffer_after_minutes * MS_PER_MINUTE;
    const checkStart = new Date(startTime.getTime() - bufferBeforeMs);
    const checkEnd = new Date(endTime.getTime() + bufferAfterMs);

    // Find available hosts
    const { data: existingAppts } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, status, host_id')
      .in('host_id', hostIds)
      .in('status', ['confirmed', 'pending'])
      .gte('start_time', new Date(checkStart.getTime() - MS_PER_HOUR).toISOString())
      .lte('end_time', new Date(checkEnd.getTime() + MS_PER_HOUR).toISOString());

    const appts = (existingAppts ?? []) as ExistingAppointment[];

    const { data: extBusy } = await supabase
      .from('external_busy_periods')
      .select('start_time, end_time')
      .in('user_id', hostIds)
      .gte('start_time', new Date(checkStart.getTime() - MS_PER_HOUR).toISOString())
      .lte('end_time', new Date(checkEnd.getTime() + MS_PER_HOUR).toISOString());

    const busy = (extBusy ?? []) as ExternalBusyPeriod[];

    const availableHosts = hosts.filter(host => {
      const apptConflict = appts.some(a => {
        if (a.host_id !== host.user_id) return false;
        return overlaps(checkStart, checkEnd, new Date(a.start_time), new Date(a.end_time));
      });
      if (apptConflict) return false;

      const extConflict = busy.some(b =>
        overlaps(checkStart, checkEnd, new Date(b.start_time), new Date(b.end_time))
      );
      return !extConflict;
    });

    if (availableHosts.length === 0) return null;
    if (availableHosts.length === 1) return availableHosts[0].user_id;

    const strategy = (calendar.round_robin_strategy ?? 'balanced') as RoundRobinStrategy;

    switch (strategy) {
      case 'priority_order':
        return availableHosts.sort((a, b) => a.priority - b.priority)[0].user_id;

      case 'weighted':
        return this.selectWeightedHost(availableHosts);

      case 'least_recently_booked':
        return await this.selectLeastRecentlyBookedHost(availableHosts);

      case 'balanced':
      default:
        return await this.selectBalancedHost(availableHosts);
    }
  }

  private static async selectBalancedHost(hosts: CalendarHost[]): Promise<string> {
    const counts: Record<string, number> = {};
    for (const host of hosts) {
      const { count } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('host_id', host.user_id)
        .in('status', ['confirmed', 'pending']);
      counts[host.user_id] = count ?? 0;
    }
    return hosts.sort((a, b) => counts[a.user_id] - counts[b.user_id])[0].user_id;
  }

  private static async selectLeastRecentlyBookedHost(hosts: CalendarHost[]): Promise<string> {
    const lastBooked: Record<string, number> = {};
    for (const host of hosts) {
      const { data } = await supabase
        .from('appointments')
        .select('created_at')
        .eq('host_id', host.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lastBooked[host.user_id] = data ? new Date(data.created_at).getTime() : 0;
    }
    return hosts.sort((a, b) => lastBooked[a.user_id] - lastBooked[b.user_id])[0].user_id;
  }

  private static selectWeightedHost(hosts: CalendarHost[]): string {
    const weighted: string[] = [];
    for (const host of hosts) {
      const weight = Math.max(host.weight, 1);
      for (let i = 0; i < weight; i++) weighted.push(host.user_id);
    }
    return weighted[Math.floor(Math.random() * weighted.length)];
  }

  // ----------------------------------------------------------
  // INTERNAL: COLLECTIVE
  // ----------------------------------------------------------

  private static async checkCollectiveAvailability(
    startTime: Date,
    endTime: Date,
    hostIds: string[],
    checkStart: Date,
    checkEnd: Date,
  ): Promise<boolean> {
    if (hostIds.length === 0) return false;

    const { data: appts } = await supabase
      .from('appointments')
      .select('id, start_time, end_time, status, host_id')
      .in('host_id', hostIds)
      .in('status', ['confirmed', 'pending'])
      .gte('start_time', new Date(checkStart.getTime() - MS_PER_HOUR).toISOString())
      .lte('end_time', new Date(checkEnd.getTime() + MS_PER_HOUR).toISOString());

    const { data: extBusy } = await supabase
      .from('external_busy_periods')
      .select('start_time, end_time')
      .in('user_id', hostIds)
      .gte('start_time', new Date(checkStart.getTime() - MS_PER_HOUR).toISOString())
      .lte('end_time', new Date(checkEnd.getTime() + MS_PER_HOUR).toISOString());

    for (const hostId of hostIds) {
      const hasApptConflict = (appts ?? []).some((a: ExistingAppointment) => {
        if (a.host_id !== hostId) return false;
        return overlaps(checkStart, checkEnd, new Date(a.start_time), new Date(a.end_time));
      });
      if (hasApptConflict) return false;

      const hasExtConflict = (extBusy ?? []).some((b: ExternalBusyPeriod) =>
        overlaps(checkStart, checkEnd, new Date(b.start_time), new Date(b.end_time))
      );
      if (hasExtConflict) return false;
    }
    return true;
  }

  // ----------------------------------------------------------
  // INTERNAL: BOOKING LIMITS
  // ----------------------------------------------------------

  private static async checkBookingLimits(
    calendar: Calendar,
    date: Date,
  ): Promise<{ canBook: boolean; reason?: string }> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Daily
    if (calendar.max_bookings_per_day) {
      const { count } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('calendar_id', calendar.id)
        .in('status', ['confirmed', 'pending'])
        .gte('start_time', dayStart.toISOString())
        .lte('start_time', dayEnd.toISOString());
      if ((count ?? 0) >= calendar.max_bookings_per_day) {
        return { canBook: false, reason: 'Maximum daily bookings reached' };
      }
    }

    // Weekly
    if (calendar.max_bookings_per_week) {
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const { count } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('calendar_id', calendar.id)
        .in('status', ['confirmed', 'pending'])
        .gte('start_time', weekStart.toISOString())
        .lte('start_time', weekEnd.toISOString());
      if ((count ?? 0) >= calendar.max_bookings_per_week) {
        return { canBook: false, reason: 'Maximum weekly bookings reached' };
      }
    }

    // Monthly
    if (calendar.max_bookings_per_month) {
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

      const { count } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('calendar_id', calendar.id)
        .in('status', ['confirmed', 'pending'])
        .gte('start_time', monthStart.toISOString())
        .lte('start_time', monthEnd.toISOString());
      if ((count ?? 0) >= calendar.max_bookings_per_month) {
        return { canBook: false, reason: 'Maximum monthly bookings reached' };
      }
    }

    return { canBook: true };
  }
}
