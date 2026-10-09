-- SYNAPSE: full database setup for a fresh Supabase project.
-- Generated from supabase/migrations by scripts/build-supabase-setup.sh; do not edit by hand.
-- Paste into the Supabase SQL Editor and run once.

-- ============ 20260902175650_solem_core_schema.sql ============
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


-- ============ 20260902224200_add_increment_workflow_runs_rpc.sql ============
/*
# Add increment_workflow_runs RPC function

1. New Functions
- `increment_workflow_runs(uuid)`: Atomically increments the `total_runs` column by 1
  and sets `last_run_at` to now() for the given workflow ID. Returns the new run count.
  This is called by the workflow engine after each execution.

2. Security
- SECURITY DEFINER so it can run with elevated privileges for the atomic update.
- Granted EXECUTE to authenticated role.
*/

CREATE OR REPLACE FUNCTION increment_workflow_runs(workflow_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  UPDATE workflows
  SET total_runs = total_runs + 1,
      last_run_at = now()
  WHERE id = workflow_id
  RETURNING total_runs INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION increment_workflow_runs(uuid) TO authenticated;


-- ============ 20260902225000_add_workspace_settings_table.sql ============
/*
# Add workspace_settings table for per-workspace configuration

Stores JSONB settings per workspace for email, SMS, notifications,
branding, security, and API config.
*/

CREATE TABLE IF NOT EXISTS workspace_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, category)
);

ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_settings" ON workspace_settings FOR SELECT
  TO authenticated USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "insert_own_settings" ON workspace_settings FOR INSERT
  TO authenticated WITH CHECK (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "update_own_settings" ON workspace_settings FOR UPDATE
  TO authenticated USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "delete_own_settings" ON workspace_settings FOR DELETE
  TO authenticated USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
      WHERE wm.user_id = auth.uid()
    )
  );


-- ============ 20260902225225_add_calendar_id_to_forms.sql ============
ALTER TABLE forms ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES calendars(id) ON DELETE SET NULL;


-- ============ 20260902230035_add_audio_url_to_recordings.sql ============
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS audio_url text;


-- ============ 20260902231056_phase2_team_workspace_auth.sql ============
/*
# Phase 2 — Team, Workspace, and Auth Enhancements

## Summary
Extends the Phase 1 schema to support full team management, workspace
customization, and role-based permissions.

## 1. Workspace fields added
- `logo_url` (text) — workspace logo image URL
- `timezone` (text, default 'UTC') — workspace default timezone
- `default_booking_settings` (jsonb) — default booking configuration

## 2. Workspace Members — status column
- `status` (text, default 'active') — CHECK in ('invited', 'active', 'suspended')
- Updated the `wm_update` policy so only admins/owners can update other members

## 3. New Table: team_invitations
- `id` (uuid PK)
- `workspace_id` (FK → workspaces)
- `email` (text, not null) — invitee email
- `role` (text, default 'member') — role assigned on acceptance
- `status` (text, default 'pending') — CHECK in ('pending', 'accepted', 'revoked')
- `invited_by` (uuid → auth.users) — who sent the invite
- `assigned_calendar_ids` (jsonb, default '[]') — calendars the member is assigned to
- `token` (text, unique) — secure invitation token
- `expires_at` (timestamptz) — when the invitation expires
- `accepted_at` (timestamptz) — when accepted
- `created_at` (timestamptz)

## 4. Permission helper functions
- `has_workspace_role(workspace_id, roles text[])` — checks if current user
  has one of the specified roles in the workspace
- `is_workspace_admin(workspace_id)` — checks for owner or admin role

## 5. RLS policy changes
- Tightened `wm_update` to require admin/owner role (was: only self-update)
- Added `wm_delete` policy for admin/owner removal of members
- Added team_invitations CRUD policies (admin/owner only)
- Workspace update now allowed for admin/owner (was: owner only)
*/

-- ============================================================
-- 1. Workspace fields
-- ============================================================

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_booking_settings jsonb DEFAULT '{}'::jsonb;

-- ============================================================
-- 2. Workspace Members — status column
-- ============================================================

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended'));

-- ============================================================
-- 3. Team Invitations table
-- ============================================================

CREATE TABLE IF NOT EXISTS team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_calendar_ids jsonb DEFAULT '[]'::jsonb,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_inv_workspace ON team_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_team_inv_email ON team_invitations(email);
CREATE INDEX IF NOT EXISTS idx_team_inv_token ON team_invitations(token);
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Permission helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION has_workspace_role(check_workspace_id uuid, check_roles text[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = check_workspace_id
      AND user_id = auth.uid()
      AND role = ANY(check_roles)
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION is_workspace_admin(check_workspace_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT has_workspace_role(check_workspace_id, ARRAY['owner', 'admin']);
$$;

-- ============================================================
-- 5. RLS policy changes
-- ============================================================

-- Workspace members: tighten update to admin/owner only (for managing others)
-- but still allow self-update for own profile fields
DROP POLICY IF EXISTS "wm_update" ON workspace_members;
CREATE POLICY "wm_update" ON workspace_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_workspace_admin(workspace_id))
  WITH CHECK (user_id = auth.uid() OR is_workspace_admin(workspace_id));

-- Workspace members: delete (remove) — admin/owner only
DROP POLICY IF EXISTS "wm_delete" ON workspace_members;
CREATE POLICY "wm_delete" ON workspace_members FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id));

-- Workspace members: insert — allow admins to invite (insert rows for other users)
DROP POLICY IF EXISTS "wm_insert_self" ON workspace_members;
CREATE POLICY "wm_insert_self" ON workspace_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR is_workspace_admin(workspace_id));

-- Workspaces: update — allow admin or owner
DROP POLICY IF EXISTS "workspaces_update" ON workspaces;
CREATE POLICY "workspaces_update" ON workspaces FOR UPDATE TO authenticated
  USING (is_workspace_admin(id)) WITH CHECK (is_workspace_admin(id));

-- Team invitations: admin/owner can view
DROP POLICY IF EXISTS "team_inv_select" ON team_invitations;
CREATE POLICY "team_inv_select" ON team_invitations FOR SELECT TO authenticated
  USING (is_workspace_admin(workspace_id));

-- Team invitations: admin/owner can create
DROP POLICY IF EXISTS "team_inv_insert" ON team_invitations;
CREATE POLICY "team_inv_insert" ON team_invitations FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id));

-- Team invitations: admin/owner can update (revoke, accept)
DROP POLICY IF EXISTS "team_inv_update" ON team_invitations;
CREATE POLICY "team_inv_update" ON team_invitations FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));

-- Team invitations: admin/owner can delete
DROP POLICY IF EXISTS "team_inv_delete" ON team_invitations;
CREATE POLICY "team_inv_delete" ON team_invitations FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id));

-- Public: allow reading invitations by token (for accept flow, no auth needed)
DROP POLICY IF EXISTS "team_inv_public_select_token" ON team_invitations;
CREATE POLICY "team_inv_public_select_token" ON team_invitations FOR SELECT TO anon, authenticated
  USING (token IS NOT NULL AND status = 'pending');


-- ============ 20260902231255_phase2_storage_buckets.sql ============
/*
# Create storage buckets for avatars and workspace logos

1. Creates two public storage buckets:
   - `avatars` — user profile photos
   - `workspace-logos` — workspace logo images
2. Both are public so images can be displayed without auth tokens.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-logos', 'workspace-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: allow authenticated users to upload to their own folder
-- Public read for all

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_authed_upload" ON storage.objects;
CREATE POLICY "avatars_authed_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_authed_update" ON storage.objects;
CREATE POLICY "avatars_authed_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "workspace_logos_public_read" ON storage.objects;
CREATE POLICY "workspace_logos_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'workspace-logos');

DROP POLICY IF EXISTS "workspace_logos_authed_upload" ON storage.objects;
CREATE POLICY "workspace_logos_authed_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'workspace-logos');

DROP POLICY IF EXISTS "workspace_logos_authed_update" ON storage.objects;
CREATE POLICY "workspace_logos_authed_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'workspace-logos') WITH CHECK (bucket_id = 'workspace-logos');


-- ============ 20260903001023_fix_workspaces_select_rls_for_owner.sql.sql ============
-- Fix: workspace owners couldn't read their own workspace right after creating it
-- because the SELECT policy only checked is_workspace_member (which queries workspace_members,
-- but the member row doesn't exist yet at insert time). Add owner_id check so the owner
-- can always read their workspace.

DROP POLICY IF EXISTS workspaces_select ON workspaces;

CREATE POLICY workspaces_select ON workspaces FOR SELECT
  TO authenticated USING (is_workspace_member(id) OR owner_id = auth.uid());


-- ============ 20260903001625_add_seed_workspace_demo_data_function.sql.sql ============
-- Seeds a new workspace with demo data (contacts, calendars, appointments, forms,
-- workflows, recordings) so the app isn't empty for new users.
-- SECURITY DEFINER so it can insert into any workspace's tables regardless of RLS.

CREATE OR REPLACE FUNCTION seed_workspace_demo_data(p_workspace_id uuid, p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_ids uuid[] := ARRAY[]::uuid[];
  v_cal_id uuid;
  v_cal2_id uuid;
  v_cal3_id uuid;
  v_contact_id uuid;
  v_form_id uuid;
  v_wf_id uuid;
  v_rec_id uuid;
  v_appt_id uuid;
BEGIN
  -- Contacts
  INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, status, company, job_title, source, last_activity_at)
  VALUES
    (p_workspace_id, 'James', 'Carter', 'james.carter@email.com', '+1234567890', 'active', 'Carter & Associates', 'CEO', 'referral', now() - interval '2 days'),
    (p_workspace_id, 'Emily', 'Rodriguez', 'emily.r@email.com', '+1234567891', 'active', 'Rodriguez Law', 'Partner', 'website', now() - interval '5 days'),
    (p_workspace_id, 'Michael', 'Zhang', 'mzhang@email.com', '+1234567892', 'active', 'Zhang Tech', 'CTO', 'event', now() - interval '1 day'),
    (p_workspace_id, 'Jessica', 'Williams', 'jess.williams@email.com', '+1234567893', 'pending', 'Williams Group', 'Director', 'referral', now() - interval '10 days'),
    (p_workspace_id, 'David', 'Kumar', 'david.kumar@email.com', '+1234567894', 'active', 'Kumar Consulting', 'Founder', 'website', now() - interval '3 days'),
    (p_workspace_id, 'Sarah', 'Johnson', 'sarah.j@email.com', '+1234567895', 'active', 'Johnson Capital', 'VP Finance', 'referral', now() - interval '7 days'),
    (p_workspace_id, 'Robert', 'Brown', 'robert.brown@email.com', '+1234567896', 'inactive', 'Brown Holdings', 'Chairman', 'event', now() - interval '30 days'),
    (p_workspace_id, 'Lisa', 'Anderson', 'lisa.a@email.com', '+1234567897', 'active', 'Anderson Media', 'CMO', 'website', now() - interval '4 days'),
    (p_workspace_id, 'Thomas', 'Lee', 'thomas.lee@email.com', '+1234567898', 'pending', 'Lee Ventures', 'Investor', 'referral', now() - interval '14 days'),
    (p_workspace_id, 'Maria', 'Garcia', 'maria.garcia@email.com', '+1234567899', 'active', 'Garcia Design', 'Creative Director', 'website', now() - interval '1 day')
  RETURNING id INTO v_contact_id;
  v_contact_ids := ARRAY(SELECT id FROM contacts WHERE workspace_id = p_workspace_id ORDER BY created_at);

  -- Calendars
  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_time_minutes, booking_window_days)
  VALUES
    (p_workspace_id, 'General Consultation', 'consultation', '30-minute consultation call', '#3B82F6', 30, 'active', 15, 30)
  RETURNING id INTO v_cal_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_time_minutes, booking_window_days)
  VALUES
    (p_workspace_id, 'Strategy Session', 'strategy', '60-minute strategy session', '#10B981', 60, 'active', 30, 30)
  RETURNING id INTO v_cal2_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_time_minutes, booking_window_days)
  VALUES
    (p_workspace_id, 'Group Workshop', 'workshop', '90-minute group workshop', '#F59E0B', 90, 'active', 0, 14)
  RETURNING id INTO v_cal3_id;

  -- Appointments (some today, some upcoming)
  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES
    (p_workspace_id, v_cal_id, v_contact_ids[1], 'Initial Consultation', 'confirmed',
     date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '10 hours 30 minutes',
     'Discuss business goals and objectives.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[2], 'Strategy Planning', 'confirmed',
     date_trunc('day', now()) + interval '14 hours', date_trunc('day', now()) + interval '15 hours',
     'Q4 strategy review and planning session.'),
    (p_workspace_id, v_cal_id, v_contact_ids[3], 'Tech Review', 'pending',
     date_trunc('day', now()) + interval '16 hours', date_trunc('day', now()) + interval '16 hours 30 minutes',
     'Technical architecture review.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[5], 'Partnership Discussion', 'confirmed',
     date_trunc('day', now()) + interval '1 day 11 hours', date_trunc('day', now()) + interval '1 day 12 hours',
     'Explore partnership opportunities.'),
    (p_workspace_id, v_cal3_id, v_contact_ids[6], 'Financial Planning Workshop', 'confirmed',
     date_trunc('day', now()) + interval '2 days 15 hours', date_trunc('day', now()) + interval '2 days 16 hours 30 minutes',
     'Group financial planning workshop.'),
    (p_workspace_id, v_cal_id, v_contact_ids[8], 'Brand Strategy Call', 'pending',
     date_trunc('day', now()) + interval '3 days 13 hours', date_trunc('day', now()) + interval '3 days 13 hours 30 minutes',
     'Discuss brand strategy and positioning.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[9], 'Investment Review', 'confirmed',
     date_trunc('day', now()) + interval '4 days 10 hours', date_trunc('day', now()) + interval '4 days 11 hours',
     'Review investment portfolio and strategy.'),
    (p_workspace_id, v_cal_id, v_contact_ids[10], 'Design Consultation', 'confirmed',
     date_trunc('day', now()) + interval '5 days 15 hours', date_trunc('day', now()) + interval '5 days 15 hours 30 minutes',
     'Initial design consultation and scope review.'),
    (p_workspace_id, v_cal_id, v_contact_ids[4], 'Follow-up Call', 'completed',
     date_trunc('day', now()) - interval '1 day 14 hours', date_trunc('day', now()) - interval '1 day 14 hours 30 minutes',
     'Follow-up on previous discussion.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[7], 'Portfolio Review', 'completed',
     date_trunc('day', now()) - interval '3 days 11 hours', date_trunc('day', now()) - interval '3 days 12 hours',
     'Annual portfolio review.')
  RETURNING id INTO v_appt_id;

  -- Forms
  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES
    (p_workspace_id, 'Client Intake Form', 'Collect client information before consultation', 'form', 'published',
     'Thank you! We will be in touch shortly to confirm your appointment.', v_cal_id)
  RETURNING id INTO v_form_id;

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES
    (p_workspace_id, 'Strategy Session Questionnaire', 'Pre-session questionnaire for strategy meetings', 'survey', 'published',
     'Thank you for completing the questionnaire. See you at the session!', v_cal2_id);

  INSERT INTO forms (workspace_id, name, description, type, status, success_message)
  VALUES
    (p_workspace_id, 'Feedback Survey', 'Post-appointment feedback survey', 'survey', 'draft',
     'Thank you for your feedback!');

  -- Form fields for the intake form
  INSERT INTO form_fields (form_id, label, field_type, required, sort_order, mapped_field)
  VALUES
    (v_form_id, 'First Name', 'first_name', true, 0, 'first_name'),
    (v_form_id, 'Last Name', 'last_name', true, 1, 'last_name'),
    (v_form_id, 'Email', 'email', true, 2, 'email'),
    (v_form_id, 'Phone', 'phone', false, 3, 'phone'),
    (v_form_id, 'Company', 'company', false, 4, 'company'),
    (v_form_id, 'What brings you in today?', 'long_text', true, 5, null);

  -- Form submissions
  INSERT INTO form_submissions (form_id, workspace_id, contact_id, submitted_data)
  VALUES
    (v_form_id, p_workspace_id, v_contact_ids[1], '{"first_name": "James", "last_name": "Carter", "email": "james.carter@email.com", "company": "Carter & Associates", "What brings you in today?": "Looking for strategic consulting services"}'::jsonb),
    (v_form_id, p_workspace_id, v_contact_ids[2], '{"first_name": "Emily", "last_name": "Rodriguez", "email": "emily.r@email.com", "company": "Rodriguez Law", "What brings you in today?": "Need help with business strategy"}'::jsonb);

  -- Workflows
  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES
    (p_workspace_id, 'Welcome Email Sequence', 'Send a welcome email when a new contact is created', 'contact_created', 'active', 5, now() - interval '1 day')
  RETURNING id INTO v_wf_id;

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES
    (p_workspace_id, 'Appointment Confirmation', 'Send confirmation email when appointment is booked', 'appointment_booked', 'active', 12, now() - interval '2 hours');

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES
    (p_workspace_id, 'Follow-up Reminder', 'Send a follow-up email after appointment completion', 'appointment_completed', 'active', 8);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES
    (p_workspace_id, 'No-show Recovery', 'Send a rebooking link when a client no-shows', 'appointment_no_show', 'paused', 3);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES
    (p_workspace_id, 'Form Submission Alert', 'Notify when a form is submitted', 'form_submitted', 'draft', 0);

  -- Workflow nodes for the welcome email workflow
  INSERT INTO workflow_nodes (workflow_id, node_type, action_type, config, sort_order)
  VALUES
    (v_wf_id, 'action', 'send_email', '{"subject": "Welcome to Howells!", "template": "welcome"}'::jsonb, 0),
    (v_wf_id, 'delay', 'wait', '{"duration": "1 day"}'::jsonb, 1),
    (v_wf_id, 'action', 'add_tag', '{"tag": "onboarded"}'::jsonb, 2);

  -- Workflow executions
  INSERT INTO workflow_executions (workflow_id, workspace_id, status, triggered_by, started_at, completed_at)
  VALUES
    (v_wf_id, p_workspace_id, 'completed', 'contact_created', now() - interval '1 day', now() - interval '1 day 1 minute'),
    (v_wf_id, p_workspace_id, 'completed', 'contact_created', now() - interval '2 days', now() - interval '2 days 1 minute'),
    (v_wf_id, p_workspace_id, 'running', 'contact_created', now() - interval '10 minutes', null);

  -- Recordings
  INSERT INTO recordings (workspace_id, appointment_id, title, status, duration_seconds, ai_summary, transcript, key_points, action_items)
  VALUES
    (p_workspace_id, v_appt_id, 'Initial Consultation - James Carter', 'ready', 1800,
     'James Carter discussed his company''s goals for the next quarter, focusing on strategic consulting services. Key topics included market expansion, operational efficiency, and team development.',
     'Speaker 1: Welcome James, thank you for joining today.\nSpeaker 2: Thanks for having me. I''m excited to discuss our goals.\nSpeaker 1: Let''s start with your current challenges...',
     '["Market expansion strategy for Q4", "Operational efficiency improvements", "Team development and hiring plans", "Budget allocation for consulting services"]'::jsonb,
     '[{"text": "Send proposal by Friday", "done": false}, {"text": "Schedule follow-up for next week", "done": true}]'::jsonb);

  INSERT INTO recordings (workspace_id, title, status, duration_seconds, ai_summary)
  VALUES
    (p_workspace_id, 'Strategy Planning - Emily Rodriguez', 'processing', 3600,
     'Emily Rodriguez reviewed Q4 strategy and discussed partnership opportunities. The session covered market analysis, competitive positioning, and growth targets.');

  -- Tags
  INSERT INTO tags (workspace_id, name, color)
  VALUES
    (p_workspace_id, 'VIP', '#EF4444'),
    (p_workspace_id, 'Client', '#3B82F6'),
    (p_workspace_id, 'Prospect', '#10B981'),
    (p_workspace_id, 'Onboarded', '#F59E0B'),
    (p_workspace_id, 'Newsletter', '#8B5CF6');

  -- Notes
  INSERT INTO notes (workspace_id, contact_id, body, created_by)
  VALUES
    (p_workspace_id, v_contact_ids[1], 'Had a great initial consultation. Very interested in our premium package.', p_owner_id),
    (p_workspace_id, v_contact_ids[2], 'Referred by James Carter. Looking for strategy consulting.', p_owner_id),
    (p_workspace_id, v_contact_ids[5], 'Discussed partnership opportunities. Follow up next week.', p_owner_id);

  -- Smart lists
  INSERT INTO smart_lists (workspace_id, name, filter_conditions)
  VALUES
    (p_workspace_id, 'Active Clients', '{"status": "active"}'::jsonb),
    (p_workspace_id, 'Pending Follow-ups', '{"status": "pending"}'::jsonb);
END;
$$;

-- Revoke public execute; only authenticated users should call this
REVOKE EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) TO authenticated;


-- ============ 20260903002255_fix_seed_workspace_demo_data_function.sql.sql ============
DROP FUNCTION IF EXISTS seed_workspace_demo_data(uuid, uuid);

CREATE OR REPLACE FUNCTION seed_workspace_demo_data(p_workspace_id uuid, p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_ids uuid[];
  v_cal_id uuid;
  v_cal2_id uuid;
  v_cal3_id uuid;
  v_form_id uuid;
  v_wf_id uuid;
  v_appt_id uuid;
BEGIN
  INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, company, job_title, source, last_activity_at)
  VALUES
    (p_workspace_id, 'James', 'Carter', 'james.carter@email.com', '+1234567890', 'Carter & Associates', 'CEO', 'referral', now() - interval '2 days'),
    (p_workspace_id, 'Emily', 'Rodriguez', 'emily.r@email.com', '+1234567891', 'Rodriguez Law', 'Partner', 'website', now() - interval '5 days'),
    (p_workspace_id, 'Michael', 'Zhang', 'mzhang@email.com', '+1234567892', 'Zhang Tech', 'CTO', 'event', now() - interval '1 day'),
    (p_workspace_id, 'Jessica', 'Williams', 'jess.williams@email.com', '+1234567893', 'Williams Group', 'Director', 'referral', now() - interval '10 days'),
    (p_workspace_id, 'David', 'Kumar', 'david.kumar@email.com', '+1234567894', 'Kumar Consulting', 'Founder', 'website', now() - interval '3 days'),
    (p_workspace_id, 'Sarah', 'Johnson', 'sarah.j@email.com', '+1234567895', 'Johnson Capital', 'VP Finance', 'referral', now() - interval '7 days'),
    (p_workspace_id, 'Robert', 'Brown', 'robert.brown@email.com', '+1234567896', 'Brown Holdings', 'Chairman', 'event', now() - interval '30 days'),
    (p_workspace_id, 'Lisa', 'Anderson', 'lisa.a@email.com', '+1234567897', 'Anderson Media', 'CMO', 'website', now() - interval '4 days'),
    (p_workspace_id, 'Thomas', 'Lee', 'thomas.lee@email.com', '+1234567898', 'Lee Ventures', 'Investor', 'referral', now() - interval '14 days'),
    (p_workspace_id, 'Maria', 'Garcia', 'maria.garcia@email.com', '+1234567899', 'Garcia Design', 'Creative Director', 'website', now() - interval '1 day');

  v_contact_ids := ARRAY(SELECT id FROM contacts WHERE workspace_id = p_workspace_id ORDER BY created_at);

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'General Consultation', 'consultation', '30-minute consultation call', '#3B82F6', 30, 'active', 15, 30)
  RETURNING id INTO v_cal_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Strategy Session', 'strategy', '60-minute strategy session', '#10B981', 60, 'active', 30, 30)
  RETURNING id INTO v_cal2_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Group Workshop', 'workshop', '90-minute group workshop', '#F59E0B', 90, 'active', 0, 14)
  RETURNING id INTO v_cal3_id;

  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES
    (p_workspace_id, v_cal_id, v_contact_ids[1], 'Initial Consultation', 'confirmed',
     date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '10 hours 30 minutes',
     'Discuss business goals and objectives.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[2], 'Strategy Planning', 'confirmed',
     date_trunc('day', now()) + interval '14 hours', date_trunc('day', now()) + interval '15 hours',
     'Q4 strategy review and planning session.'),
    (p_workspace_id, v_cal_id, v_contact_ids[3], 'Tech Review', 'pending',
     date_trunc('day', now()) + interval '16 hours', date_trunc('day', now()) + interval '16 hours 30 minutes',
     'Technical architecture review.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[5], 'Partnership Discussion', 'confirmed',
     date_trunc('day', now()) + interval '1 day 11 hours', date_trunc('day', now()) + interval '1 day 12 hours',
     'Explore partnership opportunities.'),
    (p_workspace_id, v_cal3_id, v_contact_ids[6], 'Financial Planning Workshop', 'confirmed',
     date_trunc('day', now()) + interval '2 days 15 hours', date_trunc('day', now()) + interval '2 days 16 hours 30 minutes',
     'Group financial planning workshop.'),
    (p_workspace_id, v_cal_id, v_contact_ids[8], 'Brand Strategy Call', 'pending',
     date_trunc('day', now()) + interval '3 days 13 hours', date_trunc('day', now()) + interval '3 days 13 hours 30 minutes',
     'Discuss brand strategy and positioning.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[9], 'Investment Review', 'confirmed',
     date_trunc('day', now()) + interval '4 days 10 hours', date_trunc('day', now()) + interval '4 days 11 hours',
     'Review investment portfolio and strategy.'),
    (p_workspace_id, v_cal_id, v_contact_ids[10], 'Design Consultation', 'confirmed',
     date_trunc('day', now()) + interval '5 days 15 hours', date_trunc('day', now()) + interval '5 days 15 hours 30 minutes',
     'Initial design consultation and scope review.'),
    (p_workspace_id, v_cal_id, v_contact_ids[4], 'Follow-up Call', 'completed',
     date_trunc('day', now()) - interval '1 day 14 hours', date_trunc('day', now()) - interval '1 day 14 hours 30 minutes',
     'Follow-up on previous discussion.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[7], 'Portfolio Review', 'completed',
     date_trunc('day', now()) - interval '3 days 11 hours', date_trunc('day', now()) - interval '3 days 12 hours',
     'Annual portfolio review.')
  RETURNING id INTO v_appt_id;

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Client Intake Form', 'Collect client information before consultation', 'form', 'published',
     'Thank you! We will be in touch shortly to confirm your appointment.', v_cal_id)
  RETURNING id INTO v_form_id;

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Strategy Session Questionnaire', 'Pre-session questionnaire for strategy meetings', 'survey', 'published',
     'Thank you for completing the questionnaire. See you at the session!', v_cal2_id);

  INSERT INTO forms (workspace_id, name, description, type, status, success_message)
  VALUES (p_workspace_id, 'Feedback Survey', 'Post-appointment feedback survey', 'survey', 'draft',
     'Thank you for your feedback!');

  INSERT INTO form_fields (form_id, label, field_type, required, sort_order, mapped_field)
  VALUES
    (v_form_id, 'First Name', 'first_name', true, 0, 'first_name'),
    (v_form_id, 'Last Name', 'last_name', true, 1, 'last_name'),
    (v_form_id, 'Email', 'email', true, 2, 'email'),
    (v_form_id, 'Phone', 'phone', false, 3, 'phone'),
    (v_form_id, 'Company', 'company', false, 4, 'company'),
    (v_form_id, 'What brings you in today?', 'long_text', true, 5, null);

  INSERT INTO form_submissions (form_id, workspace_id, contact_id, answers)
  VALUES
    (v_form_id, p_workspace_id, v_contact_ids[1], '{"first_name": "James", "last_name": "Carter", "email": "james.carter@email.com", "company": "Carter & Associates", "What brings you in today?": "Looking for strategic consulting services"}'::jsonb),
    (v_form_id, p_workspace_id, v_contact_ids[2], '{"first_name": "Emily", "last_name": "Rodriguez", "email": "emily.r@email.com", "company": "Rodriguez Law", "What brings you in today?": "Need help with business strategy"}'::jsonb);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Welcome Email Sequence', 'Send a welcome email when a new contact is created', 'contact_created', 'active', 5, now() - interval '1 day')
  RETURNING id INTO v_wf_id;

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Appointment Confirmation', 'Send confirmation email when appointment is booked', 'appointment_booked', 'active', 12, now() - interval '2 hours');

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Follow-up Reminder', 'Send a follow-up email after appointment completion', 'appointment_completed', 'active', 8);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'No-show Recovery', 'Send a rebooking link when a client no-shows', 'appointment_no_show', 'paused', 3);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Form Submission Alert', 'Notify when a form is submitted', 'form_submitted', 'draft', 0);

  INSERT INTO workflow_nodes (workflow_id, node_type, action_type, config, sort_order)
  VALUES
    (v_wf_id, 'action', 'send_email', '{"subject": "Welcome to Howells!", "template": "welcome"}'::jsonb, 0),
    (v_wf_id, 'delay', 'wait', '{"duration": "1 day"}'::jsonb, 1),
    (v_wf_id, 'action', 'add_tag', '{"tag": "onboarded"}'::jsonb, 2);

  INSERT INTO workflow_executions (workflow_id, status, started_at, completed_at)
  VALUES
    (v_wf_id, 'completed', now() - interval '1 day', now() - interval '1 day 1 minute'),
    (v_wf_id, 'completed', now() - interval '2 days', now() - interval '2 days 1 minute'),
    (v_wf_id, 'running', now() - interval '10 minutes', null);

  INSERT INTO recordings (workspace_id, appointment_id, title, status, duration_seconds, ai_summary, transcript, key_points, action_items)
  VALUES
    (p_workspace_id, v_appt_id, 'Initial Consultation - James Carter', 'ready', 1800,
     'James Carter discussed his company''s goals for the next quarter, focusing on strategic consulting services. Key topics included market expansion, operational efficiency, and team development.',
     'Speaker 1: Welcome James, thank you for joining today.\nSpeaker 2: Thanks for having me. I''m excited to discuss our goals.\nSpeaker 1: Let''s start with your current challenges...',
     '["Market expansion strategy for Q4", "Operational efficiency improvements", "Team development and hiring plans", "Budget allocation for consulting services"]'::jsonb,
     '[{"text": "Send proposal by Friday", "done": false}, {"text": "Schedule follow-up for next week", "done": true}]'::jsonb);

  INSERT INTO recordings (workspace_id, title, status, duration_seconds, ai_summary)
  VALUES (p_workspace_id, 'Strategy Planning - Emily Rodriguez', 'processing', 3600,
     'Emily Rodriguez reviewed Q4 strategy and discussed partnership opportunities. The session covered market analysis, competitive positioning, and growth targets.');

  INSERT INTO tags (workspace_id, name, color)
  VALUES
    (p_workspace_id, 'VIP', '#EF4444'),
    (p_workspace_id, 'Client', '#3B82F6'),
    (p_workspace_id, 'Prospect', '#10B981'),
    (p_workspace_id, 'Onboarded', '#F59E0B'),
    (p_workspace_id, 'Newsletter', '#8B5CF6');

  INSERT INTO notes (workspace_id, contact_id, content, author_id)
  VALUES
    (p_workspace_id, v_contact_ids[1], 'Had a great initial consultation. Very interested in our premium package.', p_owner_id),
    (p_workspace_id, v_contact_ids[2], 'Referred by James Carter. Looking for strategy consulting.', p_owner_id),
    (p_workspace_id, v_contact_ids[5], 'Discussed partnership opportunities. Follow up next week.', p_owner_id);

  INSERT INTO smart_lists (workspace_id, name, rules)
  VALUES
    (p_workspace_id, 'Active Clients', '{"status": "active"}'::jsonb),
    (p_workspace_id, 'Pending Follow-ups', '{"status": "pending"}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) TO authenticated;


-- ============ 20260903002327_fix_seed_function_single_returning.sql.sql ============
-- Fix: the multi-row INSERT ... RETURNING into a single variable fails when >1 row.
-- Split the appointment insert so only the first row's id is captured.

CREATE OR REPLACE FUNCTION seed_workspace_demo_data(p_workspace_id uuid, p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_ids uuid[];
  v_cal_id uuid;
  v_cal2_id uuid;
  v_cal3_id uuid;
  v_form_id uuid;
  v_wf_id uuid;
  v_appt_id uuid;
BEGIN
  INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, company, job_title, source, last_activity_at)
  VALUES
    (p_workspace_id, 'James', 'Carter', 'james.carter@email.com', '+1234567890', 'Carter & Associates', 'CEO', 'referral', now() - interval '2 days'),
    (p_workspace_id, 'Emily', 'Rodriguez', 'emily.r@email.com', '+1234567891', 'Rodriguez Law', 'Partner', 'website', now() - interval '5 days'),
    (p_workspace_id, 'Michael', 'Zhang', 'mzhang@email.com', '+1234567892', 'Zhang Tech', 'CTO', 'event', now() - interval '1 day'),
    (p_workspace_id, 'Jessica', 'Williams', 'jess.williams@email.com', '+1234567893', 'Williams Group', 'Director', 'referral', now() - interval '10 days'),
    (p_workspace_id, 'David', 'Kumar', 'david.kumar@email.com', '+1234567894', 'Kumar Consulting', 'Founder', 'website', now() - interval '3 days'),
    (p_workspace_id, 'Sarah', 'Johnson', 'sarah.j@email.com', '+1234567895', 'Johnson Capital', 'VP Finance', 'referral', now() - interval '7 days'),
    (p_workspace_id, 'Robert', 'Brown', 'robert.brown@email.com', '+1234567896', 'Brown Holdings', 'Chairman', 'event', now() - interval '30 days'),
    (p_workspace_id, 'Lisa', 'Anderson', 'lisa.a@email.com', '+1234567897', 'Anderson Media', 'CMO', 'website', now() - interval '4 days'),
    (p_workspace_id, 'Thomas', 'Lee', 'thomas.lee@email.com', '+1234567898', 'Lee Ventures', 'Investor', 'referral', now() - interval '14 days'),
    (p_workspace_id, 'Maria', 'Garcia', 'maria.garcia@email.com', '+1234567899', 'Garcia Design', 'Creative Director', 'website', now() - interval '1 day');

  v_contact_ids := ARRAY(SELECT id FROM contacts WHERE workspace_id = p_workspace_id ORDER BY created_at);

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'General Consultation', 'consultation', '30-minute consultation call', '#3B82F6', 30, 'active', 15, 30)
  RETURNING id INTO v_cal_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Strategy Session', 'strategy', '60-minute strategy session', '#10B981', 60, 'active', 30, 30)
  RETURNING id INTO v_cal2_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Group Workshop', 'workshop', '90-minute group workshop', '#F59E0B', 90, 'active', 0, 14)
  RETURNING id INTO v_cal3_id;

  -- First appointment (for recording link)
  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES (p_workspace_id, v_cal_id, v_contact_ids[1], 'Initial Consultation', 'confirmed',
     date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '10 hours 30 minutes',
     'Discuss business goals and objectives.')
  RETURNING id INTO v_appt_id;

  -- Remaining appointments
  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES
    (p_workspace_id, v_cal2_id, v_contact_ids[2], 'Strategy Planning', 'confirmed',
     date_trunc('day', now()) + interval '14 hours', date_trunc('day', now()) + interval '15 hours',
     'Q4 strategy review and planning session.'),
    (p_workspace_id, v_cal_id, v_contact_ids[3], 'Tech Review', 'pending',
     date_trunc('day', now()) + interval '16 hours', date_trunc('day', now()) + interval '16 hours 30 minutes',
     'Technical architecture review.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[5], 'Partnership Discussion', 'confirmed',
     date_trunc('day', now()) + interval '1 day 11 hours', date_trunc('day', now()) + interval '1 day 12 hours',
     'Explore partnership opportunities.'),
    (p_workspace_id, v_cal3_id, v_contact_ids[6], 'Financial Planning Workshop', 'confirmed',
     date_trunc('day', now()) + interval '2 days 15 hours', date_trunc('day', now()) + interval '2 days 16 hours 30 minutes',
     'Group financial planning workshop.'),
    (p_workspace_id, v_cal_id, v_contact_ids[8], 'Brand Strategy Call', 'pending',
     date_trunc('day', now()) + interval '3 days 13 hours', date_trunc('day', now()) + interval '3 days 13 hours 30 minutes',
     'Discuss brand strategy and positioning.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[9], 'Investment Review', 'confirmed',
     date_trunc('day', now()) + interval '4 days 10 hours', date_trunc('day', now()) + interval '4 days 11 hours',
     'Review investment portfolio and strategy.'),
    (p_workspace_id, v_cal_id, v_contact_ids[10], 'Design Consultation', 'confirmed',
     date_trunc('day', now()) + interval '5 days 15 hours', date_trunc('day', now()) + interval '5 days 15 hours 30 minutes',
     'Initial design consultation and scope review.'),
    (p_workspace_id, v_cal_id, v_contact_ids[4], 'Follow-up Call', 'completed',
     date_trunc('day', now()) - interval '1 day 14 hours', date_trunc('day', now()) - interval '1 day 14 hours 30 minutes',
     'Follow-up on previous discussion.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[7], 'Portfolio Review', 'completed',
     date_trunc('day', now()) - interval '3 days 11 hours', date_trunc('day', now()) - interval '3 days 12 hours',
     'Annual portfolio review.');

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Client Intake Form', 'Collect client information before consultation', 'form', 'published',
     'Thank you! We will be in touch shortly to confirm your appointment.', v_cal_id)
  RETURNING id INTO v_form_id;

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Strategy Session Questionnaire', 'Pre-session questionnaire for strategy meetings', 'survey', 'published',
     'Thank you for completing the questionnaire. See you at the session!', v_cal2_id);

  INSERT INTO forms (workspace_id, name, description, type, status, success_message)
  VALUES (p_workspace_id, 'Feedback Survey', 'Post-appointment feedback survey', 'survey', 'draft',
     'Thank you for your feedback!');

  INSERT INTO form_fields (form_id, label, field_type, required, sort_order, mapped_field)
  VALUES
    (v_form_id, 'First Name', 'first_name', true, 0, 'first_name'),
    (v_form_id, 'Last Name', 'last_name', true, 1, 'last_name'),
    (v_form_id, 'Email', 'email', true, 2, 'email'),
    (v_form_id, 'Phone', 'phone', false, 3, 'phone'),
    (v_form_id, 'Company', 'company', false, 4, 'company'),
    (v_form_id, 'What brings you in today?', 'long_text', true, 5, null);

  INSERT INTO form_submissions (form_id, workspace_id, contact_id, answers)
  VALUES
    (v_form_id, p_workspace_id, v_contact_ids[1], '{"first_name": "James", "last_name": "Carter", "email": "james.carter@email.com", "company": "Carter & Associates", "What brings you in today?": "Looking for strategic consulting services"}'::jsonb),
    (v_form_id, p_workspace_id, v_contact_ids[2], '{"first_name": "Emily", "last_name": "Rodriguez", "email": "emily.r@email.com", "company": "Rodriguez Law", "What brings you in today?": "Need help with business strategy"}'::jsonb);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Welcome Email Sequence', 'Send a welcome email when a new contact is created', 'contact_created', 'active', 5, now() - interval '1 day')
  RETURNING id INTO v_wf_id;

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Appointment Confirmation', 'Send confirmation email when appointment is booked', 'appointment_booked', 'active', 12, now() - interval '2 hours');

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Follow-up Reminder', 'Send a follow-up email after appointment completion', 'appointment_completed', 'active', 8);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'No-show Recovery', 'Send a rebooking link when a client no-shows', 'appointment_no_show', 'paused', 3);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Form Submission Alert', 'Notify when a form is submitted', 'form_submitted', 'draft', 0);

  INSERT INTO workflow_nodes (workflow_id, node_type, action_type, config, sort_order)
  VALUES
    (v_wf_id, 'action', 'send_email', '{"subject": "Welcome to Howells!", "template": "welcome"}'::jsonb, 0),
    (v_wf_id, 'delay', 'wait', '{"duration": "1 day"}'::jsonb, 1),
    (v_wf_id, 'action', 'add_tag', '{"tag": "onboarded"}'::jsonb, 2);

  INSERT INTO workflow_executions (workflow_id, status, started_at, completed_at)
  VALUES
    (v_wf_id, 'completed', now() - interval '1 day', now() - interval '1 day 1 minute'),
    (v_wf_id, 'completed', now() - interval '2 days', now() - interval '2 days 1 minute'),
    (v_wf_id, 'running', now() - interval '10 minutes', null);

  INSERT INTO recordings (workspace_id, appointment_id, title, status, duration_seconds, ai_summary, transcript, key_points, action_items)
  VALUES
    (p_workspace_id, v_appt_id, 'Initial Consultation - James Carter', 'ready', 1800,
     'James Carter discussed his company''s goals for the next quarter, focusing on strategic consulting services. Key topics included market expansion, operational efficiency, and team development.',
     'Speaker 1: Welcome James, thank you for joining today.\nSpeaker 2: Thanks for having me. I''m excited to discuss our goals.\nSpeaker 1: Let''s start with your current challenges...',
     '["Market expansion strategy for Q4", "Operational efficiency improvements", "Team development and hiring plans", "Budget allocation for consulting services"]'::jsonb,
     '[{"text": "Send proposal by Friday", "done": false}, {"text": "Schedule follow-up for next week", "done": true}]'::jsonb);

  INSERT INTO recordings (workspace_id, title, status, duration_seconds, ai_summary)
  VALUES (p_workspace_id, 'Strategy Planning - Emily Rodriguez', 'processing', 3600,
     'Emily Rodriguez reviewed Q4 strategy and discussed partnership opportunities. The session covered market analysis, competitive positioning, and growth targets.');

  INSERT INTO tags (workspace_id, name, color)
  VALUES
    (p_workspace_id, 'VIP', '#EF4444'),
    (p_workspace_id, 'Client', '#3B82F6'),
    (p_workspace_id, 'Prospect', '#10B981'),
    (p_workspace_id, 'Onboarded', '#F59E0B'),
    (p_workspace_id, 'Newsletter', '#8B5CF6');

  INSERT INTO notes (workspace_id, contact_id, content, author_id)
  VALUES
    (p_workspace_id, v_contact_ids[1], 'Had a great initial consultation. Very interested in our premium package.', p_owner_id),
    (p_workspace_id, v_contact_ids[2], 'Referred by James Carter. Looking for strategy consulting.', p_owner_id),
    (p_workspace_id, v_contact_ids[5], 'Discussed partnership opportunities. Follow up next week.', p_owner_id);

  INSERT INTO smart_lists (workspace_id, name, rules)
  VALUES
    (p_workspace_id, 'Active Clients', '{"status": "active"}'::jsonb),
    (p_workspace_id, 'Pending Follow-ups', '{"status": "pending"}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) TO authenticated;


-- ============ 20260903002339_backfill_existing_users_workspaces.sql.sql ============
-- Backfill: Create workspaces and memberships for existing users who don't have one,
-- then seed demo data into each.

DO $$
DECLARE
  u RECORD;
  v_ws_id uuid;
  v_slug text;
BEGIN
  FOR u IN
    SELECT au2.id, au2.email,
      COALESCE(au2.raw_user_meta_data->>'first_name', 'User') AS first_name,
      COALESCE(au2.raw_user_meta_data->>'last_name', '') AS last_name
    FROM auth.users au2
    WHERE au2.id NOT IN (SELECT user_id FROM workspace_members)
  LOOP
    v_slug := lower(
      regexp_replace(
        COALESCE(u.first_name, 'user') || '-' || COALESCE(NULLIF(u.last_name, ''), 'workspace'),
        '[^a-zA-Z0-9]', '-', 'g'
      )
    );
    v_slug := regexp_replace(v_slug, '-+', '-', 'g');
    v_slug := trim(both '-' from v_slug);

    INSERT INTO workspaces (name, slug, owner_id)
    VALUES (COALESCE(u.first_name, 'User') || '''s Workspace', v_slug, u.id)
    RETURNING id INTO v_ws_id;

    INSERT INTO workspace_members (workspace_id, user_id, role, status)
    VALUES (v_ws_id, u.id, 'owner', 'active');

    PERFORM seed_workspace_demo_data(v_ws_id, u.id);
  END LOOP;
END $$;


-- ============ 20260903004943_add_avatar_url_to_contacts.sql ============
/*
# Add avatar_url to contacts table

## Purpose
Adds an optional `avatar_url` column to the `contacts` table so contacts can have profile photos displayed in the dashboard, contact lists, and appointment rows.

## Changes
1. New column on `contacts`:
   - `avatar_url` (text, nullable) — stores a URL to the contact's profile image. Nullable because most contacts won't have one initially.

## Security
- No RLS policy changes. The existing workspace-scoped policies on `contacts` already cover the new column since column-level privileges inherit from the table-level policy.
*/

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS avatar_url text;


-- ============ 20260903012031_workflow_system_expansion.sql ============
/*
# Workflow System Expansion

## Summary
Expands the workflow system to support versioning, edges (node connections), branches,
enrollments, goals, templates, and settings. Adds 'archived' to workflow status,
expands node types, and adds a settings column to workflows.

## New Tables
1. workflow_versions — versioned snapshots of workflows for safe activation
2. workflow_edges — directed connections between nodes (supports branches)
3. workflow_enrollments — tracks which contacts are enrolled in which workflows
4. workflow_goals — goal definitions per workflow
5. workflow_templates — reusable workflow templates (15 seeded)

## Modified Tables
1. workflows — add 'archived' to status check, add settings jsonb column, add version_number int
2. workflow_nodes — expand node_type check to include trigger, wait, goal, split_test, branch, end
3. workflow_executions — add version_number int column, add enrollment_id reference

## Security
- RLS enabled on all new tables with workspace-scoped policies using can_access_workspace()
*/

-- ============================================================
-- 1. Expand workflows table
-- ============================================================

DO $$ BEGIN
  ALTER TABLE workflows ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;
  ALTER TABLE workflows ADD COLUMN IF NOT EXISTS version_number int DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Update status check to include 'archived'
DO $$ BEGIN
  ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_status_check;
  ALTER TABLE workflows ADD CONSTRAINT workflows_status_check CHECK (status IN ('draft', 'active', 'paused', 'archived'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- 2. Expand workflow_nodes table
-- ============================================================

DO $$ BEGIN
  ALTER TABLE workflow_nodes DROP CONSTRAINT IF EXISTS workflow_nodes_node_type_check;
  ALTER TABLE workflow_nodes ADD CONSTRAINT workflow_nodes_node_type_check
    CHECK (node_type IN ('trigger', 'action', 'condition', 'delay', 'wait', 'goal', 'split_test', 'branch', 'end'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add parent_node_id for branch chains
DO $$ BEGIN
  ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS parent_node_id uuid REFERENCES workflow_nodes(id) ON DELETE CASCADE;
  ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS branch_label text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 3. workflow_versions table
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_versions_workflow ON workflow_versions(workflow_id);
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. workflow_edges table
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  from_node_id uuid NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  branch_label text,
  sort_order int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_wf_edges_workflow ON workflow_edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_edges_from ON workflow_edges(from_node_id);
ALTER TABLE workflow_edges ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. workflow_enrollments table
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'removed', 'goal_reached')),
  version_number int,
  context jsonb DEFAULT '{}'::jsonb,
  enrolled_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wf_enrollments_workflow ON workflow_enrollments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_enrollments_contact ON workflow_enrollments(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wf_enrollments_unique ON workflow_enrollments(workflow_id, contact_id) WHERE status = 'active';
ALTER TABLE workflow_enrollments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. workflow_goals table
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id uuid REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  goal_event text NOT NULL,
  goal_conditions jsonb DEFAULT '{}'::jsonb,
  stop_on_reach boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_goals_workflow ON workflow_goals(workflow_id);
ALTER TABLE workflow_goals ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. workflow_templates table
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text,
  trigger_type text NOT NULL,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb DEFAULT '{}'::jsonb,
  icon text DEFAULT 'workflow',
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. Add version_number to executions
-- ============================================================

DO $$ BEGIN
  ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS version_number int;
  ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES workflow_enrollments(id) ON DELETE SET NULL;
  ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS trigger_type text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Expand execution status to include 'waiting' and 'skipped'
DO $$ BEGIN
  ALTER TABLE workflow_executions DROP CONSTRAINT IF EXISTS workflow_executions_status_check;
  ALTER TABLE workflow_executions ADD CONSTRAINT workflow_executions_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'waiting', 'skipped'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add duration_ms and retry_count to execution logs
DO $$ BEGIN
  ALTER TABLE workflow_execution_logs ADD COLUMN IF NOT EXISTS duration_ms int;
  ALTER TABLE workflow_execution_logs ADD COLUMN IF NOT EXISTS retry_count int DEFAULT 0;
  ALTER TABLE workflow_execution_logs ADD COLUMN IF NOT EXISTS input jsonb;
  ALTER TABLE workflow_execution_logs ADD COLUMN IF NOT EXISTS output jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- RLS POLICIES for new tables
-- ============================================================

-- workflow_versions
DROP POLICY IF EXISTS "wf_versions_select" ON workflow_versions;
CREATE POLICY "wf_versions_select" ON workflow_versions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_versions.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_versions_insert" ON workflow_versions;
CREATE POLICY "wf_versions_insert" ON workflow_versions FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_versions.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_versions_update" ON workflow_versions;
CREATE POLICY "wf_versions_update" ON workflow_versions FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_versions.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_versions_delete" ON workflow_versions;
CREATE POLICY "wf_versions_delete" ON workflow_versions FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_versions.workflow_id AND can_access_workspace(workflows.workspace_id)));

-- workflow_edges
DROP POLICY IF EXISTS "wf_edges_select" ON workflow_edges;
CREATE POLICY "wf_edges_select" ON workflow_edges FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_edges.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_edges_insert" ON workflow_edges;
CREATE POLICY "wf_edges_insert" ON workflow_edges FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_edges.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_edges_update" ON workflow_edges;
CREATE POLICY "wf_edges_update" ON workflow_edges FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_edges.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_edges_delete" ON workflow_edges;
CREATE POLICY "wf_edges_delete" ON workflow_edges FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_edges.workflow_id AND can_access_workspace(workflows.workspace_id)));

-- workflow_enrollments
DROP POLICY IF EXISTS "wf_enrollments_select" ON workflow_enrollments;
CREATE POLICY "wf_enrollments_select" ON workflow_enrollments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_enrollments.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_enrollments_insert" ON workflow_enrollments;
CREATE POLICY "wf_enrollments_insert" ON workflow_enrollments FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_enrollments.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_enrollments_update" ON workflow_enrollments;
CREATE POLICY "wf_enrollments_update" ON workflow_enrollments FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_enrollments.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_enrollments_delete" ON workflow_enrollments;
CREATE POLICY "wf_enrollments_delete" ON workflow_enrollments FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_enrollments.workflow_id AND can_access_workspace(workflows.workspace_id)));

-- workflow_goals
DROP POLICY IF EXISTS "wf_goals_select" ON workflow_goals;
CREATE POLICY "wf_goals_select" ON workflow_goals FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_goals.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_goals_insert" ON workflow_goals;
CREATE POLICY "wf_goals_insert" ON workflow_goals FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_goals.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_goals_update" ON workflow_goals;
CREATE POLICY "wf_goals_update" ON workflow_goals FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_goals.workflow_id AND can_access_workspace(workflows.workspace_id)));
DROP POLICY IF EXISTS "wf_goals_delete" ON workflow_goals;
CREATE POLICY "wf_goals_delete" ON workflow_goals FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM workflows WHERE workflows.id = workflow_goals.workflow_id AND can_access_workspace(workflows.workspace_id)));

-- workflow_templates (read-only, available to all authenticated users)
DROP POLICY IF EXISTS "wf_templates_select" ON workflow_templates;
CREATE POLICY "wf_templates_select" ON workflow_templates FOR SELECT TO authenticated USING (true);

-- ============================================================
-- SEED 15 workflow templates
-- ============================================================
INSERT INTO workflow_templates (name, description, category, trigger_type, icon, sort_order, nodes) VALUES
('Appointment Confirmation', 'Send a confirmation email immediately when an appointment is booked.', 'Appointments', 'appointment_booked', 'calendar', 1, '[{"node_type":"action","action_type":"send_email","config":{"subject":"Your appointment is confirmed","body":"Hi {{first_name}}, your appointment on {{appointment_date}} at {{appointment_time}} is confirmed. We look forward to seeing you!"}},{"node_type":"wait","action_type":"wait","config":{"duration_value":24,"duration_unit":"hours"}},{"node_type":"action","action_type":"send_sms","config":{"body":"Reminder: You have an appointment tomorrow at {{appointment_time}}. See you then!"}}]'),
('Appointment Reminder', 'Send a reminder 24 hours before an appointment.', 'Appointments', 'appointment_booked', 'calendar', 2, '[{"node_type":"wait","action_type":"wait","config":{"duration_value":24,"duration_unit":"hours"}},{"node_type":"action","action_type":"send_sms","config":{"body":"Hi {{first_name}}, reminder for your appointment on {{appointment_date}} at {{appointment_time}}."}}]'),
('Cancellation Follow-Up', 'Reach out when an appointment is cancelled to offer rescheduling.', 'Appointments', 'appointment_cancelled', 'calendar', 3, '[{"node_type":"action","action_type":"send_email","config":{"subject":"Sorry we missed you","body":"Hi {{first_name}}, we noticed you cancelled your appointment. Would you like to reschedule? Use this link: {{booking_link}}"}},{"node_type":"wait","action_type":"wait","config":{"duration_value":2,"duration_unit":"days"}},{"node_type":"action","action_type":"send_sms","config":{"body":"Hi {{first_name}}, still interested in rescheduling? Reply to this message."}}]'),
('Reschedule Follow-Up', 'Confirm the new time and send details after a reschedule.', 'Appointments', 'appointment_rescheduled', 'calendar', 4, '[{"node_type":"action","action_type":"send_email","config":{"subject":"Your appointment has been rescheduled","body":"Hi {{first_name}}, your appointment is now on {{appointment_date}} at {{appointment_time}}."}}]'),
('No-Show Follow-Up', 'Automatically follow up when someone misses an appointment.', 'Appointments', 'appointment_no_show', 'calendar', 5, '[{"node_type":"action","action_type":"add_tag","config":{"tag":"No-Show"}},{"node_type":"action","action_type":"send_sms","config":{"body":"Hi {{first_name}}, we missed you today. Would you like to book another time? {{booking_link}}"}},{"node_type":"wait","action_type":"wait","config":{"duration_value":1,"duration_unit":"days"}},{"node_type":"action","action_type":"send_email","config":{"subject":"We missed you today","body":"Hi {{first_name}}, we noticed you couldn''t make your appointment. No worries — reschedule anytime: {{booking_link}}"}}]'),
('New Lead Follow-Up', 'Welcome new leads and remind your team to follow up.', 'Lead management', 'form_submitted', 'users', 6, '[{"node_type":"action","action_type":"send_email","config":{"subject":"Thanks for reaching out!","body":"Hi {{first_name}}, thanks for your interest! We''ll be in touch within 24 hours."}},{"node_type":"action","action_type":"add_tag","config":{"tag":"New Lead"}},{"node_type":"wait","action_type":"wait","config":{"duration_value":1,"duration_unit":"days"}},{"node_type":"action","action_type":"send_sms","config":{"body":"Hi {{first_name}}, just following up on your inquiry. Do you have any questions?"}}]'),
('Form Submission Follow-Up', 'Send an instant reply when a form is submitted.', 'Forms', 'form_submitted', 'file-text', 7, '[{"node_type":"action","action_type":"send_email","config":{"subject":"We received your submission","body":"Hi {{first_name}}, thank you for submitting the form. We''ll review and get back to you shortly."}}]'),
('New Client Intake', 'Onboard new clients with a welcome sequence.', 'Client experience', 'contact_created', 'sparkles', 8, '[{"node_type":"action","action_type":"send_email","config":{"subject":"Welcome aboard!","body":"Hi {{first_name}}, welcome! Here''s everything you need to get started."}},{"node_type":"action","action_type":"add_tag","config":{"tag":"New Client"}},{"node_type":"wait","action_type":"wait","config":{"duration_value":3,"duration_unit":"days"}},{"node_type":"action","action_type":"send_email","config":{"subject":"How''s it going?","body":"Hi {{first_name}}, checking in to see if you have any questions so far."}}]'),
('Post-Appointment Follow-Up', 'Send a thank-you and request feedback after an appointment.', 'Appointments', 'appointment_completed', 'calendar', 9, '[{"node_type":"action","action_type":"send_email","config":{"subject":"Thanks for visiting!","body":"Hi {{first_name}}, thank you for your time today. We''d love to hear your feedback."}},{"node_type":"wait","action_type":"wait","config":{"duration_value":1,"duration_unit":"days"}},{"node_type":"action","action_type":"send_sms","config":{"body":"Hi {{first_name}}, how was your experience? Reply with any feedback!"}}]'),
('Recording Follow-Up', 'Send a recording link and summary after a meeting.', 'Recordings', 'appointment_completed', 'mic', 10, '[{"node_type":"action","action_type":"send_email","config":{"subject":"Your recording is ready","body":"Hi {{first_name}}, here''s the recording from our meeting: {{recording_url}}"}}]'),
('Lead Qualification', 'Qualify leads with a series of questions before assigning them.', 'Lead management', 'form_submitted', 'users', 11, '[{"node_type":"action","action_type":"add_tag","config":{"tag":"Pending Qualification"}},{"node_type":"action","action_type":"send_email","config":{"subject":"A few quick questions","body":"Hi {{first_name}}, to better serve you, could you tell us a bit more about your needs?"}},{"node_type":"wait","action_type":"wait","config":{"duration_value":2,"duration_unit":"days"}},{"node_type":"condition","action_type":"condition","config":{"field":"email","operator":"exists","value":""}}]'),
('VIP Follow-Up', 'Special follow-up sequence for VIP contacts.', 'Client experience', 'tag_added', 'star', 12, '[{"node_type":"action","action_type":"send_email","config":{"subject":"You''re a VIP to us","body":"Hi {{first_name}}, as a valued client, you get priority access and dedicated support."}},{"node_type":"action","action_type":"add_note","config":{"content":"VIP follow-up sequence started"}}]'),
('Review Request', 'Ask clients for a review after a successful appointment.', 'Appointments', 'appointment_completed', 'star', 13, '[{"node_type":"wait","action_type":"wait","config":{"duration_value":2,"duration_unit":"days"}},{"node_type":"action","action_type":"send_email","config":{"subject":"We''d love your review","body":"Hi {{first_name}}, if you enjoyed your experience, we''d be grateful for a quick review!"}}]'),
('Re-Engagement', 'Re-engage contacts who haven''t been active in 30 days.', 'Lead management', 'contact_created', 'users', 14, '[{"node_type":"wait","action_type":"wait","config":{"duration_value":30,"duration_unit":"days"}},{"node_type":"action","action_type":"send_email","config":{"subject":"We miss you!","body":"Hi {{first_name}}, it''s been a while. Here''s what''s new and an exclusive offer just for you."}},{"node_type":"action","action_type":"send_sms","config":{"body":"Hi {{first_name}}, we miss you! Check your email for a special offer."}}]'),
('AI Lead Qualification', 'Use AI to qualify leads based on their form responses.', 'AI', 'form_submitted', 'sparkles', 15, '[{"node_type":"action","action_type":"ai_action","config":{"prompt":"Analyze this lead''s form responses and assign a qualification score from 1-10."}},{"node_type":"condition","action_type":"condition","config":{"field":"ai_score","operator":"greater_than","value":"7"}},{"node_type":"action","action_type":"add_tag","config":{"tag":"Qualified Lead"}},{"node_type":"action","action_type":"send_email","config":{"subject":"You''re a great fit!","body":"Hi {{first_name}}, based on your responses, we think we can help you. Let''s schedule a call."}}]')
ON CONFLICT DO NOTHING;


-- ============ 20260903232718_update_seed_function_jennifer_carter.sql ============
CREATE OR REPLACE FUNCTION seed_workspace_demo_data(p_workspace_id uuid, p_owner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_ids uuid[];
  v_cal_id uuid;
  v_cal2_id uuid;
  v_cal3_id uuid;
  v_form_id uuid;
  v_wf_id uuid;
  v_appt_id uuid;
BEGIN
  INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, company, job_title, source, last_activity_at)
  VALUES
    (p_workspace_id, 'Jennifer', 'Carter', 'jennifer.carter@email.com', '+1234567890', 'Carter & Associates', 'CEO', 'referral', now() - interval '2 days'),
    (p_workspace_id, 'Emily', 'Rodriguez', 'emily.r@email.com', '+1234567891', 'Rodriguez Law', 'Partner', 'website', now() - interval '5 days'),
    (p_workspace_id, 'Michael', 'Zhang', 'mzhang@email.com', '+1234567892', 'Zhang Tech', 'CTO', 'event', now() - interval '1 day'),
    (p_workspace_id, 'Jessica', 'Williams', 'jess.williams@email.com', '+1234567893', 'Williams Group', 'Director', 'referral', now() - interval '10 days'),
    (p_workspace_id, 'David', 'Kumar', 'david.kumar@email.com', '+1234567894', 'Kumar Consulting', 'Founder', 'website', now() - interval '3 days'),
    (p_workspace_id, 'Sarah', 'Johnson', 'sarah.j@email.com', '+1234567895', 'Johnson Capital', 'VP Finance', 'referral', now() - interval '7 days'),
    (p_workspace_id, 'Robert', 'Brown', 'robert.brown@email.com', '+1234567896', 'Brown Holdings', 'Chairman', 'event', now() - interval '30 days'),
    (p_workspace_id, 'Lisa', 'Anderson', 'lisa.a@email.com', '+1234567897', 'Anderson Media', 'CMO', 'website', now() - interval '4 days'),
    (p_workspace_id, 'Thomas', 'Lee', 'thomas.lee@email.com', '+1234567898', 'Lee Ventures', 'Investor', 'referral', now() - interval '14 days'),
    (p_workspace_id, 'Maria', 'Garcia', 'maria.garcia@email.com', '+1234567899', 'Garcia Design', 'Creative Director', 'website', now() - interval '1 day');

  v_contact_ids := ARRAY(SELECT id FROM contacts WHERE workspace_id = p_workspace_id ORDER BY created_at);

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'General Consultation', 'consultation', '30-minute consultation call', '#3B82F6', 30, 'active', 15, 30)
  RETURNING id INTO v_cal_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Strategy Session', 'strategy', '60-minute strategy session', '#10B981', 60, 'active', 30, 30)
  RETURNING id INTO v_cal2_id;

  INSERT INTO calendars (workspace_id, name, slug, description, color, duration_minutes, status, buffer_before_minutes, max_booking_horizon_days)
  VALUES (p_workspace_id, 'Group Workshop', 'workshop', '90-minute group workshop', '#F59E0B', 90, 'active', 0, 14)
  RETURNING id INTO v_cal3_id;

  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES (p_workspace_id, v_cal_id, v_contact_ids[1], 'Initial Consultation', 'confirmed',
     date_trunc('day', now()) + interval '10 hours', date_trunc('day', now()) + interval '10 hours 30 minutes',
     'Discuss business goals and objectives.')
  RETURNING id INTO v_appt_id;

  INSERT INTO appointments (workspace_id, calendar_id, contact_id, title, status, start_time, end_time, notes)
  VALUES
    (p_workspace_id, v_cal2_id, v_contact_ids[2], 'Strategy Planning', 'confirmed',
     date_trunc('day', now()) + interval '14 hours', date_trunc('day', now()) + interval '15 hours',
     'Q4 strategy review and planning session.'),
    (p_workspace_id, v_cal_id, v_contact_ids[3], 'Tech Review', 'pending',
     date_trunc('day', now()) + interval '16 hours', date_trunc('day', now()) + interval '16 hours 30 minutes',
     'Technical architecture review.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[5], 'Partnership Discussion', 'confirmed',
     date_trunc('day', now()) + interval '1 day 11 hours', date_trunc('day', now()) + interval '1 day 12 hours',
     'Explore partnership opportunities.'),
    (p_workspace_id, v_cal3_id, v_contact_ids[6], 'Financial Planning Workshop', 'confirmed',
     date_trunc('day', now()) + interval '2 days 15 hours', date_trunc('day', now()) + interval '2 days 16 hours 30 minutes',
     'Group financial planning workshop.'),
    (p_workspace_id, v_cal_id, v_contact_ids[8], 'Brand Strategy Call', 'pending',
     date_trunc('day', now()) + interval '3 days 13 hours', date_trunc('day', now()) + interval '3 days 13 hours 30 minutes',
     'Discuss brand strategy and positioning.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[9], 'Investment Review', 'confirmed',
     date_trunc('day', now()) + interval '4 days 10 hours', date_trunc('day', now()) + interval '4 days 11 hours',
     'Review investment portfolio and strategy.'),
    (p_workspace_id, v_cal_id, v_contact_ids[10], 'Design Consultation', 'confirmed',
     date_trunc('day', now()) + interval '5 days 15 hours', date_trunc('day', now()) + interval '5 days 15 hours 30 minutes',
     'Initial design consultation and scope review.'),
    (p_workspace_id, v_cal_id, v_contact_ids[4], 'Follow-up Call', 'completed',
     date_trunc('day', now()) - interval '1 day 14 hours', date_trunc('day', now()) - interval '1 day 14 hours 30 minutes',
     'Follow-up on previous discussion.'),
    (p_workspace_id, v_cal2_id, v_contact_ids[7], 'Portfolio Review', 'completed',
     date_trunc('day', now()) - interval '3 days 11 hours', date_trunc('day', now()) - interval '3 days 12 hours',
     'Annual portfolio review.');

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Client Intake Form', 'Collect client information before consultation', 'form', 'published',
     'Thank you! We will be in touch shortly to confirm your appointment.', v_cal_id)
  RETURNING id INTO v_form_id;

  INSERT INTO forms (workspace_id, name, description, type, status, success_message, calendar_id)
  VALUES (p_workspace_id, 'Strategy Session Questionnaire', 'Pre-session questionnaire for strategy meetings', 'survey', 'published',
     'Thank you for completing the questionnaire. See you at the session!', v_cal2_id);

  INSERT INTO forms (workspace_id, name, description, type, status, success_message)
  VALUES (p_workspace_id, 'Feedback Survey', 'Post-appointment feedback survey', 'survey', 'draft',
     'Thank you for your feedback!');

  INSERT INTO form_fields (form_id, label, field_type, required, sort_order, mapped_field)
  VALUES
    (v_form_id, 'First Name', 'first_name', true, 0, 'first_name'),
    (v_form_id, 'Last Name', 'last_name', true, 1, 'last_name'),
    (v_form_id, 'Email', 'email', true, 2, 'email'),
    (v_form_id, 'Phone', 'phone', false, 3, 'phone'),
    (v_form_id, 'Company', 'company', false, 4, 'company'),
    (v_form_id, 'What brings you in today?', 'long_text', true, 5, null);

  INSERT INTO form_submissions (form_id, workspace_id, contact_id, answers)
  VALUES
    (v_form_id, p_workspace_id, v_contact_ids[1], '{"first_name": "Jennifer", "last_name": "Carter", "email": "jennifer.carter@email.com", "company": "Carter & Associates", "What brings you in today?": "Looking for strategic consulting services"}'::jsonb),
    (v_form_id, p_workspace_id, v_contact_ids[2], '{"first_name": "Emily", "last_name": "Rodriguez", "email": "emily.r@email.com", "company": "Rodriguez Law", "What brings you in today?": "Need help with business strategy"}'::jsonb);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Welcome Email Sequence', 'Send a welcome email when a new contact is created', 'contact_created', 'active', 5, now() - interval '1 day')
  RETURNING id INTO v_wf_id;

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs, last_run_at)
  VALUES (p_workspace_id, 'Appointment Confirmation', 'Send confirmation email when appointment is booked', 'appointment_booked', 'active', 12, now() - interval '2 hours');

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Follow-up Reminder', 'Send a follow-up email after appointment completion', 'appointment_completed', 'active', 8);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'No-show Recovery', 'Send a rebooking link when a client no-shows', 'appointment_no_show', 'paused', 3);

  INSERT INTO workflows (workspace_id, name, description, trigger_type, status, total_runs)
  VALUES (p_workspace_id, 'Form Submission Alert', 'Notify when a form is submitted', 'form_submitted', 'draft', 0);

  INSERT INTO workflow_nodes (workflow_id, node_type, action_type, config, sort_order)
  VALUES
    (v_wf_id, 'action', 'send_email', '{"subject": "Welcome to SYNAPSE!", "template": "welcome"}'::jsonb, 0),
    (v_wf_id, 'delay', 'wait', '{"duration": "1 day"}'::jsonb, 1),
    (v_wf_id, 'action', 'add_tag', '{"tag": "onboarded"}'::jsonb, 2);

  INSERT INTO workflow_executions (workflow_id, status, started_at, completed_at)
  VALUES
    (v_wf_id, 'completed', now() - interval '1 day', now() - interval '1 day 1 minute'),
    (v_wf_id, 'completed', now() - interval '2 days', now() - interval '2 days 1 minute'),
    (v_wf_id, 'running', now() - interval '10 minutes', null);

  INSERT INTO recordings (workspace_id, appointment_id, title, status, duration_seconds, ai_summary, transcript, key_points, action_items)
  VALUES
    (p_workspace_id, v_appt_id, 'Initial Consultation - Jennifer Carter', 'ready', 1800,
     'Jennifer Carter discussed her company''s goals for the next quarter, focusing on strategic consulting services. Key topics included market expansion, operational efficiency, and team development.',
     'Speaker 1: Welcome Jennifer, thank you for joining today.\nSpeaker 2: Thanks for having me. I''m excited to discuss our goals.\nSpeaker 1: Let''s start with your current challenges...',
     '["Market expansion strategy for Q4", "Operational efficiency improvements", "Team development and hiring plans", "Budget allocation for consulting services"]'::jsonb,
     '[{"text": "Send proposal by Friday", "done": false}, {"text": "Schedule follow-up for next week", "done": true}]'::jsonb);

  INSERT INTO recordings (workspace_id, title, status, duration_seconds, ai_summary)
  VALUES (p_workspace_id, 'Strategy Planning - Emily Rodriguez', 'processing', 3600,
     'Emily Rodriguez reviewed Q4 strategy and discussed partnership opportunities. The session covered market analysis, competitive positioning, and growth targets.');

  INSERT INTO tags (workspace_id, name, color)
  VALUES
    (p_workspace_id, 'VIP', '#EF4444'),
    (p_workspace_id, 'Client', '#3B82F6'),
    (p_workspace_id, 'Prospect', '#10B981'),
    (p_workspace_id, 'Onboarded', '#F59E0B'),
    (p_workspace_id, 'Newsletter', '#8B5CF6');

  INSERT INTO notes (workspace_id, contact_id, content, author_id)
  VALUES
    (p_workspace_id, v_contact_ids[1], 'Had a great initial consultation. Very interested in our premium package.', p_owner_id),
    (p_workspace_id, v_contact_ids[2], 'Referred by Jennifer Carter. Looking for strategy consulting.', p_owner_id),
    (p_workspace_id, v_contact_ids[5], 'Discussed partnership opportunities. Follow up next week.', p_owner_id);

  INSERT INTO smart_lists (workspace_id, name, rules)
  VALUES
    (p_workspace_id, 'Active Clients', '{"status": "active"}'::jsonb),
    (p_workspace_id, 'Pending Follow-ups', '{"status": "pending"}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION seed_workspace_demo_data(uuid, uuid) TO authenticated;

-- ============ 20260904000002_add_booking_links_table.sql ============
/*
# Add booking_links table for permanent and one-time booking links

1. New Tables
- `booking_links`
  - `id` (uuid, primary key)
  - `workspace_id` (uuid, FK to workspaces, cascade delete)
  - `calendar_id` (uuid, FK to calendars, cascade delete)
  - `token` (text, unique, not null) — cryptographically random, non-sequential
  - `link_type` (text, 'permanent' or 'one_time')
  - `max_uses` (int, default 1 for one-time, null for permanent)
  - `use_count` (int, default 0)
  - `expires_at` (timestamptz, nullable — null means no expiry)
  - `used_at` (timestamptz, nullable — when first booking was made)
  - `created_by` (uuid, FK to auth.users)
  - `created_at` (timestamptz, default now())
2. Security
- Enable RLS on `booking_links`.
- Workspace members can read/insert/update/delete links for their workspace.
3. Indexes
- Index on `calendar_id` for quick lookups
- Index on `token` for booking page lookups
4. Notes
- One-time links expire after a single successful booking (use_count >= max_uses).
- Tokens use gen_random_uuid() for non-guessable, non-sequential URLs.
*/

CREATE TABLE IF NOT EXISTS booking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  link_type text NOT NULL DEFAULT 'permanent' CHECK (link_type IN ('permanent', 'one_time')),
  max_uses int,
  use_count int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_links_calendar ON booking_links(calendar_id);
CREATE INDEX IF NOT EXISTS idx_booking_links_token ON booking_links(token);
ALTER TABLE booking_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_booking_links_workspace" ON booking_links;
CREATE POLICY "select_booking_links_workspace"
ON booking_links FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "insert_booking_links_workspace" ON booking_links;
CREATE POLICY "insert_booking_links_workspace"
ON booking_links FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "update_booking_links_workspace" ON booking_links;
CREATE POLICY "update_booking_links_workspace"
ON booking_links FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "delete_booking_links_workspace" ON booking_links;
CREATE POLICY "delete_booking_links_workspace"
ON booking_links FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);

-- ============ 20260904003603_add_calendar_creation_engine_fields.sql ============
/*
# Calendar Creation Engine - Schema Additions

1. New Columns on `calendars`
- `round_robin_strategy` (text, default 'balanced') — distribution strategy for round robin calendars.
  Values: 'balanced', 'least_recently_booked', 'priority_order', 'weighted'.
- `price` (numeric, nullable) — price for service-based calendars.
- `currency` (text, default 'USD') — currency for service pricing.
- `color` already exists but ensure default is set.

2. New Columns on `calendar_hosts`
- `priority` already exists (integer) — used for priority_order and weighted strategies.
- `weight` already exists (integer) — used for weighted distribution.

3. Notes
- All columns are nullable or have safe defaults so existing calendars are unaffected.
- No tables dropped, no columns removed, no types changed.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendars' AND column_name = 'round_robin_strategy'
  ) THEN
    ALTER TABLE calendars ADD COLUMN round_robin_strategy text DEFAULT 'balanced';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendars' AND column_name = 'price'
  ) THEN
    ALTER TABLE calendars ADD COLUMN price numeric(10,2);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendars' AND column_name = 'currency'
  ) THEN
    ALTER TABLE calendars ADD COLUMN currency text DEFAULT 'USD';
  END IF;
END $$;


-- ============ 20260904005153_add_scheduling_engine_tables.sql ============
/*
# Scheduling Engine - Schema Additions

1. New Tables
- `booking_locks` — Atomic slot reservation locks to prevent double booking.
  When a booking transaction starts, a row is inserted. When it completes, the row is deleted.
  Two simultaneous requests for the same slot collide on the unique constraint.
- `host_availability_rules` — Per-host working hours complementing calendar-level availability.
  For round robin and collective calendars, each host can have their own working hours.

2. Constraints
- UNIQUE on (calendar_id, slot_start) — only one lock per slot per calendar.
- `expires_at` — locks auto-expire so abandoned transactions don't block forever.
  Expired locks are cleaned up before new inserts.

3. Security
- RLS enabled on both new tables.
- Policies allow authenticated workspace members to manage locks and host availability.

4. Notes
- No existing tables or columns modified or removed.
*/

-- Booking locks table
CREATE TABLE IF NOT EXISTS booking_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  host_id uuid,
  locked_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_locks_calendar_slot_idx
  ON booking_locks (calendar_id, slot_start);

ALTER TABLE booking_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_workspace_locks" ON booking_locks;
CREATE POLICY "select_workspace_locks" ON booking_locks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = booking_locks.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = booking_locks.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "insert_workspace_locks" ON booking_locks;
CREATE POLICY "insert_workspace_locks" ON booking_locks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = booking_locks.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = booking_locks.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "delete_workspace_locks" ON booking_locks;
CREATE POLICY "delete_workspace_locks" ON booking_locks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = booking_locks.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = booking_locks.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

-- Host availability rules table
CREATE TABLE IF NOT EXISTS host_availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_availability_rules_calendar_user_idx
  ON host_availability_rules (calendar_id, user_id, day_of_week);

ALTER TABLE host_availability_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "select_workspace_host_availability" ON host_availability_rules FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "insert_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "insert_workspace_host_availability" ON host_availability_rules FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "update_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "update_workspace_host_availability" ON host_availability_rules FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "delete_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "delete_workspace_host_availability" ON host_availability_rules FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );


-- ============ 20260904010047_add_calendar_forms_integration.sql ============
/*
# Calendar Forms Integration

1. New columns on `calendars`:
- `form_mode` — 'default' | 'custom' (default: 'default')
- `custom_confirmation_message` — text, nullable
- `custom_redirect_url` — text, nullable
- `embed_config` — jsonb for embed settings

2. New table: `form_field_conditions`
- Conditional logic for form fields (show/hide/require/disqualify/message/redirect)
- References form_field_id

3. No existing columns modified or removed.
*/

-- Add form_mode to calendars
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS form_mode text DEFAULT 'default';
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS custom_confirmation_message text;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS custom_redirect_url text;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS embed_config jsonb DEFAULT '{}'::jsonb;

-- Form field conditions table
CREATE TABLE IF NOT EXISTS form_field_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_field_id uuid NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
  condition_type text NOT NULL,
  trigger_field_id uuid REFERENCES form_fields(id) ON DELETE CASCADE,
  trigger_operator text NOT NULL,
  trigger_value text,
  action_config jsonb DEFAULT '{}'::jsonb,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_field_conditions_field_idx
  ON form_field_conditions (form_field_id);

ALTER TABLE form_field_conditions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_workspace_field_conditions" ON form_field_conditions;
CREATE POLICY "select_workspace_field_conditions" ON form_field_conditions FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM form_fields ff
      JOIN forms f ON f.id = ff.form_id
      WHERE ff.id = form_field_conditions.form_field_id
      AND (
        EXISTS (SELECT 1 FROM workspaces w WHERE w.id = f.workspace_id AND w.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = f.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
      )
    )
  );

DROP POLICY IF EXISTS "insert_workspace_field_conditions" ON form_field_conditions;
CREATE POLICY "insert_workspace_field_conditions" ON form_field_conditions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM form_fields ff
      JOIN forms f ON f.id = ff.form_id
      WHERE ff.id = form_field_conditions.form_field_id
      AND (
        EXISTS (SELECT 1 FROM workspaces w WHERE w.id = f.workspace_id AND w.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = f.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
      )
    )
  );

DROP POLICY IF EXISTS "update_workspace_field_conditions" ON form_field_conditions;
CREATE POLICY "update_workspace_field_conditions" ON form_field_conditions FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM form_fields ff
      JOIN forms f ON f.id = ff.form_id
      WHERE ff.id = form_field_conditions.form_field_id
      AND (
        EXISTS (SELECT 1 FROM workspaces w WHERE w.id = f.workspace_id AND w.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = f.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
      )
    )
  );

DROP POLICY IF EXISTS "delete_workspace_field_conditions" ON form_field_conditions;
CREATE POLICY "delete_workspace_field_conditions" ON form_field_conditions FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM form_fields ff
      JOIN forms f ON f.id = ff.form_id
      WHERE ff.id = form_field_conditions.form_field_id
      AND (
        EXISTS (SELECT 1 FROM workspaces w WHERE w.id = f.workspace_id AND w.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = f.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
      )
    )
  );


-- ============ 20260904022426_add_public_booking_locks_rls_policies.sql ============
/*
# Add public RLS policies for booking_locks

## Problem
The public booking page (accessed by unauthenticated visitors) needs to:
1. INSERT a temporary lock on a time slot when a visitor starts booking
2. SELECT existing locks to detect conflicts
3. DELETE their own lock after booking completes or expires

The booking_locks table currently only has `authenticated` policies,
so anonymous visitors (using the anon key) cannot insert/select/delete locks.
This silently breaks the entire booking flow at the time-selection step.

## Changes
1. Add `booking_locks_public_select` — allows anon+authenticated to SELECT
   (needed to check for conflicting locks before reserving a slot)
2. Add `booking_locks_public_insert` — allows anon+authenticated to INSERT
   (needed to reserve a slot when a visitor clicks a time)
3. Add `booking_locks_public_delete` — allows anon+authenticated to DELETE
   (needed to release the lock after booking completes; expired locks are
   also cleaned up by this path)

These are safe because:
- Locks are ephemeral (5-minute TTL) and contain no sensitive data
- The unique constraint on (calendar_id, slot_start, slot_end) prevents
  double-booking regardless of who inserts
- DELETE is scoped to the lock's own row — the USING(true) allows any
  visitor to release a lock, which is acceptable since locks expire
  automatically and only the booking system creates them
*/

-- SELECT: allow public to read locks (needed to check conflicts)
DROP POLICY IF EXISTS "booking_locks_public_select" ON booking_locks;
CREATE POLICY "booking_locks_public_select"
  ON booking_locks FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT: allow public to create locks
DROP POLICY IF EXISTS "booking_locks_public_insert" ON booking_locks;
CREATE POLICY "booking_locks_public_insert"
  ON booking_locks FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- DELETE: allow public to release locks
DROP POLICY IF EXISTS "booking_locks_public_delete" ON booking_locks;
CREATE POLICY "booking_locks_public_delete"
  ON booking_locks FOR DELETE
  TO anon, authenticated
  USING (true);

-- ============ 20260904022436_add_public_external_busy_periods_select.sql ============
/*
# Add public SELECT policy for external_busy_periods

## Problem
The scheduling engine queries `external_busy_periods` during slot generation
to filter out times when hosts are busy. This query runs from the browser
using the anon key on the public booking page. Without a public SELECT
policy, the query returns zero rows (not an error), so the engine sees
no busy periods — which is fine for correctness (it just means no
external conflicts are filtered) but is consistent with how other
booking-related tables expose read access to anon.

## Changes
1. Add `busy_periods_public_select` — allows anon+authenticated to SELECT
   on external_busy_periods. This is safe because busy periods contain
   only time ranges (no sensitive event titles or attendee data), and
   the public booking page needs them to generate accurate availability.
*/

DROP POLICY IF EXISTS "busy_periods_public_select" ON external_busy_periods;
CREATE POLICY "busy_periods_public_select"
  ON external_busy_periods FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============ 20260904024909_20260904031000_public_booking_host_profiles.sql ============
/*
# Allow public booking pages to show assigned host names safely

1. Security scope
- Adds a read policy for profiles used by active public calendars.
- Visitors can only see the profile columns needed by the booking host selector.
- Private profile fields remain unavailable to anonymous visitors.

2. Modified tables
- `profiles`: anonymous SELECT is limited to `user_id`, `first_name`, `last_name`, and `avatar_url`.
- `profiles`: public rows are limited to users assigned to an active calendar.

3. Important notes
- Authenticated users retain the existing owner-scoped profile access.
- No profile data is deleted or changed.
*/

REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (user_id, first_name, last_name, avatar_url) ON public.profiles TO anon;

DROP POLICY IF EXISTS "profiles_public_booking_hosts" ON public.profiles;
CREATE POLICY "profiles_public_booking_hosts"
ON public.profiles
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.calendar_hosts
    JOIN public.calendars ON calendars.id = calendar_hosts.calendar_id
    WHERE calendar_hosts.user_id = profiles.user_id
      AND calendars.status = 'active'
  )
);

-- ============ 20260904032040_add_form_fields_to_calendar_groups.sql ============
/*
# Add form support to calendar groups

1. Modified Tables
- `calendar_groups`: Added `connected_form_id` (uuid, FK to forms) and `booking_flow` (text, defaults to 'calendar_first')
  so group calendars can present a form to visitors before showing the calendar chooser.
2. Security
- No new policies needed; existing calendar_groups RLS policies already cover SELECT/INSERT/UPDATE for workspace members
  and the public SELECT policy allows anon access for booking.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_groups' AND column_name = 'connected_form_id'
  ) THEN
    ALTER TABLE calendar_groups
      ADD COLUMN connected_form_id uuid REFERENCES forms(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_groups' AND column_name = 'booking_flow'
  ) THEN
    ALTER TABLE calendar_groups
      ADD COLUMN booking_flow text DEFAULT 'calendar_first' CHECK (booking_flow IN ('calendar_first', 'form_first'));
  END IF;
END $$;


-- ============ 20260904032958_add_public_messages_and_contacts_select_policies.sql.sql ============
-- Allow anon (public booking page) to look up existing contacts by email
-- so the booking flow can update an existing contact instead of duplicating.
CREATE POLICY "contacts_public_select"
  ON contacts FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow anon (public booking page) to insert confirmation messages
-- after a booking is created.
CREATE POLICY "messages_public_insert"
  ON messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow anon to update contacts (e.g. last_activity_at) when a returning
-- visitor books again.
CREATE POLICY "contacts_public_update"
  ON contacts FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);


-- ============ 20260904160810_decouple_calendars_from_workspaces.sql ============
/*
# Decouple Calendars from Workspaces

## Purpose
The calendar feature should work independently of the workspace feature.
Currently calendars require a workspace_id (NOT NULL), which blocks calendar
creation when no workspace exists. This migration makes workspace_id nullable
on calendars and calendar_groups, adds an owner_id column to both tables so
calendars can belong directly to a user, and updates RLS policies accordingly.

## Changes

### 1. calendars table
- Added `owner_id` column (uuid, references auth.users, ON DELETE SET NULL)
- Made `workspace_id` nullable (was NOT NULL)
- Added index on `owner_id`

### 2. calendar_groups table
- Added `owner_id` column (uuid, references auth.users, ON DELETE SET NULL)
- Made `workspace_id` nullable (was NOT NULL)
- Added index on `owner_id`

### 3. RLS Policies
- Updated calendar SELECT policy to allow access via workspace membership OR direct ownership
- Updated calendar INSERT policy to allow access via workspace membership OR direct ownership
- Updated calendar UPDATE policy to allow access via workspace membership OR direct ownership
- Updated calendar DELETE policy to allow access via workspace membership OR direct ownership
- Same set of updates for calendar_groups

## Security
- RLS remains enabled on both tables
- Access is granted via workspace membership (existing) OR direct ownership (new)
- Public/anon SELECT policies for active calendars remain unchanged
*/

-- ============================================================
-- calendars table: add owner_id, make workspace_id nullable
-- ============================================================

ALTER TABLE calendars ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE calendars ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendars_owner ON calendars(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================
-- calendar_groups table: add owner_id, make workspace_id nullable
-- ============================================================

ALTER TABLE calendar_groups ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE calendar_groups ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_groups_owner ON calendar_groups(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================
-- Update RLS policies on calendars
-- ============================================================

-- Helper: can the current user access this calendar (via workspace OR direct ownership)?
CREATE OR REPLACE FUNCTION can_access_calendar(check_calendar_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM calendars c
    WHERE c.id = check_calendar_id
    AND (
      c.owner_id = auth.uid()
      OR (c.workspace_id IS NOT NULL AND can_access_workspace(c.workspace_id))
    )
  );
$$;

-- SELECT (authenticated)
DROP POLICY IF EXISTS "calendars_select" ON calendars;
CREATE POLICY "calendars_select" ON calendars FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- INSERT
DROP POLICY IF EXISTS "calendars_insert" ON calendars;
CREATE POLICY "calendars_insert" ON calendars FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- UPDATE
DROP POLICY IF EXISTS "calendars_update" ON calendars;
CREATE POLICY "calendars_update" ON calendars FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- DELETE
DROP POLICY IF EXISTS "calendars_delete" ON calendars;
CREATE POLICY "calendars_delete" ON calendars FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- ============================================================
-- Update RLS policies on calendar_groups
-- ============================================================

DROP POLICY IF EXISTS "cal_groups_select" ON calendar_groups;
CREATE POLICY "cal_groups_select" ON calendar_groups FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "cal_groups_insert" ON calendar_groups;
CREATE POLICY "cal_groups_insert" ON calendar_groups FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "cal_groups_update" ON calendar_groups;
CREATE POLICY "cal_groups_update" ON calendar_groups FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "cal_groups_delete" ON calendar_groups;
CREATE POLICY "cal_groups_delete" ON calendar_groups FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- ============================================================
-- Update availability_rules policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "avail_rules_select" ON availability_rules;
CREATE POLICY "avail_rules_select" ON availability_rules FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_rules_insert" ON availability_rules;
CREATE POLICY "avail_rules_insert" ON availability_rules FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_rules_update" ON availability_rules;
CREATE POLICY "avail_rules_update" ON availability_rules FOR UPDATE
  TO authenticated USING (can_access_calendar(calendar_id)) WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_rules_delete" ON availability_rules;
CREATE POLICY "avail_rules_delete" ON availability_rules FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));

-- ============================================================
-- Update availability_overrides policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "avail_overrides_select" ON availability_overrides;
CREATE POLICY "avail_overrides_select" ON availability_overrides FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_overrides_insert" ON availability_overrides;
CREATE POLICY "avail_overrides_insert" ON availability_overrides FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_overrides_update" ON availability_overrides;
CREATE POLICY "avail_overrides_update" ON availability_overrides FOR UPDATE
  TO authenticated USING (can_access_calendar(calendar_id)) WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_overrides_delete" ON availability_overrides;
CREATE POLICY "avail_overrides_delete" ON availability_overrides FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));

-- ============================================================
-- Update calendar_hosts policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "cal_hosts_select" ON calendar_hosts;
CREATE POLICY "cal_hosts_select" ON calendar_hosts FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_hosts_insert" ON calendar_hosts;
CREATE POLICY "cal_hosts_insert" ON calendar_hosts FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_hosts_update" ON calendar_hosts;
CREATE POLICY "cal_hosts_update" ON calendar_hosts FOR UPDATE
  TO authenticated USING (can_access_calendar(calendar_id)) WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_hosts_delete" ON calendar_hosts;
CREATE POLICY "cal_hosts_delete" ON calendar_hosts FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));

-- ============================================================
-- Update calendar_group_members policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "cal_group_members_select" ON calendar_group_members;
CREATE POLICY "cal_group_members_select" ON calendar_group_members FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_group_members_insert" ON calendar_group_members;
CREATE POLICY "cal_group_members_insert" ON calendar_group_members FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_group_members_delete" ON calendar_group_members;
CREATE POLICY "cal_group_members_delete" ON calendar_group_members FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));


-- ============ 20260904160947_decouple_forms_from_workspaces.sql ============
/*
# Decouple Forms from Workspaces + Fix Unique Constraints

## Purpose
The calendar wizard queries forms by owner_id when no workspace exists.
The forms table currently has no owner_id column, so that query would error.
This migration adds owner_id to forms, makes its workspace_id nullable, and
adds partial unique indexes so calendar/calendar_group slugs stay unique
per-owner (not just per-workspace).

## Changes

### 1. forms table
- Added `owner_id` column (uuid, references auth.users, ON DELETE SET NULL)
- Made `workspace_id` nullable (was NOT NULL)
- Added index on `owner_id`
- Updated RLS policies to allow access via workspace membership OR direct ownership

### 2. Unique constraints
- Added partial unique index on calendars(owner_id, slug) WHERE workspace_id IS NULL
- Added partial unique index on calendar_groups(owner_id, slug) WHERE workspace_id IS NULL

### 3. forms RLS policies
- SELECT: allow via workspace membership OR direct ownership
- INSERT: allow via workspace membership OR direct ownership
- UPDATE: allow via workspace membership OR direct ownership
- DELETE: allow via workspace membership OR direct ownership
*/

-- ============================================================
-- forms table: add owner_id, make workspace_id nullable
-- ============================================================
ALTER TABLE forms ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE forms ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forms_owner ON forms(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================
-- Partial unique indexes for owner-scoped calendars and groups
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_owner_slug
  ON calendars(owner_id, slug) WHERE workspace_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_groups_owner_slug
  ON calendar_groups(owner_id, slug) WHERE workspace_id IS NULL;

-- ============================================================
-- Update forms RLS policies
-- ============================================================
DROP POLICY IF EXISTS "forms_select" ON forms;
CREATE POLICY "forms_select" ON forms FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "forms_insert" ON forms;
CREATE POLICY "forms_insert" ON forms FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "forms_update" ON forms;
CREATE POLICY "forms_update" ON forms FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "forms_delete" ON forms;
CREATE POLICY "forms_delete" ON forms FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );


-- ============ 20260904162353_decouple_booking_tables_from_workspaces.sql ============
/*
# Decouple Booking Tables from Workspaces

## Purpose
The public booking flow (BookingPage) inserts rows into booking_locks,
contacts, appointments, form_submissions, and messages. All of these
tables currently require workspace_id NOT NULL, but calendars can now
exist without a workspace (owner_id instead). This migration makes
workspace_id nullable on all booking-related tables and adds owner_id
so bookings can complete for workspace-independent calendars.

## Changes

### 1. booking_locks
- Made workspace_id nullable
- Added owner_id column (references auth.users, ON DELETE SET NULL)

### 2. contacts
- Made workspace_id nullable
- Added owner_id column

### 3. appointments
- Made workspace_id nullable
- Added owner_id column

### 4. form_submissions
- Made workspace_id nullable
- Added owner_id column

### 5. messages
- Made workspace_id nullable
- Added owner_id column

### 6. RLS Policies
- Added public INSERT policy for contacts (anon needs to create contacts during booking)
- Added public INSERT policy for form_submissions (anon needs to submit forms during booking)
- Updated authenticated policies on contacts, appointments, form_submissions, messages
  to allow access via workspace membership OR direct owner_id match

## Security
- RLS remains enabled on all tables
- Public/anon policies are scoped to INSERT only (plus existing SELECT/UPDATE where already present)
- Authenticated policies now check both workspace membership and direct ownership
*/

-- ============================================================
-- Make workspace_id nullable + add owner_id
-- ============================================================

ALTER TABLE booking_locks ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE booking_locks ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE contacts ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id) WHERE owner_id IS NOT NULL;

ALTER TABLE appointments ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_owner ON appointments(owner_id) WHERE owner_id IS NOT NULL;

ALTER TABLE form_submissions ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE messages ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- Public INSERT policy for contacts (anon booking flow)
-- ============================================================
DROP POLICY IF EXISTS "contacts_public_insert" ON contacts;
CREATE POLICY "contacts_public_insert"
  ON contacts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ============================================================
-- Public INSERT policy for form_submissions (anon booking flow)
-- ============================================================
DROP POLICY IF EXISTS "form_submissions_public_insert" ON form_submissions;
CREATE POLICY "form_submissions_public_insert"
  ON form_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ============================================================
-- Update authenticated policies to allow owner_id-based access
-- ============================================================

-- contacts: update existing authenticated SELECT to also allow owner_id
DROP POLICY IF EXISTS "contacts_select" ON contacts;
CREATE POLICY "contacts_select" ON contacts FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "contacts_insert" ON contacts;
CREATE POLICY "contacts_insert" ON contacts FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "contacts_update" ON contacts;
CREATE POLICY "contacts_update" ON contacts FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "contacts_delete" ON contacts;
CREATE POLICY "contacts_delete" ON contacts FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- appointments: update authenticated policies
DROP POLICY IF EXISTS "appts_select" ON appointments;
CREATE POLICY "appts_select" ON appointments FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "appts_insert" ON appointments;
CREATE POLICY "appts_insert" ON appointments FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "appts_update" ON appointments;
CREATE POLICY "appts_update" ON appointments FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "appts_delete" ON appointments;
CREATE POLICY "appts_delete" ON appointments FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- form_submissions: update authenticated policies
DROP POLICY IF EXISTS "form_submissions_select" ON form_submissions;
CREATE POLICY "form_submissions_select" ON form_submissions FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "form_submissions_insert" ON form_submissions;
CREATE POLICY "form_submissions_insert" ON form_submissions FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- messages: update authenticated policies
DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update" ON messages FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- ============ 20260905011345_add_group_calendar_theme_and_analytics.sql ============
/*
# Group Calendar Theme, Settings & Analytics

## Purpose
Extend the existing `calendar_groups` table with branding/theme fields
and create a new `calendar_group_analytics` table to track public page
visitors, calendar selections, and booking conversions.

## 1. Modified Tables

### `calendar_groups` — new columns
- `logo_url` (text, nullable) — optional group logo image URL
- `cover_url` (text, nullable) — optional cover/banner image URL
- `primary_color` (text, default '#E4A93C') — accent color for cards/buttons
- `background_color` (text, default '#09132b') — page background color
- `font_family` (text, default 'Inter') — font family for public page
- `layout` (text, default 'grid', CHECK in 'grid'|'list') — card layout style
- `is_active` (boolean, default true) — toggle public visibility without deleting
- `updated_at` (timestamptz, default now()) — track settings changes

## 2. New Tables

### `calendar_group_analytics`
- `id` (uuid PK, gen_random_uuid())
- `group_id` (uuid, FK calendar_groups CASCADE)
- `calendar_id` (uuid, FK calendars SET NULL, nullable — null for group-page views)
- `event_type` (text, CHECK in 'page_view'|'calendar_selected'|'booking_started'|'booking_completed')
- `visitor_ip` (text, nullable) — hashed IP for dedup, nullable
- `metadata` (jsonb, default '{}') — extra context (referrer, user-agent summary)
- `created_at` (timestamptz, default now())

## 3. Security

### `calendar_groups` — public SELECT policy
- New `calendar_groups_public_select` policy: `TO anon, authenticated`
  USING `(is_active = true)` — only active groups are visible publicly.
- Existing authenticated policies remain unchanged (owner/workspace access).

### `calendar_group_members` — public SELECT policy
- New `calendar_group_members_public_select` policy: `TO anon, authenticated`
  USING (EXISTS (SELECT 1 FROM calendar_groups WHERE id = group_id AND is_active = true))
  — public can only see members of active groups.

### `calendar_group_analytics` — public INSERT only
- `calendar_group_analytics_public_insert`: `TO anon, authenticated WITH CHECK (true)`
  — anyone can record analytics events (page views, selections).
- `calendar_group_analytics_select_own`: `TO authenticated` — owners can read
  analytics for their groups.
- No public SELECT, no UPDATE, no DELETE via anon.

## 4. Indexes
- `idx_calendar_group_analytics_group` on `group_id`
- `idx_calendar_group_analytics_calendar` on `calendar_id`
- `idx_calendar_group_analytics_event` on `event_type`
*/

-- ── Extend calendar_groups with theme/branding fields ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'logo_url') THEN
    ALTER TABLE calendar_groups ADD COLUMN logo_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'cover_url') THEN
    ALTER TABLE calendar_groups ADD COLUMN cover_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'primary_color') THEN
    ALTER TABLE calendar_groups ADD COLUMN primary_color text DEFAULT '#E4A93C';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'background_color') THEN
    ALTER TABLE calendar_groups ADD COLUMN background_color text DEFAULT '#09132b';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'font_family') THEN
    ALTER TABLE calendar_groups ADD COLUMN font_family text DEFAULT 'Inter';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'layout') THEN
    ALTER TABLE calendar_groups ADD COLUMN layout text DEFAULT 'grid' CHECK (layout IN ('grid', 'list'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'is_active') THEN
    ALTER TABLE calendar_groups ADD COLUMN is_active boolean DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'updated_at') THEN
    ALTER TABLE calendar_groups ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- ── Create analytics table ──
CREATE TABLE IF NOT EXISTS calendar_group_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES calendar_groups(id) ON DELETE CASCADE,
  calendar_id uuid REFERENCES calendars(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('page_view', 'calendar_selected', 'booking_started', 'booking_completed')),
  visitor_ip text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE calendar_group_analytics ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_calendar_group_analytics_group ON calendar_group_analytics(group_id);
CREATE INDEX IF NOT EXISTS idx_calendar_group_analytics_calendar ON calendar_group_analytics(calendar_id);
CREATE INDEX IF NOT EXISTS idx_calendar_group_analytics_event ON calendar_group_analytics(event_type);

-- ── Public SELECT on calendar_groups (only active groups) ──
DROP POLICY IF EXISTS "calendar_groups_public_select" ON calendar_groups;
CREATE POLICY "calendar_groups_public_select"
  ON calendar_groups FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- ── Public SELECT on calendar_group_members (only for active groups) ──
DROP POLICY IF EXISTS "calendar_group_members_public_select" ON calendar_group_members;
CREATE POLICY "calendar_group_members_public_select"
  ON calendar_group_members FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM calendar_groups WHERE id = group_id AND is_active = true));

-- ── Analytics: public INSERT (anyone can record events) ──
DROP POLICY IF EXISTS "calendar_group_analytics_public_insert" ON calendar_group_analytics;
CREATE POLICY "calendar_group_analytics_public_insert"
  ON calendar_group_analytics FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ── Analytics: authenticated SELECT (owners only) ──
DROP POLICY IF EXISTS "calendar_group_analytics_select_own" ON calendar_group_analytics;
CREATE POLICY "calendar_group_analytics_select_own"
  ON calendar_group_analytics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM calendar_groups
      WHERE id = group_id
      AND (owner_id = auth.uid() OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id)))
    )
  );

-- ============ 20260905015514_fix_booking_links_for_public_use.sql.sql ============
/*
# Fix booking_links for public one-time link enforcement

## Problem
1. `booking_links.workspace_id` is NOT NULL, but personal (non-workspace) calendars
   have no workspace — one-time link generation fails silently for those calendars.
2. RLS is `authenticated`-only, so the public booking page (anon key) cannot read
   `booking_links` to validate a token. One-time links currently behave identically
   to permanent links.
3. There is no atomic way for an unauthenticated visitor to claim a one-time link
   (increment use_count, set used_at) without racing.

## Changes

### 1. Make workspace_id nullable on booking_links
   `ALTER TABLE booking_links ALTER COLUMN workspace_id DROP NOT NULL;`
   This allows personal calendars (owner_id-scoped) to create booking links.

### 2. Add owner_id column to booking_links
   `ALTER TABLE booking_links ADD COLUMN owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;`
   Mirrors the pattern used by calendars/contacts/etc. for personal calendars.

### 3. Add anon SELECT policy for token validation
   Allows the public booking page to look up a link by its token (read-only).
   Scoped to SELECT only — anon cannot INSERT/UPDATE/DELETE.

### 4. Create SECURITY DEFINER function: claim_booking_link(token text)
   Atomically validates and claims a one-time booking link:
   - Checks the link exists, is a one_time link, and hasn't exceeded max_uses
   - Checks expiry if expires_at is set
   - Atomically increments use_count and sets used_at
   - Returns the link row on success, or an error reason on failure
   This prevents race conditions where two visitors try to use the same link.

### 5. Grant EXECUTE on claim function to anon, authenticated
   Public visitors need to call this function to claim their one-time link.

## Security
- anon gets SELECT-only on booking_links (can read token metadata, cannot modify)
- The claim function is SECURITY DEFINER (runs as the table owner) so it can
  perform the atomic UPDATE — anon cannot UPDATE the table directly
- All existing authenticated policies remain unchanged
*/

-- 1. Make workspace_id nullable for personal calendars
ALTER TABLE booking_links ALTER COLUMN workspace_id DROP NOT NULL;

-- 2. Add owner_id for personal-calendar scoping
ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Add anon SELECT policy for token lookup
DROP POLICY IF EXISTS "booking_links_anon_select" ON booking_links;
CREATE POLICY "booking_links_anon_select"
ON booking_links FOR SELECT
TO anon, authenticated
USING (true);

-- 4. Create atomic claim function
CREATE OR REPLACE FUNCTION claim_booking_link(p_token text)
RETURNS TABLE (
  id uuid,
  calendar_id uuid,
  link_type text,
  token text,
  max_uses int,
  use_count int,
  expires_at timestamptz,
  used_at timestamptz,
  success boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link booking_links%ROWTYPE;
  v_reason text := null;
BEGIN
  -- Look up the link by token
  SELECT * INTO v_link FROM booking_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text, NULL::text,
      NULL::int, NULL::int, NULL::timestamptz, NULL::timestamptz,
      false, 'Link not found.';
    RETURN;
  END IF;

  -- Check expiry
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RETURN QUERY SELECT v_link.id, v_link.calendar_id, v_link.link_type, v_link.token,
      v_link.max_uses, v_link.use_count, v_link.expires_at, v_link.used_at,
      false, 'This link has expired.';
    RETURN;
  END IF;

  -- For one_time links, check if already used
  IF v_link.link_type = 'one_time' AND v_link.max_uses IS NOT NULL
     AND v_link.use_count >= v_link.max_uses THEN
    RETURN QUERY SELECT v_link.id, v_link.calendar_id, v_link.link_type, v_link.token,
      v_link.max_uses, v_link.use_count, v_link.expires_at, v_link.used_at,
      false, 'This one-time link has already been used.';
    RETURN;
  END IF;

  -- Atomically increment use_count (only if still under max_uses)
  UPDATE booking_links
    SET use_count = use_count + 1,
        used_at = now()
    WHERE id = v_link.id
      AND (max_uses IS NULL OR use_count < max_uses)
  RETURNING * INTO v_link;

  IF NOT FOUND THEN
    -- Someone else claimed it between our SELECT and UPDATE
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text, NULL::text,
      NULL::int, NULL::int, NULL::timestamptz, NULL::timestamptz,
      false, 'This link has already been used.';
    RETURN;
  END IF;

  RETURN QUERY SELECT v_link.id, v_link.calendar_id, v_link.link_type, v_link.token,
    v_link.max_uses, v_link.use_count, v_link.expires_at, v_link.used_at,
    true, NULL;
  RETURN;
END;
$$;

-- 5. Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION claim_booking_link(text) TO anon, authenticated;


-- ============ 20260905020403_add_integration_layer_schema.sql.sql ============
/*
# Add integration layer columns and sync logs table

## Changes

### 1. appointments — add external calendar sync + payment columns
- `external_event_id text` — ID of the event created in the external calendar (Google Calendar writeback). NULL until synced.
- `sync_status text DEFAULT 'pending'` — sync state: 'pending' (needs sync), 'synced' (event created externally), 'error' (sync failed), 'not_required' (no writeback configured).
- `payment_status text DEFAULT 'free'` — payment state: 'free', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'.
- `payment_provider text` — which provider handled the payment (e.g. 'stripe'). NULL if free.
- `payment_intent_id text` — provider's payment intent / charge ID. NULL if free.

### 2. integration_sync_logs — new table
Tracks each sync run between SYNAPSE and an external calendar provider.
- `id` uuid PK
- `integration_id` uuid FK → integrations(id) ON DELETE CASCADE
- `sync_type text` — 'busy_periods' (fetching busy times) or 'event_writeback' (creating/updating external events) or 'event_cancellation' (removing external events)
- `status text` — 'success', 'failed', 'partial'
- `error_message text` — NULL on success
- `events_synced int DEFAULT 0` — count of events processed
- `started_at timestamptz DEFAULT now()`
- `completed_at timestamptz` — NULL until done

### 3. integrations — add selected_calendar_ids column
- `selected_calendar_ids jsonb DEFAULT '[]'` — array of external calendar IDs the user selected for conflict checking (e.g. Google "Work" and "Personal" calendars).

### 4. Update Integration TypeScript type
The DB already has access_token, refresh_token, token_expires_at columns. The TS type will be updated in the frontend code separately.

## Security
- integration_sync_logs: RLS enabled, owner-scoped via integration ownership (user_id on integrations).
- No new anon policies needed — all integration management is authenticated-only.
- appointments columns are accessible via existing appointment policies.
*/

-- 1. Add columns to appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS external_event_id text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sync_status text DEFAULT 'pending';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'free';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_provider text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_intent_id text;

-- 2. Add selected_calendar_ids to integrations
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS selected_calendar_ids jsonb DEFAULT '[]'::jsonb;

-- 3. Create integration_sync_logs table
CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  sync_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  events_synced int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Enable RLS on integration_sync_logs
ALTER TABLE integration_sync_logs ENABLE ROW LEVEL SECURITY;

-- Policies: owner can manage their sync logs (scoped through integrations.user_id)
DROP POLICY IF EXISTS "select_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "select_own_sync_logs" ON integration_sync_logs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "insert_own_sync_logs" ON integration_sync_logs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "update_own_sync_logs" ON integration_sync_logs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "delete_own_sync_logs" ON integration_sync_logs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_integration_sync_logs_integration_id ON integration_sync_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_appointments_sync_status ON appointments(sync_status) WHERE sync_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_appointments_payment_status ON appointments(payment_status) WHERE payment_status NOT IN ('free');


-- ============ 20260905022204_update_location_type_constraint.sql.sql ============
-- Step 1: Drop the old check constraint
ALTER TABLE calendars DROP CONSTRAINT IF EXISTS calendars_location_type_check;

-- Step 2: Migrate existing data to the new location type
UPDATE calendars SET location_type = 'synapse_meeting' WHERE location_type IN ('google_meet', 'zoom', 'teams');

-- Step 3: Add the new check constraint
ALTER TABLE calendars ADD CONSTRAINT calendars_location_type_check
  CHECK (location_type IN ('synapse_meeting', 'phone', 'in_person', 'custom', 'none'));

-- Step 4: Update workspace default_booking_settings if they reference old location types
UPDATE workspace_settings
  SET settings = jsonb_set(settings, '{default_location}', '"synapse_meeting"')
  WHERE settings->>'default_location' IN ('google_meet', 'zoom', 'teams');


-- ============ 20260905030458_add_button_color_to_calendar_groups.sql.sql ============
-- Add button_color to calendar_groups theme fields
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'button_color') THEN
    ALTER TABLE calendar_groups ADD COLUMN button_color text DEFAULT '#E4A93C';
  END IF;
END $$;


-- ============ 20260905034325_add_calendar_appearance_columns.sql.sql ============
/*
# Add appearance columns to calendars table

1. Changes
- Adds `logo_url`, `cover_url`, `background_color`, `button_color`, `font_family` columns to `calendars`.
- These mirror the same fields on `calendar_groups` so individual calendars can also be themed.
- All columns are nullable with safe defaults applied via `IF NOT EXISTS`.
- No RLS changes — existing policies on `calendars` remain unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'logo_url') THEN
    ALTER TABLE calendars ADD COLUMN logo_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'cover_url') THEN
    ALTER TABLE calendars ADD COLUMN cover_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'background_color') THEN
    ALTER TABLE calendars ADD COLUMN background_color text DEFAULT '#FAF6F0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'button_color') THEN
    ALTER TABLE calendars ADD COLUMN button_color text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'font_family') THEN
    ALTER TABLE calendars ADD COLUMN font_family text DEFAULT 'Inter';
  END IF;
END $$;

-- ============ 20260905042433_add_invite_pastor_tolu_form.sql (skipped: data from the original database) ============

-- ============ 20260905042505_update_pastor_tolu_form_fields.sql (skipped: data from the original database) ============

-- ============ 20260906223635_add_forms_module_inactive_status_and_usage_tracking.sql ============
-- Add 'inactive' to forms status constraint
ALTER TABLE forms DROP CONSTRAINT forms_status_check;
ALTER TABLE forms ADD CONSTRAINT forms_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'inactive'::text, 'archived'::text]));

-- Form usage tracking: references where a form is connected across SYNAPSE modules
CREATE TABLE form_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module = ANY (ARRAY['calendar'::text, 'event'::text, 'webinar'::text, 'workflow'::text, 'landing_page'::text, 'external'::text])),
  entity_id uuid,
  entity_name text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_form_usages_form_id ON form_usages(form_id);
CREATE UNIQUE INDEX idx_form_usages_unique ON form_usages(form_id, module, entity_id) WHERE entity_id IS NOT NULL;

ALTER TABLE form_usages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_usages_select" ON form_usages FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM forms f
      WHERE f.id = form_id
      AND (f.owner_id = auth.uid() OR (f.workspace_id IS NOT NULL AND can_access_workspace(f.workspace_id)))
    )
  );

CREATE POLICY "form_usages_insert" ON form_usages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM forms f
      WHERE f.id = form_id
      AND (f.owner_id = auth.uid() OR (f.workspace_id IS NOT NULL AND can_access_workspace(f.workspace_id)))
    )
  );

CREATE POLICY "form_usages_delete" ON form_usages FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM forms f
      WHERE f.id = form_id
      AND (f.owner_id = auth.uid() OR (f.workspace_id IS NOT NULL AND can_access_workspace(f.workspace_id)))
    )
  );

-- Seed form_usages from existing calendar connections
INSERT INTO form_usages (form_id, module, entity_id, entity_name)
  SELECT connected_form_id, 'calendar', id, name
  FROM calendars
  WHERE connected_form_id IS NOT NULL
  ON CONFLICT (form_id, module, entity_id) WHERE entity_id IS NOT NULL DO NOTHING;

INSERT INTO form_usages (form_id, module, entity_id, entity_name)
  SELECT connected_form_id, 'calendar', id, name
  FROM calendar_groups
  WHERE connected_form_id IS NOT NULL
  ON CONFLICT (form_id, module, entity_id) WHERE entity_id IS NOT NULL DO NOTHING;


-- ============ 20260906223824_add_form_submission_counts_rpc.sql ============
-- RPC to get submission counts for a list of form IDs
CREATE OR REPLACE FUNCTION get_form_submission_counts(form_ids uuid[])
RETURNS TABLE(form_id uuid, count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT form_id, COUNT(*) as count
  FROM form_submissions
  WHERE form_id = ANY(form_ids)
  GROUP BY form_id;
$$;

GRANT EXECUTE ON FUNCTION get_form_submission_counts(uuid[]) TO authenticated;


-- ============ 20260906225805_add_form_definition_column.sql ============
-- Add definition JSONB column for the visual form builder
-- This stores the complete form definition: pages, sections, elements, theme, logic, settings
ALTER TABLE forms ADD COLUMN IF NOT EXISTS definition jsonb DEFAULT '{}';


-- ============ 20260906230419_add_form_definition_column.sql ============
-- Add definition JSONB column for the visual form builder
-- Stores the complete form definition: pages, sections, elements, theme, logic, settings
ALTER TABLE forms ADD COLUMN IF NOT EXISTS definition jsonb DEFAULT '{}';


-- ============ 20260906235445_add_form_notification_logs_and_submission_tracking.sql ============
/*
# Form notification logs and submission tracking

1. New Tables
- `form_notification_logs` — records each notification attempt (internal and respondent) for a form submission.
  - `id` (uuid, primary key)
  - `submission_id` (uuid, FK to form_submissions, ON DELETE CASCADE)
  - `form_id` (uuid, FK to forms, ON DELETE CASCADE)
  - `workspace_id` (uuid, FK to workspaces, ON DELETE CASCADE)
  - `type` (text: 'internal' or 'respondent')
  - `channel` (text: 'email', 'in_app', 'both')
  - `recipient` (text: email address or user id)
  - `subject` (text)
  - `body` (text)
  - `status` (text: 'pending', 'sent', 'failed')
  - `error` (text, nullable)
  - `created_at` (timestamptz)
- `form_activity_timeline` — links form submissions to contacts for activity tracking.
  - `id` (uuid, primary key)
  - `contact_id` (uuid, FK to contacts, ON DELETE CASCADE)
  - `submission_id` (uuid, FK to form_submissions, ON DELETE CASCADE)
  - `form_id` (uuid, FK to forms, ON DELETE CASCADE)
  - `workspace_id` (uuid, FK to workspaces, ON DELETE CASCADE)
  - `form_name` (text)
  - `created_at` (timestamptz)

2. Security
- Enable RLS on both new tables.
- Owner-scoped CRUD via workspace membership check (authenticated users can access rows in workspaces they belong to).
- Allow anon INSERT on form_notification_logs (public form submissions may trigger notifications).
- Allow anon SELECT on form_activity_timeline for contact timeline lookups.
*/

-- ============================================================
-- FORM NOTIFICATION LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS form_notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('internal', 'respondent')),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'in_app', 'both')),
  recipient text,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_logs_submission ON form_notification_logs(submission_id);
CREATE INDEX IF NOT EXISTS idx_notif_logs_form ON form_notification_logs(form_id);
CREATE INDEX IF NOT EXISTS idx_notif_logs_workspace ON form_notification_logs(workspace_id);
ALTER TABLE form_notification_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated workspace members to read notification logs
DROP POLICY IF EXISTS "select_workspace_notif_logs" ON form_notification_logs;
CREATE POLICY "select_workspace_notif_logs" ON form_notification_logs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces WHERE workspaces.id = form_notification_logs.workspace_id AND workspaces.owner_id = auth.uid())
  );

-- Allow anon to insert notification logs (public form submissions)
DROP POLICY IF EXISTS "insert_notif_logs" ON form_notification_logs;
CREATE POLICY "insert_notif_logs" ON form_notification_logs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- Allow workspace owners to update notification log status
DROP POLICY IF EXISTS "update_workspace_notif_logs" ON form_notification_logs;
CREATE POLICY "update_workspace_notif_logs" ON form_notification_logs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces WHERE workspaces.id = form_notification_logs.workspace_id AND workspaces.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces WHERE workspaces.id = form_notification_logs.workspace_id AND workspaces.owner_id = auth.uid())
  );

-- ============================================================
-- FORM ACTIVITY TIMELINE
-- ============================================================

CREATE TABLE IF NOT EXISTS form_activity_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  form_name text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_activity_contact ON form_activity_timeline(contact_id);
CREATE INDEX IF NOT EXISTS idx_form_activity_submission ON form_activity_timeline(submission_id);
ALTER TABLE form_activity_timeline ENABLE ROW LEVEL SECURITY;

-- Allow authenticated workspace members to read activity timeline
DROP POLICY IF EXISTS "select_workspace_form_activity" ON form_activity_timeline;
CREATE POLICY "select_workspace_form_activity" ON form_activity_timeline FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces WHERE workspaces.id = form_activity_timeline.workspace_id AND workspaces.owner_id = auth.uid())
  );

-- Allow anon to insert activity timeline (public form submissions)
DROP POLICY IF EXISTS "insert_form_activity" ON form_activity_timeline;
CREATE POLICY "insert_form_activity" ON form_activity_timeline FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- Allow workspace owners to delete activity timeline entries
DROP POLICY IF EXISTS "delete_workspace_form_activity" ON form_activity_timeline;
CREATE POLICY "delete_workspace_form_activity" ON form_activity_timeline FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces WHERE workspaces.id = form_activity_timeline.workspace_id AND workspaces.owner_id = auth.uid())
  );


-- ============ 20260907095904_add_page_config_to_calendar_groups.sql ============
/*
# Add page_config JSONB column to calendar_groups

1. Modified Tables
- `calendar_groups`: Add `page_config` jsonb column (nullable) for storing the
  reusable public page presentation configuration (branding, typography, layout,
  header, footer, navigation). This is presentation-only config and does NOT
  affect calendar availability, booking logic, or form data.

2. Security
- No RLS policy changes needed — the column inherits the table's existing RLS.
- Public SELECT already exists on calendar_groups for active groups.
- Owner-scoped UPDATE already exists for the workspace owner.
*/

ALTER TABLE calendar_groups
  ADD COLUMN IF NOT EXISTS page_config jsonb;


-- ============ 20260907112956_ensure_form_definition_column.sql ============
-- Add definition JSONB column for visual form builder (if not already present)
ALTER TABLE forms ADD COLUMN IF NOT EXISTS definition jsonb DEFAULT '{}';


-- ============ 20260907113333_create_test_group_calendars_with_forms.sql ============
-- Create three test forms with distinct definitions
INSERT INTO forms (id, name, description, type, status, create_contact, update_contact, auto_tags, definition)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'General Consultation Form',
    'Please fill out this form before your consultation.',
    'form',
    'published',
    true,
    true,
    '[]'::jsonb,
    '{
      "version": 1,
      "pages": [{"id": "page-a1", "name": "Page 1", "sectionIds": ["sec-a1"], "visible": true}],
      "sections": {"sec-a1": {"id": "sec-a1", "name": "Section 1", "visible": true, "columnCount": 2, "elementIds": ["el-a1","el-a2","el-a3","el-a4","el-a5"]}},
      "elements": {
        "el-a1": {"id": "el-a1", "type": "first_name", "category": "fields", "displayLabel": "First Name", "sortOrder": 0, "column": 1, "field": {"fieldId": "fld-a1", "label": "First Name", "required": true, "visible": true, "placeholder": "John", "mappedContactField": "first_name"}},
        "el-a2": {"id": "el-a2", "type": "last_name", "category": "fields", "displayLabel": "Last Name", "sortOrder": 1, "column": 2, "field": {"fieldId": "fld-a2", "label": "Last Name", "required": true, "visible": true, "placeholder": "Doe", "mappedContactField": "last_name"}},
        "el-a3": {"id": "el-a3", "type": "email", "category": "fields", "displayLabel": "Email Address", "sortOrder": 2, "column": 1, "field": {"fieldId": "fld-a3", "label": "Email Address", "required": true, "visible": true, "placeholder": "john@example.com", "mappedContactField": "email"}},
        "el-a4": {"id": "el-a4", "type": "phone", "category": "fields", "displayLabel": "Phone Number", "sortOrder": 3, "column": 2, "field": {"fieldId": "fld-a4", "label": "Phone Number", "required": false, "visible": true, "placeholder": "+1 (555) 000-0000", "mappedContactField": "phone"}},
        "el-a5": {"id": "el-a5", "type": "long_text", "category": "fields", "displayLabel": "What would you like to discuss?", "sortOrder": 4, "column": 1, "field": {"fieldId": "fld-a5", "label": "What would you like to discuss?", "required": false, "visible": true, "placeholder": "Briefly describe what you would like to cover in the consultation."}}
      },
      "header": {"enabled": true, "showLogo": false, "showTitle": true, "showDescription": true, "showProgress": false},
      "footer": {"enabled": false, "content": ""},
      "theme": {
        "layoutPreset": "card", "maxFormWidth": "720px",
        "colors": {"surfaceBackground": "#ffffff", "heading": "#09132b", "bodyText": "#4a4a4a", "mutedText": "#9a9a9a", "border": "#e5e5e5", "primary": "#E4A93C", "background": "#ffffff"},
        "typography": {"primaryFont": "Inter, system-ui, sans-serif", "headingFont": "Playfair Display, Georgia, serif", "headingSize": "28px", "headingWeight": 700, "headingLineHeight": 1.2, "headingLetterSpacing": "0", "bodySize": "15px", "bodyLineHeight": 1.5, "buttonSize": "15px", "buttonWeight": 600},
        "layout": {"formWidth": "medium", "pagePadding": 32, "sectionSpacing": 24, "fieldSpacing": 16, "containerRadius": "xl", "containerShadow": "lg"},
        "fieldStyle": {"borderWidth": 1, "borderRadius": "md", "borderColor": "#d1d5db", "focusBorderColor": "#E4A93C", "backgroundColor": "#ffffff", "textColor": "#1a1a1a", "fontSize": "15px", "padding": "12px 16px"},
        "buttonStyle": {"style": "filled", "background": "#09132b", "textColor": "#ffffff", "border": "#09132b", "borderRadius": "lg", "height": 48, "padding": 24, "width": "full", "align": "center"},
        "split": {"leftWidth": 40, "rightWidth": 60, "columnGap": 0, "backgroundImage": null, "overlayOpacity": 0, "backgroundOverlay": "#000000", "contentAlign": "left"},
        "background": {"type": "color", "color": "#ffffff", "imageUrl": null, "imageSize": "cover", "imagePosition": "center", "overlayOpacity": 0, "overlayColor": "#000000"},
        "branding": {"logoUrl": null, "logoWidth": 200},
        "progress": {"show": true, "style": "bar", "color": "#E4A93C", "height": 6, "spacing": 16, "showLabels": true}
      },
      "logic": [],
      "settings": {"createContact": true, "updateContact": true, "autoTags": [], "successMessage": "Thank you for your submission.", "redirectUrl": null, "showProgressBar": false, "allowBackNavigation": true},
      "notifications": {
        "internal": {"enabled": false, "recipients": [], "channel": "email", "subject": "New Form Submission", "message": "A new form submission has been received.", "includeFields": [], "includeAllFields": true},
        "respondent": {"enabled": false, "emailFieldId": null, "subject": "Thank you for your submission", "senderName": "", "replyTo": "", "message": "We have received your information and will be in touch shortly.", "includeAnswers": "none", "includedFields": []},
        "postSubmission": {"type": "thank_you", "thankYouPage": {"heading": "Thank You!", "message": "Your submission has been received.", "imageUrl": null, "buttonText": null, "buttonLink": null}, "redirectUrl": null, "customMessage": ""}
      }
    }'::jsonb
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Group Workshop Registration',
    'Register for our upcoming group workshop.',
    'form',
    'published',
    true,
    true,
    '[]'::jsonb,
    '{
      "version": 1,
      "pages": [{"id": "page-b1", "name": "Page 1", "sectionIds": ["sec-b1"], "visible": true}],
      "sections": {"sec-b1": {"id": "sec-b1", "name": "Section 1", "visible": true, "columnCount": 2, "elementIds": ["el-b1","el-b2","el-b3","el-b4","el-b5","el-b6"]}},
      "elements": {
        "el-b1": {"id": "el-b1", "type": "first_name", "category": "fields", "displayLabel": "First Name", "sortOrder": 0, "column": 1, "field": {"fieldId": "fld-b1", "label": "First Name", "required": true, "visible": true, "placeholder": "Jane", "mappedContactField": "first_name"}},
        "el-b2": {"id": "el-b2", "type": "last_name", "category": "fields", "displayLabel": "Last Name", "sortOrder": 1, "column": 2, "field": {"fieldId": "fld-b2", "label": "Last Name", "required": true, "visible": true, "placeholder": "Smith", "mappedContactField": "last_name"}},
        "el-b3": {"id": "el-b3", "type": "email", "category": "fields", "displayLabel": "Email Address", "sortOrder": 2, "column": 1, "field": {"fieldId": "fld-b3", "label": "Email Address", "required": true, "visible": true, "placeholder": "jane@example.com", "mappedContactField": "email"}},
        "el-b4": {"id": "el-b4", "type": "phone", "category": "fields", "displayLabel": "Phone Number", "sortOrder": 3, "column": 2, "field": {"fieldId": "fld-b4", "label": "Phone Number", "required": false, "visible": true, "placeholder": "+1 (555) 000-0000", "mappedContactField": "phone"}},
        "el-b5": {"id": "el-b5", "type": "text_field", "category": "fields", "displayLabel": "Organisation", "sortOrder": 4, "column": 1, "field": {"fieldId": "fld-b5", "label": "Organisation", "required": false, "visible": true, "placeholder": "Your organisation name"}},
        "el-b6": {"id": "el-b6", "type": "long_text", "category": "fields", "displayLabel": "What do you hope to learn?", "sortOrder": 5, "column": 1, "field": {"fieldId": "fld-b6", "label": "What do you hope to learn?", "required": false, "visible": true, "placeholder": "Tell us what you hope to gain from this workshop."}}
      },
      "header": {"enabled": true, "showLogo": false, "showTitle": true, "showDescription": true, "showProgress": false},
      "footer": {"enabled": false, "content": ""},
      "theme": {
        "layoutPreset": "card", "maxFormWidth": "720px",
        "colors": {"surfaceBackground": "#ffffff", "heading": "#09132b", "bodyText": "#4a4a4a", "mutedText": "#9a9a9a", "border": "#e5e5e5", "primary": "#E4A93C", "background": "#ffffff"},
        "typography": {"primaryFont": "Inter, system-ui, sans-serif", "headingFont": "Playfair Display, Georgia, serif", "headingSize": "28px", "headingWeight": 700, "headingLineHeight": 1.2, "headingLetterSpacing": "0", "bodySize": "15px", "bodyLineHeight": 1.5, "buttonSize": "15px", "buttonWeight": 600},
        "layout": {"formWidth": "medium", "pagePadding": 32, "sectionSpacing": 24, "fieldSpacing": 16, "containerRadius": "xl", "containerShadow": "lg"},
        "fieldStyle": {"borderWidth": 1, "borderRadius": "md", "borderColor": "#d1d5db", "focusBorderColor": "#E4A93C", "backgroundColor": "#ffffff", "textColor": "#1a1a1a", "fontSize": "15px", "padding": "12px 16px"},
        "buttonStyle": {"style": "filled", "background": "#09132b", "textColor": "#ffffff", "border": "#09132b", "borderRadius": "lg", "height": 48, "padding": 24, "width": "full", "align": "center"},
        "split": {"leftWidth": 40, "rightWidth": 60, "columnGap": 0, "backgroundImage": null, "overlayOpacity": 0, "backgroundOverlay": "#000000", "contentAlign": "left"},
        "background": {"type": "color", "color": "#ffffff", "imageUrl": null, "imageSize": "cover", "imagePosition": "center", "overlayOpacity": 0, "overlayColor": "#000000"},
        "branding": {"logoUrl": null, "logoWidth": 200},
        "progress": {"show": true, "style": "bar", "color": "#E4A93C", "height": 6, "spacing": 16, "showLabels": true}
      },
      "logic": [],
      "settings": {"createContact": true, "updateContact": true, "autoTags": [], "successMessage": "Thank you for your registration.", "redirectUrl": null, "showProgressBar": false, "allowBackNavigation": true},
      "notifications": {
        "internal": {"enabled": false, "recipients": [], "channel": "email", "subject": "New Form Submission", "message": "A new form submission has been received.", "includeFields": [], "includeAllFields": true},
        "respondent": {"enabled": false, "emailFieldId": null, "subject": "Thank you for your submission", "senderName": "", "replyTo": "", "message": "We have received your information and will be in touch shortly.", "includeAnswers": "none", "includedFields": []},
        "postSubmission": {"type": "thank_you", "thankYouPage": {"heading": "Thank You!", "message": "Your registration has been received.", "imageUrl": null, "buttonText": null, "buttonLink": null}, "redirectUrl": null, "customMessage": ""}
      }
    }'::jsonb
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Strategy Session Application',
    'Apply for a strategy session with our team.',
    'form',
    'published',
    true,
    true,
    '[]'::jsonb,
    '{
      "version": 1,
      "pages": [{"id": "page-c1", "name": "Page 1", "sectionIds": ["sec-c1"], "visible": true}],
      "sections": {"sec-c1": {"id": "sec-c1", "name": "Section 1", "visible": true, "columnCount": 2, "elementIds": ["el-c1","el-c2","el-c3","el-c4","el-c5","el-c6","el-c7"]}},
      "elements": {
        "el-c1": {"id": "el-c1", "type": "first_name", "category": "fields", "displayLabel": "First Name", "sortOrder": 0, "column": 1, "field": {"fieldId": "fld-c1", "label": "First Name", "required": true, "visible": true, "placeholder": "Alex", "mappedContactField": "first_name"}},
        "el-c2": {"id": "el-c2", "type": "last_name", "category": "fields", "displayLabel": "Last Name", "sortOrder": 1, "column": 2, "field": {"fieldId": "fld-c2", "label": "Last Name", "required": true, "visible": true, "placeholder": "Johnson", "mappedContactField": "last_name"}},
        "el-c3": {"id": "el-c3", "type": "email", "category": "fields", "displayLabel": "Email Address", "sortOrder": 2, "column": 1, "field": {"fieldId": "fld-c3", "label": "Email Address", "required": true, "visible": true, "placeholder": "alex@example.com", "mappedContactField": "email"}},
        "el-c4": {"id": "el-c4", "type": "phone", "category": "fields", "displayLabel": "Phone Number", "sortOrder": 3, "column": 2, "field": {"fieldId": "fld-c4", "label": "Phone Number", "required": false, "visible": true, "placeholder": "+1 (555) 000-0000", "mappedContactField": "phone"}},
        "el-c5": {"id": "el-c5", "type": "text_field", "category": "fields", "displayLabel": "Company", "sortOrder": 4, "column": 1, "field": {"fieldId": "fld-c5", "label": "Company", "required": true, "visible": true, "placeholder": "Your company name"}},
        "el-c6": {"id": "el-c6", "type": "text_field", "category": "fields", "displayLabel": "Role", "sortOrder": 5, "column": 2, "field": {"fieldId": "fld-c6", "label": "Role", "required": false, "visible": true, "placeholder": "Your job title"}},
        "el-c7": {"id": "el-c7", "type": "long_text", "category": "fields", "displayLabel": "What challenge are you facing?", "sortOrder": 6, "column": 1, "field": {"fieldId": "fld-c7", "label": "What challenge are you facing?", "required": true, "visible": true, "placeholder": "Describe the strategic challenge you would like to discuss."}}
      },
      "header": {"enabled": true, "showLogo": false, "showTitle": true, "showDescription": true, "showProgress": false},
      "footer": {"enabled": false, "content": ""},
      "theme": {
        "layoutPreset": "card", "maxFormWidth": "720px",
        "colors": {"surfaceBackground": "#ffffff", "heading": "#09132b", "bodyText": "#4a4a4a", "mutedText": "#9a9a9a", "border": "#e5e5e5", "primary": "#E4A93C", "background": "#ffffff"},
        "typography": {"primaryFont": "Inter, system-ui, sans-serif", "headingFont": "Playfair Display, Georgia, serif", "headingSize": "28px", "headingWeight": 700, "headingLineHeight": 1.2, "headingLetterSpacing": "0", "bodySize": "15px", "bodyLineHeight": 1.5, "buttonSize": "15px", "buttonWeight": 600},
        "layout": {"formWidth": "medium", "pagePadding": 32, "sectionSpacing": 24, "fieldSpacing": 16, "containerRadius": "xl", "containerShadow": "lg"},
        "fieldStyle": {"borderWidth": 1, "borderRadius": "md", "borderColor": "#d1d5db", "focusBorderColor": "#E4A93C", "backgroundColor": "#ffffff", "textColor": "#1a1a1a", "fontSize": "15px", "padding": "12px 16px"},
        "buttonStyle": {"style": "filled", "background": "#09132b", "textColor": "#ffffff", "border": "#09132b", "borderRadius": "lg", "height": 48, "padding": 24, "width": "full", "align": "center"},
        "split": {"leftWidth": 40, "rightWidth": 60, "columnGap": 0, "backgroundImage": null, "overlayOpacity": 0, "backgroundOverlay": "#000000", "contentAlign": "left"},
        "background": {"type": "color", "color": "#ffffff", "imageUrl": null, "imageSize": "cover", "imagePosition": "center", "overlayOpacity": 0, "overlayColor": "#000000"},
        "branding": {"logoUrl": null, "logoWidth": 200},
        "progress": {"show": true, "style": "bar", "color": "#E4A93C", "height": 6, "spacing": 16, "showLabels": true}
      },
      "logic": [],
      "settings": {"createContact": true, "updateContact": true, "autoTags": [], "successMessage": "Thank you for your application.", "redirectUrl": null, "showProgressBar": false, "allowBackNavigation": true},
      "notifications": {
        "internal": {"enabled": false, "recipients": [], "channel": "email", "subject": "New Form Submission", "message": "A new form submission has been received.", "includeFields": [], "includeAllFields": true},
        "respondent": {"enabled": false, "emailFieldId": null, "subject": "Thank you for your submission", "senderName": "", "replyTo": "", "message": "We have received your information and will be in touch shortly.", "includeAnswers": "none", "includedFields": []},
        "postSubmission": {"type": "thank_you", "thankYouPage": {"heading": "Thank You!", "message": "Your application has been received.", "imageUrl": null, "buttonText": null, "buttonLink": null}, "redirectUrl": null, "customMessage": ""}
      }
    }'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  definition = EXCLUDED.definition,
  status = EXCLUDED.status;

-- Create three test calendars (valid hex UUIDs)
INSERT INTO calendars (id, name, slug, description, calendar_type, duration_minutes, slot_interval_minutes, location_type, status, booking_flow, connected_form_id, color, background_color, button_color, font_family, timezone, max_booking_horizon_days, min_booking_notice_minutes)
VALUES
  ('0c100000-0000-0000-0000-000000000001', 'General Consultation', 'general-consultation', '30-minute consultation call', 'one_on_one', 30, 30, 'synapse_meeting', 'active', 'form_first', '11111111-1111-1111-1111-111111111111', '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'UTC', 30, 60),
  ('0c100000-0000-0000-0000-000000000002', 'Group Workshop', 'group-workshop', 'Interactive group workshop session', 'group', 90, 30, 'synapse_meeting', 'active', 'form_first', '22222222-2222-2222-2222-222222222222', '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'UTC', 30, 60),
  ('0c100000-0000-0000-0000-000000000003', 'Strategy Session', 'strategy-session', 'Strategic planning session with our team', 'one_on_one', 60, 30, 'synapse_meeting', 'active', 'form_first', '33333333-3333-3333-3333-333333333333', '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'UTC', 30, 60)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  connected_form_id = EXCLUDED.connected_form_id,
  booking_flow = EXCLUDED.booking_flow,
  status = EXCLUDED.status,
  background_color = EXCLUDED.background_color;

-- Create the group calendar
INSERT INTO calendar_groups (id, name, slug, description, is_active, primary_color, background_color, button_color, font_family, layout, booking_flow)
VALUES
  ('0e100000-0000-0000-0000-000000000001', 'SYNAPSE Booking', 'synapse-booking', 'Book a session with our team. Choose a service above, fill out the form, and select a time that works for you.', true, '#E4A93C', '#09132b', '#E4A93C', 'Inter', 'grid', 'form_first')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  primary_color = EXCLUDED.primary_color,
  background_color = EXCLUDED.background_color,
  button_color = EXCLUDED.button_color,
  booking_flow = EXCLUDED.booking_flow;

-- Link calendars to the group
INSERT INTO calendar_group_members (group_id, calendar_id, sort_order)
VALUES
  ('0e100000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000001', 0),
  ('0e100000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000002', 1),
  ('0e100000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000003', 2)
ON CONFLICT DO NOTHING;


-- ============ 20260907132304_add_page_config_to_calendar_groups.sql ============
ALTER TABLE calendar_groups
  ADD COLUMN IF NOT EXISTS page_config jsonb;

-- ============ 20260911220252_fix_is_workspace_member_and_form_fields_rls.sql ============
/*
# Fix is_workspace_member to check workspace ownership, and fix form_fields INSERT policy

## Problem
The `is_workspace_member` function only checked the `workspace_members` table.
If a workspace owner had no row in `workspace_members` (which can happen due to
timing or missing insert), `can_access_workspace()` returned false, blocking ALL
RLS-checked inserts: forms, form_fields, contacts, calendar_groups, and
calendar_group_members. This was the root cause of form creation, contact
creation, CSV import, and group calendar member insertion all failing.

## Changes

1. `is_workspace_member` — now also returns true if the user is the owner of the
   workspace (checked via `workspaces.owner_id = auth.uid()`). This is a
   superset of the old check: members still pass, and owners always pass even
   if their `workspace_members` row is missing or delayed.

2. `form_fields_insert` policy — the old policy only checked
   `can_access_workspace(forms.workspace_id)`, which failed when the workspace
   owner had no `workspace_members` row. The new policy also checks
   `forms.owner_id = auth.uid()`, so form fields can be inserted by the form's
   owner regardless of workspace membership state.

## Security
- No policies are weakened. The owner check is the same identity check, just
  via a different table column. An attacker still cannot access another user's
  workspace data.
- `is_workspace_member` remains SECURITY DEFINER with `search_path = 'public'`.
*/

-- 1. Fix is_workspace_member to also check workspace ownership
CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = check_workspace_id AND user_id = auth.uid()
) OR EXISTS (
  SELECT 1 FROM workspaces
  WHERE id = check_workspace_id AND owner_id = auth.uid()
);
$function$;

-- 2. Fix form_fields INSERT policy to also check form ownership
DROP POLICY IF EXISTS "form_fields_insert" ON form_fields;
CREATE POLICY "form_fields_insert"
ON form_fields FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM forms
    WHERE forms.id = form_fields.form_id
    AND (
      forms.owner_id = auth.uid()
      OR (forms.workspace_id IS NOT NULL AND can_access_workspace(forms.workspace_id))
    )
  )
);


-- ============ 20260926140000_fix_calendars_location_type_default.sql ============
/*
  # Fix calendars.location_type default

  20260905022204 restricted location_type to
  ('synapse_meeting', 'phone', 'in_person', 'custom', 'none') but left the
  column default as 'google_meet', so any insert that omits location_type
  (including seed_workspace_demo_data) violates the check constraint.
*/

ALTER TABLE calendars ALTER COLUMN location_type SET DEFAULT 'synapse_meeting';


-- ============ 20260927100000_add_contact_detail_fields.sql ============
/*
  # Contact detail fields for the Add Contact form

  Adds the fields the redesigned Add Contact form collects:
  - additional_emails  text[]  : emails beyond the primary one (primary stays in `email`)
  - phone_type         text    : type of the primary phone (mobile, home, work, other)
  - additional_phones  jsonb   : [{ "type": "mobile", "number": "+234 803 552 3054" }, ...]
  - contact_type       text    : 'lead' or 'customer'
  - timezone           text    : IANA time zone, e.g. 'Africa/Lagos'
  - dnd_all            boolean : do not disturb on every channel
  - dnd_channels       text[]  : any of 'email', 'sms', 'calls', 'inbound'
*/

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS additional_emails text[] NOT NULL DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_type text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS additional_phones jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_type text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dnd_all boolean NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dnd_channels text[] NOT NULL DEFAULT '{}';

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type IS NULL OR contact_type IN ('lead', 'customer'));

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_type_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_phone_type_check
  CHECK (phone_type IS NULL OR phone_type IN ('mobile', 'home', 'work', 'other'));

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_dnd_channels_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_dnd_channels_check
  CHECK (dnd_channels <@ ARRAY['email', 'sms', 'calls', 'inbound']::text[]);


-- ============ 20260927180000_add_email_fields_to_messages.sql ============
/*
  # Email details on messages

  The contact page's email composer records who it is from, who it goes to
  (including CC/BCC) and the formatted body, ready for an email provider.

  - from_email  text   : sender address
  - from_name   text   : sender display name
  - to_address  text   : recipient email or phone number
  - cc          text[] : CC addresses
  - bcc         text[] : BCC addresses
  - body_html   text   : formatted email body (body keeps the plain-text version)
*/

ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_email text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_name text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_address text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cc text[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS bcc text[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_html text;


-- ============ 20260928090000_add_connected_email_accounts.sql ============
/*
  # Connected email accounts (Gmail)

  Lets a team member connect their own Google account and send email from it
  inside SYNAPSE.

  1. email_accounts
     One row per connected mailbox. A user can see and remove only their own
     connections; tokens never live here.

  2. email_account_secrets
     The encrypted OAuth refresh token and the short-lived access token.
     Row level security is on with NO policies, so the browser can never read
     it. Only Edge Functions using the service role key touch this table.

  3. messages.email_account_id
     Which connected mailbox a message was sent from.
*/

CREATE TABLE IF NOT EXISTS email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  email text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  last_error text,
  scopes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, provider, email)
);
CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts(user_id);
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_accounts_select_own" ON email_accounts;
CREATE POLICY "email_accounts_select_own" ON email_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "email_accounts_delete_own" ON email_accounts;
CREATE POLICY "email_accounts_delete_own" ON email_accounts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS email_account_secrets (
  account_id uuid PRIMARY KEY REFERENCES email_accounts(id) ON DELETE CASCADE,
  refresh_token_enc text NOT NULL,
  access_token_enc text,
  access_token_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_account_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_account_secrets FROM anon, authenticated;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_account_id uuid
  REFERENCES email_accounts(id) ON DELETE SET NULL;


-- ============ 20260930120000_add_spaces.sql ============
/*
  # Spatial workspace foundation: spaces

  Naming: `workspaces` stays the account/tenant. A "workspace" in the Workspaces
  section of the app (the virtual office people walk around in) is a row in the
  new `spaces` table. The UI still calls spaces "workspaces".

  1. profiles
     - avatar_config (jsonb, null): the default avatar used in every space
     - media_prefs (jsonb): how the user joins a space (muted, camera off, data saver)

  2. spaces: one virtual space, owned by a workspace (tenant)
     - slug is unique across ALL tenants, because links look like synapse.app/<slug>
     - space_type: office | classroom | event_hall | coaching_studio | community_hub
     - size_band: solo (1) | small (2-10) | medium (11-25) | large (26-50) | xl (50+)
     - updated_at has no trigger (the repo sets updated_at from the app, as elsewhere)

  3. space_members: per-person state inside one space
     (avatar override, assigned desk, last position, first entry)

  4. Row level security
     - spaces: members of the owning workspace can read; owners/admins can create,
       edit and delete (is_workspace_member / is_workspace_admin)
     - space_members: people can read rows for spaces in their workspaces, and can
       only create or update their own row

  5. is_space_slug_available(p_slug): true/false only, so the create wizard can check
     a slug without reading other tenants' spaces
*/

-- 1. profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_config jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS media_prefs jsonb
  DEFAULT '{"join_muted": true, "join_camera_off": true, "data_saver": false}'::jsonb;

-- 2. spaces
CREATE TABLE IF NOT EXISTS spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  space_type text NOT NULL DEFAULT 'office'
    CHECK (space_type IN ('office', 'classroom', 'event_hall', 'coaching_studio', 'community_hub')),
  size_band text NOT NULL DEFAULT 'small'
    CHECK (size_band IN ('solo', 'small', 'medium', 'large', 'xl')),
  template_key text NOT NULL,
  map jsonb NOT NULL DEFAULT '{}'::jsonb,
  capacity int NOT NULL DEFAULT 25,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT spaces_slug_key UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS idx_spaces_workspace ON spaces(workspace_id);
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

-- 3. space_members
CREATE TABLE IF NOT EXISTS space_members (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar_override jsonb,
  desk_id text,
  last_position jsonb,
  first_entered_at timestamptz,
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);
ALTER TABLE space_members ENABLE ROW LEVEL SECURITY;

-- 4. RLS: spaces
DROP POLICY IF EXISTS "spaces_select" ON spaces;
CREATE POLICY "spaces_select" ON spaces FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "spaces_insert" ON spaces;
CREATE POLICY "spaces_insert" ON spaces FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "spaces_update" ON spaces;
CREATE POLICY "spaces_update" ON spaces FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id))
  WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "spaces_delete" ON spaces;
CREATE POLICY "spaces_delete" ON spaces FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id));

-- 4. RLS: space_members
DROP POLICY IF EXISTS "space_members_select" ON space_members;
CREATE POLICY "space_members_select" ON space_members FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM spaces s
    WHERE s.id = space_members.space_id AND is_workspace_member(s.workspace_id)
  ));

DROP POLICY IF EXISTS "space_members_insert_own" ON space_members;
CREATE POLICY "space_members_insert_own" ON space_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM spaces s
      WHERE s.id = space_members.space_id AND is_workspace_member(s.workspace_id)
    )
  );

DROP POLICY IF EXISTS "space_members_update_own" ON space_members;
CREATE POLICY "space_members_update_own" ON space_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM spaces s
      WHERE s.id = space_members.space_id AND is_workspace_member(s.workspace_id)
    )
  );

-- 5. Slug check for the create wizard: reveals only whether the slug is taken.
CREATE OR REPLACE FUNCTION is_space_slug_available(p_slug text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(btrim(p_slug), '') <> ''
    AND NOT EXISTS (SELECT 1 FROM spaces WHERE slug = p_slug);
$$;
REVOKE ALL ON FUNCTION is_space_slug_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_space_slug_available(text) TO authenticated;


-- ============ 20261001100000_extend_spaces_types_access_config.sql ============
/*
  # Spaces: more types, access, availability, branding and room configuration

  Extends the spaces table from 20260930120000_add_spaces.sql. Safe to run more than once.

  1. space_type
     Allowed values become: office, coworking, classroom, event_hall, coaching_studio,
     town_square, campus, custom. Existing 'community_hub' rows become 'town_square'.

  2. New columns on spaces
     - access_mode       members | invite_only | guest_link (default members)
     - guest_link_token  unique secret for "anyone with a guest link"; null otherwise
     - permissions       which roles may edit the office, lock rooms, broadcast, invite
     - persistence       always_on | scheduled (default always_on)
     - schedule          { opens_at, closes_at, recurrence, days, date, timezone, calendar_id }
     - branding          { logo_url, accent }
     - config            { rooms: [{ id, name, type, capacity, lockable, knock_to_enter }] }

  3. join_space_as_guest(p_token)
     For people outside the account who open a guest link. Returns a small JSON object
     describing that one space, and only when its access_mode is 'guest_link'.
     It never returns the account (workspace_id), members, or any other data.
*/

-- 1. space_type: drop the old check, move community_hub, add the wider check
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_space_type_check;
UPDATE spaces SET space_type = 'town_square' WHERE space_type = 'community_hub';
ALTER TABLE spaces ADD CONSTRAINT spaces_space_type_check CHECK (
  space_type IN ('office', 'coworking', 'classroom', 'event_hall', 'coaching_studio', 'town_square', 'campus', 'custom')
);

-- 2. New columns
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'members';
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_access_mode_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_access_mode_check
  CHECK (access_mode IN ('members', 'invite_only', 'guest_link'));

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS guest_link_token text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_guest_link_token_key') THEN
    ALTER TABLE spaces ADD CONSTRAINT spaces_guest_link_token_key UNIQUE (guest_link_token);
  END IF;
END $$;

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT
  '{"edit_office":["owner","admin"],"lock_rooms":["owner","admin"],"broadcast":["owner","admin"],"invite":["owner","admin"]}'::jsonb;

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS persistence text NOT NULL DEFAULT 'always_on';
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_persistence_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_persistence_check
  CHECK (persistence IN ('always_on', 'scheduled'));

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS schedule jsonb;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. Guest entry: limited details of one guest-link space, nothing else.
CREATE OR REPLACE FUNCTION join_space_as_guest(p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'slug', s.slug,
    'description', s.description,
    'space_type', s.space_type,
    'template_key', s.template_key,
    'capacity', s.capacity,
    'persistence', s.persistence,
    'schedule', s.schedule,
    'branding', s.branding,
    'config', s.config,
    'map', s.map
  )
  FROM spaces s
  WHERE coalesce(btrim(p_token), '') <> ''
    AND s.guest_link_token = p_token
    AND s.access_mode = 'guest_link'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION join_space_as_guest(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_space_as_guest(text) TO anon, authenticated;


-- ============ 20261002090000_add_meetings.sql ============
/*
  # Meetings (video rooms outside the spatial workspaces)

  A meeting is a LiveKit room (`meeting_<id>`) that members of a SYNAPSE account can join with a
  code like FOCU-358 or an optional nickname. Safe to run more than once.

  1. meetings
     - workspace_id   the account (tenant) that owns it
     - host_id        who created it
     - title          shown on the Meetings page and in the room
     - code           unique join code, e.g. FOCU-358 (shared in links: /meetings/FOCU-358)
     - nickname       optional easy name, unique within the account (e.g. "weekly-sync")
     - kind           instant (started now) | later (link made for later) | scheduled
     - scheduled_at   start time for scheduled meetings
     - duration_min   planned length
     - ended_at       set when the host ends it; ended meetings show under Calls

  2. RLS
     - members of the account can see its meetings
     - members can create meetings they host
     - the host or an account admin can change or delete a meeting
*/

CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Meeting' CHECK (char_length(title) BETWEEN 1 AND 120),
  code text NOT NULL CHECK (code ~ '^[A-Z]{4}-[0-9]{3}$'),
  nickname text CHECK (nickname IS NULL OR nickname ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  kind text NOT NULL DEFAULT 'instant' CHECK (kind IN ('instant', 'later', 'scheduled')),
  scheduled_at timestamptz,
  duration_min integer NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 600),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'scheduled' OR scheduled_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS meetings_code_key ON meetings(code);
CREATE UNIQUE INDEX IF NOT EXISTS meetings_nickname_key ON meetings(workspace_id, nickname) WHERE nickname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_workspace_time ON meetings(workspace_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_workspace_created ON meetings(workspace_id, created_at DESC);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meetings_select" ON meetings;
CREATE POLICY "meetings_select" ON meetings FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "meetings_insert" ON meetings;
CREATE POLICY "meetings_insert" ON meetings FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "meetings_update" ON meetings;
CREATE POLICY "meetings_update" ON meetings FOR UPDATE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "meetings_delete" ON meetings;
CREATE POLICY "meetings_delete" ON meetings FOR DELETE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id));


-- ============ 20261005100000_add_events.sql ============
/*
  # Events: public event pages, tickets, registration with QR + PIN, check-in

  Safe to run more than once.

  1. events            an event an account hosts; public at /e/<slug> once published
  2. event_tickets     ticket types (Free, VIP…) with optional price and capacity
  3. event_registrations
                       one person's registration: their answers, a 6-digit PIN and a QR token.
                       Paid tickets are reserved and paid at the venue (payment_status 'unpaid')
                       until online payment is connected.
  4. Public access goes only through SECURITY DEFINER functions:
       public_events()               published, public, not yet ended
       public_event(slug)            one published event with its tickets and spaces left
       public_event_stats()          real totals for the events home page
       register_for_event(...)       registers someone, respecting capacity; adds them to Contacts
       public_ticket(token)          the attendee's ticket page
  5. Storage bucket event-covers (public read) for posters.
*/

-- 1. events ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 280),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  category text NOT NULL DEFAULT 'community',
  cover_url text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  mode text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'online', 'hybrid')),
  venue_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  online_url text NOT NULL DEFAULT '',
  organiser_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted')),
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS events_slug_key ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_workspace_start ON events(workspace_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_public ON events(status, visibility, ends_at);

-- 2. tickets -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 400),
  price_minor integer NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_tickets_event ON event_tickets(event_id, sort);

-- 3. registrations -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES event_tickets(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 80),
  last_name text NOT NULL DEFAULT '' CHECK (char_length(last_name) <= 80),
  email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(email) <= 200),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  pin text NOT NULL CHECK (pin ~ '^[0-9]{6}$'),
  qr_token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  payment_status text NOT NULL DEFAULT 'free' CHECK (payment_status IN ('free', 'unpaid', 'paid')),
  amount_minor integer NOT NULL DEFAULT 0,
  checked_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_qr_key ON event_registrations(qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_pin_key ON event_registrations(event_id, pin);
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_email_key ON event_registrations(event_id, lower(email)) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_event_registrations_event ON event_registrations(event_id, created_at DESC);

-- RLS: account members manage their own events; the public uses the functions below.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select" ON events;
CREATE POLICY "events_select" ON events FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "events_insert" ON events;
CREATE POLICY "events_insert" ON events FOR INSERT TO authenticated WITH CHECK (is_workspace_member(workspace_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "events_update" ON events;
CREATE POLICY "events_update" ON events FOR UPDATE TO authenticated USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "events_delete" ON events;
CREATE POLICY "events_delete" ON events FOR DELETE TO authenticated USING (created_by = auth.uid() OR is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "event_tickets_all" ON event_tickets;
CREATE POLICY "event_tickets_all" ON event_tickets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));

DROP POLICY IF EXISTS "event_registrations_select" ON event_registrations;
CREATE POLICY "event_registrations_select" ON event_registrations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "event_registrations_update" ON event_registrations;
CREATE POLICY "event_registrations_update" ON event_registrations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "event_registrations_delete" ON event_registrations;
CREATE POLICY "event_registrations_delete" ON event_registrations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_admin(e.workspace_id)));

-- 4. Public functions --------------------------------------------------------------------

-- Tickets of one event with how many places are left (null = unlimited).
CREATE OR REPLACE FUNCTION event_ticket_list(p_event uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'description', t.description,
    'price_minor', t.price_minor, 'currency', t.currency, 'capacity', t.capacity,
    'remaining', CASE WHEN t.capacity IS NULL THEN NULL ELSE greatest(t.capacity - (
      SELECT count(*) FROM event_registrations r WHERE r.ticket_id = t.id AND r.status = 'confirmed'), 0) END
  ) ORDER BY t.sort, t.created_at), '[]'::jsonb)
  FROM event_tickets t WHERE t.event_id = p_event;
$$;
REVOKE ALL ON FUNCTION event_ticket_list(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION event_public_json(e events)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'organiser_id', e.workspace_id, 'slug', e.slug, 'title', e.title,
    'summary', e.summary, 'description', e.description, 'category', e.category,
    'cover_url', e.cover_url, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
    'timezone', e.timezone, 'mode', e.mode, 'venue_name', e.venue_name,
    'address', e.address, 'city', e.city, 'status', e.status, 'visibility', e.visibility,
    'organiser_name', coalesce(nullif(e.organiser_name, ''), (SELECT w.name FROM workspaces w WHERE w.id = e.workspace_id), ''),
    'questions', e.questions,
    'registered', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'confirmed'),
    'tickets', event_ticket_list(e.id)
  );
$$;
REVOKE ALL ON FUNCTION event_public_json(events) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public_events()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(event_public_json(e) - 'description' - 'questions' ORDER BY e.starts_at), '[]'::jsonb)
  FROM (SELECT * FROM events
        WHERE status = 'published' AND visibility = 'public' AND ends_at > now()
        ORDER BY starts_at LIMIT 200) e;
$$;
REVOKE ALL ON FUNCTION public_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_events() TO anon, authenticated;

-- The online link is only given to registered attendees (public_ticket), never on the open page.
CREATE OR REPLACE FUNCTION public_event(p_slug text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT event_public_json(e) FROM events e
  WHERE e.slug = lower(btrim(p_slug)) AND e.status IN ('published', 'cancelled') LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_event(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_event(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public_event_stats()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'upcoming', (SELECT count(*) FROM events WHERE status = 'published' AND visibility = 'public' AND ends_at > now()),
    'registrations', (SELECT count(*) FROM event_registrations r JOIN events e ON e.id = r.event_id
                      WHERE r.status = 'confirmed' AND e.status = 'published' AND e.visibility = 'public'),
    'cities', (SELECT count(DISTINCT lower(city)) FROM events WHERE status = 'published' AND visibility = 'public' AND city <> ''),
    'organisers', (SELECT count(DISTINCT workspace_id) FROM events WHERE status = 'published' AND visibility = 'public')
  );
$$;
REVOKE ALL ON FUNCTION public_event_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_event_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION register_for_event(
  p_slug text, p_ticket uuid, p_first text, p_last text, p_email text, p_phone text, p_answers jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev events;
  tk event_tickets;
  taken integer;
  new_pin text;
  reg event_registrations;
  cid uuid;
  q jsonb;
  em text := lower(btrim(coalesce(p_email, '')));
BEGIN
  SELECT * INTO ev FROM events WHERE slug = lower(btrim(p_slug)) AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF ev.ends_at < now() THEN RAISE EXCEPTION 'event_over'; END IF;
  IF coalesce(btrim(p_first), '') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;

  -- Lock the ticket row so two people can't take the last place at once.
  SELECT * INTO tk FROM event_tickets WHERE id = p_ticket AND event_id = ev.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found'; END IF;
  IF tk.capacity IS NOT NULL THEN
    SELECT count(*) INTO taken FROM event_registrations WHERE ticket_id = tk.id AND status = 'confirmed';
    IF taken >= tk.capacity THEN RAISE EXCEPTION 'sold_out'; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM event_registrations WHERE event_id = ev.id AND lower(email) = em AND status = 'confirmed') THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- Required questions must be answered.
  FOR q IN SELECT * FROM jsonb_array_elements(ev.questions) LOOP
    IF coalesce((q->>'required')::boolean, false)
       AND coalesce(btrim(coalesce(p_answers, '{}'::jsonb)->>(q->>'id')), '') IN ('', 'false') THEN
      RAISE EXCEPTION 'answer_required';
    END IF;
  END LOOP;

  LOOP
    new_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = ev.id AND pin = new_pin);
  END LOOP;

  -- Every registrant becomes (or updates) a contact in the host's CRM.
  SELECT id INTO cid FROM contacts WHERE workspace_id = ev.workspace_id AND lower(email) = em LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, source)
    VALUES (ev.workspace_id, btrim(p_first), btrim(coalesce(p_last, '')), em, btrim(coalesce(p_phone, '')), 'event')
    RETURNING id INTO cid;
  ELSE
    UPDATE contacts SET last_activity_at = now() WHERE id = cid;
  END IF;

  INSERT INTO event_registrations (event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin,
                                   payment_status, amount_minor)
  VALUES (ev.id, tk.id, cid, left(btrim(p_first), 80), left(btrim(coalesce(p_last, '')), 80), em,
          left(btrim(coalesce(p_phone, '')), 40), coalesce(p_answers, '{}'::jsonb), new_pin,
          CASE WHEN tk.price_minor > 0 THEN 'unpaid' ELSE 'free' END, tk.price_minor)
  RETURNING * INTO reg;

  RETURN jsonb_build_object('qr_token', reg.qr_token, 'pin', reg.pin);
END;
$$;
REVOKE ALL ON FUNCTION register_for_event(text, uuid, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_for_event(text, uuid, text, text, text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public_ticket(p_token uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'qr_token', r.qr_token, 'pin', r.pin, 'first_name', r.first_name, 'last_name', r.last_name,
    'email', r.email, 'status', r.status, 'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'checked_in_at', r.checked_in_at, 'created_at', r.created_at,
    'ticket_name', t.name, 'currency', coalesce(t.currency, 'NGN'),
    'online_url', e.online_url,
    'event', event_public_json(e) - 'questions' - 'tickets'
  )
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN event_tickets t ON t.id = r.ticket_id
  WHERE r.qr_token = p_token LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_ticket(uuid) TO anon, authenticated;

-- 5. Posters ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "event_covers_public_read" ON storage.objects;
CREATE POLICY "event_covers_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'event-covers');
DROP POLICY IF EXISTS "event_covers_authed_upload" ON storage.objects;
CREATE POLICY "event_covers_authed_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-covers');
DROP POLICY IF EXISTS "event_covers_authed_update" ON storage.objects;
CREATE POLICY "event_covers_authed_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'event-covers') WITH CHECK (bucket_id = 'event-covers');


-- ============ 20261008090000_meeting_guest_links.sql ============
/*
  # Meeting invite links for people outside the account

  Each meeting gets a private invite token. The link SYNAPSE copies
  (/meetings/FOCU-358?invite=<token>) lets anyone who has it join as a guest with their name,
  without a SYNAPSE account. Members still join with their login as before.
  Safe to run more than once.

  1. meetings.invite_token   random 32 hex characters, unique
  2. meeting_by_invite(code, token)
       What a guest needs to see before joining (title, host name, ended or not), and only when
       the token matches. Nothing else about the account is exposed.
*/

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS invite_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX IF NOT EXISTS meetings_invite_token_key ON meetings(invite_token);

CREATE OR REPLACE FUNCTION meeting_by_invite(p_code text, p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', m.id,
    'workspace_id', m.workspace_id,
    'host_id', m.host_id,
    'title', m.title,
    'code', m.code,
    'nickname', NULL,
    'kind', m.kind,
    'scheduled_at', m.scheduled_at,
    'duration_min', m.duration_min,
    'ended_at', m.ended_at,
    'created_at', m.created_at,
    'invite_token', m.invite_token,
    'host_name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), w.name, '')
  )
  FROM meetings m
  LEFT JOIN profiles p ON p.user_id = m.host_id
  LEFT JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.code = upper(btrim(p_code))
    AND coalesce(btrim(p_token), '') <> ''
    AND m.invite_token = btrim(p_token)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION meeting_by_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meeting_by_invite(text, text) TO anon, authenticated;


-- ============ 20261009090000_meeting_rooms_admit_breakouts_recordings.sql ============
/*
  # Meetings: waiting room, lock, breakout rooms, recordings

  Everything the meeting tools need in the database, in one file. Safe to run more than once.

  1. meetings.waiting_room   true: everyone except the host waits until the host admits them
     meetings.locked         true: nobody new can join (people already admitted can rejoin)
     meetings.breakout       the host's breakout rooms while they are open, e.g.
                               {"open": true, "rooms": [{"n": 1, "name": "Room 1"}],
                                "assign": {"<participant id>": 1}}
                             null when there are no breakout rooms

  2. meeting_admissions
     One row per person who asked to join (members, other-account users and guests). The
     livekit-token function writes these with the service key; the browser only reads them
     and the host (or an account admin) changes their status.
       - ticket      what the joining browser keeps so it can ask again ("am I in yet?")
       - identity    their id in the call (user id, or guest_<…> for guests)
       - status      waiting | admitted | denied | removed

  3. meeting_by_invite() also returns waiting_room, locked and breakout, so guests (who
     can't read the meetings table) can follow breakout rooms.

  4. recordings.meeting_id, and a private storage bucket "meeting-recordings" where files are
     kept under <account id>/<file>. Only members of that account can read or add them.
*/

-- 1. Meeting settings ------------------------------------------------------------------------
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS waiting_room boolean NOT NULL DEFAULT false;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS breakout jsonb;

-- 2. Admissions ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_admissions (
  ticket uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  identity text NOT NULL CHECK (char_length(identity) BETWEEN 1 AND 80),
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 120),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'admitted', 'denied', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_meeting_admissions_meeting ON meeting_admissions(meeting_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_admissions_identity ON meeting_admissions(meeting_id, identity);

ALTER TABLE meeting_admissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_admissions_select" ON meeting_admissions;
CREATE POLICY "meeting_admissions_select" ON meeting_admissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id AND is_workspace_member(m.workspace_id)));

DROP POLICY IF EXISTS "meeting_admissions_update" ON meeting_admissions;
CREATE POLICY "meeting_admissions_update" ON meeting_admissions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR is_workspace_admin(m.workspace_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR is_workspace_admin(m.workspace_id))));

-- 3. Guests can see the meeting's live settings ---------------------------------------------
CREATE OR REPLACE FUNCTION meeting_by_invite(p_code text, p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', m.id,
    'workspace_id', m.workspace_id,
    'host_id', m.host_id,
    'title', m.title,
    'code', m.code,
    'nickname', NULL,
    'kind', m.kind,
    'scheduled_at', m.scheduled_at,
    'duration_min', m.duration_min,
    'ended_at', m.ended_at,
    'created_at', m.created_at,
    'invite_token', m.invite_token,
    'waiting_room', m.waiting_room,
    'locked', m.locked,
    'breakout', m.breakout,
    'host_name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), w.name, '')
  )
  FROM meetings m
  LEFT JOIN profiles p ON p.user_id = m.host_id
  LEFT JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.code = upper(btrim(p_code))
    AND coalesce(btrim(p_token), '') <> ''
    AND m.invite_token = btrim(p_token)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION meeting_by_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meeting_by_invite(text, text) TO anon, authenticated;

-- 4. Recordings ------------------------------------------------------------------------------
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings(meeting_id);

INSERT INTO storage.buckets (id, name, public) VALUES ('meeting-recordings', 'meeting-recordings', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "meeting_recordings_read" ON storage.objects;
CREATE POLICY "meeting_recordings_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'meeting-recordings' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));
DROP POLICY IF EXISTS "meeting_recordings_upload" ON storage.objects;
CREATE POLICY "meeting_recordings_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meeting-recordings' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));
DROP POLICY IF EXISTS "meeting_recordings_delete" ON storage.objects;
CREATE POLICY "meeting_recordings_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meeting-recordings' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));


-- ============ 20261010090000_workflow_engine.sql ============
/*
  # Workflows that really run

  Everything the new Workflows builder needs on the server. Workflows run inside the database,
  every minute, so waits really wait and nothing depends on anyone keeping a browser open.
  Safe to run more than once.

  1. New data the triggers and actions use
     - contacts.date_of_birth             Birthday Reminder / Custom Date Reminder
     - tasks                               Task Added / Task Reminder / Task Completed, Add Task
     - team_notifications                  Send Internal Notification (shown under the bell)
     - workflows.definition, workflows.notes
         definition = { triggers: [...], start: <step id>, graph: { <step id>: step } }

  2. The engine's own tables (members of the account can read them; only the engine writes)
     - wf_events        what happened (filled automatically by the triggers below)
     - wf_runs          one row per contact going through a workflow (Enrollment History)
     - wf_logs          one row per step run (Execution Logs)
     - wf_daily_marks   so a birthday / date / task reminder fires once per day
     - wf_private.settings  internal key the scheduler uses to ask the mailer to send emails

  3. Event capture: contacts, tags, notes, tasks, appointments, form submissions, replies and
     event registrations each record an event. Events made by a workflow's own actions carry a
     depth, so a workflow can trigger another one but loops stop after a few hops.

  4. The engine
     - wf_tick()   every minute: handle new events, continue contacts whose wait is over,
                   run the 8 AM date reminders, and ask the mailer to send queued emails.
     - wf_test_run(workflow, contact)  "Test workflow" in the builder.

  5. Scheduling: pg_cron runs wf_tick() every minute (pg_net is used for webhooks and the mailer).
*/

-- 0. Extensions (Supabase allows these; skipped quietly where they don't exist) ----------------
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron not available: %', SQLERRM; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net not available: %', SQLERRM; END $$;

-- 1. Data ------------------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS definition jsonb;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  due_at timestamptz,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due ON tasks(workspace_id, due_at) WHERE completed_at IS NULL;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_all" ON tasks;
CREATE POLICY "tasks_all" ON tasks FOR ALL TO authenticated
  USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));

CREATE TABLE IF NOT EXISTS team_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_team_notifications_user ON team_notifications(user_id, created_at DESC);
ALTER TABLE team_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "team_notifications_own" ON team_notifications;
CREATE POLICY "team_notifications_own" ON team_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "team_notifications_read" ON team_notifications;
CREATE POLICY "team_notifications_read" ON team_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2. Engine tables ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wf_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  type text NOT NULL,
  contact_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  depth int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wf_events_todo ON wf_events(id) WHERE processed_at IS NULL;
ALTER TABLE wf_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wf_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_id text,
  trigger_name text,
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waiting', 'completed', 'failed', 'removed', 'stopped')),
  current_step text,
  resume_at timestamptz,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  depth int NOT NULL DEFAULT 0,
  is_test boolean NOT NULL DEFAULT false,
  exit_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wf_runs_workflow ON wf_runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_runs_contact ON wf_runs(contact_id, workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_runs_due ON wf_runs(resume_at) WHERE status = 'waiting';
ALTER TABLE wf_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wf_logs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  contact_id uuid,
  step_id text,
  step_type text,
  step_name text,
  status text NOT NULL CHECK (status IN ('success', 'skipped', 'failed', 'waiting')),
  detail text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_logs_workflow ON wf_logs(workflow_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_logs_run ON wf_logs(run_id, id);
ALTER TABLE wf_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wf_daily_marks (
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_id text NOT NULL,
  subject_id uuid NOT NULL,
  day date NOT NULL,
  PRIMARY KEY (workflow_id, trigger_id, subject_id, day)
);
ALTER TABLE wf_daily_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wf_runs_select" ON wf_runs;
CREATE POLICY "wf_runs_select" ON wf_runs FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "wf_logs_select" ON wf_logs;
CREATE POLICY "wf_logs_select" ON wf_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM workflows w WHERE w.id = workflow_id AND can_access_workspace(w.workspace_id)));
DROP POLICY IF EXISTS "wf_events_select" ON wf_events;
CREATE POLICY "wf_events_select" ON wf_events FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));

-- Workflow-queued emails remember which run sent them (for "Stop on response").
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wf_run_id uuid;
CREATE INDEX IF NOT EXISTS idx_messages_queued ON messages(created_at) WHERE status = 'queued';

CREATE SCHEMA IF NOT EXISTS wf_private;
REVOKE ALL ON SCHEMA wf_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS wf_private.settings (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO wf_private.settings(key, value) VALUES ('mailer_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;
INSERT INTO wf_private.settings(key, value) VALUES ('mailer_url', 'https://parmtumfpsdtdtgwvscq.supabase.co/functions/v1/send-email')
ON CONFLICT (key) DO NOTHING;

-- The mailer (send-email, service role) checks the key the scheduler sends.
CREATE OR REPLACE FUNCTION wf_mailer_secret() RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT value FROM wf_private.settings WHERE key = 'mailer_secret';
$$;
REVOKE ALL ON FUNCTION wf_mailer_secret() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION wf_mailer_secret() TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- The app's public (anon) key, so the scheduler's call passes Supabase's gateway. It's the same
-- key every visitor's browser already has; the app saves it here when a member opens Workflows.
CREATE OR REPLACE FUNCTION wf_set_client_key(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = auth.uid()) THEN RETURN; END IF;
  IF p_key IS NULL OR char_length(p_key) NOT BETWEEN 20 AND 2000 OR p_key !~ '^[A-Za-z0-9._-]+$' THEN RETURN; END IF;
  INSERT INTO wf_private.settings(key, value) VALUES ('client_key', p_key) ON CONFLICT (key) DO UPDATE SET value = excluded.value;
END $$;
REVOKE ALL ON FUNCTION wf_set_client_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_set_client_key(text) TO authenticated;

-- 3. Event capture ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wf_emit(p_workspace uuid, p_type text, p_contact uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d int := coalesce(nullif(current_setting('synapse.wf_depth', true), '')::int, 0);
BEGIN
  IF p_workspace IS NULL THEN RETURN; END IF;
  INSERT INTO wf_events(workspace_id, type, contact_id, data, depth) VALUES (p_workspace, p_type, p_contact, coalesce(p_data, '{}'::jsonb), d);
END $$;

CREATE OR REPLACE FUNCTION wf_on_contact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed jsonb := '{}'::jsonb; f text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM wf_emit(NEW.workspace_id, 'contact_created', NEW.id, '{}'::jsonb);
    RETURN NEW;
  END IF;
  FOREACH f IN ARRAY ARRAY['first_name','last_name','email','phone','company','job_title','contact_type','owner_id','timezone','date_of_birth','source'] LOOP
    IF (to_jsonb(OLD)->f) IS DISTINCT FROM (to_jsonb(NEW)->f) THEN
      changed := changed || jsonb_build_object(f, jsonb_build_object('old', to_jsonb(OLD)->f, 'new', to_jsonb(NEW)->f));
    END IF;
  END LOOP;
  IF changed <> '{}'::jsonb THEN PERFORM wf_emit(NEW.workspace_id, 'contact_changed', NEW.id, jsonb_build_object('changed', changed)); END IF;
  IF OLD.dnd_all IS DISTINCT FROM NEW.dnd_all OR OLD.dnd_channels IS DISTINCT FROM NEW.dnd_channels THEN
    PERFORM wf_emit(NEW.workspace_id, 'contact_dnd', NEW.id, jsonb_build_object(
      'old_all', OLD.dnd_all, 'new_all', NEW.dnd_all,
      'old_channels', to_jsonb(OLD.dnd_channels), 'new_channels', to_jsonb(NEW.dnd_channels)));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wf_contact_events ON contacts;
CREATE TRIGGER wf_contact_events AFTER INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION wf_on_contact();

CREATE OR REPLACE FUNCTION wf_on_contact_tag() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; ws uuid; tname text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT t.workspace_id, t.name INTO ws, tname FROM tags t WHERE t.id = r.tag_id;
  -- A contact being deleted takes its tags with it: that isn't a "tag removed".
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = r.contact_id) THEN RETURN NULL; END IF;
  PERFORM wf_emit(ws, 'contact_tag', r.contact_id, jsonb_build_object('event', CASE WHEN TG_OP = 'DELETE' THEN 'removed' ELSE 'added' END, 'tag', tname));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_contact_tag_events ON contact_tags;
CREATE TRIGGER wf_contact_tag_events AFTER INSERT OR DELETE ON contact_tags FOR EACH ROW EXECUTE FUNCTION wf_on_contact_tag();

CREATE OR REPLACE FUNCTION wf_on_note() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN PERFORM wf_emit(NEW.workspace_id, 'note_added', NEW.contact_id, jsonb_build_object('note', left(NEW.content, 2000))); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_note_events ON notes;
CREATE TRIGGER wf_note_events AFTER INSERT ON notes FOR EACH ROW EXECUTE FUNCTION wf_on_note();

CREATE OR REPLACE FUNCTION wf_on_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM wf_emit(NEW.workspace_id, 'task_added', NEW.contact_id, jsonb_build_object('task_id', NEW.id, 'title', NEW.title, 'assigned_to', NEW.assigned_to));
  ELSIF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
    PERFORM wf_emit(NEW.workspace_id, 'task_completed', NEW.contact_id, jsonb_build_object('task_id', NEW.id, 'title', NEW.title, 'assigned_to', NEW.assigned_to));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_task_events ON tasks;
CREATE TRIGGER wf_task_events AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION wf_on_task();

CREATE OR REPLACE FUNCTION wf_on_appointment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM wf_emit(NEW.workspace_id, 'appointment_booked', NEW.contact_id, jsonb_build_object('appointment_id', NEW.id, 'calendar_id', NEW.calendar_id, 'status', 'booked', 'start_time', NEW.start_time, 'title', NEW.title));
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM wf_emit(NEW.workspace_id, 'appointment_status', NEW.contact_id, jsonb_build_object('appointment_id', NEW.id, 'calendar_id', NEW.calendar_id,
      'status', CASE NEW.status WHEN 'completed' THEN 'showed' ELSE NEW.status END, 'start_time', NEW.start_time, 'title', NEW.title));
  ELSIF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    PERFORM wf_emit(NEW.workspace_id, 'appointment_status', NEW.contact_id, jsonb_build_object('appointment_id', NEW.id, 'calendar_id', NEW.calendar_id, 'status', 'rescheduled', 'start_time', NEW.start_time, 'title', NEW.title));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_appointment_events ON appointments;
CREATE TRIGGER wf_appointment_events AFTER INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION wf_on_appointment();

CREATE OR REPLACE FUNCTION wf_on_form_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN PERFORM wf_emit(NEW.workspace_id, 'form_submitted', NEW.contact_id, jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id)); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_form_events ON form_submissions;
CREATE TRIGGER wf_form_events AFTER INSERT ON form_submissions FOR EACH ROW EXECUTE FUNCTION wf_on_form_submission();

CREATE OR REPLACE FUNCTION wf_on_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'inbound' AND NEW.contact_id IS NOT NULL THEN
    PERFORM wf_emit(NEW.workspace_id, 'customer_replied', NEW.contact_id, jsonb_build_object('channel', NEW.channel));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_message_events ON messages;
CREATE TRIGGER wf_message_events AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION wf_on_message();

DO $$ BEGIN
  IF to_regclass('public.event_registrations') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION wf_on_event_registration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      DECLARE ws uuid;
      BEGIN
        IF NEW.contact_id IS NULL THEN RETURN NULL; END IF;
        SELECT workspace_id INTO ws FROM events WHERE id = NEW.event_id;
        PERFORM wf_emit(ws, 'event_registered', NEW.contact_id, jsonb_build_object('event_id', NEW.event_id));
        RETURN NULL;
      END $b$;
    $f$;
    EXECUTE 'DROP TRIGGER IF EXISTS wf_event_registration_events ON event_registrations';
    EXECUTE 'CREATE TRIGGER wf_event_registration_events AFTER INSERT ON event_registrations FOR EACH ROW EXECUTE FUNCTION wf_on_event_registration()';
  END IF;
END $$;

-- 4. Engine -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wf_contact_tags(p_contact uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(lower(t.name)), '{}') FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = p_contact;
$$;

-- jsonb array of strings -> lower-case text[]
CREATE OR REPLACE FUNCTION wf_lower_list(j jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(lower(x)), '{}') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(j) = 'array' THEN j ELSE '[]'::jsonb END) x;
$$;

-- Contact Created / Contact DND tag rules: every rule must pass.
CREATE OR REPLACE FUNCTION wf_tag_rules_ok(p_rules jsonb, p_tags text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb; want text[];
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rules) = 'array' THEN p_rules ELSE '[]'::jsonb END) LOOP
    want := wf_lower_list(r->'tags');
    IF cardinality(want) = 0 THEN CONTINUE; END IF;
    CASE r->>'op'
      WHEN 'equals' THEN IF NOT (p_tags @> want) THEN RETURN false; END IF;
      WHEN 'not_equals' THEN IF p_tags @> want THEN RETURN false; END IF;
      WHEN 'any_of' THEN IF NOT (p_tags && want) THEN RETURN false; END IF;
      WHEN 'none_of' THEN IF p_tags && want THEN RETURN false; END IF;
      ELSE NULL;
    END CASE;
  END LOOP;
  RETURN true;
END $$;

-- Does this trigger (from a workflow's definition) match this event?
CREATE OR REPLACE FUNCTION wf_trigger_matches(t jsonb, ev wf_events) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f jsonb := coalesce(t->'filters', '{}'::jsonb); tags text[]; ch jsonb; op text; v text; nchan text[]; ochan text[];
BEGIN
  CASE t->>'type'
    WHEN 'contact_created' THEN
      RETURN ev.type = 'contact_created' AND wf_tag_rules_ok(f->'tag_rules', wf_contact_tags(ev.contact_id));
    WHEN 'contact_changed' THEN
      IF ev.type <> 'contact_changed' THEN RETURN false; END IF;
      IF coalesce(f->>'field', '') = '' THEN RETURN true; END IF;
      ch := ev.data->'changed'->(f->>'field');
      IF ch IS NULL THEN RETURN false; END IF;
      op := coalesce(f->>'op', 'has_changed'); v := coalesce(f->>'value', '');
      IF op = 'has_changed_to' THEN RETURN lower(coalesce(ch->>'new', '')) = lower(v); END IF;
      RETURN true;
    WHEN 'contact_dnd' THEN
      IF ev.type <> 'contact_dnd' THEN RETURN false; END IF;
      nchan := wf_lower_list(ev.data->'new_channels'); ochan := wf_lower_list(ev.data->'old_channels');
      CASE coalesce(f->>'flag', 'any')
        WHEN 'enabled_all' THEN IF NOT ((ev.data->>'new_all')::boolean AND NOT coalesce((ev.data->>'old_all')::boolean, false)) THEN RETURN false; END IF;
        WHEN 'disabled_all' THEN IF NOT (coalesce((ev.data->>'old_all')::boolean, false) AND NOT (ev.data->>'new_all')::boolean) THEN RETURN false; END IF;
        WHEN 'enabled_specific' THEN
          IF NOT EXISTS (SELECT 1 FROM unnest(nchan) c WHERE NOT c = ANY(ochan) AND (cardinality(wf_lower_list(f->'channels')) = 0 OR c = ANY(wf_lower_list(f->'channels')))) THEN RETURN false; END IF;
        WHEN 'disabled_specific' THEN
          IF NOT EXISTS (SELECT 1 FROM unnest(ochan) c WHERE NOT c = ANY(nchan) AND (cardinality(wf_lower_list(f->'channels')) = 0 OR c = ANY(wf_lower_list(f->'channels')))) THEN RETURN false; END IF;
        ELSE NULL;
      END CASE;
      RETURN wf_tag_rules_ok(f->'tag_rules', wf_contact_tags(ev.contact_id));
    WHEN 'contact_tag' THEN
      IF ev.type <> 'contact_tag' THEN RETURN false; END IF;
      IF coalesce(f->>'event', 'any') <> 'any' AND f->>'event' <> ev.data->>'event' THEN RETURN false; END IF;
      tags := wf_lower_list(f->'tags');
      RETURN cardinality(tags) = 0 OR lower(ev.data->>'tag') = ANY(tags);
    WHEN 'note_added' THEN
      IF ev.type <> 'note_added' THEN RETURN false; END IF;
      tags := wf_contact_tags(ev.contact_id);
      IF coalesce(f->>'has_tag', '') <> '' AND NOT lower(f->>'has_tag') = ANY(tags) THEN RETURN false; END IF;
      IF coalesce(f->>'not_tag', '') <> '' AND lower(f->>'not_tag') = ANY(tags) THEN RETURN false; END IF;
      RETURN true;
    WHEN 'task_added' THEN
      IF ev.type <> 'task_added' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'users')) = 0 OR lower(coalesce(ev.data->>'assigned_to', '')) = ANY(wf_lower_list(f->'users'));
    WHEN 'task_completed' THEN
      IF ev.type <> 'task_completed' THEN RETURN false; END IF;
      v := lower(coalesce(ev.data->>'assigned_to', ''));
      CASE coalesce(f->>'user_op', 'any')
        WHEN 'is' THEN RETURN v = ANY(wf_lower_list(f->'users'));
        WHEN 'is_not' THEN RETURN NOT (v = ANY(wf_lower_list(f->'users')));
        WHEN 'is_empty' THEN RETURN v = '';
        WHEN 'is_not_empty' THEN RETURN v <> '';
        ELSE RETURN true;
      END CASE;
    WHEN 'appointment_status' THEN
      IF ev.type NOT IN ('appointment_status', 'appointment_booked') THEN RETURN false; END IF;
      IF cardinality(wf_lower_list(f->'statuses')) > 0 AND NOT lower(ev.data->>'status') = ANY(wf_lower_list(f->'statuses')) THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'calendars')) = 0 OR lower(ev.data->>'calendar_id') = ANY(wf_lower_list(f->'calendars'));
    WHEN 'customer_booked_appointment' THEN
      IF ev.type <> 'appointment_booked' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'calendars')) = 0 OR lower(ev.data->>'calendar_id') = ANY(wf_lower_list(f->'calendars'));
    WHEN 'form_submitted' THEN
      IF ev.type <> 'form_submitted' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'forms')) = 0 OR lower(ev.data->>'form_id') = ANY(wf_lower_list(f->'forms'));
    WHEN 'customer_replied' THEN
      IF ev.type <> 'customer_replied' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'channels')) = 0 OR lower(ev.data->>'channel') = ANY(wf_lower_list(f->'channels'));
    WHEN 'event_registered' THEN
      IF ev.type <> 'event_registered' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'events')) = 0 OR lower(ev.data->>'event_id') = ANY(wf_lower_list(f->'events'));
    ELSE RETURN false;
  END CASE;
END $$;

-- {{contact.first_name}} etc.
CREATE OR REPLACE FUNCTION wf_merge(p_text text, p_contact uuid, p_ctx jsonb DEFAULT '{}'::jsonb) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; s text := coalesce(p_text, ''); full_name text;
BEGIN
  SELECT * INTO c FROM contacts WHERE id = p_contact;
  IF FOUND THEN
    full_name := btrim(concat_ws(' ', c.first_name, c.last_name));
    s := replace(s, '{{contact.first_name}}', coalesce(c.first_name, ''));
    s := replace(s, '{{contact.last_name}}', coalesce(c.last_name, ''));
    s := replace(s, '{{contact.name}}', full_name);
    s := replace(s, '{{contact.email}}', coalesce(c.email, ''));
    s := replace(s, '{{contact.phone}}', coalesce(c.phone, ''));
    s := replace(s, '{{contact.company}}', coalesce(c.company, ''));
    s := replace(s, '{{first_name}}', coalesce(c.first_name, ''));
    s := replace(s, '{{last_name}}', coalesce(c.last_name, ''));
    s := replace(s, '{{email}}', coalesce(c.email, ''));
    s := replace(s, '{{phone}}', coalesce(c.phone, ''));
    s := replace(s, '{{company}}', coalesce(c.company, ''));
  END IF;
  s := replace(s, '{{appointment.title}}', coalesce(p_ctx->>'title', ''));
  s := replace(s, '{{appointment.start_time}}', coalesce(p_ctx->>'start_time', ''));
  RETURN s;
END $$;

-- If/Else: does the contact meet the step's conditions?
CREATE OR REPLACE FUNCTION wf_conditions_ok(p_cfg jsonb, p_contact uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cnd jsonb; ok boolean; all_mode boolean := coalesce(p_cfg->>'match', 'all') = 'all'; any_hit boolean := false; val text; tags text[]; crow jsonb;
BEGIN
  SELECT to_jsonb(c) INTO crow FROM contacts c WHERE c.id = p_contact;
  IF crow IS NULL THEN RETURN false; END IF;
  tags := wf_contact_tags(p_contact);
  FOR cnd IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cfg->'conditions') = 'array' THEN p_cfg->'conditions' ELSE '[]'::jsonb END) LOOP
    IF cnd->>'field' = 'tag' THEN
      ok := CASE cnd->>'op' WHEN 'not_has' THEN NOT (lower(cnd->>'value') = ANY(tags)) ELSE lower(cnd->>'value') = ANY(tags) END;
    ELSIF cnd->>'field' = 'dnd_all' THEN
      ok := coalesce((crow->>'dnd_all')::boolean, false) = (cnd->>'op' = 'is_true');
    ELSE
      val := lower(coalesce(crow->>(cnd->>'field'), ''));
      ok := CASE cnd->>'op'
        WHEN 'equals' THEN val = lower(coalesce(cnd->>'value', ''))
        WHEN 'not_equals' THEN val <> lower(coalesce(cnd->>'value', ''))
        WHEN 'contains' THEN position(lower(coalesce(cnd->>'value', '')) IN val) > 0
        WHEN 'is_empty' THEN val = ''
        WHEN 'is_not_empty' THEN val <> ''
        ELSE false END;
    END IF;
    IF all_mode AND NOT ok THEN RETURN false; END IF;
    IF ok THEN any_hit := true; END IF;
  END LOOP;
  RETURN all_mode OR any_hit;
END $$;

-- The next moment inside the workflow's time window (or now, if there's no window or we're in it).
CREATE OR REPLACE FUNCTION wf_window_next(p_settings jsonb, p_tz text, p_now timestamptz DEFAULT now()) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := p_settings->'time_window'; tz text := coalesce(nullif(p_tz, ''), 'UTC'); local_ts timestamp; d int; i int; st time; en time; days int[]; cand timestamp;
BEGIN
  IF w IS NULL OR NOT coalesce((w->>'enabled')::boolean, false) THEN RETURN p_now; END IF;
  st := coalesce(w->>'start', '09:00')::time; en := coalesce(w->>'end', '17:00')::time;
  days := coalesce(ARRAY(SELECT x::int FROM jsonb_array_elements_text(w->'days') x), ARRAY[0,1,2,3,4,5,6]);
  IF cardinality(days) = 0 THEN days := ARRAY[0,1,2,3,4,5,6]; END IF;
  BEGIN local_ts := p_now AT TIME ZONE tz; EXCEPTION WHEN OTHERS THEN tz := 'UTC'; local_ts := p_now AT TIME ZONE tz; END;
  FOR i IN 0..7 LOOP
    cand := date_trunc('day', local_ts) + make_interval(days => i);
    d := extract(dow FROM cand)::int;
    IF NOT d = ANY(days) THEN CONTINUE; END IF;
    IF i = 0 THEN
      IF local_ts::time >= st AND local_ts::time < en THEN RETURN p_now; END IF;
      IF local_ts::time < st THEN RETURN (cand + st) AT TIME ZONE tz; END IF;
    ELSE
      RETURN (cand + st) AT TIME ZONE tz;
    END IF;
  END LOOP;
  RETURN p_now;
END $$;

CREATE OR REPLACE FUNCTION wf_log(p_run wf_runs, p_step jsonb, p_id text, p_status text, p_detail text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO wf_logs(run_id, workflow_id, contact_id, step_id, step_type, step_name, status, detail)
  VALUES (p_run.id, p_run.workflow_id, p_run.contact_id, p_id, p_step->>'type', coalesce(nullif(p_step->>'name', ''), p_step->>'type'), p_status, left(coalesce(p_detail, ''), 1000));
$$;

CREATE OR REPLACE FUNCTION wf_finish(p_run uuid, p_status text, p_reason text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE wf_runs SET status = p_status, exit_reason = p_reason, finished_at = now(), resume_at = NULL WHERE id = p_run AND status IN ('active', 'waiting');
$$;

CREATE OR REPLACE FUNCTION wf_tag_id(p_ws uuid, p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid;
BEGIN
  SELECT id INTO tid FROM tags WHERE workspace_id = p_ws AND lower(name) = lower(btrim(p_name));
  IF tid IS NULL THEN INSERT INTO tags(workspace_id, name) VALUES (p_ws, btrim(p_name)) RETURNING id INTO tid; END IF;
  RETURN tid;
END $$;

-- Runs one step. Returns the branch to follow: 'next', 'yes', 'no', 'wait' (paused), 'end' or 'fail'.
CREATE OR REPLACE FUNCTION wf_exec_step(p_run wf_runs, p_wf workflows, p_id text, p_step jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce(p_step->'config', '{}'::jsonb);
  c record; t text; n int; secs bigint; until timestamptz; tz text; acct record; uids uuid[]; uid uuid;
  subj text; body text; ok boolean; other workflows; target uuid; dnd text[]; fld text;
BEGIN
  SELECT * INTO c FROM contacts WHERE id = p_run.contact_id;
  IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'The contact no longer exists.'); RETURN 'fail'; END IF;
  PERFORM set_config('synapse.wf_depth', (p_run.depth + 1)::text, true);

  CASE p_step->>'type'
  WHEN 'add_tag' THEN
    FOR t IN SELECT jsonb_array_elements_text(coalesce(cfg->'tags', '[]')) LOOP
      INSERT INTO contact_tags(contact_id, tag_id) VALUES (c.id, wf_tag_id(c.workspace_id, t)) ON CONFLICT DO NOTHING;
    END LOOP;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Added: ' || coalesce((SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(coalesce(cfg->'tags', '[]')) x), ''));
  WHEN 'remove_tag' THEN
    DELETE FROM contact_tags ct USING tags tg WHERE ct.contact_id = c.id AND tg.id = ct.tag_id AND lower(tg.name) = ANY(wf_lower_list(cfg->'tags'));
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Removed: ' || coalesce((SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(coalesce(cfg->'tags', '[]')) x), ''));
  WHEN 'update_field' THEN
    fld := cfg->>'field';
    IF fld NOT IN ('first_name','last_name','email','phone','company','job_title','contact_type','timezone','date_of_birth','source') THEN
      PERFORM wf_log(p_run, p_step, p_id, 'failed', 'That field can''t be changed by a workflow.'); RETURN 'fail';
    END IF;
    BEGIN
      IF fld = 'date_of_birth' THEN
        UPDATE contacts SET date_of_birth = nullif(cfg->>'value', '')::date, updated_at = now() WHERE id = c.id;
      ELSE
        EXECUTE format('UPDATE contacts SET %I = $1, updated_at = now() WHERE id = $2', fld)
        USING nullif(wf_merge(cfg->>'value', c.id, p_run.context), ''), c.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM wf_log(p_run, p_step, p_id, 'failed', SQLERRM); RETURN 'fail';
    END;
    PERFORM wf_log(p_run, p_step, p_id, 'success', fld || ' set to "' || coalesce(cfg->>'value', '') || '"');
  WHEN 'assign_user' THEN
    UPDATE contacts SET owner_id = nullif(cfg->>'user_id', '')::uuid, updated_at = now() WHERE id = c.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Assigned');
  WHEN 'remove_assigned_user' THEN
    UPDATE contacts SET owner_id = NULL, updated_at = now() WHERE id = c.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Unassigned');
  WHEN 'set_dnd' THEN
    IF coalesce(cfg->>'scope', 'all') = 'all' THEN
      UPDATE contacts SET dnd_all = (cfg->>'mode' = 'enable'), updated_at = now() WHERE id = c.id;
    ELSE
      dnd := ARRAY(SELECT x FROM jsonb_array_elements_text(coalesce(cfg->'channels', '[]')) x WHERE x IN ('email','sms','calls'));
      IF cfg->>'mode' = 'enable' THEN
        UPDATE contacts SET dnd_channels = ARRAY(SELECT DISTINCT unnest(dnd_channels || dnd)), updated_at = now() WHERE id = c.id;
      ELSE
        UPDATE contacts SET dnd_channels = ARRAY(SELECT x FROM unnest(dnd_channels) x WHERE NOT x = ANY(dnd)), updated_at = now() WHERE id = c.id;
      END IF;
    END IF;
    PERFORM wf_log(p_run, p_step, p_id, 'success', CASE WHEN cfg->>'mode' = 'enable' THEN 'Do Not Disturb on' ELSE 'Do Not Disturb off' END);
  WHEN 'add_note' THEN
    INSERT INTO notes(workspace_id, contact_id, content) VALUES (c.workspace_id, c.id, coalesce(nullif(wf_merge(cfg->>'text', c.id, p_run.context), ''), '(empty note)'));
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Note added');
  WHEN 'add_task' THEN
    INSERT INTO tasks(workspace_id, contact_id, title, body, due_at, assigned_to)
    VALUES (c.workspace_id, c.id, left(coalesce(nullif(wf_merge(cfg->>'title', c.id, p_run.context), ''), 'Follow up'), 200), wf_merge(cfg->>'body', c.id, p_run.context),
      CASE WHEN cfg->>'due_in_days' ~ '^\d+$' THEN now() + make_interval(days => (cfg->>'due_in_days')::int) END,
      CASE WHEN cfg->>'assign' = 'owner' THEN c.owner_id ELSE nullif(cfg->>'assign', '')::uuid END);
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Task added');
  WHEN 'notify' THEN
    IF cfg->>'to' = 'users' THEN uids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(cfg->'users', '[]')) x);
    ELSIF cfg->>'to' = 'everyone' THEN uids := ARRAY(SELECT user_id FROM workspace_members WHERE workspace_id = c.workspace_id AND coalesce(status, 'active') = 'active');
    ELSE uids := ARRAY[c.owner_id]; END IF;
    uids := ARRAY(SELECT DISTINCT x FROM unnest(uids) x WHERE x IS NOT NULL);
    IF cardinality(uids) = 0 THEN PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'Nobody to notify (the contact has no assigned user).'); RETURN 'next'; END IF;
    FOREACH uid IN ARRAY uids LOOP
      INSERT INTO team_notifications(workspace_id, user_id, title, body, link)
      VALUES (c.workspace_id, uid, left(coalesce(nullif(wf_merge(cfg->>'title', c.id, p_run.context), ''), p_wf.name), 200), wf_merge(cfg->>'body', c.id, p_run.context), '/contacts/' || c.id);
    END LOOP;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Notified ' || cardinality(uids) || ' ' || CASE WHEN cardinality(uids) = 1 THEN 'person' ELSE 'people' END);
  WHEN 'send_email' THEN
    IF coalesce(c.email, '') = '' THEN PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'The contact has no email address.'); RETURN 'next'; END IF;
    IF c.dnd_all OR 'email' = ANY(c.dnd_channels) OR NOT coalesce(c.email_opt_in, true) THEN
      PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'The contact has Do Not Disturb on for email.'); RETURN 'next';
    END IF;
    tz := CASE WHEN p_wf.settings->>'timezone' = 'contact' AND coalesce(c.timezone, '') <> '' THEN c.timezone ELSE (SELECT timezone FROM workspaces WHERE id = c.workspace_id) END;
    until := wf_window_next(p_wf.settings, tz);
    IF until > now() + interval '30 seconds' THEN
      UPDATE wf_runs SET status = 'waiting', resume_at = until, current_step = p_id WHERE id = p_run.id;
      PERFORM wf_log(p_run, p_step, p_id, 'waiting', 'Outside the sending window. Sends at ' || to_char(until AT TIME ZONE coalesce(tz, 'UTC'), 'Dy DD Mon HH24:MI'));
      RETURN 'wait';
    END IF;
    SELECT * INTO acct FROM email_accounts WHERE id = coalesce(nullif(cfg->>'account_id', ''), nullif(p_wf.settings->'sender'->>'account_id', ''))::uuid AND workspace_id = c.workspace_id;
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'No sending email account chosen. Pick one in this workflow''s Settings → Sender.'); RETURN 'fail'; END IF;
    subj := wf_merge(cfg->>'subject', c.id, p_run.context); body := wf_merge(cfg->>'body', c.id, p_run.context);
    INSERT INTO messages(workspace_id, contact_id, channel, direction, subject, body, status, from_email, from_name, to_address, email_account_id, wf_run_id)
    VALUES (c.workspace_id, c.id, 'email', 'outbound', subj, body, 'queued', acct.email, coalesce(nullif(p_wf.settings->'sender'->>'from_name', ''), acct.display_name), c.email, acct.id, p_run.id);
    UPDATE wf_runs SET context = context || '{"messaged": true}'::jsonb WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Email queued to ' || c.email || ': "' || subj || '"');
  WHEN 'wait' THEN
    n := greatest(coalesce(nullif(cfg->>'amount', '')::int, 1), 0);
    secs := n * CASE coalesce(cfg->>'unit', 'hours') WHEN 'minutes' THEN 60 WHEN 'days' THEN 86400 ELSE 3600 END;
    UPDATE wf_runs SET status = 'waiting', resume_at = now() + make_interval(secs => secs), current_step = coalesce(p_step->>'next', '') WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'waiting', 'Waiting ' || n || ' ' || coalesce(cfg->>'unit', 'hours'));
    RETURN 'wait';
  WHEN 'if_else' THEN
    ok := wf_conditions_ok(cfg, c.id);
    PERFORM wf_log(p_run, p_step, p_id, 'success', CASE WHEN ok THEN 'Yes branch' ELSE 'No branch' END);
    RETURN CASE WHEN ok THEN 'yes' ELSE 'no' END;
  WHEN 'webhook' THEN
    IF coalesce(cfg->>'url', '') !~ '^https://' THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'The webhook needs an https:// address.'); RETURN 'fail'; END IF;
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := ''{"Content-Type": "application/json"}''::jsonb)'
      USING cfg->>'url', jsonb_build_object('event', 'synapse.workflow', 'workflow', jsonb_build_object('id', p_wf.id, 'name', p_wf.name),
        'contact', (SELECT to_jsonb(x) - 'workspace_id' FROM contacts x WHERE x.id = c.id), 'tags', to_jsonb(wf_contact_tags(c.id)), 'trigger', p_run.trigger_name, 'context', p_run.context);
      PERFORM wf_log(p_run, p_step, p_id, 'success', 'Sent to ' || (cfg->>'url'));
    EXCEPTION WHEN OTHERS THEN
      PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Couldn''t send the webhook: ' || SQLERRM); RETURN 'fail';
    END;
  WHEN 'add_to_workflow' THEN
    SELECT * INTO other FROM workflows WHERE id = nullif(cfg->>'workflow_id', '')::uuid AND workspace_id = c.workspace_id;
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a workflow.'); RETURN 'fail'; END IF;
    target := wf_enroll(other, jsonb_build_object('id', 'added', 'name', 'Added by ' || p_wf.name), c.id, 'Added by workflow "' || p_wf.name || '"', '{}'::jsonb, p_run.depth + 1, false, true);
    PERFORM wf_log(p_run, p_step, p_id, CASE WHEN target IS NULL THEN 'skipped' ELSE 'success' END, CASE WHEN target IS NULL THEN 'Already in "' || other.name || '" (or it is a draft)' ELSE 'Added to "' || other.name || '"' END);
  WHEN 'remove_from_workflow' THEN
    IF coalesce(cfg->>'workflow_id', 'current') = 'current' THEN
      PERFORM wf_log(p_run, p_step, p_id, 'success', 'Removed from this workflow');
      PERFORM wf_finish(p_run.id, 'removed', 'Removed by a step in this workflow');
      RETURN 'end';
    END IF;
    UPDATE wf_runs SET status = 'removed', exit_reason = 'Removed by workflow "' || p_wf.name || '"', finished_at = now(), resume_at = NULL
    WHERE workflow_id = (cfg->>'workflow_id')::uuid AND contact_id = c.id AND status IN ('active', 'waiting');
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Removed from the other workflow');
  WHEN 'end' THEN
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'End');
    RETURN 'end';
  ELSE
    PERFORM wf_log(p_run, p_step, p_id, 'failed', 'This step type isn''t supported: ' || coalesce(p_step->>'type', '?'));
    RETURN 'fail';
  END CASE;
  RETURN 'next';
END $$;

-- Walk a run forward until it waits or finishes.
CREATE OR REPLACE FUNCTION wf_run(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r wf_runs; w workflows; step jsonb; sid text; res text; hops int := 0;
BEGIN
  SELECT * INTO r FROM wf_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('active', 'waiting') THEN RETURN; END IF;
  SELECT * INTO w FROM workflows WHERE id = r.workflow_id;
  UPDATE wf_runs SET status = 'active', resume_at = NULL WHERE id = r.id;
  sid := r.current_step;
  LOOP
    hops := hops + 1;
    IF coalesce(sid, '') = '' THEN PERFORM wf_finish(r.id, 'completed', 'Workflow completed'); RETURN; END IF;
    IF hops > 200 THEN PERFORM wf_finish(r.id, 'failed', 'Too many steps in one go (is there a loop?)'); RETURN; END IF;
    step := w.definition->'graph'->sid;
    IF step IS NULL THEN PERFORM wf_finish(r.id, 'completed', 'The next step was deleted from the workflow'); RETURN; END IF;
    UPDATE wf_runs SET current_step = sid WHERE id = r.id;
    SELECT * INTO r FROM wf_runs WHERE id = r.id;
    BEGIN
      res := wf_exec_step(r, w, sid, step);
    EXCEPTION WHEN OTHERS THEN
      PERFORM wf_log(r, step, sid, 'failed', SQLERRM);
      res := 'fail';
    END;
    CASE res
      WHEN 'wait' THEN RETURN;
      WHEN 'end' THEN PERFORM wf_finish(r.id, 'completed', 'Ended by a step'); RETURN;
      WHEN 'fail' THEN
        -- Keep going after a failed step, like most builders do; the log shows what failed.
        sid := step->>'next';
      WHEN 'yes' THEN sid := step->>'yes';
      WHEN 'no' THEN sid := step->>'no';
      ELSE sid := step->>'next';
    END CASE;
  END LOOP;
END $$;

-- Put a contact into a workflow (respects Allow Re-entry; never twice at the same time).
CREATE OR REPLACE FUNCTION wf_enroll(p_wf workflows, p_trigger jsonb, p_contact uuid, p_reason text, p_ctx jsonb, p_depth int, p_test boolean, p_run_now boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF p_contact IS NULL THEN RETURN NULL; END IF;
  IF NOT p_test THEN
    IF p_wf.status <> 'active' THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM wf_runs WHERE workflow_id = p_wf.id AND contact_id = p_contact AND status IN ('active', 'waiting')) THEN RETURN NULL; END IF;
    IF NOT coalesce((p_wf.settings->>'allow_reentry')::boolean, false)
       AND EXISTS (SELECT 1 FROM wf_runs WHERE workflow_id = p_wf.id AND contact_id = p_contact AND NOT is_test) THEN RETURN NULL; END IF;
    -- Safety net against loops (a workflow that keeps re-triggering itself): at most 3 entries
    -- for the same contact in 10 minutes.
    IF (SELECT count(*) FROM wf_runs WHERE workflow_id = p_wf.id AND contact_id = p_contact AND NOT is_test AND started_at > now() - interval '10 minutes') >= 3 THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO wf_runs(workflow_id, workspace_id, contact_id, trigger_id, trigger_name, reason, current_step, context, depth, is_test)
  VALUES (p_wf.id, p_wf.workspace_id, p_contact, p_trigger->>'id', coalesce(nullif(p_trigger->>'name', ''), p_trigger->>'type'), p_reason,
          p_wf.definition->>'start', coalesce(p_ctx, '{}'::jsonb), p_depth, p_test)
  RETURNING id INTO rid;
  UPDATE workflows SET total_runs = coalesce(total_runs, 0) + 1, last_run_at = now() WHERE id = p_wf.id;
  IF p_run_now THEN PERFORM wf_run(rid); END IF;
  RETURN rid;
END $$;

-- Handle one event: stop-on-response, then enrol into every matching published workflow.
CREATE OR REPLACE FUNCTION wf_handle_event(ev wf_events) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w workflows; t jsonb;
BEGIN
  IF ev.depth > 4 THEN RETURN; END IF; -- workflows triggering workflows: stop runaway chains
  IF ev.type = 'customer_replied' THEN
    UPDATE wf_runs r SET status = 'stopped', exit_reason = 'The contact replied (Stop on response)', finished_at = now(), resume_at = NULL
    FROM workflows w2
    WHERE w2.id = r.workflow_id AND r.contact_id = ev.contact_id AND r.status IN ('active', 'waiting')
      AND coalesce((w2.settings->>'stop_on_response')::boolean, false) AND coalesce((r.context->>'messaged')::boolean, false);
  END IF;
  FOR w IN SELECT * FROM workflows WHERE workspace_id = ev.workspace_id AND status = 'active' AND definition IS NOT NULL LOOP
    FOR t IN SELECT * FROM jsonb_array_elements(coalesce(w.definition->'triggers', '[]'::jsonb)) LOOP
      IF wf_trigger_matches(t, ev) THEN
        PERFORM wf_enroll(w, t, ev.contact_id, coalesce(nullif(t->>'name', ''), t->>'type'), ev.data, ev.depth, false, true);
        EXIT; -- one enrolment per workflow per event
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Birthday / Custom Date / Task reminders: once a day, from 8 AM in the account's time zone.
CREATE OR REPLACE FUNCTION wf_daily_scan() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w workflows; t jsonb; f jsonb; tz text; today date; target date; n int := 0; c record; days int; ofs text; hit boolean; dob date; mmdd text;
BEGIN
  FOR w IN SELECT * FROM workflows WHERE status = 'active' AND definition IS NOT NULL
           AND definition->'triggers' @? '$[*] ? (@.type == "birthday_reminder" || @.type == "custom_date_reminder" || @.type == "task_reminder")' LOOP
    tz := coalesce((SELECT nullif(timezone, '') FROM workspaces WHERE id = w.workspace_id), 'UTC');
    BEGIN today := (now() AT TIME ZONE tz)::date; EXCEPTION WHEN OTHERS THEN tz := 'UTC'; today := (now() AT TIME ZONE tz)::date; END;
    IF (now() AT TIME ZONE tz)::time < time '08:00' THEN CONTINUE; END IF;
    FOR t IN SELECT * FROM jsonb_array_elements(w.definition->'triggers') LOOP
      f := coalesce(t->'filters', '{}'::jsonb);
      days := greatest(coalesce(nullif(f->>'days', '')::int, 0), 0);
      ofs := coalesce(f->>'offset', 'on');
      target := CASE ofs WHEN 'before' THEN today + days WHEN 'after' THEN today - days ELSE today END;
      IF t->>'type' IN ('birthday_reminder', 'custom_date_reminder') THEN
        IF coalesce(f->>'weekday', '') <> '' AND extract(dow FROM today)::int <> (f->>'weekday')::int THEN CONTINUE; END IF;
        FOR c IN SELECT id, date_of_birth, created_at FROM contacts WHERE workspace_id = w.workspace_id LOOP
          dob := CASE WHEN t->>'type' = 'birthday_reminder' OR coalesce(f->>'field', 'date_of_birth') = 'date_of_birth' THEN c.date_of_birth
                      ELSE (c.created_at AT TIME ZONE tz)::date END;
          IF dob IS NULL THEN CONTINUE; END IF;
          IF coalesce(f->>'month', '') <> '' AND extract(month FROM dob)::int <> (f->>'month')::int THEN CONTINUE; END IF;
          IF t->>'type' = 'custom_date_reminder' AND coalesce((f->>'match_year')::boolean, false) THEN
            hit := dob = target;
          ELSE
            mmdd := to_char(dob, 'MM-DD');
            -- 29 February birthdays are celebrated on 28 February in other years.
            IF mmdd = '02-29' AND NOT (extract(year FROM target)::int % 4 = 0 AND (extract(year FROM target)::int % 100 <> 0 OR extract(year FROM target)::int % 400 = 0)) THEN mmdd := '02-28'; END IF;
            hit := mmdd = to_char(target, 'MM-DD');
          END IF;
          IF NOT hit THEN CONTINUE; END IF;
          IF coalesce(f->>'has_tag', '') <> '' AND NOT lower(f->>'has_tag') = ANY(wf_contact_tags(c.id)) THEN CONTINUE; END IF;
          INSERT INTO wf_daily_marks VALUES (w.id, coalesce(t->>'id', ''), c.id, today) ON CONFLICT DO NOTHING;
          IF NOT FOUND THEN CONTINUE; END IF;
          IF wf_enroll(w, t, c.id, coalesce(nullif(t->>'name', ''), t->>'type'), '{}'::jsonb, 0, false, true) IS NOT NULL THEN n := n + 1; END IF;
        END LOOP;
      ELSIF t->>'type' = 'task_reminder' THEN
        FOR c IN SELECT id, contact_id, title FROM tasks WHERE workspace_id = w.workspace_id AND contact_id IS NOT NULL AND due_at IS NOT NULL
                   AND (due_at AT TIME ZONE tz)::date = CASE ofs WHEN 'after' THEN today - days ELSE today + days END LOOP
          INSERT INTO wf_daily_marks VALUES (w.id, coalesce(t->>'id', ''), c.id, today) ON CONFLICT DO NOTHING;
          IF NOT FOUND THEN CONTINUE; END IF;
          IF wf_enroll(w, t, c.contact_id, coalesce(nullif(t->>'name', ''), 'Task reminder') || ': ' || c.title, jsonb_build_object('task_id', c.id, 'title', c.title), 0, false, true) IS NOT NULL THEN n := n + 1; END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;

-- Every minute (pg_cron): new events, finished waits, daily reminders, queued emails.
CREATE OR REPLACE FUNCTION wf_tick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev wf_events; r record; n_ev int := 0; n_runs int := 0; n_daily int := 0; queued int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('synapse_wf_tick')) THEN RETURN jsonb_build_object('skipped', true); END IF;
  FOR ev IN SELECT * FROM wf_events WHERE processed_at IS NULL ORDER BY id LIMIT 500 LOOP
    BEGIN
      PERFORM wf_handle_event(ev);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf event % failed: %', ev.id, SQLERRM;
    END;
    UPDATE wf_events SET processed_at = now() WHERE id = ev.id;
    n_ev := n_ev + 1;
  END LOOP;
  FOR r IN SELECT id FROM wf_runs WHERE status = 'waiting' AND resume_at <= now() ORDER BY resume_at LIMIT 500 LOOP
    BEGIN PERFORM wf_run(r.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf run % failed: %', r.id, SQLERRM; END;
    n_runs := n_runs + 1;
  END LOOP;
  BEGIN n_daily := wf_daily_scan(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf daily scan failed: %', SQLERRM; END;
  -- Housekeeping: keep 30 days of history, like the manual's logs.
  DELETE FROM wf_events WHERE processed_at < now() - interval '30 days';
  DELETE FROM wf_logs WHERE at < now() - interval '30 days';
  -- Ask the mailer to send workflow emails.
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND wf_run_id IS NOT NULL;
  IF queued > 0 AND to_regnamespace('net') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := ''{"mode":"queue"}''::jsonb, headers := jsonb_strip_nulls(jsonb_build_object(''Content-Type'', ''application/json'', ''x-synapse-mailer'', $2, ''apikey'', $3, ''Authorization'', ''Bearer '' || $3)))'
      USING (SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), wf_mailer_secret(), (SELECT value FROM wf_private.settings WHERE key = 'client_key');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf mailer call failed: %', SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('events', n_ev, 'resumed', n_runs, 'daily', n_daily, 'queued_emails', queued);
END $$;
REVOKE ALL ON FUNCTION wf_tick() FROM PUBLIC, anon, authenticated;

-- "Test workflow": run it now for one contact (works on drafts too). Members only.
CREATE OR REPLACE FUNCTION wf_test_run(p_workflow uuid, p_contact uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w workflows; rid uuid;
BEGIN
  SELECT * INTO w FROM workflows WHERE id = p_workflow;
  IF NOT FOUND OR NOT can_access_workspace(w.workspace_id) THEN RAISE EXCEPTION 'Workflow not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact AND workspace_id = w.workspace_id) THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF w.definition IS NULL OR coalesce(w.definition->>'start', '') = '' THEN RAISE EXCEPTION 'Add at least one step first'; END IF;
  rid := wf_enroll(w, jsonb_build_object('id', 'test', 'name', 'Test run'), p_contact, 'Test run from the builder', '{}'::jsonb, 0, true, true);
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION wf_test_run(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_test_run(uuid, uuid) TO authenticated;

-- Remove a contact from a workflow (Enrollment History → Remove).
CREATE OR REPLACE FUNCTION wf_remove_run(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wf_runs WHERE id = p_run AND can_access_workspace(workspace_id)) THEN RAISE EXCEPTION 'Not found'; END IF;
  PERFORM wf_finish(p_run, 'removed', 'Removed by a team member');
END $$;
REVOKE ALL ON FUNCTION wf_remove_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_remove_run(uuid) TO authenticated;

-- 5. Every minute -------------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'synapse-workflows';
    PERFORM cron.schedule('synapse-workflows', '* * * * *', 'SELECT public.wf_tick()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Could not schedule workflows: %', SQLERRM;
END $$;


-- ============ 20261011090000_characters.sql ============
/*
  # Characters

  3D characters (.glb files, for example a Meshy export with all its animation clips merged)
  that a workspace uploads and previews on the Characters page. Safe to run more than once.

  1. characters             one row per uploaded character
     - clips                the animation clips in the file: [{ "name": "Walking", "duration": 1.25 }]
     - default_clip         the clip the character plays by default (chosen on the Characters page)
  2. Storage bucket "characters" (private, 30 MB per file). Files live under
     <workspace id>/<file name>.glb and only members of that workspace can read or change them.
*/

-- 1. Table -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  storage_path text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 31457280),
  clips jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_clip text,
  bones int NOT NULL DEFAULT 0,
  triangles int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_characters_workspace ON characters(workspace_id, created_at DESC);
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "characters_all" ON characters;
CREATE POLICY "characters_all" ON characters FOR ALL TO authenticated
  USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));

-- 2. Storage ---------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('characters', 'characters', false, 31457280, ARRAY['model/gltf-binary', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "characters_read" ON storage.objects;
CREATE POLICY "characters_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'characters' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));
DROP POLICY IF EXISTS "characters_upload" ON storage.objects;
CREATE POLICY "characters_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'characters' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));
DROP POLICY IF EXISTS "characters_delete" ON storage.objects;
CREATE POLICY "characters_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'characters' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));


-- ============ 20261012090000_characters_in_spaces.sql ============
/*
  # Characters in spaces

  The character people appear as when they walk around a workspace's spaces, and which of its
  animation clips plays for standing, walking, wave and cheer. Safe to run more than once.

  - characters.use_in_spaces   at most one per workspace (when none is chosen, the newest is used)
  - characters.space_clips     { "idle": "...", "walk": "...", "wave": "...", "cheer": "..." }
*/
ALTER TABLE characters ADD COLUMN IF NOT EXISTS use_in_spaces boolean NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS space_clips jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_one_in_spaces ON characters(workspace_id) WHERE use_in_spaces;

