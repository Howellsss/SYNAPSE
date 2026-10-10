export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'rescheduled'
  | 'completed'
  | 'no_show';

export type CalendarType =
  | 'one_on_one'
  | 'group'
  | 'round_robin'
  | 'collective'
  | 'event'
  | 'service';

export type LocationType =
  | 'synapse_meeting'
  | 'phone'
  | 'in_person'
  | 'custom'
  | 'none';

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';
export type FormStatus = 'draft' | 'published' | 'inactive' | 'archived';

export type UserRole = 'owner' | 'admin' | 'member';

export type Channel = 'email' | 'sms';
export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'cancelled';

export type TriggerType =
  | 'appointment_booked'
  | 'appointment_confirmed'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'appointment_completed'
  | 'appointment_no_show'
  | 'appointment_status_changed'
  | 'form_submitted'
  | 'survey_submitted'
  | 'contact_created'
  | 'contact_updated'
  | 'contact_field_changed'
  | 'tag_added'
  | 'tag_removed'
  | 'contact_dnd_changed'
  | 'note_added'
  | 'task_created'
  | 'task_completed'
  | 'birthday'
  | 'custom_date'
  | 'calendar_booking_created'
  | 'calendar_booking_cancelled'
  | 'calendar_booking_rescheduled'
  | 'availability_changed'
  | 'customer_replied'
  | 'email_delivered'
  | 'email_opened'
  | 'email_clicked'
  | 'email_bounced'
  | 'sms_received'
  | 'sms_delivery_failed'
  | 'recording_created'
  | 'transcript_generated'
  | 'recording_completed'
  | 'ai_agent_event'
  | 'ai_conversation_completed'
  | 'ai_intent_detected'
  | 'ai_qualification_completed'
  | 'added_to_workflow'
  | 'removed_from_workflow'
  | 'goal_reached'
  | 'inbound_webhook'
  | 'external_event'
  | 'google_calendar_event'
  | 'integration_event'
  | 'scheduled_trigger'
  | 'custom_trigger'
  | 'contact_enters_smart_list';

export type ActionType =
  | 'send_email'
  | 'send_sms'
  | 'send_internal_notification'
  | 'send_whatsapp'
  | 'send_voice_call'
  | 'send_booking_link'
  | 'add_tag'
  | 'remove_tag'
  | 'update_contact'
  | 'update_contact_field'
  | 'add_note'
  | 'create_task'
  | 'assign_contact'
  | 'remove_assignment'
  | 'add_to_smart_list'
  | 'remove_from_smart_list'
  | 'create_contact'
  | 'find_contact'
  | 'delete_contact'
  | 'add_to_smart_list'
  | 'remove_from_smart_list'
  | 'wait'
  | 'send_webhook'
  | 'http_request'
  | 'create_task'
  | 'assign_owner'
  | 'ai_action'
  | 'ai_prompt'
  | 'ai_intent_detection'
  | 'ai_summarize'
  | 'ai_extract_info'
  | 'ai_decision_maker'
  | 'update_appointment_status'
  | 'cancel_appointment'
  | 'reschedule_appointment'
  | 'create_appointment'
  | 'create_one_time_booking_link'
  | 'send_appointment_confirmation'
  | 'create_booking'
  | 'cancel_booking'
  | 'reschedule_booking'
  | 'check_availability'
  | 'send_form'
  | 'create_form_submission'
  | 'update_form_submission'
  | 'attach_recording'
  | 'create_recording_note'
  | 'generate_transcript'
  | 'generate_ai_summary'
  | 'if_else'
  | 'goal'
  | 'split_test'
  | 'go_to_workflow'
  | 'remove_from_workflow'
  | 'end_workflow'
  | 'google_calendar'
  | 'custom_integration'
  | 'update_custom_value';

export type NodeType = 'trigger' | 'action' | 'condition' | 'delay' | 'wait' | 'goal' | 'split_test' | 'branch' | 'end';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  logo_url: string | null;
  timezone: string;
  default_booking_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: UserRole;
  status: 'invited' | 'active' | 'suspended';
  created_at: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface TeamInvitation {
  id: string;
  workspace_id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  invited_by: string | null;
  assigned_calendar_ids: string[];
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  timezone: string;
  language: string;
  avatar_url: string | null;
  avatar_config: AvatarConfig | null;
  media_prefs: MediaPrefs | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// SPACES (the virtual offices shown as "Workspaces" in the UI;
// `Workspace` above is the account/tenant that owns them)
// ============================================================

/** Placeholder until the avatar builder defines its shape. */
export type AvatarConfig = Record<string, unknown>;

export interface MediaPrefs {
  join_muted: boolean;
  join_camera_off: boolean;
  data_saver: boolean;
}

export type SpaceType =
  | 'office'
  | 'coworking'
  | 'classroom'
  | 'event_hall'
  | 'coaching_studio'
  | 'town_square'
  | 'campus'
  | 'custom';

/** Who may enter: account members, only invited people, or anyone holding the guest link. */
export type AccessMode = 'members' | 'invite_only' | 'guest_link';
export type Persistence = 'always_on' | 'scheduled';
export type SpacePermissionKey = 'edit_office' | 'lock_rooms' | 'broadcast' | 'invite';
export type SpacePermissions = Record<SpacePermissionKey, UserRole[]>;

export type ScheduleRecurrence = 'daily' | 'weekdays' | 'weekly' | 'once';
export interface SpaceSchedule {
  /** Local times "HH:MM" in `timezone`. If closes_at <= opens_at the window runs past midnight. */
  opens_at: string;
  closes_at: string;
  recurrence: ScheduleRecurrence;
  /** For 'weekly': 0 = Sunday … 6 = Saturday. */
  days?: number[];
  /** For 'once': "YYYY-MM-DD". */
  date?: string;
  timezone: string;
  calendar_id: string | null;
}

export interface SpaceBranding {
  logo_url?: string | null;
  accent?: string | null;
}

export type RoomType = 'open_area' | 'meeting_room' | 'private_office' | 'stage' | 'quiet_zone' | 'lounge' | 'breakout';
export interface SpaceRoom {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
  lockable: boolean;
  knock_to_enter: boolean;
}
export interface SpaceConfig {
  rooms?: SpaceRoom[];
}

/** solo = 1, small = 2–10, medium = 11–25, large = 26–50, xl = 50+ people. */
export type SizeBand = 'solo' | 'small' | 'medium' | 'large' | 'xl';

export interface Space {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  space_type: SpaceType;
  size_band: SizeBand;
  template_key: string;
  map: Record<string, unknown>;
  capacity: number;
  access_mode: AccessMode;
  guest_link_token: string | null;
  permissions: SpacePermissions;
  persistence: Persistence;
  schedule: SpaceSchedule | null;
  branding: SpaceBranding;
  config: SpaceConfig;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpaceMember {
  space_id: string;
  user_id: string;
  avatar_override: AvatarConfig | null;
  desk_id: string | null;
  last_position: Record<string, unknown> | null;
  first_entered_at: string | null;
}

export type PhoneType = 'mobile' | 'home' | 'work' | 'other';
export type DndChannel = 'email' | 'sms' | 'calls' | 'inbound';

export interface Contact {
  id: string;
  workspace_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  avatar_url: string | null;
  source: string;
  email_opt_in: boolean;
  sms_opt_in: boolean;
  additional_emails?: string[];
  phone_type?: PhoneType | null;
  additional_phones?: { type: PhoneType; number: string }[];
  contact_type?: 'lead' | 'customer' | null;
  timezone?: string | null;
  dnd_all?: boolean;
  /** After the workflows database update. */
  date_of_birth?: string | null;
  dnd_channels?: DndChannel[];
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface SmartList {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  rules: SmartListRule[];
  created_at: string;
  updated_at: string;
}

export interface SmartListRule {
  field: string;
  operator: string;
  value: string;
  logic?: 'AND' | 'OR';
}

export interface Note {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  appointment_id: string | null;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface Calendar {
  id: string;
  workspace_id: string | null;
  owner_id: string | null;
  name: string;
  description: string | null;
  slug: string;
  calendar_type: CalendarType;
  duration_minutes: number;
  slot_interval_minutes: number;
  location_type: LocationType;
  location_url: string | null;
  color: string;
  timezone: string;
  status: 'active' | 'inactive' | 'archived';
  capacity: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_booking_notice_minutes: number;
  max_booking_horizon_days: number;
  max_bookings_per_day: number | null;
  max_bookings_per_week: number | null;
  max_bookings_per_month: number | null;
  cancellation_policy: string;
  booking_flow: 'calendar_first' | 'form_first';
  form_mode: 'default' | 'custom';
  connected_form_id: string | null;
  custom_confirmation_message: string | null;
  custom_redirect_url: string | null;
  embed_config: EmbedConfig;
  round_robin_strategy: string | null;
  price: number | null;
  currency: string;
  logo_url: string | null;
  cover_url: string | null;
  background_color: string | null;
  button_color: string | null;
  font_family: string | null;
  created_at: string;
  updated_at: string;
}

export type FormFieldType =
  | 'first_name'
  | 'last_name'
  | 'text'
  | 'long_text'
  | 'phone'
  | 'email'
  | 'number'
  | 'radio'
  | 'checkbox'
  | 'multi_select'
  | 'dropdown'
  | 'date'
  | 'time'
  | 'file_upload'
  | 'consent'
  | 'hidden';

export type ConditionType =
  | 'show'
  | 'hide'
  | 'require'
  | 'disqualify'
  | 'display_message'
  | 'redirect';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than';

export interface FormFieldCondition {
  id: string;
  form_field_id: string;
  condition_type: ConditionType;
  trigger_field_id: string;
  trigger_operator: ConditionOperator;
  trigger_value: string | null;
  action_config: {
    message?: string;
    redirect_url?: string;
  };
  sort_order: number;
}

export interface EmbedConfig {
  type: 'inline' | 'popup' | 'button';
  button_text?: string;
  button_color?: string;
  width?: string;
  height?: string;
}

export interface BookingLink {
  id: string;
  workspace_id: string | null;
  owner_id: string | null;
  calendar_id: string;
  token: string;
  link_type: 'permanent' | 'one_time';
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  used_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CalendarGroup {
  id: string;
  workspace_id: string | null;
  owner_id: string | null;
  name: string;
  description: string | null;
  slug: string;
  connected_form_id: string | null;
  booking_flow: 'calendar_first' | 'form_first';
  logo_url: string | null;
  cover_url: string | null;
  primary_color: string;
  background_color: string;
  button_color: string;
  font_family: string;
  layout: 'grid' | 'list';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarGroupMember {
  group_id: string;
  calendar_id: string;
  sort_order: number;
}

export interface CalendarGroupAnalytics {
  id: string;
  group_id: string;
  calendar_id: string | null;
  event_type: 'page_view' | 'calendar_selected' | 'booking_started' | 'booking_completed';
  visitor_ip: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AvailabilityRule {
  id: string;
  calendar_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  sort_order: number;
}

export interface AvailabilityOverride {
  id: string;
  calendar_id: string;
  override_date: string;
  type: 'available' | 'blackout';
  start_time: string | null;
  end_time: string | null;
}

export interface Appointment {
  id: string;
  workspace_id: string;
  calendar_id: string;
  contact_id: string;
  host_id: string | null;
  title: string;
  status: AppointmentStatus;
  start_time: string;
  end_time: string;
  timezone: string;
  location_type: string;
  location_url: string | null;
  meeting_link: string | null;
  notes: string | null;
  cancellation_reason: string | null;
  reschedule_token: string | null;
  manage_token: string;
  created_at: string;
  updated_at: string;
}

export interface AppointmentParticipant {
  id: string;
  appointment_id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface Form {
  id: string;
  workspace_id: string;
  owner_id?: string | null;
  name: string;
  description: string | null;
  type: 'form' | 'survey';
  status: FormStatus;
  success_message: string;
  redirect_url: string | null;
  create_contact: boolean;
  update_contact: boolean;
  auto_tags: string[];
  calendar_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormField {
  id: string;
  form_id: string;
  label: string;
  field_type: FormFieldType;
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  default_value: string | null;
  options: string[] | null;
  validation: Record<string, unknown> | null;
  sort_order: number;
  mapped_field: string | null;
  conditions?: FormFieldCondition[];
}

export interface FormSubmission {
  id: string;
  workspace_id: string;
  form_id: string;
  contact_id: string | null;
  appointment_id: string | null;
  answers: Record<string, string>;
  source: string | null;
  created_at: string;
}

export type FormUsageModule = 'calendar' | 'event' | 'webinar' | 'workflow' | 'landing_page' | 'external';

export interface FormUsage {
  id: string;
  form_id: string;
  module: FormUsageModule;
  entity_id: string | null;
  entity_name: string | null;
  created_at: string;
}

export interface Workflow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  total_runs: number;
  last_run_at: string | null;
  settings: WorkflowSettings;
  version_number: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_type: NodeType;
  action_type: string | null;
  config: Record<string, unknown>;
  sort_order: number;
  parent_node_id?: string | null;
  branch_label?: string | null;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  contact_id: string | null;
  appointment_id: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting' | 'skipped';
  current_node_index: number;
  context: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  version_number?: number | null;
  enrollment_id?: string | null;
  trigger_type?: string | null;
}

export interface WorkflowExecutionLog {
  id: string;
  execution_id: string;
  node_id: string | null;
  node_type: string;
  action_type: string | null;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  result: Record<string, unknown> | null;
  error: string | null;
  executed_at: string;
  duration_ms?: number | null;
  retry_count?: number;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
}

export interface Message {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  appointment_id: string | null;
  channel: Channel;
  direction: string;
  subject: string | null;
  body: string;
  status: MessageStatus;
  provider_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface ActionItem {
  text: string;
  done: boolean;
}

export interface Recording {
  id: string;
  workspace_id: string;
  appointment_id: string | null;
  contact_id: string | null;
  title: string;
  duration_seconds: number;
  audio_url: string | null;
  media_url: string | null;
  transcript: string | null;
  ai_summary: string | null;
  key_points: string[];
  action_items: ActionItem[];
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
}

/** An uploaded 3D character (.glb) and the animation clips inside it. */
export interface Character {
  id: string;
  /** Null for the shared SYNAPSE library (all new uploads). */
  workspace_id: string | null;
  name: string;
  storage_path: string;
  size_bytes: number;
  clips: { name: string; duration: number }[];
  default_clip: string | null;
  bones: number;
  triangles: number;
  /** The character everyone appears as in this workspace's spaces (one per workspace). */
  use_in_spaces?: boolean;
  /** Which clip plays for standing, walking, wave and cheer in spaces (chosen on the Characters page). */
  space_clips?: Partial<Record<'idle' | 'walk' | 'wave' | 'cheer', string | null>> | null;
  created_by: string | null;
  created_at: string;
}

export interface Integration {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  status: 'connected' | 'disconnected' | 'error';
  metadata: Record<string, unknown>;
  selected_calendar_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface IntegrationSyncLog {
  id: string;
  integration_id: string;
  sync_type: 'busy_periods' | 'event_writeback' | 'event_cancellation';
  status: 'success' | 'failed' | 'partial';
  error_message: string | null;
  events_synced: number;
  started_at: string;
  completed_at: string | null;
}

export interface Webhook {
  id: string;
  workspace_id: string;
  url: string;
  secret: string | null;
  events: string[];
  is_active: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  workspace_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CalendarHost {
  calendar_id: string;
  user_id: string;
  priority: number;
  weight: number;
  is_primary: boolean;
  created_at: string;
}

export interface WorkflowSettings {
  allow_reentry?: boolean;
  max_reentry_count?: number;
  stop_on_response?: boolean;
  timezone?: string;
  business_hours?: { start: string; end: string; days: number[] };
  execution_time_window?: { start: string; end: string };
  sender_name?: string;
  sender_email?: string;
  error_handling?: 'stop' | 'continue' | 'retry';
  execution_limit?: number;
}

export interface WorkflowVersion {
  id: string;
  workflow_id: string;
  version_number: number;
  status: 'draft' | 'active' | 'archived';
  snapshot: Record<string, unknown>;
  published_at: string | null;
  created_at: string;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  from_node_id: string;
  to_node_id: string;
  branch_label?: string | null;
  sort_order: number;
}

export interface WorkflowEnrollment {
  id: string;
  workflow_id: string;
  contact_id: string;
  status: 'active' | 'completed' | 'failed' | 'removed' | 'goal_reached';
  version_number: number | null;
  context: Record<string, unknown>;
  enrolled_at: string;
  completed_at: string | null;
}

export interface WorkflowGoal {
  id: string;
  workflow_id: string;
  node_id: string | null;
  goal_event: string;
  goal_conditions: Record<string, unknown>;
  stop_on_reach: boolean;
  created_at: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  trigger_type: TriggerType;
  nodes: Record<string, unknown>[];
  settings: Record<string, unknown>;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface WorkflowValidationIssue {
  type: 'error' | 'warning';
  message: string;
  node_id?: string;
  node_label?: string;
}

export interface WorkflowCondition {
  field: string;
  operator: string;
  value: string;
  logic?: 'AND' | 'OR';
}

export interface WorkflowConditionGroup {
  logic: 'AND' | 'OR';
  conditions: WorkflowCondition[];
}

export interface WorkflowVariable {
  key: string;
  label: string;
  group: string;
}
