/*
# Howells Core Schema — Appointment Management Platform (Part 1: Foundation + Forms + Calendars)

Creates the complete database architecture. Tables ordered so foreign key
dependencies resolve correctly: workspaces → contacts/tags → forms → calendars → appointments → workflows → comms → recordings → integrations → webhooks/audit.

All tables have RLS enabled with workspace-membership-scoped policies.
Public (anon) access is granted for booking-page operations on active calendars.
*/

-- ============================================================
-- WORKSPACES & TEAM
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  phone text,
  timezone text DEFAULT 'UTC',
  language text DEFAULT 'en',
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a member of the given workspace?
CREATE OR REPLACE FUNCTION is_workspace_member(check_workspace_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = check_workspace_id AND user_id = auth.uid()
  );
$$;

-- Helper: can the current user access this workspace?
CREATE OR REPLACE FUNCTION can_access_workspace(check_workspace_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_workspace_member(check_workspace_id);
$$;

-- ============================================================
-- CONTACTS (CRM)
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  email text,
  phone text,
  company text,
  job_title text,
  source text DEFAULT 'manual',
  email_opt_in boolean DEFAULT true,
  sms_opt_in boolean DEFAULT true,
  last_activity_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(workspace_id, first_name, last_name);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#394560',
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, name)
);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY(contact_id, tag_id)
);
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS smart_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE smart_lists ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id uuid,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FORMS (before calendars so calendars can FK to forms)
-- ============================================================

CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  type text DEFAULT 'form' CHECK (type IN ('form', 'survey')),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  success_message text DEFAULT 'Thank you for your submission.',
  redirect_url text,
  create_contact boolean DEFAULT true,
  update_contact boolean DEFAULT true,
  auto_tags jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forms_workspace ON forms(workspace_id);
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_type text NOT NULL CHECK (
    field_type IN ('text', 'long_text', 'email', 'phone', 'dropdown', 'radio',
    'checkbox', 'multi_select', 'date', 'time', 'number', 'file', 'hidden',
    'consent', 'rating', 'first_name', 'last_name', 'company')
  ),
  required boolean DEFAULT false,
  placeholder text,
  help_text text,
  default_value text,
  options jsonb,
  validation jsonb,
  sort_order int DEFAULT 0,
  mapped_field text
);
CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields(form_id);
ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  appointment_id uuid,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_submissions_form ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_submissions_contact ON form_submissions(contact_id);
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CALENDARS
-- ============================================================

CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  slug text NOT NULL,
  calendar_type text NOT NULL DEFAULT 'one_on_one' CHECK (
    calendar_type IN ('one_on_one', 'group', 'round_robin', 'collective', 'event', 'service')
  ),
  duration_minutes int NOT NULL DEFAULT 30,
  slot_interval_minutes int DEFAULT 30,
  location_type text DEFAULT 'google_meet' CHECK (
    location_type IN ('google_meet', 'zoom', 'teams', 'phone', 'in_person', 'custom', 'none')
  ),
  location_url text,
  color text DEFAULT '#0D1C3B',
  timezone text DEFAULT 'UTC',
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  capacity int DEFAULT 1,
  buffer_before_minutes int DEFAULT 0,
  buffer_after_minutes int DEFAULT 0,
  min_booking_notice_minutes int DEFAULT 120,
  max_booking_horizon_days int DEFAULT 60,
  max_bookings_per_day int,
  max_bookings_per_week int,
  max_bookings_per_month int,
  cancellation_policy text DEFAULT 'any_time',
  booking_flow text DEFAULT 'calendar_first' CHECK (booking_flow IN ('calendar_first', 'form_first')),
  connected_form_id uuid REFERENCES forms(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_calendars_workspace ON calendars(workspace_id);
CREATE INDEX IF NOT EXISTS idx_calendars_slug ON calendars(slug);
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS calendar_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  slug text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, slug)
);
ALTER TABLE calendar_groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS calendar_group_members (
  group_id uuid NOT NULL REFERENCES calendar_groups(id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  sort_order int DEFAULT 0,
  PRIMARY KEY(group_id, calendar_id)
);
ALTER TABLE calendar_group_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS calendar_hosts (
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  priority int DEFAULT 0,
  weight int DEFAULT 1,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY(calendar_id, user_id)
);
ALTER TABLE calendar_hosts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time text NOT NULL,
  end_time text NOT NULL,
  sort_order int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_avail_rules_calendar ON availability_rules(calendar_id);
ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS availability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('available', 'blackout')),
  start_time text,
  end_time text
);
CREATE INDEX IF NOT EXISTS idx_avail_overrides_calendar ON availability_overrides(calendar_id, override_date);
ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- APPOINTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  host_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'confirmed', 'cancelled', 'rescheduled', 'completed', 'no_show')
  ),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  timezone text DEFAULT 'UTC',
  location_type text DEFAULT 'google_meet',
  location_url text,
  meeting_link text,
  notes text,
  cancellation_reason text,
  reschedule_token text,
  manage_token text NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appts_workspace ON appointments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_appts_calendar ON appointments(calendar_id);
CREATE INDEX IF NOT EXISTS idx_appts_contact ON appointments(contact_id);
CREATE INDEX IF NOT EXISTS idx_appts_start ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appts_status ON appointments(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_appts_manage_token ON appointments(manage_token);
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Now link form_submissions.appointment_id to appointments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'form_submissions_appointment_id_fkey'
  ) THEN
    ALTER TABLE form_submissions
    ADD CONSTRAINT form_submissions_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS appointment_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE appointment_participants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- WORKFLOWS
-- ============================================================

CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  trigger_type text NOT NULL,
  trigger_config jsonb DEFAULT '{}'::jsonb,
  total_runs int DEFAULT 0,
  last_run_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_type text NOT NULL CHECK (node_type IN ('action', 'condition', 'delay')),
  action_type text,
  config jsonb DEFAULT '{}'::jsonb,
  sort_order int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes ON workflow_nodes(workflow_id);
ALTER TABLE workflow_nodes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  status text DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  current_node_index int DEFAULT 0,
  context jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wf_exec_workflow ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_exec_contact ON workflow_executions(contact_id);
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workflow_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  node_id uuid REFERENCES workflow_nodes(id) ON DELETE SET NULL,
  node_type text,
  action_type text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  result jsonb,
  error text,
  executed_at timestamptz DEFAULT now()
);
ALTER TABLE workflow_execution_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- COMMUNICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  direction text DEFAULT 'outbound',
  subject text,
  body text,
  status text DEFAULT 'queued' CHECK (
    status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'cancelled')
  ),
  provider_message_id text,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_workspace ON messages(workspace_id);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN ('booking_confirmation', 'booking_cancellation', 'rescheduling',
    'reminder', 'follow_up', 'host_notification')
  ),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient text NOT NULL CHECK (recipient IN ('contact', 'host', 'both')),
  template text,
  offset_minutes int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RECORDINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  title text NOT NULL,
  duration_seconds int DEFAULT 0,
  media_url text,
  transcript text,
  ai_summary text,
  key_points jsonb DEFAULT '[]'::jsonb,
  action_items jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recordings_workspace ON recordings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_recordings_appointment ON recordings(appointment_id);
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- INTEGRATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google_calendar', 'outlook', 'zoom', 'stripe')),
  status text DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS external_busy_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  external_event_id text,
  source text DEFAULT 'google_calendar',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_busy_periods_user ON external_busy_periods(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_busy_periods_workspace ON external_busy_periods(workspace_id);
ALTER TABLE external_busy_periods ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- WEBHOOKS & AUDIT
-- ============================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  last_triggered_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_logs(workspace_id, created_at DESC);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES — AUTHENTICATED (workspace-scoped)
-- ============================================================

-- Profiles
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Workspaces
DROP POLICY IF EXISTS "workspaces_select" ON workspaces;
CREATE POLICY "workspaces_select" ON workspaces FOR SELECT TO authenticated USING (is_workspace_member(id));
DROP POLICY IF EXISTS "workspaces_insert" ON workspaces;
CREATE POLICY "workspaces_insert" ON workspaces FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "workspaces_update" ON workspaces;
CREATE POLICY "workspaces_update" ON workspaces FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Workspace members
DROP POLICY IF EXISTS "wm_select" ON workspace_members;
CREATE POLICY "wm_select" ON workspace_members FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "wm_insert_self" ON workspace_members;
CREATE POLICY "wm_insert_self" ON workspace_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "wm_update" ON workspace_members;
CREATE POLICY "wm_update" ON workspace_members FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Contacts
DROP POLICY IF EXISTS "contacts_select" ON contacts;
CREATE POLICY "contacts_select" ON contacts FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "contacts_insert" ON contacts;
CREATE POLICY "contacts_insert" ON contacts FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "contacts_update" ON contacts;
CREATE POLICY "contacts_update" ON contacts FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "contacts_delete" ON contacts;
CREATE POLICY "contacts_delete" ON contacts FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Tags
DROP POLICY IF EXISTS "tags_select" ON tags;
CREATE POLICY "tags_select" ON tags FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "tags_insert" ON tags;
CREATE POLICY "tags_insert" ON tags FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "tags_update" ON tags;
CREATE POLICY "tags_update" ON tags FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "tags_delete" ON tags;
CREATE POLICY "tags_delete" ON tags FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Contact tags
DROP POLICY IF EXISTS "contact_tags_select" ON contact_tags;
CREATE POLICY "contact_tags_select" ON contact_tags FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND can_access_workspace(contacts.workspace_id)));
DROP POLICY IF EXISTS "contact_tags_insert" ON contact_tags;
CREATE POLICY "contact_tags_insert" ON contact_tags FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND can_access_workspace(contacts.workspace_id)));
DROP POLICY IF EXISTS "contact_tags_delete" ON contact_tags;
CREATE POLICY "contact_tags_delete" ON contact_tags FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND can_access_workspace(contacts.workspace_id)));

-- Smart Lists
DROP POLICY IF EXISTS "smart_lists_select" ON smart_lists;
CREATE POLICY "smart_lists_select" ON smart_lists FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "smart_lists_insert" ON smart_lists;
CREATE POLICY "smart_lists_insert" ON smart_lists FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "smart_lists_update" ON smart_lists;
CREATE POLICY "smart_lists_update" ON smart_lists FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "smart_lists_delete" ON smart_lists;
CREATE POLICY "smart_lists_delete" ON smart_lists FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Notes
DROP POLICY IF EXISTS "notes_select" ON notes;
CREATE POLICY "notes_select" ON notes FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "notes_insert" ON notes;
CREATE POLICY "notes_insert" ON notes FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "notes_update" ON notes;
CREATE POLICY "notes_update" ON notes FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "notes_delete" ON notes;
CREATE POLICY "notes_delete" ON notes FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Forms
DROP POLICY IF EXISTS "forms_select" ON forms;
CREATE POLICY "forms_select" ON forms FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "forms_insert" ON forms;
CREATE POLICY "forms_insert" ON forms FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "forms_update" ON forms;
CREATE POLICY "forms_update" ON forms FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "forms_delete" ON forms;
CREATE POLICY "forms_delete" ON forms FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Form Fields
DROP POLICY IF EXISTS "form_fields_select" ON form_fields;
CREATE POLICY "form_fields_select" ON form_fields FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM forms WHERE forms.id = form_fields.form_id AND can_access_workspace(forms.workspace_id)));
DROP POLICY IF EXISTS "form_fields_insert" ON form_fields;
CREATE POLICY "form_fields_insert" ON form_fields FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM forms WHERE forms.id = form_fields.form_id AND can_access_workspace(forms.workspace_id)));
DROP POLICY IF EXISTS "form_fields_update" ON form_fields;
CREATE POLICY "form_fields_update" ON form_fields FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM forms WHERE forms.id = form_fields.form_id AND can_access_workspace(forms.workspace_id)));
DROP POLICY IF EXISTS "form_fields_delete" ON form_fields;
CREATE POLICY "form_fields_delete" ON form_fields FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM forms WHERE forms.id = form_fields.form_id AND can_access_workspace(forms.workspace_id)));

-- Form Submissions
DROP POLICY IF EXISTS "submissions_select" ON form_submissions;
CREATE POLICY "submissions_select" ON form_submissions FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "submissions_insert" ON form_submissions;
CREATE POLICY "submissions_insert" ON form_submissions FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "submissions_update" ON form_submissions;
CREATE POLICY "submissions_update" ON form_submissions FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "submissions_delete" ON form_submissions;
CREATE POLICY "submissions_delete" ON form_submissions FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Calendars
DROP POLICY IF EXISTS "calendars_select" ON calendars;
CREATE POLICY "calendars_select" ON calendars FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "calendars_insert" ON calendars;
CREATE POLICY "calendars_insert" ON calendars FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "calendars_update" ON calendars;
CREATE POLICY "calendars_update" ON calendars FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "calendars_delete" ON calendars;
CREATE POLICY "calendars_delete" ON calendars FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Calendar Groups
DROP POLICY IF EXISTS "cal_groups_select" ON calendar_groups;
CREATE POLICY "cal_groups_select" ON calendar_groups FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "cal_groups_insert" ON calendar_groups;
CREATE POLICY "cal_groups_insert" ON calendar_groups FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "cal_groups_update" ON calendar_groups;
CREATE POLICY "cal_groups_update" ON calendar_groups FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "cal_groups_delete" ON calendar_groups;
CREATE POLICY "cal_groups_delete" ON calendar_groups FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Calendar Group Members
DROP POLICY IF EXISTS "cal_group_members_select" ON calendar_group_members;
CREATE POLICY "cal_group_members_select" ON calendar_group_members FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM calendar_groups WHERE calendar_groups.id = calendar_group_members.group_id AND can_access_workspace(calendar_groups.workspace_id)));
DROP POLICY IF EXISTS "cal_group_members_insert" ON calendar_group_members;
CREATE POLICY "cal_group_members_insert" ON calendar_group_members FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM calendar_groups WHERE calendar_groups.id = calendar_group_members.group_id AND can_access_workspace(calendar_groups.workspace_id)));
DROP POLICY IF EXISTS "cal_group_members_delete" ON calendar_group_members;
CREATE POLICY "cal_group_members_delete" ON calendar_group_members FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM calendar_groups WHERE calendar_groups.id = calendar_group_members.group_id AND can_access_workspace(calendar_groups.workspace_id)));

-- Calendar Hosts
DROP POLICY IF EXISTS "cal_hosts_select" ON calendar_hosts;
CREATE POLICY "cal_hosts_select" ON calendar_hosts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = calendar_hosts.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "cal_hosts_insert" ON calendar_hosts;
CREATE POLICY "cal_hosts_insert" ON calendar_hosts FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = calendar_hosts.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "cal_hosts_delete" ON calendar_hosts;
CREATE POLICY "cal_hosts_delete" ON calendar_hosts FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = calendar_hosts.calendar_id AND can_access_workspace(calendars.workspace_id)));

-- Availability Rules
DROP POLICY IF EXISTS "avail_rules_select" ON availability_rules;
CREATE POLICY "avail_rules_select" ON availability_rules FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "avail_rules_insert" ON availability_rules;
CREATE POLICY "avail_rules_insert" ON availability_rules FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "avail_rules_update" ON availability_rules;
CREATE POLICY "avail_rules_update" ON availability_rules FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "avail_rules_delete" ON availability_rules;
CREATE POLICY "avail_rules_delete" ON availability_rules FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));

-- Availability Overrides
DROP POLICY IF EXISTS "avail_overrides_select" ON availability_overrides;
CREATE POLICY "avail_overrides_select" ON availability_overrides FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_overrides.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "avail_overrides_insert" ON availability_overrides;
CREATE POLICY "avail_overrides_insert" ON availability_overrides FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_overrides.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "avail_overrides_update" ON availability_overrides;
CREATE POLICY "avail_overrides_update" ON availability_overrides FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_overrides.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "avail_overrides_delete" ON availability_overrides;
CREATE POLICY "avail_overrides_delete" ON availability_overrides FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = availability_overrides.calendar_id AND can_access_workspace(calendars.workspace_id)));

-- Appointments
DROP POLICY IF EXISTS "appts_select" ON appointments;
CREATE POLICY "appts_select" ON appointments FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "appts_insert" ON appointments;
CREATE POLICY "appts_insert" ON appointments FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "appts_update" ON appointments;
CREATE POLICY "appts_update" ON appointments FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "appts_delete" ON appointments;
CREATE POLICY "appts_delete" ON appointments FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Appointment Participants
DROP POLICY IF EXISTS "appt_participants_select" ON appointment_participants;
CREATE POLICY "appt_participants_select" ON appointment_participants FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM appointments WHERE appointments.id = appointment_participants.appointment_id AND can_access_workspace(appointments.workspace_id)));
DROP POLICY IF EXISTS "appt_participants_insert" ON appointment_participants;
CREATE POLICY "appt_participants_insert" ON appointment_participants FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM appointments WHERE appointments.id = appointment_participants.appointment_id AND can_access_workspace(appointments.workspace_id)));
DROP POLICY IF EXISTS "appt_participants_delete" ON appointment_participants;
CREATE POLICY "appt_participants_delete" ON appointment_participants FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM appointments WHERE appointments.id = appointment_participants.appointment_id AND can_access_workspace(appointments.workspace_id)));

-- Workflows
DROP POLICY IF EXISTS "workflows_select" ON workflows;
CREATE POLICY "workflows_select" ON workflows FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "workflows_insert" ON workflows;
CREATE POLICY "workflows_insert" ON workflows FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "workflows_update" ON workflows;
CREATE POLICY "workflows_update" ON workflows FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "workflows_delete" ON workflows;
CREATE POLICY "workflows_delete" ON workflows FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Workflow Nodes
DROP POLICY IF EXISTS "wf_nodes_select" ON workflow_nodes;
CREATE POLICY "wf_nodes_select" ON workflow_nodes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_nodes.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_nodes_insert" ON workflow_nodes;
CREATE POLICY "wf_nodes_insert" ON workflow_nodes FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_nodes.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_nodes_update" ON workflow_nodes;
CREATE POLICY "wf_nodes_update" ON workflow_nodes FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_nodes.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_nodes_delete" ON workflow_nodes;
CREATE POLICY "wf_nodes_delete" ON workflow_nodes FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_nodes.workflow_id AND can_access_workspace(workflows.workspace_id)));

-- Workflow Executions
DROP POLICY IF EXISTS "wf_exec_select" ON workflow_executions;
CREATE POLICY "wf_exec_select" ON workflow_executions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_executions.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_exec_insert" ON workflow_executions;
CREATE POLICY "wf_exec_insert" ON workflow_executions FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_executions.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_exec_update" ON workflow_executions;
CREATE POLICY "wf_exec_update" ON workflow_executions FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_executions.workflow_id AND can_access_workspace(workflows.workspace_id)));

-- Workflow Execution Logs
DROP POLICY IF EXISTS "wf_exec_logs_select" ON workflow_execution_logs;
CREATE POLICY "wf_exec_logs_select" ON workflow_execution_logs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM workflow_executions WHERE workflow_executions.id = workflow_execution_logs.execution_id AND
  EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_executions.workflow_id AND can_access_workspace(workflows.workspace_id))));
DROP POLICY IF EXISTS "wf_exec_logs_insert" ON workflow_execution_logs;
CREATE POLICY "wf_exec_logs_insert" ON workflow_execution_logs FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM workflow_executions WHERE workflow_executions.id = workflow_execution_logs.execution_id AND
  EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_executions.workflow_id AND can_access_workspace(workflows.workspace_id))));

-- Messages
DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update" ON messages FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));

-- Notification Rules
DROP POLICY IF EXISTS "notif_rules_select" ON notification_rules;
CREATE POLICY "notif_rules_select" ON notification_rules FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = notification_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "notif_rules_insert" ON notification_rules;
CREATE POLICY "notif_rules_insert" ON notification_rules FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = notification_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "notif_rules_update" ON notification_rules;
CREATE POLICY "notif_rules_update" ON notification_rules FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = notification_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));
DROP POLICY IF EXISTS "notif_rules_delete" ON notification_rules;
CREATE POLICY "notif_rules_delete" ON notification_rules FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM calendars WHERE calendars.id = notification_rules.calendar_id AND can_access_workspace(calendars.workspace_id)));

-- Recordings
DROP POLICY IF EXISTS "recordings_select" ON recordings;
CREATE POLICY "recordings_select" ON recordings FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "recordings_insert" ON recordings;
CREATE POLICY "recordings_insert" ON recordings FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "recordings_update" ON recordings;
CREATE POLICY "recordings_update" ON recordings FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "recordings_delete" ON recordings;
CREATE POLICY "recordings_delete" ON recordings FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Integrations
DROP POLICY IF EXISTS "integrations_select" ON integrations;
CREATE POLICY "integrations_select" ON integrations FOR SELECT TO authenticated USING (user_id = auth.uid() OR can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "integrations_insert" ON integrations;
CREATE POLICY "integrations_insert" ON integrations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "integrations_update" ON integrations;
CREATE POLICY "integrations_update" ON integrations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "integrations_delete" ON integrations;
CREATE POLICY "integrations_delete" ON integrations FOR DELETE TO authenticated USING (user_id = auth.uid());

-- External Busy Periods
DROP POLICY IF EXISTS "busy_periods_select" ON external_busy_periods;
CREATE POLICY "busy_periods_select" ON external_busy_periods FOR SELECT TO authenticated USING (user_id = auth.uid() OR can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "busy_periods_insert" ON external_busy_periods;
CREATE POLICY "busy_periods_insert" ON external_busy_periods FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "busy_periods_delete" ON external_busy_periods;
CREATE POLICY "busy_periods_delete" ON external_busy_periods FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Webhooks
DROP POLICY IF EXISTS "webhooks_select" ON webhooks;
CREATE POLICY "webhooks_select" ON webhooks FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "webhooks_insert" ON webhooks;
CREATE POLICY "webhooks_insert" ON webhooks FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "webhooks_update" ON webhooks;
CREATE POLICY "webhooks_update" ON webhooks FOR UPDATE TO authenticated USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "webhooks_delete" ON webhooks;
CREATE POLICY "webhooks_delete" ON webhooks FOR DELETE TO authenticated USING (can_access_workspace(workspace_id));

-- Audit Logs
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT TO authenticated WITH CHECK (can_access_workspace(workspace_id));

-- ============================================================
-- RLS POLICIES — PUBLIC (anon, for booking pages)
-- ============================================================

DROP POLICY IF EXISTS "calendars_public_select" ON calendars;
CREATE POLICY "calendars_public_select" ON calendars FOR SELECT TO anon, authenticated
USING (status = 'active');

DROP POLICY IF EXISTS "avail_rules_public_select" ON availability_rules;
CREATE POLICY "avail_rules_public_select" ON availability_rules FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "avail_overrides_public_select" ON availability_overrides;
CREATE POLICY "avail_overrides_public_select" ON availability_overrides FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "appts_public_select" ON appointments;
CREATE POLICY "appts_public_select" ON appointments FOR SELECT TO anon, authenticated
USING (status IN ('confirmed', 'pending'));

DROP POLICY IF EXISTS "contacts_public_insert" ON contacts;
CREATE POLICY "contacts_public_insert" ON contacts FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "appts_public_insert" ON appointments;
CREATE POLICY "appts_public_insert" ON appointments FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "submissions_public_insert" ON form_submissions;
CREATE POLICY "submissions_public_insert" ON form_submissions FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "forms_public_select" ON forms;
CREATE POLICY "forms_public_select" ON forms FOR SELECT TO anon, authenticated
USING (status = 'published');

DROP POLICY IF EXISTS "form_fields_public_select" ON form_fields;
CREATE POLICY "form_fields_public_select" ON form_fields FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "appts_public_update" ON appointments;
CREATE POLICY "appts_public_update" ON appointments FOR UPDATE TO anon, authenticated
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "cal_groups_public_select" ON calendar_groups;
CREATE POLICY "cal_groups_public_select" ON calendar_groups FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "cal_group_members_public_select" ON calendar_group_members;
CREATE POLICY "cal_group_members_public_select" ON calendar_group_members FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "cal_hosts_public_select" ON calendar_hosts;
CREATE POLICY "cal_hosts_public_select" ON calendar_hosts FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "appt_participants_public_select" ON appointment_participants;
CREATE POLICY "appt_participants_public_select" ON appointment_participants FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "appt_participants_public_insert" ON appointment_participants;
CREATE POLICY "appt_participants_public_insert" ON appointment_participants FOR INSERT TO anon, authenticated WITH CHECK (true);
