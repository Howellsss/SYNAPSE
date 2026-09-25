import {
  Zap, Mail, MessageSquare, Tag, Clock, Webhook, FileText, Settings2, GitBranch,
  Users, Calendar, Mic, Sparkles, Phone, Send, Target, Split, Workflow as WorkflowIcon,
  ArrowRightLeft, Bell, Globe, Database, Trash2, Search, UserPlus, UserMinus,
  Edit3, StickyNote, CheckSquare, CalendarPlus, CalendarX, CalendarClock, Link2,
  Download, Upload, AlertTriangle, Flag, Square, Infinity as InfinityIcon,
  type LucideIcon,
} from 'lucide-react';
import type { TriggerType, ActionType, WorkflowVariable } from '@/types';

export interface TriggerOption {
  value: TriggerType;
  label: string;
  icon: LucideIcon;
  category: string;
}

export interface ActionOption {
  value: ActionType;
  label: string;
  icon: LucideIcon;
  category: string;
  description: string;
}

export const TRIGGER_CATEGORIES: TriggerOption[] = [
  // CONTACT
  { value: 'contact_created', label: 'Contact Created', icon: UserPlus, category: 'Contact' },
  { value: 'contact_updated', label: 'Contact Updated', icon: Edit3, category: 'Contact' },
  { value: 'contact_field_changed', label: 'Contact Field Changed', icon: Edit3, category: 'Contact' },
  { value: 'tag_added', label: 'Contact Tag Added', icon: Tag, category: 'Contact' },
  { value: 'tag_removed', label: 'Contact Tag Removed', icon: Tag, category: 'Contact' },
  { value: 'contact_dnd_changed', label: 'Contact DND Changed', icon: Bell, category: 'Contact' },
  { value: 'note_added', label: 'Note Added', icon: StickyNote, category: 'Contact' },
  { value: 'task_created', label: 'Task Created', icon: CheckSquare, category: 'Contact' },
  { value: 'task_completed', label: 'Task Completed', icon: CheckSquare, category: 'Contact' },
  { value: 'birthday', label: 'Birthday', icon: Calendar, category: 'Contact' },
  { value: 'custom_date', label: 'Custom Date', icon: Calendar, category: 'Contact' },
  // FORMS
  { value: 'form_submitted', label: 'Form Submitted', icon: FileText, category: 'Forms' },
  { value: 'survey_submitted', label: 'Survey Submitted', icon: FileText, category: 'Forms' },
  // APPOINTMENTS
  { value: 'appointment_booked', label: 'Appointment Booked', icon: Calendar, category: 'Appointments' },
  { value: 'appointment_confirmed', label: 'Appointment Confirmed', icon: Calendar, category: 'Appointments' },
  { value: 'appointment_rescheduled', label: 'Appointment Rescheduled', icon: ArrowRightLeft, category: 'Appointments' },
  { value: 'appointment_cancelled', label: 'Appointment Cancelled', icon: CalendarX, category: 'Appointments' },
  { value: 'appointment_completed', label: 'Appointment Completed', icon: CheckSquare, category: 'Appointments' },
  { value: 'appointment_no_show', label: 'Appointment No-Show', icon: AlertTriangle, category: 'Appointments' },
  { value: 'appointment_status_changed', label: 'Appointment Status Changed', icon: Edit3, category: 'Appointments' },
  // CALENDARS
  { value: 'calendar_booking_created', label: 'Calendar Booking Created', icon: CalendarPlus, category: 'Calendars' },
  { value: 'calendar_booking_cancelled', label: 'Calendar Booking Cancelled', icon: CalendarX, category: 'Calendars' },
  { value: 'calendar_booking_rescheduled', label: 'Calendar Booking Rescheduled', icon: CalendarClock, category: 'Calendars' },
  { value: 'availability_changed', label: 'Availability Changed', icon: Calendar, category: 'Calendars' },
  // COMMUNICATION
  { value: 'customer_replied', label: 'Customer Replied', icon: MessageSquare, category: 'Communication' },
  { value: 'email_delivered', label: 'Email Delivered', icon: Mail, category: 'Communication' },
  { value: 'email_opened', label: 'Email Opened', icon: Mail, category: 'Communication' },
  { value: 'email_clicked', label: 'Email Clicked', icon: Mail, category: 'Communication' },
  { value: 'email_bounced', label: 'Email Bounced', icon: Mail, category: 'Communication' },
  { value: 'sms_received', label: 'SMS Received', icon: MessageSquare, category: 'Communication' },
  { value: 'sms_delivery_failed', label: 'SMS Delivery Failed', icon: MessageSquare, category: 'Communication' },
  // RECORDINGS
  { value: 'recording_created', label: 'Recording Created', icon: Mic, category: 'Recordings' },
  { value: 'transcript_generated', label: 'Transcript Generated', icon: FileText, category: 'Recordings' },
  { value: 'recording_completed', label: 'Recording Completed', icon: Mic, category: 'Recordings' },
  // AI
  { value: 'ai_agent_event', label: 'AI Agent Event', icon: Sparkles, category: 'AI' },
  { value: 'ai_conversation_completed', label: 'AI Conversation Completed', icon: Sparkles, category: 'AI' },
  { value: 'ai_intent_detected', label: 'AI Intent Detected', icon: Sparkles, category: 'AI' },
  { value: 'ai_qualification_completed', label: 'AI Qualification Completed', icon: Sparkles, category: 'AI' },
  // WORKFLOW
  { value: 'added_to_workflow', label: 'Added to Workflow', icon: WorkflowIcon, category: 'Workflow' },
  { value: 'removed_from_workflow', label: 'Removed from Workflow', icon: WorkflowIcon, category: 'Workflow' },
  { value: 'goal_reached', label: 'Goal Reached', icon: Target, category: 'Workflow' },
  // INTEGRATIONS
  { value: 'inbound_webhook', label: 'Inbound Webhook', icon: Webhook, category: 'Integrations' },
  { value: 'external_event', label: 'External Event', icon: Globe, category: 'Integrations' },
  { value: 'google_calendar_event', label: 'Google Calendar Event', icon: Calendar, category: 'Integrations' },
  { value: 'integration_event', label: 'Integration Event', icon: Database, category: 'Integrations' },
  // SYSTEM
  { value: 'scheduled_trigger', label: 'Scheduled Trigger', icon: Clock, category: 'System' },
  { value: 'custom_trigger', label: 'Custom Trigger', icon: Settings2, category: 'System' },
];

export const ACTION_CATEGORIES: ActionOption[] = [
  // CONTACT
  { value: 'create_contact', label: 'Create Contact', icon: UserPlus, category: 'Contact', description: 'Create a new contact record' },
  { value: 'find_contact', label: 'Find Contact', icon: Search, category: 'Contact', description: 'Find a contact by field' },
  { value: 'update_contact', label: 'Update Contact', icon: Edit3, category: 'Contact', description: 'Update contact fields' },
  { value: 'update_contact_field', label: 'Update Contact Field', icon: Edit3, category: 'Contact', description: 'Update a specific contact field' },
  { value: 'add_tag', label: 'Add Contact Tag', icon: Tag, category: 'Contact', description: 'Add a tag to the contact' },
  { value: 'remove_tag', label: 'Remove Contact Tag', icon: Tag, category: 'Contact', description: 'Remove a tag from the contact' },
  { value: 'add_note', label: 'Add Contact Note', icon: StickyNote, category: 'Contact', description: 'Add a note to the contact' },
  { value: 'create_task', label: 'Create Task', icon: CheckSquare, category: 'Contact', description: 'Create a task for the contact' },
  { value: 'assign_contact', label: 'Assign Contact', icon: UserPlus, category: 'Contact', description: 'Assign contact to a team member' },
  { value: 'remove_assignment', label: 'Remove Assignment', icon: UserMinus, category: 'Contact', description: 'Remove contact assignment' },
  { value: 'add_to_smart_list', label: 'Add to Smart List', icon: Users, category: 'Contact', description: 'Add contact to a smart list' },
  { value: 'remove_from_smart_list', label: 'Remove from Smart List', icon: Users, category: 'Contact', description: 'Remove from a smart list' },
  { value: 'delete_contact', label: 'Delete Contact', icon: Trash2, category: 'Contact', description: 'Delete the contact record' },
  // COMMUNICATION
  { value: 'send_email', label: 'Send Email', icon: Mail, category: 'Communication', description: 'Send an email to the contact' },
  { value: 'send_sms', label: 'Send SMS', icon: MessageSquare, category: 'Communication', description: 'Send an SMS to the contact' },
  { value: 'send_internal_notification', label: 'Send Internal Notification', icon: Bell, category: 'Communication', description: 'Notify a team member' },
  { value: 'send_whatsapp', label: 'Send WhatsApp', icon: MessageSquare, category: 'Communication', description: 'Send a WhatsApp message' },
  { value: 'send_voice_call', label: 'Send Voice / Call', icon: Phone, category: 'Communication', description: 'Trigger a voice call' },
  { value: 'send_booking_link', label: 'Send Booking Link', icon: Link2, category: 'Communication', description: 'Send a booking link' },
  // APPOINTMENTS
  { value: 'update_appointment_status', label: 'Update Appointment Status', icon: Edit3, category: 'Appointments', description: 'Change appointment status' },
  { value: 'cancel_appointment', label: 'Cancel Appointment', icon: CalendarX, category: 'Appointments', description: 'Cancel an appointment' },
  { value: 'reschedule_appointment', label: 'Reschedule Appointment', icon: CalendarClock, category: 'Appointments', description: 'Reschedule an appointment' },
  { value: 'create_appointment', label: 'Create Appointment', icon: CalendarPlus, category: 'Appointments', description: 'Create a new appointment' },
  { value: 'create_one_time_booking_link', label: 'Create One-Time Booking Link', icon: Link2, category: 'Appointments', description: 'Generate a one-time booking link' },
  { value: 'send_appointment_confirmation', label: 'Send Appointment Confirmation', icon: Send, category: 'Appointments', description: 'Send confirmation details' },
  // CALENDARS
  { value: 'create_booking', label: 'Create Booking', icon: CalendarPlus, category: 'Calendars', description: 'Create a calendar booking' },
  { value: 'cancel_booking', label: 'Cancel Booking', icon: CalendarX, category: 'Calendars', description: 'Cancel a calendar booking' },
  { value: 'reschedule_booking', label: 'Reschedule Booking', icon: CalendarClock, category: 'Calendars', description: 'Reschedule a booking' },
  { value: 'check_availability', label: 'Check Availability', icon: Calendar, category: 'Calendars', description: 'Check calendar availability' },
  // FORMS
  { value: 'send_form', label: 'Send Form', icon: FileText, category: 'Forms', description: 'Send a form to the contact' },
  { value: 'create_form_submission', label: 'Create Form Submission', icon: FileText, category: 'Forms', description: 'Create a form submission' },
  { value: 'update_form_submission', label: 'Update Form Submission', icon: Edit3, category: 'Forms', description: 'Update a form submission' },
  // RECORDINGS
  { value: 'attach_recording', label: 'Attach Recording', icon: Mic, category: 'Recordings', description: 'Attach a recording' },
  { value: 'create_recording_note', label: 'Create Recording Note', icon: StickyNote, category: 'Recordings', description: 'Add a note to a recording' },
  { value: 'generate_transcript', label: 'Generate Transcript', icon: FileText, category: 'Recordings', description: 'Generate a transcript' },
  { value: 'generate_ai_summary', label: 'Generate AI Summary', icon: Sparkles, category: 'Recordings', description: 'Generate an AI summary' },
  // AI
  { value: 'ai_action', label: 'AI Agent', icon: Sparkles, category: 'AI', description: 'Run an AI agent action' },
  { value: 'ai_prompt', label: 'AI Prompt', icon: Sparkles, category: 'AI', description: 'Run a custom AI prompt' },
  { value: 'ai_intent_detection', label: 'AI Intent Detection', icon: Sparkles, category: 'AI', description: 'Detect intent from text' },
  { value: 'ai_summarize', label: 'AI Summarize', icon: Sparkles, category: 'AI', description: 'Summarize text with AI' },
  { value: 'ai_extract_info', label: 'AI Extract Information', icon: Sparkles, category: 'AI', description: 'Extract structured information' },
  { value: 'ai_decision_maker', label: 'AI Decision Maker', icon: Sparkles, category: 'AI', description: 'Let AI make a branching decision' },
  // WORKFLOW CONTROL
  { value: 'if_else', label: 'If / Else', icon: GitBranch, category: 'Workflow Control', description: 'Branch based on conditions' },
  { value: 'wait', label: 'Wait', icon: Clock, category: 'Workflow Control', description: 'Pause for a duration or until a condition' },
  { value: 'goal', label: 'Goal', icon: Target, category: 'Workflow Control', description: 'Define a workflow goal' },
  { value: 'split_test', label: 'Split Test', icon: Split, category: 'Workflow Control', description: 'Split contacts between branches' },
  { value: 'go_to_workflow', label: 'Go To Workflow', icon: WorkflowIcon, category: 'Workflow Control', description: 'Send contact to another workflow' },
  { value: 'remove_from_workflow', label: 'Remove from Workflow', icon: UserMinus, category: 'Workflow Control', description: 'Remove contact from this workflow' },
  { value: 'end_workflow', label: 'End Workflow', icon: Square, category: 'Workflow Control', description: 'Terminate this execution' },
  // DATA / INTEGRATIONS
  { value: 'send_webhook', label: 'Webhook', icon: Webhook, category: 'Data / Integrations', description: 'Send a webhook to an external URL' },
  { value: 'http_request', label: 'HTTP Request', icon: Globe, category: 'Data / Integrations', description: 'Make an HTTP request' },
  { value: 'google_calendar', label: 'Google Calendar', icon: Calendar, category: 'Data / Integrations', description: 'Interact with Google Calendar' },
  { value: 'custom_integration', label: 'Custom Integration', icon: Database, category: 'Data / Integrations', description: 'Connect to a custom integration' },
  { value: 'update_custom_value', label: 'Update Custom Value', icon: Settings2, category: 'Data / Integrations', description: 'Update a custom field value' },
];

export const CONDITION_OPERATORS = [
  { value: 'is', label: 'Is' },
  { value: 'is_not', label: 'Is not' },
  { value: 'contains', label: 'Contains' },
  { value: 'does_not_contain', label: 'Does not contain' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
  { value: 'greater_than', label: 'Greater than' },
  { value: 'less_than', label: 'Less than' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'in_list', label: 'In list' },
  { value: 'not_in_list', label: 'Not in list' },
  { value: 'exists', label: 'Exists' },
];

export const CONDITION_FIELDS = [
  { value: 'first_name', label: 'Contact → First Name', group: 'Contact' },
  { value: 'last_name', label: 'Contact → Last Name', group: 'Contact' },
  { value: 'email', label: 'Contact → Email', group: 'Contact' },
  { value: 'phone', label: 'Contact → Phone', group: 'Contact' },
  { value: 'company', label: 'Contact → Company', group: 'Contact' },
  { value: 'job_title', label: 'Contact → Job Title', group: 'Contact' },
  { value: 'source', label: 'Contact → Source', group: 'Contact' },
  { value: 'status', label: 'Contact → Status', group: 'Contact' },
  { value: 'tags', label: 'Contact → Tags', group: 'Contact' },
  { value: 'email_opt_in', label: 'Contact → Email Opt-in', group: 'Contact' },
  { value: 'sms_opt_in', label: 'Contact → SMS Opt-in', group: 'Contact' },
  { value: 'appointment_status', label: 'Appointment → Status', group: 'Appointment' },
  { value: 'appointment_date', label: 'Appointment → Date', group: 'Appointment' },
  { value: 'appointment_calendar', label: 'Appointment → Calendar', group: 'Appointment' },
  { value: 'appointment_host', label: 'Appointment → Host', group: 'Appointment' },
  { value: 'form_name', label: 'Form → Name', group: 'Form' },
  { value: 'form_answers', label: 'Form → Answers', group: 'Form' },
  { value: 'workflow_name', label: 'Workflow → Name', group: 'Workflow' },
  { value: 'recording_status', label: 'Recording → Status', group: 'Recording' },
  { value: 'ai_intent', label: 'AI → Intent', group: 'AI' },
  { value: 'ai_score', label: 'AI → Score', group: 'AI' },
];

export const DYNAMIC_VARIABLES: WorkflowVariable[] = [
  { key: 'contact.first_name', label: 'First Name', group: 'Contact' },
  { key: 'contact.last_name', label: 'Last Name', group: 'Contact' },
  { key: 'contact.email', label: 'Email', group: 'Contact' },
  { key: 'contact.phone', label: 'Phone', group: 'Contact' },
  { key: 'contact.company', label: 'Company', group: 'Contact' },
  { key: 'contact.job_title', label: 'Job Title', group: 'Contact' },
  { key: 'appointment.date', label: 'Appointment Date', group: 'Appointment' },
  { key: 'appointment.time', label: 'Appointment Time', group: 'Appointment' },
  { key: 'appointment.calendar', label: 'Appointment Calendar', group: 'Appointment' },
  { key: 'appointment.host', label: 'Appointment Host', group: 'Appointment' },
  { key: 'appointment.booking_link', label: 'Booking Link', group: 'Appointment' },
  { key: 'form.name', label: 'Form Name', group: 'Form' },
  { key: 'workflow.name', label: 'Workflow Name', group: 'Workflow' },
];

export const WAIT_DURATIONS = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
];

export const WAIT_MODES = [
  { value: 'duration', label: 'Wait for a duration' },
  { value: 'until_datetime', label: 'Wait until a specific date/time' },
  { value: 'until_time', label: 'Wait until a specific time' },
  { value: 'business_hours', label: 'Wait during business hours only' },
  { value: 'until_reply', label: 'Wait until contact replies' },
  { value: 'until_appointment_change', label: 'Wait until appointment changes' },
  { value: 'until_condition', label: 'Wait until condition is true' },
];

export const GOAL_EVENTS = [
  { value: 'appointment_booked', label: 'Appointment Booked' },
  { value: 'appointment_confirmed', label: 'Appointment Confirmed' },
  { value: 'form_submitted', label: 'Form Submitted' },
  { value: 'contact_replied', label: 'Contact Replied' },
  { value: 'tag_added', label: 'Tag Added' },
  { value: 'custom_condition', label: 'Custom Condition Met' },
];

export function getTriggerOption(value: string): TriggerOption | undefined {
  return TRIGGER_CATEGORIES.find((t) => t.value === value);
}

export function getActionOption(value: string): ActionOption | undefined {
  return ACTION_CATEGORIES.find((a) => a.value === value);
}

export function getTriggerCategories(): string[] {
  return [...new Set(TRIGGER_CATEGORIES.map((t) => t.category))];
}

export function getActionCategories(): string[] {
  return [...new Set(ACTION_CATEGORIES.map((a) => a.category))];
}
