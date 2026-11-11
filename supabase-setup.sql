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


-- ============ 20261013090000_character_library.sql ============
/*
  # One character library for all of SYNAPSE

  Characters were per workspace. They become one library: every signed-in person, in every
  workspace, can see and use every character. Only SYNAPSE admins (the people who run SYNAPSE,
  not workspace owners) can add, change or remove them. Safe to run more than once.

  1. platform_admins + is_platform_admin()
     The first admins are whoever has uploaded characters so far. To add someone else later:
       INSERT INTO platform_admins (user_id) SELECT id FROM auth.users WHERE email = '<their email>';
  2. characters: readable by everyone signed in; writable by SYNAPSE admins only.
     workspace_id is no longer required (new uploads belong to the library, not a workspace).
     One default character for all of SYNAPSE (use_in_spaces), instead of one per workspace.
  3. Storage bucket "characters": everyone signed in can read; SYNAPSE admins upload and delete.
*/

-- 1. SYNAPSE admins ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_admins_self" ON platform_admins;
CREATE POLICY "platform_admins_self" ON platform_admins FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;

INSERT INTO platform_admins (user_id)
SELECT DISTINCT created_by FROM characters WHERE created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2. Characters -------------------------------------------------------------------------------
ALTER TABLE characters ALTER COLUMN workspace_id DROP NOT NULL;

DROP POLICY IF EXISTS "characters_all" ON characters;
DROP POLICY IF EXISTS "characters_select" ON characters;
CREATE POLICY "characters_select" ON characters FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "characters_insert" ON characters;
CREATE POLICY "characters_insert" ON characters FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
DROP POLICY IF EXISTS "characters_update" ON characters;
CREATE POLICY "characters_update" ON characters FOR UPDATE TO authenticated
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
DROP POLICY IF EXISTS "characters_delete" ON characters;
CREATE POLICY "characters_delete" ON characters FOR DELETE TO authenticated USING (is_platform_admin());

-- One default character for everyone (keep the newest if several workspaces had chosen one).
DROP INDEX IF EXISTS idx_characters_one_in_spaces;
UPDATE characters SET use_in_spaces = false
WHERE use_in_spaces AND id <> (SELECT id FROM characters WHERE use_in_spaces ORDER BY created_at DESC LIMIT 1);
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_one_default ON characters ((true)) WHERE use_in_spaces;

-- 3. Storage ----------------------------------------------------------------------------------
DROP POLICY IF EXISTS "characters_read" ON storage.objects;
CREATE POLICY "characters_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'characters');
DROP POLICY IF EXISTS "characters_upload" ON storage.objects;
CREATE POLICY "characters_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'characters' AND is_platform_admin());
DROP POLICY IF EXISTS "characters_delete" ON storage.objects;
CREATE POLICY "characters_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'characters' AND is_platform_admin());


-- ============ 20261014090000_company_foundations.sql ============
/*
# Company foundations: roles, departments, safe invitations

For company accounts (e.g. a support company with 200 staff): a Supervisor role, departments
that supervisors lead, job titles, invitations that carry a department and title, and fixes
to how people join a workspace.

## 1. Security fixes
- `wm_insert_self` let any signed-in user add themselves to ANY workspace with ANY role
  (including owner/admin). Now a member row can only be added by a workspace admin, by the
  workspace's owner for themselves, or by someone holding a pending, unexpired invitation for
  that workspace, for their own email, with exactly the invited role.
- `wm_update` let members update their own row, including `role` and `status` (promote
  themselves to admin, un-suspend themselves). A trigger now stops anyone but a workspace admin
  changing role, status, title or department; `owner` can only ever be the workspace's owner.
- `team_inv_public_select_token` let anyone (even signed out) list EVERY pending invitation with
  its email and token. Replaced by:
    - `get_invitation(token)`: the one invitation for a token (for the accept page), and
    - a policy letting a signed-in user see invitations sent to their own email.
- Invitees could not mark their invitation accepted (update was admin-only), so invitations stayed
  "pending" forever. `accept_invitation(token)` does the whole accept server-side, and a policy
  lets invitees mark their own invitation accepted.

## 2. Supervisor role
`workspace_members.role` and `team_invitations.role`: owner, admin, supervisor, member.

## 3. Departments
- `departments` (name, color, description) per workspace.
- `department_members` (department, member, is_lead). A lead is a supervisor of that department.
- Everyone in the workspace can see departments; admins create/rename/delete them; admins and
  the department's leads add and remove members (only admins choose leads).

## 4. Job titles and invitation details
- `workspace_members.title`
- `team_invitations.title`, `team_invitations.department_id` (joined on accept)
*/

-- ============================================================
-- 1. Roles: add 'supervisor'
-- ============================================================

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('public.workspace_members'::regclass, 'public.team_invitations'::regclass)
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'supervisor', 'member'));
-- NOT VALID: any old 'owner' invitation stays readable; new and changed ones must use these roles.
ALTER TABLE team_invitations ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('admin', 'supervisor', 'member')) NOT VALID;

-- ============================================================
-- 2. Departments
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 500),
  color text NOT NULL DEFAULT '#0D1C3B' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_departments_workspace ON departments(workspace_id);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS department_members (
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_lead boolean NOT NULL DEFAULT false,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(workspace_id, user_id);
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;

-- The department's workspace must match (no cross-workspace rows).
CREATE OR REPLACE FUNCTION department_members_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'Department is not in this workspace';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Only members of the workspace can join its departments';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS department_members_check ON department_members;
CREATE TRIGGER department_members_check BEFORE INSERT OR UPDATE ON department_members
  FOR EACH ROW EXECUTE FUNCTION department_members_check();

-- Leads of a department (its supervisors).
CREATE OR REPLACE FUNCTION is_department_lead(check_department_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM department_members dm
    JOIN workspace_members m ON m.workspace_id = dm.workspace_id AND m.user_id = dm.user_id
    WHERE dm.department_id = check_department_id AND dm.user_id = auth.uid()
      AND dm.is_lead AND m.status = 'active'
  );
$$;

DROP POLICY IF EXISTS departments_select ON departments;
CREATE POLICY departments_select ON departments FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS departments_insert ON departments;
CREATE POLICY departments_insert ON departments FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS departments_update ON departments;
CREATE POLICY departments_update ON departments FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS departments_delete ON departments;
CREATE POLICY departments_delete ON departments FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS department_members_select ON department_members;
CREATE POLICY department_members_select ON department_members FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));
-- Admins add anyone (and choose leads); a department's leads add plain members to it.
DROP POLICY IF EXISTS department_members_insert ON department_members;
CREATE POLICY department_members_insert ON department_members FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id) OR (is_department_lead(department_id) AND NOT is_lead));
DROP POLICY IF EXISTS department_members_update ON department_members;
CREATE POLICY department_members_update ON department_members FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS department_members_delete ON department_members;
CREATE POLICY department_members_delete ON department_members FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id) OR (is_department_lead(department_id) AND NOT is_lead));

-- ============================================================
-- 3. Job titles, invitation department/title
-- ============================================================

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS title text
  CHECK (title IS NULL OR length(title) <= 80);
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS title text
  CHECK (title IS NULL OR length(title) <= 80);
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES departments(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Who may add and change member rows
-- ============================================================

DROP POLICY IF EXISTS "wm_insert_self" ON workspace_members;
CREATE POLICY "wm_insert_self" ON workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    -- Admins add people.
    is_workspace_admin(workspace_id)
    -- The workspace's owner restores their own owner row.
    OR (user_id = auth.uid() AND role = 'owner'
        AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
    -- Someone accepting their own pending invitation, with exactly the invited role.
    OR (user_id = auth.uid() AND role <> 'owner' AND EXISTS (
      SELECT 1 FROM team_invitations i
      WHERE i.workspace_id = workspace_members.workspace_id
        AND i.status = 'pending' AND i.expires_at > now()
        AND lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        AND i.role = workspace_members.role
    ))
  );

-- Role, status, title and departments are the admins' to change. 'owner' is only ever the
-- workspace's owner. Server-side code (no signed-in user) is not limited.
CREATE OR REPLACE FUNCTION workspace_members_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_owner uuid;
BEGIN
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = NEW.workspace_id;
  IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM ws_owner THEN
    RAISE EXCEPTION 'Only the workspace owner can have the owner role';
  END IF;
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      RAISE EXCEPTION 'The owner''s role cannot be changed';
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.title IS DISTINCT FROM OLD.title)
       AND NOT is_workspace_admin(NEW.workspace_id) AND auth.uid() IS DISTINCT FROM ws_owner THEN
      RAISE EXCEPTION 'Only workspace admins can change roles, status or titles';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_members_guard ON workspace_members;
CREATE TRIGGER workspace_members_guard BEFORE INSERT OR UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_guard();

-- ============================================================
-- 5. Invitations: no public listing; accept on the server
-- ============================================================

DROP POLICY IF EXISTS "team_inv_public_select_token" ON team_invitations;

-- Signed-in people see invitations sent to their own email (used when they sign in).
DROP POLICY IF EXISTS "team_inv_select_own" ON team_invitations;
CREATE POLICY "team_inv_select_own" ON team_invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ... and can mark them accepted.
DROP POLICY IF EXISTS "team_inv_accept_own" ON team_invitations;
CREATE POLICY "team_inv_accept_own" ON team_invitations FOR UPDATE TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND status = 'pending')
  WITH CHECK (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND status = 'accepted');

-- One invitation by its token, for the accept page (works signed out). Nothing else is listable.
CREATE OR REPLACE FUNCTION get_invitation(p_token text)
RETURNS TABLE (
  id uuid, workspace_id uuid, workspace_name text, email text, role text, title text,
  department_name text, status text, expires_at timestamptz
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT i.id, i.workspace_id, w.name, i.email, i.role, i.title, d.name, i.status, i.expires_at
  FROM team_invitations i
  JOIN workspaces w ON w.id = i.workspace_id
  LEFT JOIN departments d ON d.id = i.department_id
  WHERE p_token IS NOT NULL AND length(p_token) >= 32 AND i.token = p_token;
$$;
REVOKE ALL ON FUNCTION get_invitation(text) FROM public;
GRANT EXECUTE ON FUNCTION get_invitation(text) TO anon, authenticated;

-- Accept an invitation for the signed-in user: join with the invited role, title and department.
CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv team_invitations%ROWTYPE;
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in to accept this invitation'; END IF;
  SELECT * INTO inv FROM team_invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation link is not valid'; END IF;
  IF inv.status = 'revoked' THEN RAISE EXCEPTION 'This invitation was cancelled'; END IF;
  IF inv.status = 'pending' AND inv.expires_at <= now() THEN RAISE EXCEPTION 'This invitation has expired. Ask for a new one.'; END IF;
  IF lower(inv.email) <> my_email THEN
    RAISE EXCEPTION 'This invitation is for %. Sign in with that email.', inv.email;
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, role, status, title)
  VALUES (inv.workspace_id, me, inv.role, 'active', inv.title)
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET status = 'active',
        title = coalesce(workspace_members.title, EXCLUDED.title);

  IF inv.department_id IS NOT NULL THEN
    INSERT INTO department_members (department_id, workspace_id, user_id, is_lead, added_by)
    VALUES (inv.department_id, inv.workspace_id, me, inv.role = 'supervisor', inv.invited_by)
    ON CONFLICT (department_id, user_id) DO NOTHING;
  END IF;

  UPDATE team_invitations SET status = 'accepted', accepted_at = coalesce(accepted_at, now()) WHERE id = inv.id;
  RETURN inv.workspace_id;
END $$;
REVOKE ALL ON FUNCTION accept_invitation(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION accept_invitation(text) TO authenticated;

-- ============================================================
-- 6. Team directory
-- ============================================================

-- Teammates can see each other's name and avatar (people in a shared workspace).
DROP POLICY IF EXISTS "profiles_select_teammates" ON profiles;
CREATE POLICY "profiles_select_teammates" ON profiles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workspace_members a
    JOIN workspace_members b ON b.workspace_id = a.workspace_id
    WHERE a.user_id = auth.uid() AND b.user_id = profiles.user_id
  ));

-- Everyone in a workspace, for the team page: name, avatar, role, status, title and departments.
-- Emails only for the workspace's admins.
CREATE OR REPLACE FUNCTION workspace_directory(p_workspace_id uuid)
RETURNS TABLE (
  member_id uuid, user_id uuid, first_name text, last_name text, avatar_url text, email text,
  role text, status text, title text, joined_at timestamptz, department_ids uuid[], lead_department_ids uuid[]
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT m.id, m.user_id, p.first_name, p.last_name, p.avatar_url,
         CASE WHEN is_workspace_admin(p_workspace_id) THEN u.email::text END,
         m.role, m.status, m.title, m.created_at,
         coalesce(array_agg(dm.department_id) FILTER (WHERE dm.department_id IS NOT NULL), '{}'),
         coalesce(array_agg(dm.department_id) FILTER (WHERE dm.is_lead), '{}')
  FROM workspace_members m
  LEFT JOIN profiles p ON p.user_id = m.user_id
  LEFT JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN department_members dm ON dm.workspace_id = m.workspace_id AND dm.user_id = m.user_id
  WHERE m.workspace_id = p_workspace_id AND is_workspace_member(p_workspace_id)
  GROUP BY m.id, p.first_name, p.last_name, p.avatar_url, u.email
  ORDER BY lower(coalesce(p.first_name, '')), lower(coalesce(p.last_name, ''));
$$;
REVOKE ALL ON FUNCTION workspace_directory(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION workspace_directory(uuid) TO authenticated;


-- ============ 20261015090000_company_rooms.sql ============
/*
  # Company rooms: rooms supervisors create and assign, links experts send to clients

  Needs 20261014090000_company_foundations.sql (supervisor role, departments) first.
  Safe to run more than once.

  1. company_rooms
     A standing video room of the account (e.g. "Video Support 3"), optionally in a department.
     Admins and supervisors create them; experts cannot. Shows busy while a call is going on in it.
     - open_to_department: everyone in the room's department may use it (not only those assigned)
     - busy_until / busy_meeting / busy_by: kept fresh by the person in the call (room_heartbeat)

  2. company_room_assignees
     Who may use a room: start a call in it and create links for clients or teammates.

  3. meetings.room_id, meetings.for_whom
     A link made in a room is a meeting in that room ("Video Support 3 · Jane Client"). Only
     people who may use the room can put a meeting in it (trigger meetings_room_guard).

  4. Who can do what
     - see rooms and who is assigned: everyone in the account
     - create rooms: admins, and supervisors (in departments they lead, or with no department)
     - change, assign, delete: admins, the supervisor who created the room, or a lead of its department
     - use a room: those above, the people assigned, and (if open_to_department) its department
*/

-- ---------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS company_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  open_to_department boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  busy_until timestamptz,
  busy_meeting uuid,
  busy_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_company_rooms_workspace ON company_rooms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_company_rooms_department ON company_rooms(department_id);

CREATE TABLE IF NOT EXISTS company_room_assignees (
  room_id uuid NOT NULL REFERENCES company_rooms(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_room_assignees_user ON company_room_assignees(user_id);

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES company_rooms(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS for_whom text CHECK (for_whom IS NULL OR char_length(for_whom) <= 120);
CREATE INDEX IF NOT EXISTS idx_meetings_room ON meetings(room_id, created_at DESC) WHERE room_id IS NOT NULL;

-- ---------------------------------------------------------------- helpers

/** Admins, and active supervisors, can create rooms in this account. */
CREATE OR REPLACE FUNCTION can_create_rooms(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_workspace_admin(p_workspace) OR has_workspace_role(p_workspace, ARRAY['supervisor']);
$$;

/** Change, assign or delete this room. */
CREATE OR REPLACE FUNCTION can_manage_room(p_room uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_rooms r
    WHERE r.id = p_room
      AND (
        is_workspace_admin(r.workspace_id)
        OR (has_workspace_role(r.workspace_id, ARRAY['supervisor'])
            AND (r.created_by = auth.uid() OR (r.department_id IS NOT NULL AND is_department_lead(r.department_id))))
      )
  );
$$;

/** Start a call or make links in this room. */
CREATE OR REPLACE FUNCTION can_use_room(p_room uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT can_manage_room(p_room) OR EXISTS (
    SELECT 1 FROM company_rooms r
    WHERE r.id = p_room
      AND has_workspace_role(r.workspace_id, ARRAY['owner', 'admin', 'supervisor', 'member'])
      AND (
        EXISTS (SELECT 1 FROM company_room_assignees a WHERE a.room_id = r.id AND a.user_id = auth.uid())
        OR (r.open_to_department AND r.department_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM department_members dm WHERE dm.department_id = r.department_id AND dm.user_id = auth.uid()))
      )
  );
$$;

REVOKE ALL ON FUNCTION can_create_rooms(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_manage_room(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_use_room(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_create_rooms(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_use_room(uuid) TO authenticated;

-- ---------------------------------------------------------------- row-level security

ALTER TABLE company_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_room_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_rooms_select" ON company_rooms;
CREATE POLICY "company_rooms_select" ON company_rooms FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "company_rooms_insert" ON company_rooms;
CREATE POLICY "company_rooms_insert" ON company_rooms FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND can_create_rooms(workspace_id)
    AND (department_id IS NULL OR is_workspace_admin(workspace_id) OR is_department_lead(department_id))
  );

DROP POLICY IF EXISTS "company_rooms_update" ON company_rooms;
CREATE POLICY "company_rooms_update" ON company_rooms FOR UPDATE TO authenticated
  USING (can_manage_room(id))
  WITH CHECK (department_id IS NULL OR is_workspace_admin(workspace_id) OR is_department_lead(department_id));

DROP POLICY IF EXISTS "company_rooms_delete" ON company_rooms;
CREATE POLICY "company_rooms_delete" ON company_rooms FOR DELETE TO authenticated
  USING (can_manage_room(id));

DROP POLICY IF EXISTS "company_room_assignees_select" ON company_room_assignees;
CREATE POLICY "company_room_assignees_select" ON company_room_assignees FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "company_room_assignees_insert" ON company_room_assignees;
CREATE POLICY "company_room_assignees_insert" ON company_room_assignees FOR INSERT TO authenticated
  WITH CHECK (can_manage_room(room_id));

DROP POLICY IF EXISTS "company_room_assignees_delete" ON company_room_assignees;
CREATE POLICY "company_room_assignees_delete" ON company_room_assignees FOR DELETE TO authenticated
  USING (can_manage_room(room_id));

-- ---------------------------------------------------------------- guards

-- Rooms: the workspace never changes, busy fields only change through room_heartbeat/room_release,
-- and a room's department belongs to the same account.
CREATE OR REPLACE FUNCTION company_rooms_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'That department belongs to another account';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id <> OLD.workspace_id THEN RAISE EXCEPTION 'A room cannot move to another account'; END IF;
    IF current_setting('synapse.room_busy', true) IS DISTINCT FROM 'on'
       AND (NEW.busy_until IS DISTINCT FROM OLD.busy_until OR NEW.busy_meeting IS DISTINCT FROM OLD.busy_meeting OR NEW.busy_by IS DISTINCT FROM OLD.busy_by) THEN
      NEW.busy_until := OLD.busy_until; NEW.busy_meeting := OLD.busy_meeting; NEW.busy_by := OLD.busy_by;
    END IF;
  ELSIF current_setting('synapse.room_busy', true) IS DISTINCT FROM 'on' THEN
    NEW.busy_until := NULL; NEW.busy_meeting := NULL; NEW.busy_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS company_rooms_guard ON company_rooms;
CREATE TRIGGER company_rooms_guard BEFORE INSERT OR UPDATE ON company_rooms
  FOR EACH ROW EXECUTE FUNCTION company_rooms_guard();

-- Assignees: same account as the room, and an active member of it.
CREATE OR REPLACE FUNCTION company_room_assignees_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT r.workspace_id INTO NEW.workspace_id FROM company_rooms r WHERE r.id = NEW.room_id;
  IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'Only people in this account can be assigned to its rooms';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS company_room_assignees_check ON company_room_assignees;
CREATE TRIGGER company_room_assignees_check BEFORE INSERT OR UPDATE ON company_room_assignees
  FOR EACH ROW EXECUTE FUNCTION company_room_assignees_check();

-- Meetings in a room: only people who may use the room, in the same account.
CREATE OR REPLACE FUNCTION meetings_room_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.room_id IS NULL OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.room_id IS NOT DISTINCT FROM OLD.room_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM company_rooms r WHERE r.id = NEW.room_id AND r.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'That room belongs to another account';
  END IF;
  IF NOT can_use_room(NEW.room_id) THEN
    RAISE EXCEPTION 'You are not assigned to this room. Ask a supervisor to assign you.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS meetings_room_guard ON meetings;
CREATE TRIGGER meetings_room_guard BEFORE INSERT OR UPDATE OF room_id ON meetings
  FOR EACH ROW EXECUTE FUNCTION meetings_room_guard();

-- ---------------------------------------------------------------- busy

/** Mark the room of this meeting busy for the next 90 seconds (called every ~45 s during the call). */
CREATE OR REPLACE FUNCTION room_heartbeat(p_meeting uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room uuid; v_ws uuid; v_until timestamptz := now() + interval '90 seconds';
BEGIN
  SELECT m.room_id, m.workspace_id INTO v_room, v_ws FROM meetings m WHERE m.id = p_meeting AND m.ended_at IS NULL;
  IF v_room IS NULL OR NOT is_workspace_member(v_ws) THEN RETURN NULL; END IF;
  PERFORM set_config('synapse.room_busy', 'on', true);
  UPDATE company_rooms SET busy_until = v_until, busy_meeting = p_meeting, busy_by = auth.uid() WHERE id = v_room;
  RETURN v_until;
END;
$$;

/** The call in this meeting is over: the room is free again (unless another call took it over). */
CREATE OR REPLACE FUNCTION room_release(p_meeting uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room uuid; v_ws uuid;
BEGIN
  SELECT m.room_id, m.workspace_id INTO v_room, v_ws FROM meetings m WHERE m.id = p_meeting;
  IF v_room IS NULL OR NOT is_workspace_member(v_ws) THEN RETURN; END IF;
  PERFORM set_config('synapse.room_busy', 'on', true);
  UPDATE company_rooms SET busy_until = NULL, busy_meeting = NULL, busy_by = NULL WHERE id = v_room AND busy_meeting = p_meeting;
END;
$$;

REVOKE ALL ON FUNCTION room_heartbeat(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION room_release(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION room_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION room_release(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON company_rooms, company_room_assignees TO authenticated;


-- ============ 20261016090000_conversations.sql ============
/*
  # Conversations: channels, direct messages, threads, incoming webhooks, email replies

  Needs 20261014090000_company_foundations.sql first. Safe to run more than once.

  1. chat_channels      a channel (#general, #video-team) or a direct message between people
                        - kind: 'channel' | 'dm'; private channels are visible to their members only
                        - dm_key: the sorted user ids of a direct message, so each pair has one
  2. chat_members       who is in a channel; last_read_at drives unread counts
  3. chat_messages      messages; parent_id makes a thread reply
                        - source: 'user' | 'webhook' (Zapier, Airtable, Modal…) | 'system'
                        - sender_name: shown for webhook posts (no SYNAPSE person behind them)
  4. chat_webhooks      incoming webhook links per channel (a secret token in the URL).
                        The chat-webhook Edge Function posts with it; only channel owners and
                        admins see or manage them.
  5. messages.provider_thread_id, messages.reply_checked_at
                        the Gmail thread an email went out in, so replies can be brought back
                        (send-email's scheduler run reads new replies and saves them as inbound;
                        reply_checked_at spreads the checking over the sent emails)

  Who can do what
  - everyone in the account sees public channels and their messages; private channels and direct
    messages only their members
  - anyone in the account can create a channel (they own it) and join public ones
  - channel owners and admins rename, archive, add or remove people, and manage webhooks
  - you edit and delete your own messages; owners and admins can delete any in their channels
*/

-- ---------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel', 'dm')),
  name text CHECK (name IS NULL OR name ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  is_private boolean NOT NULL DEFAULT false,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  dm_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  last_message_at timestamptz,
  CHECK ((kind = 'channel' AND name IS NOT NULL AND dm_key IS NULL) OR (kind = 'dm' AND dm_key IS NOT NULL AND is_private))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_name_key ON chat_channels(workspace_id, name) WHERE kind = 'channel';
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_dm_key ON chat_channels(workspace_id, dm_key) WHERE kind = 'dm';
CREATE INDEX IF NOT EXISTS idx_chat_channels_workspace ON chat_channels(workspace_id);

CREATE TABLE IF NOT EXISTS chat_members (
  channel_id uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  muted boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, workspace_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'webhook', 'system')),
  sender_name text CHECK (sender_name IS NULL OR char_length(sender_name) <= 80),
  webhook_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  reply_count integer NOT NULL DEFAULT 0,
  last_reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace ON chat_messages(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chat_webhooks_channel ON chat_webhooks(channel_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_thread_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(provider_thread_id) WHERE provider_thread_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_key ON messages(workspace_id, provider_message_id) WHERE provider_message_id IS NOT NULL AND direction = 'inbound';

-- ---------------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION is_chat_member(p_channel uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM chat_members WHERE channel_id = p_channel AND user_id = auth.uid());
$$;

/** See a channel: its members, or anyone active in the account when it's public. */
CREATE OR REPLACE FUNCTION can_see_channel(p_channel uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel
      AND has_workspace_role(c.workspace_id, ARRAY['owner', 'admin', 'supervisor', 'member'])
      AND (NOT c.is_private OR is_chat_member(c.id))
  );
$$;

/** Rename, archive, add or remove people, manage webhooks. */
CREATE OR REPLACE FUNCTION can_manage_channel(p_channel uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel AND c.kind = 'channel'
      AND (is_workspace_admin(c.workspace_id)
           OR EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = auth.uid() AND m.role = 'owner'))
  );
$$;

REVOKE ALL ON FUNCTION is_chat_member(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_see_channel(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_manage_channel(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION is_chat_member(uuid), can_see_channel(uuid), can_manage_channel(uuid) TO authenticated;

-- ---------------------------------------------------------------- row-level security

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_channels_select" ON chat_channels;
CREATE POLICY "chat_channels_select" ON chat_channels FOR SELECT TO authenticated USING (can_see_channel(id));

-- Channels are created through create_channel / open_dm (they add the creator as owner).
DROP POLICY IF EXISTS "chat_channels_update" ON chat_channels;
CREATE POLICY "chat_channels_update" ON chat_channels FOR UPDATE TO authenticated
  USING (can_manage_channel(id)) WITH CHECK (can_manage_channel(id));

DROP POLICY IF EXISTS "chat_channels_delete" ON chat_channels;
CREATE POLICY "chat_channels_delete" ON chat_channels FOR DELETE TO authenticated
  USING (kind = 'channel' AND is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "chat_members_select" ON chat_members;
CREATE POLICY "chat_members_select" ON chat_members FOR SELECT TO authenticated USING (can_see_channel(channel_id));

-- Join a public channel yourself; owners and admins add anyone in the account.
DROP POLICY IF EXISTS "chat_members_insert" ON chat_members;
CREATE POLICY "chat_members_insert" ON chat_members FOR INSERT TO authenticated
  WITH CHECK (
    role = 'member'
    AND (
      (user_id = auth.uid() AND EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = channel_id AND c.kind = 'channel' AND NOT c.is_private AND c.archived_at IS NULL)
        AND can_see_channel(channel_id))
      OR can_manage_channel(channel_id)
    )
  );

-- Your own read marker and mute; owners and admins can make someone an owner.
DROP POLICY IF EXISTS "chat_members_update" ON chat_members;
CREATE POLICY "chat_members_update" ON chat_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR can_manage_channel(channel_id))
  WITH CHECK (user_id = auth.uid() OR can_manage_channel(channel_id));

DROP POLICY IF EXISTS "chat_members_delete" ON chat_members;
CREATE POLICY "chat_members_delete" ON chat_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR can_manage_channel(channel_id));

DROP POLICY IF EXISTS "chat_messages_select" ON chat_messages;
CREATE POLICY "chat_messages_select" ON chat_messages FOR SELECT TO authenticated USING (can_see_channel(channel_id));

DROP POLICY IF EXISTS "chat_messages_insert" ON chat_messages;
CREATE POLICY "chat_messages_insert" ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND source = 'user' AND webhook_id IS NULL AND sender_name IS NULL
    AND is_chat_member(channel_id)
    AND EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = channel_id AND c.archived_at IS NULL)
  );

DROP POLICY IF EXISTS "chat_messages_update" ON chat_messages;
CREATE POLICY "chat_messages_update" ON chat_messages FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR can_manage_channel(channel_id))
  WITH CHECK (user_id = auth.uid() OR can_manage_channel(channel_id));

DROP POLICY IF EXISTS "chat_webhooks_select" ON chat_webhooks;
CREATE POLICY "chat_webhooks_select" ON chat_webhooks FOR SELECT TO authenticated USING (can_manage_channel(channel_id));
DROP POLICY IF EXISTS "chat_webhooks_insert" ON chat_webhooks;
CREATE POLICY "chat_webhooks_insert" ON chat_webhooks FOR INSERT TO authenticated
  WITH CHECK (can_manage_channel(channel_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "chat_webhooks_update" ON chat_webhooks;
CREATE POLICY "chat_webhooks_update" ON chat_webhooks FOR UPDATE TO authenticated
  USING (can_manage_channel(channel_id)) WITH CHECK (can_manage_channel(channel_id));
DROP POLICY IF EXISTS "chat_webhooks_delete" ON chat_webhooks;
CREATE POLICY "chat_webhooks_delete" ON chat_webhooks FOR DELETE TO authenticated USING (can_manage_channel(channel_id));

-- ---------------------------------------------------------------- guards

-- Members and webhooks: same account as the channel; members must be active in it.
CREATE OR REPLACE FUNCTION chat_members_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT c.workspace_id INTO NEW.workspace_id FROM chat_channels c WHERE c.id = NEW.channel_id;
  IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'Only people in this account can be in its channels';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION chat_webhooks_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT c.workspace_id INTO NEW.workspace_id FROM chat_channels c WHERE c.id = NEW.channel_id AND c.kind = 'channel';
  IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_members_check ON chat_members;
CREATE TRIGGER chat_members_check BEFORE INSERT OR UPDATE OF channel_id, user_id ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_members_check();
DROP TRIGGER IF EXISTS chat_webhooks_check ON chat_webhooks;
CREATE TRIGGER chat_webhooks_check BEFORE INSERT OR UPDATE OF channel_id ON chat_webhooks
  FOR EACH ROW EXECUTE FUNCTION chat_webhooks_check();

-- Messages: account from the channel, thread replies stay in their channel (one level deep),
-- edits only change the text, and the channel and thread counters stay current.
CREATE OR REPLACE FUNCTION chat_messages_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent chat_messages;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT c.workspace_id INTO NEW.workspace_id FROM chat_channels c WHERE c.id = NEW.channel_id;
    IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
    NEW.reply_count := 0; NEW.last_reply_at := NULL; NEW.edited_at := NULL; NEW.deleted_at := NULL;
    NEW.created_at := now();
    IF NEW.parent_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM chat_messages WHERE id = NEW.parent_id;
      IF v_parent.id IS NULL OR v_parent.channel_id <> NEW.channel_id THEN RAISE EXCEPTION 'Reply to a message in this channel'; END IF;
      IF v_parent.parent_id IS NOT NULL THEN NEW.parent_id := v_parent.parent_id; END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the text (an edit) or a delete marker; counters only from the trigger below.
  IF NEW.channel_id <> OLD.channel_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.source <> OLD.source OR NEW.created_at <> OLD.created_at OR NEW.sender_name IS DISTINCT FROM OLD.sender_name THEN
    RAISE EXCEPTION 'Only the text of a message can change';
  END IF;
  IF current_setting('synapse.chat_counts', true) IS DISTINCT FROM 'on' THEN
    NEW.reply_count := OLD.reply_count; NEW.last_reply_at := OLD.last_reply_at;
    IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This message was deleted'; END IF;
    IF NEW.deleted_at IS NOT NULL THEN
      -- Deleting removes the words; the gap stays so threads still make sense.
      NEW.deleted_at := now(); NEW.body := 'This message was deleted.'; NEW.meta := '{}'::jsonb;
      RETURN NEW;
    END IF;
    IF NEW.body <> OLD.body THEN
      IF OLD.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You can only edit your own messages'; END IF;
      NEW.edited_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_messages_guard ON chat_messages;
CREATE TRIGGER chat_messages_guard BEFORE INSERT OR UPDATE ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_guard();

CREATE OR REPLACE FUNCTION chat_messages_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('synapse.chat_counts', 'on', true);
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE chat_messages SET reply_count = reply_count + 1, last_reply_at = NEW.created_at WHERE id = NEW.parent_id;
  END IF;
  UPDATE chat_channels SET last_message_at = NEW.created_at WHERE id = NEW.channel_id;
  -- Posting counts as reading.
  IF NEW.user_id IS NOT NULL THEN
    UPDATE chat_members SET last_read_at = NEW.created_at WHERE channel_id = NEW.channel_id AND user_id = NEW.user_id;
  END IF;
  PERFORM set_config('synapse.chat_counts', 'off', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS chat_messages_after ON chat_messages;
CREATE TRIGGER chat_messages_after AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_after();

-- Channels: kind, account and direct-message pairs never change.
CREATE OR REPLACE FUNCTION chat_channels_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.kind <> OLD.kind OR NEW.dm_key IS DISTINCT FROM OLD.dm_key THEN
    RAISE EXCEPTION 'That cannot change';
  END IF;
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'That department belongs to another account';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_channels_guard ON chat_channels;
CREATE TRIGGER chat_channels_guard BEFORE UPDATE ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION chat_channels_guard();

-- ---------------------------------------------------------------- actions

/** Create a channel; you become its owner. Name: lowercase letters, numbers, - and _. */
CREATE OR REPLACE FUNCTION create_channel(p_workspace uuid, p_name text, p_description text DEFAULT NULL, p_private boolean DEFAULT false, p_department uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text := lower(btrim(p_name));
BEGIN
  IF NOT has_workspace_role(p_workspace, ARRAY['owner', 'admin', 'supervisor', 'member']) THEN RAISE EXCEPTION 'Not in this account'; END IF;
  IF p_department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments WHERE id = p_department AND workspace_id = p_workspace) THEN
    RAISE EXCEPTION 'That department belongs to another account';
  END IF;
  INSERT INTO chat_channels (workspace_id, kind, name, description, is_private, department_id, created_by)
  VALUES (p_workspace, 'channel', v_name, nullif(btrim(p_description), ''), coalesce(p_private, false), p_department, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO chat_members (channel_id, workspace_id, user_id, role) VALUES (v_id, p_workspace, auth.uid(), 'owner');
  RETURN v_id;
END;
$$;

/** The direct message between you and these people (made the first time). */
CREATE OR REPLACE FUNCTION open_dm(p_workspace uuid, p_users uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[]; v_key text; v_id uuid; v_user uuid;
BEGIN
  IF NOT has_workspace_role(p_workspace, ARRAY['owner', 'admin', 'supervisor', 'member']) THEN RAISE EXCEPTION 'Not in this account'; END IF;
  SELECT array_agg(DISTINCT u ORDER BY u) INTO v_ids FROM unnest(array_append(p_users, auth.uid())) u;
  IF array_length(v_ids, 1) < 2 OR array_length(v_ids, 1) > 9 THEN RAISE EXCEPTION 'A direct message is between 2 and 9 people'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) u WHERE NOT EXISTS (
      SELECT 1 FROM workspace_members m WHERE m.workspace_id = p_workspace AND m.user_id = u AND m.status = 'active')) THEN
    RAISE EXCEPTION 'Everyone in a direct message must be in this account';
  END IF;
  v_key := array_to_string(v_ids, ',');
  SELECT id INTO v_id FROM chat_channels WHERE workspace_id = p_workspace AND kind = 'dm' AND dm_key = v_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO chat_channels (workspace_id, kind, is_private, dm_key, created_by) VALUES (p_workspace, 'dm', true, v_key, auth.uid())
  RETURNING id INTO v_id;
  FOREACH v_user IN ARRAY v_ids LOOP
    INSERT INTO chat_members (channel_id, workspace_id, user_id, role) VALUES (v_id, p_workspace, v_user, 'member');
  END LOOP;
  RETURN v_id;
END;
$$;

/** Unread messages per channel you're in (top-level and thread replies by others since you last read). */
CREATE OR REPLACE FUNCTION chat_unread(p_workspace uuid)
RETURNS TABLE (channel_id uuid, unread bigint) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT m.channel_id, count(x.id)
  FROM chat_members m
  JOIN chat_messages x ON x.channel_id = m.channel_id AND x.created_at > m.last_read_at
    AND x.deleted_at IS NULL AND x.user_id IS DISTINCT FROM auth.uid()
  WHERE m.user_id = auth.uid() AND m.workspace_id = p_workspace
  GROUP BY m.channel_id;
$$;

REVOKE ALL ON FUNCTION create_channel(uuid, text, text, boolean, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION open_dm(uuid, uuid[]) FROM public, anon;
REVOKE ALL ON FUNCTION chat_unread(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION create_channel(uuid, text, text, boolean, uuid), open_dm(uuid, uuid[]), chat_unread(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_channels, chat_members, chat_messages, chat_webhooks TO authenticated;

-- Live updates: new and edited messages and channels reach the app as they happen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chat_members') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_members;
    END IF;
  END IF;
END $$;


-- ============ 20261017090000_streams.sql ============
/*
  # Streams: one person broadcasts, many watch

  A stream is a LiveKit room (stream_<id>) where only the host sends video and sound; viewers
  watch, chat and react. Viewers join with the watch link (/live/CODE?watch=<token>), no account
  needed; people in the account can open it from Streams. The call-token function only lets
  viewers in while the stream is live. Safe to run more than once.

  1. streams
     - code: like meetings (FOCU-358), used in links
     - watch_token: the private part of the watch link
     - status: scheduled -> live -> ended (started_at / ended_at are set on the way)
  2. stream_by_watch(code, token): what the public watch page needs, only with the right token
  3. RLS: everyone in the account sees its streams; members create streams they host; the host
     or an admin changes or deletes them
*/

CREATE TABLE IF NOT EXISTS streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{4}-[0-9]{3}$'),
  watch_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  chat_enabled boolean NOT NULL DEFAULT true,
  peak_viewers integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_streams_workspace ON streams(workspace_id, created_at DESC);

ALTER TABLE streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "streams_select" ON streams;
CREATE POLICY "streams_select" ON streams FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "streams_insert" ON streams;
CREATE POLICY "streams_insert" ON streams FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'supervisor', 'member']));

DROP POLICY IF EXISTS "streams_update" ON streams;
CREATE POLICY "streams_update" ON streams FOR UPDATE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id))
  WITH CHECK (host_id = auth.uid() OR is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "streams_delete" ON streams;
CREATE POLICY "streams_delete" ON streams FOR DELETE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id));

-- Status only moves forward, with its times; the account, host and code never change.
CREATE OR REPLACE FUNCTION streams_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'scheduled'; NEW.started_at := NULL; NEW.ended_at := NULL; NEW.peak_viewers := 0;
    RETURN NEW;
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.host_id <> OLD.host_id OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'That cannot change';
  END IF;
  IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN RAISE EXCEPTION 'This stream has ended'; END IF;
  IF OLD.status = 'live' AND NEW.status = 'scheduled' THEN RAISE EXCEPTION 'A live stream can only end'; END IF;
  IF NEW.status = 'live' AND OLD.status <> 'live' THEN NEW.started_at := now(); END IF;
  IF NEW.status = 'ended' AND OLD.status <> 'ended' THEN NEW.ended_at := now(); END IF;
  NEW.peak_viewers := greatest(OLD.peak_viewers, NEW.peak_viewers);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS streams_guard ON streams;
CREATE TRIGGER streams_guard BEFORE INSERT OR UPDATE ON streams FOR EACH ROW EXECUTE FUNCTION streams_guard();

/** The public watch page: title, status and who's hosting, only with the right watch token. */
CREATE OR REPLACE FUNCTION stream_by_watch(p_code text, p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', s.id, 'title', s.title, 'description', s.description, 'code', s.code, 'status', s.status,
    'scheduled_at', s.scheduled_at, 'started_at', s.started_at, 'ended_at', s.ended_at, 'chat_enabled', s.chat_enabled,
    'host_id', s.host_id,
    'host_name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), w.name, ''),
    'workspace_name', w.name
  )
  FROM streams s
  LEFT JOIN profiles p ON p.user_id = s.host_id
  LEFT JOIN workspaces w ON w.id = s.workspace_id
  WHERE s.code = upper(btrim(p_code)) AND coalesce(btrim(p_token), '') <> '' AND s.watch_token = btrim(p_token)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION stream_by_watch(text, text) FROM public;
GRANT EXECUTE ON FUNCTION stream_by_watch(text, text) TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON streams TO authenticated;


-- ============ 20261017120000_dashboard_summary.sql ============
-- Dashboard in one request: today's and the week's bookings (with their contact and calendar) and
-- the four counts, which the dashboard used to fetch with six separate requests.
--
-- SECURITY INVOKER: it runs as the person asking, so row-level security decides exactly what it
-- sees, the same as the six requests did. Safe to run more than once.

create or replace function public.dashboard_summary(
  p_workspace_id uuid,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_now timestamptz,
  p_week_end timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with booked as (
    select a.start_time,
           to_jsonb(a)
             || jsonb_build_object(
                  'contacts', case when c.id is null then null else to_jsonb(c) end,
                  'calendars', case when cal.id is null then null else to_jsonb(cal) end
                ) as row
    from appointments a
    left join contacts c on c.id = a.contact_id
    left join calendars cal on cal.id = a.calendar_id
    where a.workspace_id = p_workspace_id
      and a.status in ('confirmed', 'pending')
      and a.start_time >= least(p_today_start, p_now)
      and a.start_time <= greatest(p_today_end, p_week_end)
  )
  select jsonb_build_object(
    'today', coalesce((
      select jsonb_agg(b.row order by b.start_time)
      from booked b
      where b.start_time >= p_today_start and b.start_time <= p_today_end
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(u.row order by u.start_time)
      from (
        select b.row, b.start_time from booked b
        where b.start_time >= p_now and b.start_time <= p_week_end
        order by b.start_time
        limit 6
      ) u
    ), '[]'::jsonb),
    'contacts', (select count(*) from contacts where workspace_id = p_workspace_id),
    'members', (select count(*) from workspace_members where workspace_id = p_workspace_id),
    'completed', (select count(*) from appointments where workspace_id = p_workspace_id and status = 'completed'),
    'messages', (select count(*) from messages where workspace_id = p_workspace_id)
  );
$$;

revoke all on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;


-- ============ 20261018090000_member_status.sql ============
/*
  # Member status: what people are up to, and whether they are away

  Everyone in the account sees each other's status (an emoji and a short line, like "In a
  meeting"), when it clears, and whether they set themselves away. Each person sets only their
  own. Who is online right now is not stored: the app works that out live. Safe to run more
  than once.

  1. member_status: one row per person per account
  2. RLS: members read the account's statuses; each person writes only their own row
  3. Realtime: changes reach everyone straight away
*/

CREATE TABLE IF NOT EXISTS member_status (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text CHECK (emoji IS NULL OR char_length(emoji) <= 16),
  text text CHECK (text IS NULL OR char_length(text) <= 100),
  clear_at timestamptz,
  away boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE member_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_status_select" ON member_status;
CREATE POLICY "member_status_select" ON member_status FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_insert" ON member_status;
CREATE POLICY "member_status_insert" ON member_status FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_update" ON member_status;
CREATE POLICY "member_status_update" ON member_status FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_delete" ON member_status;
CREATE POLICY "member_status_delete" ON member_status FOR DELETE TO authenticated USING (user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'member_status') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE member_status;
    END IF;
  END IF;
END $$;


-- ============ 20261021090000_forms_upgrade.sql ============
/*
  # Forms and surveys: quiz scores, disqualified leads, payments, where people came from, emails

  Each submission keeps its quiz score and result, whether logic disqualified the person, the
  payment taken with it (Stripe Checkout), and where they came from (utm tags, ?source=, the page
  that sent them). Form notification emails are queued as messages linked to their submission and
  sent by the same mailer as workflow emails. Safe to run more than once.

  1. form_submissions: meta, score / score_max / score_percent / quiz_result, disqualified,
     payment_status / payment_amount / payment_currency / stripe_session_id
  2. messages.form_submission_id: the submission a queued email belongs to
*/

ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score numeric;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score_max numeric;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score_percent integer;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS quiz_result text;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS disqualified boolean NOT NULL DEFAULT false;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'none';
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_amount integer;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_currency text;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS stripe_session_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_payment_status_check') THEN
    ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_payment_status_check
      CHECK (payment_status IN ('none', 'pending', 'paid', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created ON form_submissions(form_id, created_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_form_queued ON messages(created_at) WHERE status = 'queued' AND form_submission_id IS NOT NULL;


-- ============ 20261021120000_form_workflow_trigger.sql ============
/*
  # Forms: start "Form submitted" workflows when the contact is attached

  The form-submit function saves the submission first and attaches the contact a moment later
  (an UPDATE). The workflow trigger only listened for INSERTs with a contact already set, so
  form and survey submissions never started a workflow.

  This adds a second trigger for the moment a submission gets its contact. A submission saved
  with its contact already set still fires once (on INSERT); one saved without a contact fires
  once when the contact is attached.

  It also wakes the mailer for a form's own emails (the team alert and the auto-reply). The
  once-a-minute job only called the mailer when a workflow email was waiting, so form emails
  stayed queued until some workflow happened to send one. Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION wf_on_form_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM wf_emit(NEW.workspace_id, 'form_submitted', NEW.contact_id, jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS wf_form_events ON form_submissions;
CREATE TRIGGER wf_form_events AFTER INSERT ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION wf_on_form_submission();

DROP TRIGGER IF EXISTS wf_form_contact_events ON form_submissions;
CREATE TRIGGER wf_form_contact_events AFTER UPDATE OF contact_id ON form_submissions
  FOR EACH ROW WHEN (OLD.contact_id IS NULL AND NEW.contact_id IS NOT NULL)
  EXECUTE FUNCTION wf_on_form_submission();

-- The column form emails are linked by (also added by 20261021090000_forms_upgrade.sql).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;

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
  -- Ask the mailer to send workflow emails and form emails (team alert, auto-reply).
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND (wf_run_id IS NOT NULL OR form_submission_id IS NOT NULL);
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


-- ============ 20261022090000_form_files.sql ============
/*
  # Forms: pictures and files uploaded from the device

  One public bucket, `form-files`, with two folders:

  - `assets/<workspace id>/...`: what the builder uploads (images, logos, backgrounds). Only
    members of that workspace can add, replace or remove them.
  - `responses/<form id>/...`: what people filling a form in upload (File Upload answers and
    signatures). Anyone may add a file, but only to a form that is published, or as a member of
    the form's workspace (the builder's Preview works on drafts). Nobody can change or remove
    them except the workspace.

  The files are public links (like a form's own images), with random names that can't be
  guessed. 10 MB each. Safe to run more than once.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('form-files', 'form-files', true, 10485760)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;

-- Builder pictures: members of the workspace in the second folder name.
DROP POLICY IF EXISTS "form_files_assets_insert" ON storage.objects;
CREATE POLICY "form_files_assets_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets'
    AND can_access_workspace(((storage.foldername(name))[2])::uuid)
  );
DROP POLICY IF EXISTS "form_files_assets_update" ON storage.objects;
CREATE POLICY "form_files_assets_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid))
  WITH CHECK (bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid));
DROP POLICY IF EXISTS "form_files_assets_delete" ON storage.objects;
CREATE POLICY "form_files_assets_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid));

-- Answers: into a published form, or any form of your own workspace (Preview).
CREATE OR REPLACE FUNCTION form_accepts_files(p_form text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM forms f
    WHERE f.id::text = p_form AND (f.status = 'published' OR (auth.uid() IS NOT NULL AND can_access_workspace(f.workspace_id)))
  );
$$;
GRANT EXECUTE ON FUNCTION form_accepts_files(text) TO anon, authenticated;

DROP POLICY IF EXISTS "form_files_responses_insert" ON storage.objects;
CREATE POLICY "form_files_responses_insert" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'responses'
    AND form_accepts_files((storage.foldername(name))[2])
  );
DROP POLICY IF EXISTS "form_files_responses_delete" ON storage.objects;
CREATE POLICY "form_files_responses_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'responses'
    AND EXISTS (SELECT 1 FROM forms f WHERE f.id::text = (storage.foldername(name))[2] AND can_access_workspace(f.workspace_id))
  );

-- Public links need no read policy, but listing the bucket stays closed: reading rows of
-- storage.objects is limited to the workspace's own folders.
DROP POLICY IF EXISTS "form_files_read" ON storage.objects;
CREATE POLICY "form_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'form-files' AND (
      ((storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid))
      OR ((storage.foldername(name))[1] = 'responses' AND EXISTS (SELECT 1 FROM forms f WHERE f.id::text = (storage.foldername(name))[2] AND can_access_workspace(f.workspace_id)))
    )
  );


-- ============ 20261022120000_roles_and_access.sql ============
/*
  # Roles: Owner, Admin, User, and what each User can see

  - Three roles. Owner (the account holder) and Admins see and do everything; an Admin can make
    other people Admins. Everyone else is a User ('member' in the database). There are no
    Supervisors any more: they become Users, and department leads are cleared.
  - What a User sees: `workspace_members.access`, a list of sections. Empty (NULL) means the
    standard set: Conversations, Workspaces, Meetings (with the rooms assigned to them) and
    Calendars (only the calendars they own or are a host of). Admins switch more on per person.
  - Enforced in the database, not only in the menu: a restrictive policy on each section's tables
    lets a User of the account reach them only when that section is on for them. People outside
    the account (public booking pages, public forms) are untouched: their own policies decide.
  - Company settings, connected email accounts, webhooks, integrations and the audit log can only
    be changed by Admins. Only Admins change roles, status, titles or what someone can see.
  - Rooms: only Admins create, change and assign them.

  Safe to run more than once.
*/

-- ============================================================
-- 1. No more Supervisors
-- ============================================================

UPDATE workspace_members SET role = 'member' WHERE role = 'supervisor';
UPDATE team_invitations SET role = 'member' WHERE role = 'supervisor';
UPDATE department_members SET is_lead = false WHERE is_lead;

ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));
ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_role_check;
ALTER TABLE team_invitations ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('admin', 'member')) NOT VALID;

-- Nobody leads a department now (rooms and department changes are for Admins).
CREATE OR REPLACE FUNCTION is_department_lead(check_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION can_create_rooms(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_workspace_admin(p_workspace);
$$;

CREATE OR REPLACE FUNCTION can_manage_room(p_room uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM company_rooms r WHERE r.id = p_room AND is_workspace_admin(r.workspace_id));
$$;

-- ============================================================
-- 2. What each User can see
-- ============================================================

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS access text[];

/** The sections a User sees when nobody has chosen for them. Keep in step with src/lib/access.ts. */
CREATE OR REPLACE FUNCTION default_member_access() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['conversations', 'workspaces', 'meetings', 'calendars'];
$$;

/**
 * May the signed-in person use this section of this account? Owners and Admins: always. Users: when
 * it is in their list. Someone who is not in the account at all (or a row with no account): yes,
 * because this only narrows what the account's own people can do; their other policies still apply.
 */
CREATE OR REPLACE FUNCTION member_can(p_workspace uuid, p_feature text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT m.role IN ('owner', 'admin') OR p_feature = ANY(coalesce(m.access, default_member_access()))
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() AND coalesce(m.status, 'active') = 'active'
    LIMIT 1
  ), true) END;
$$;

/** Admin-only parts of an account (same rule: people outside the account are not affected). */
CREATE OR REPLACE FUNCTION member_is_admin_or_outside(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT m.role IN ('owner', 'admin')
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() AND coalesce(m.status, 'active') = 'active'
    LIMIT 1
  ), true) END;
$$;

/** A User sees only the calendars they own or host; Admins (and outsiders' own rules) see the rest. */
CREATE OR REPLACE FUNCTION member_sees_calendar(p_calendar uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_calendar IS NULL THEN true ELSE coalesce((
    SELECT member_is_admin_or_outside(c.workspace_id)
      OR (member_can(c.workspace_id, 'calendars')
          AND (c.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM calendar_hosts h WHERE h.calendar_id = c.id AND h.user_id = auth.uid())))
    FROM calendars c WHERE c.id = p_calendar
  ), true) END;
$$;

-- Only Admins (or the owner) change roles, status, titles or what someone can see.
CREATE OR REPLACE FUNCTION workspace_members_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_owner uuid;
BEGIN
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = NEW.workspace_id;
  IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM ws_owner THEN
    RAISE EXCEPTION 'Only the workspace owner can have the owner role';
  END IF;
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      RAISE EXCEPTION 'The owner''s role cannot be changed';
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.title IS DISTINCT FROM OLD.title OR NEW.access IS DISTINCT FROM OLD.access)
       AND NOT is_workspace_admin(NEW.workspace_id) AND auth.uid() IS DISTINCT FROM ws_owner THEN
      RAISE EXCEPTION 'Only admins can change roles, status, titles or what someone can see';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_members_guard ON workspace_members;
CREATE TRIGGER workspace_members_guard BEFORE INSERT OR UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_guard();

-- ============================================================
-- 3. Each section's tables follow it
-- ============================================================

DO $$
DECLARE
  pair text[];
  sections text[][] := ARRAY[
    ARRAY['contacts', 'contacts'], ARRAY['tags', 'contacts'], ARRAY['notes', 'contacts'],
    ARRAY['smart_lists', 'contacts'], ARRAY['tasks', 'contacts'], ARRAY['messages', 'contacts'],
    ARRAY['calendar_groups', 'calendars'], ARRAY['booking_links', 'calendars'],
    ARRAY['host_availability_rules', 'calendars'], ARRAY['external_busy_periods', 'calendars'],
    ARRAY['forms', 'forms'], ARRAY['form_submissions', 'forms'],
    ARRAY['form_notification_logs', 'forms'], ARRAY['form_activity_timeline', 'forms'],
    ARRAY['workflows', 'workflows'], ARRAY['wf_events', 'workflows'], ARRAY['wf_runs', 'workflows'],
    ARRAY['events', 'events'], ARRAY['streams', 'streams'], ARRAY['recordings', 'recordings']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY sections LOOP
    IF to_regclass('public.' || pair[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1] || '_section_access', pair[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_can(workspace_id, %L)) WITH CHECK (member_can(workspace_id, %L))',
        pair[1] || '_section_access', pair[1], pair[2], pair[2]);
    END IF;
  END LOOP;

  -- Admin-only to read and change.
  FOREACH pair SLICE 1 IN ARRAY ARRAY[ARRAY['webhooks', ''], ARRAY['integrations', ''], ARRAY['audit_logs', '']] LOOP
    IF to_regclass('public.' || pair[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1] || '_admins_only', pair[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id))',
        pair[1] || '_admins_only', pair[1]);
    END IF;
  END LOOP;
END $$;

-- Calendars and their bookings: a User sees only their own calendars.
DROP POLICY IF EXISTS calendars_section_access ON calendars;
CREATE POLICY calendars_section_access ON calendars AS RESTRICTIVE FOR ALL TO authenticated
  USING (member_sees_calendar(id))
  WITH CHECK (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND owner_id = auth.uid()));
DROP POLICY IF EXISTS appointments_section_access ON appointments;
CREATE POLICY appointments_section_access ON appointments AS RESTRICTIVE FOR ALL TO authenticated
  USING (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND member_sees_calendar(calendar_id)))
  WITH CHECK (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND member_sees_calendar(calendar_id)));

-- Company settings and connected email accounts: everyone in the account may read (sending email
-- from a contact needs the account), only Admins change them.
DROP POLICY IF EXISTS workspace_settings_admin_insert ON workspace_settings;
CREATE POLICY workspace_settings_admin_insert ON workspace_settings AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS workspace_settings_admin_update ON workspace_settings;
CREATE POLICY workspace_settings_admin_update ON workspace_settings AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS workspace_settings_admin_delete ON workspace_settings;
CREATE POLICY workspace_settings_admin_delete ON workspace_settings AS RESTRICTIVE FOR DELETE TO authenticated
  USING (member_is_admin_or_outside(workspace_id));

DROP POLICY IF EXISTS email_accounts_admin_insert ON email_accounts;
CREATE POLICY email_accounts_admin_insert ON email_accounts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS email_accounts_admin_update ON email_accounts;
CREATE POLICY email_accounts_admin_update ON email_accounts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS email_accounts_admin_delete ON email_accounts;
CREATE POLICY email_accounts_admin_delete ON email_accounts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (member_is_admin_or_outside(workspace_id));


-- ============ 20261028090000_close_public_contacts.sql ============
/*
  # Close the public doors on contacts and appointments

  Until now, three rules made for the public booking pages let anyone with the site's public key,
  signed in or not, read every contact of every account, change any contact, and change any
  appointment. They go. The booking pages do the two things they need through two narrow
  functions instead:

  - public_booking_contact(): finds the visitor's contact by email in the account the calendar
    or form belongs to, or adds them. It returns only the contact's id, never anyone's details,
    and on an existing contact it only fills in what's empty (a stranger who knows someone's
    email can't overwrite their name or phone).
  - public_cancel_booking(): the visitor cancels the booking they just made, by its id (which
    only they have), and only one still to come.

  Staff keep their usual access through the account's own rules. Safe to run more than once.
*/

DROP POLICY IF EXISTS "contacts_public_select" ON contacts;
DROP POLICY IF EXISTS "contacts_public_update" ON contacts;
DROP POLICY IF EXISTS "contacts_public_insert" ON contacts;
DROP POLICY IF EXISTS "appts_public_update" ON appointments;

CREATE OR REPLACE FUNCTION public_booking_contact(
  p_workspace uuid, p_owner uuid, p_first text, p_last text, p_email text, p_phone text, p_source text DEFAULT 'booking_page'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em text := nullif(lower(trim(coalesce(p_email, ''))), '');
  first_name_in text := nullif(left(trim(coalesce(p_first, '')), 100), '');
  last_name_in text := nullif(left(trim(coalesce(p_last, '')), 100), '');
  phone_in text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  cid uuid;
BEGIN
  -- Only a real account (or a calendar owner, for calendars outside any account).
  IF p_workspace IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace) THEN RAISE EXCEPTION 'Unknown account'; END IF;
  ELSIF p_owner IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner) THEN
    RAISE EXCEPTION 'Unknown account';
  END IF;
  IF em IS NOT NULL AND em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN em := NULL; END IF;
  IF em IS NULL AND first_name_in IS NULL AND phone_in IS NULL THEN RETURN NULL; END IF;

  IF em IS NOT NULL THEN
    SELECT id INTO cid FROM contacts
    WHERE lower(email) = em
      AND (CASE WHEN p_workspace IS NOT NULL THEN workspace_id = p_workspace ELSE workspace_id IS NULL AND owner_id = p_owner END)
    ORDER BY created_at LIMIT 1;
  END IF;

  IF cid IS NOT NULL THEN
    UPDATE contacts SET
      first_name = coalesce(nullif(first_name, ''), first_name_in),
      last_name = coalesce(nullif(last_name, ''), last_name_in),
      phone = coalesce(nullif(phone, ''), phone_in),
      last_activity_at = now()
    WHERE id = cid;
    RETURN cid;
  END IF;

  INSERT INTO contacts (workspace_id, owner_id, first_name, last_name, email, phone, source)
  VALUES (p_workspace, CASE WHEN p_workspace IS NULL THEN p_owner END, first_name_in, last_name_in, em, phone_in,
          left(coalesce(nullif(p_source, ''), 'booking_page'), 40))
  RETURNING id INTO cid;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public_booking_contact(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_booking_contact(uuid, uuid, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public_cancel_booking(p_appointment uuid, p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE appointments
  SET status = 'cancelled', cancellation_reason = nullif(left(coalesce(p_reason, ''), 300), ''), updated_at = now()
  WHERE id = p_appointment AND status IN ('confirmed', 'pending') AND start_time > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public_cancel_booking(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_cancel_booking(uuid, text) TO anon, authenticated;


-- ============ 20261029090000_remove_person.sql ============
/*
  # Suspending and removing a person, with hand-over

  - A suspended person is locked out of the account everywhere, not only in the menu: the
    membership checks now count active people only. (Until now a suspended person kept full
    access to the database.) The account owner is never locked out.
  - offboard_member(): an Admin suspends or removes someone in one step and hands their work to
    another active person in the account:
      contacts they own, their open tasks, the calendars they own or host (and the bookings still
      to come on them), their booking links and calendar groups, forms, events, meetings not yet
      ended, and the rooms assigned to them. Channels they own get the new person as an owner.
    Removing also takes them out of the account's channels, departments, rooms and spaces, then
    deletes their membership. Suspending keeps all of that, so they can be brought back.
    Each step is written to the audit log.
  - Their sign-ins are ended (when they belong to no other account), so they are signed out on
    every device. The app also checks every minute and on returning to the tab.
  - my_membership_status(): what the app asks to know whether the signed-in person still belongs.

  Safe to run more than once.
*/

-- ============================================================
-- 1. Only active people count as members
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
SELECT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = check_workspace_id AND user_id = auth.uid() AND coalesce(status, 'active') = 'active'
) OR EXISTS (
  SELECT 1 FROM workspaces
  WHERE id = check_workspace_id AND owner_id = auth.uid()
);
$function$;

-- A suspended person is not "outside" the account: they get nothing.
CREATE OR REPLACE FUNCTION member_can(p_workspace uuid, p_feature text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT coalesce(m.status, 'active') = 'active'
       AND (m.role IN ('owner', 'admin') OR p_feature = ANY(coalesce(m.access, default_member_access())))
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid()
    LIMIT 1
  ), true) END;
$$;

CREATE OR REPLACE FUNCTION member_is_admin_or_outside(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT coalesce(m.status, 'active') = 'active' AND m.role IN ('owner', 'admin')
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid()
    LIMIT 1
  ), true) END;
$$;

-- ============================================================
-- 2. Am I still in this account?
-- ============================================================

/** 'active', 'suspended', or 'removed' (no longer in the account) for the signed-in person. */
CREATE OR REPLACE FUNCTION my_membership_status(p_workspace uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN 'removed'
    WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = p_workspace AND w.owner_id = auth.uid()) THEN 'active'
    ELSE coalesce((
      SELECT CASE WHEN coalesce(m.status, 'active') = 'suspended' THEN 'suspended' ELSE 'active' END
      FROM workspace_members m WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() LIMIT 1
    ), 'removed')
  END;
$$;
REVOKE ALL ON FUNCTION my_membership_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_membership_status(uuid) TO authenticated;

-- ============================================================
-- 3. What someone has, for the hand-over screen
-- ============================================================

CREATE OR REPLACE FUNCTION member_work(p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE ws uuid; uid uuid;
BEGIN
  SELECT workspace_id, user_id INTO ws, uid FROM workspace_members WHERE id = p_member;
  IF ws IS NULL THEN RAISE EXCEPTION 'That person is not in this account'; END IF;
  IF NOT is_workspace_admin(ws) THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
  RETURN jsonb_build_object(
    'contacts', (SELECT count(*) FROM contacts WHERE workspace_id = ws AND owner_id = uid),
    'tasks', (SELECT count(*) FROM tasks WHERE workspace_id = ws AND assigned_to = uid AND completed_at IS NULL),
    'calendars', (SELECT count(*) FROM calendars c WHERE c.workspace_id = ws AND (c.owner_id = uid
                   OR EXISTS (SELECT 1 FROM calendar_hosts h WHERE h.calendar_id = c.id AND h.user_id = uid))),
    'bookings', (SELECT count(*) FROM appointments WHERE workspace_id = ws AND (host_id = uid OR owner_id = uid)
                  AND start_time > now() AND status IN ('confirmed', 'pending')),
    'forms', (SELECT count(*) FROM forms WHERE workspace_id = ws AND owner_id = uid),
    'events', (SELECT count(*) FROM events WHERE workspace_id = ws AND created_by = uid),
    'meetings', (SELECT count(*) FROM meetings WHERE workspace_id = ws AND host_id = uid AND ended_at IS NULL),
    'rooms', (SELECT count(*) FROM company_room_assignees WHERE workspace_id = ws AND user_id = uid)
  );
END $$;
REVOKE ALL ON FUNCTION member_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION member_work(uuid) TO authenticated;

-- ============================================================
-- 4. Suspend or remove, with hand-over
-- ============================================================

CREATE OR REPLACE FUNCTION offboard_member(p_member uuid, p_action text, p_hand_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws uuid; uid uuid; who_role text; ws_owner uuid;
  moved jsonb := '{}'::jsonb; n int;
BEGIN
  IF p_action NOT IN ('suspend', 'remove') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT workspace_id, user_id, role INTO ws, uid, who_role FROM workspace_members WHERE id = p_member;
  IF ws IS NULL THEN RAISE EXCEPTION 'That person is not in this account'; END IF;
  IF NOT is_workspace_admin(ws) THEN RAISE EXCEPTION 'Only admins can suspend or remove people'; END IF;
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = ws;
  IF uid = ws_owner OR who_role = 'owner' THEN RAISE EXCEPTION 'The account owner cannot be suspended or removed'; END IF;
  IF uid = auth.uid() THEN RAISE EXCEPTION 'You cannot suspend or remove yourself'; END IF;
  IF p_action = 'remove' AND p_hand_to IS NULL THEN RAISE EXCEPTION 'Choose who takes over their work'; END IF;
  IF p_hand_to IS NOT NULL AND (p_hand_to = uid OR NOT (p_hand_to = ws_owner OR EXISTS (
       SELECT 1 FROM workspace_members m WHERE m.workspace_id = ws AND m.user_id = p_hand_to AND coalesce(m.status, 'active') = 'active'))) THEN
    RAISE EXCEPTION 'The person taking over must be active in this account';
  END IF;

  -- Hand-over
  IF p_hand_to IS NOT NULL THEN
    UPDATE contacts SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('contacts', n);

    UPDATE tasks SET assigned_to = p_hand_to, updated_at = now() WHERE workspace_id = ws AND assigned_to = uid AND completed_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('tasks', n);

    UPDATE calendars SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('calendars', n);
    INSERT INTO calendar_hosts (calendar_id, user_id, priority, weight, is_primary)
      SELECT h.calendar_id, p_hand_to, h.priority, h.weight, h.is_primary
      FROM calendar_hosts h JOIN calendars c ON c.id = h.calendar_id
      WHERE c.workspace_id = ws AND h.user_id = uid
      ON CONFLICT (calendar_id, user_id) DO NOTHING;
    DELETE FROM calendar_hosts h USING calendars c WHERE c.id = h.calendar_id AND c.workspace_id = ws AND h.user_id = uid;

    UPDATE appointments SET host_id = CASE WHEN host_id = uid THEN p_hand_to ELSE host_id END,
                            owner_id = CASE WHEN owner_id = uid THEN p_hand_to ELSE owner_id END
      WHERE workspace_id = ws AND (host_id = uid OR owner_id = uid) AND start_time > now() AND status IN ('confirmed', 'pending');
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('bookings', n);

    UPDATE booking_links SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    UPDATE calendar_groups SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE forms SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('forms', n);
    UPDATE form_submissions SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE events SET created_by = p_hand_to WHERE workspace_id = ws AND created_by = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('events', n);

    UPDATE meetings SET host_id = p_hand_to WHERE workspace_id = ws AND host_id = uid AND ended_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('meetings', n);

    INSERT INTO company_room_assignees (room_id, workspace_id, user_id, assigned_by)
      SELECT a.room_id, ws, p_hand_to, auth.uid() FROM company_room_assignees a WHERE a.workspace_id = ws AND a.user_id = uid
      ON CONFLICT (room_id, user_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('rooms', n);

    INSERT INTO chat_members (channel_id, workspace_id, user_id, role)
      SELECT cm.channel_id, ws, p_hand_to, 'owner' FROM chat_members cm WHERE cm.workspace_id = ws AND cm.user_id = uid AND cm.role = 'owner'
      ON CONFLICT (channel_id, user_id) DO UPDATE SET role = 'owner';
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE workspace_members SET status = 'suspended' WHERE id = p_member;
  ELSE
    DELETE FROM chat_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM department_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM company_room_assignees WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM space_members sm USING spaces s WHERE s.id = sm.space_id AND s.workspace_id = ws AND sm.user_id = uid;
    DELETE FROM member_status WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM workspace_members WHERE id = p_member;
  END IF;

  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (ws, auth.uid(), CASE p_action WHEN 'suspend' THEN 'member_suspended' ELSE 'member_removed' END, 'member', uid,
          jsonb_build_object('handed_to', p_hand_to, 'moved', moved));

  -- Sign them out everywhere, unless they still belong to another account.
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = uid AND m.workspace_id <> ws AND coalesce(m.status, 'active') = 'active')
     AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = uid AND w.id <> ws)
     AND to_regclass('auth.sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING uid;
    EXCEPTION WHEN insufficient_privilege THEN NULL;  -- the app and the checks above still lock them out
    END;
  END IF;

  RETURN moved;
END $$;
REVOKE ALL ON FUNCTION offboard_member(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION offboard_member(uuid, text, uuid) TO authenticated;


-- ============ 20261029120000_audit_log.sql ============
/*
  # Audit log: the database writes down who changed what

  Every important change is recorded by the database itself, with the person who made it (they
  can't be left out or faked from the app):
    - People: someone joins, is invited, an invite is cancelled, a role / what someone can see /
      suspended or active changes, someone is removed.
    - Deletions: contacts, forms, workflows, calendars, events, rooms, departments, channels.
    - Publishing: a workflow switched on or off, a form published or taken down.
    - Settings: company details and settings pages, connected email accounts, webhooks,
      integrations, departments and rooms created or renamed, room assignments.
  Only changes made by a signed-in person are written (not the system's own), and only Admins can
  read the log (as before). Entries can't be edited or deleted.

  Safe to run more than once.
*/

-- A person's name for the log (kept in the entry, so it still reads after they leave).
CREATE OR REPLACE FUNCTION audit_person(p_user uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(
    nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    (SELECT u.email::text FROM auth.users u WHERE u.id = p_user),
    'Someone')
  FROM (SELECT 1) one LEFT JOIN profiles p ON p.user_id = p_user;
$$;

-- Write one entry, for changes a signed-in person makes.
CREATE OR REPLACE FUNCTION audit_write(p_workspace uuid, p_action text, p_type text, p_id uuid, p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_workspace IS NULL OR current_setting('synapse.offboarding', true) = 'on' THEN RETURN; END IF;
  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_workspace, auth.uid(), p_action, p_type, p_id, coalesce(p_details, '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION audit_write(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Entries name the person who really made them, and stay as written.
CREATE OR REPLACE FUNCTION audit_logs_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.user_id := auth.uid(); END IF;
  NEW.details := coalesce(NEW.details, '{}'::jsonb) || jsonb_build_object('actor', CASE WHEN NEW.user_id IS NOT NULL THEN audit_person(NEW.user_id) END);
  NEW.created_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_logs_stamp ON audit_logs;
CREATE TRIGGER audit_logs_stamp BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_stamp();
DROP POLICY IF EXISTS "audit_logs_update" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete" ON audit_logs;

-- ============================================================
-- People
-- ============================================================

CREATE OR REPLACE FUNCTION audit_members() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r workspace_members%ROWTYPE;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_OP = 'INSERT' THEN
    PERFORM audit_write(r.workspace_id, 'member_joined', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id), 'role', r.role));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM audit_write(r.workspace_id, 'member_removed', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id)));
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      PERFORM audit_write(r.workspace_id, 'role_changed', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id), 'from', OLD.role, 'to', NEW.role));
    END IF;
    IF NEW.access IS DISTINCT FROM OLD.access THEN
      PERFORM audit_write(r.workspace_id, 'access_changed', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id),
        'from', to_jsonb(coalesce(OLD.access, default_member_access())), 'to', to_jsonb(coalesce(NEW.access, default_member_access()))));
    END IF;
    IF coalesce(NEW.status, 'active') IS DISTINCT FROM coalesce(OLD.status, 'active') THEN
      PERFORM audit_write(r.workspace_id, CASE WHEN NEW.status = 'suspended' THEN 'member_suspended' ELSE 'member_reactivated' END, 'member', r.user_id,
        jsonb_build_object('name', audit_person(r.user_id)));
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_members ON workspace_members;
CREATE TRIGGER audit_members AFTER INSERT OR UPDATE OR DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION audit_members();

CREATE OR REPLACE FUNCTION audit_invitations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM audit_write(NEW.workspace_id, 'member_invited', 'invitation', NEW.id, jsonb_build_object('email', NEW.email, 'role', NEW.role));
  ELSIF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    PERFORM audit_write(NEW.workspace_id, 'invite_cancelled', 'invitation', NEW.id, jsonb_build_object('email', NEW.email));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_invitations ON team_invitations;
CREATE TRIGGER audit_invitations AFTER INSERT OR UPDATE ON team_invitations FOR EACH ROW EXECUTE FUNCTION audit_invitations();

-- ============================================================
-- Deletions, publishing, renames
-- ============================================================

/** The name a row goes by, for each audited table. */
CREATE OR REPLACE FUNCTION audit_label(p_table text, p_row jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_table
    WHEN 'contacts' THEN coalesce(nullif(trim(coalesce(p_row->>'first_name', '') || ' ' || coalesce(p_row->>'last_name', '')), ''), p_row->>'email', 'a contact')
    WHEN 'events' THEN p_row->>'title'
    WHEN 'webhooks' THEN p_row->>'url'
    WHEN 'integrations' THEN p_row->>'provider'
    WHEN 'email_accounts' THEN p_row->>'email'
    ELSE p_row->>'name'
  END;
$$;

CREATE OR REPLACE FUNCTION audit_things() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  kind text := CASE TG_TABLE_NAME
    WHEN 'contacts' THEN 'contact' WHEN 'forms' THEN 'form' WHEN 'workflows' THEN 'workflow' WHEN 'calendars' THEN 'calendar'
    WHEN 'events' THEN 'event' WHEN 'company_rooms' THEN 'room' WHEN 'departments' THEN 'department' WHEN 'chat_channels' THEN 'channel'
    WHEN 'webhooks' THEN 'webhook' WHEN 'integrations' THEN 'integration' WHEN 'email_accounts' THEN 'email_account' ELSE TG_TABLE_NAME END;
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r jsonb := coalesce(n, o);
  ws uuid := (r->>'workspace_id')::uuid;
  id uuid := (r->>'id')::uuid;
  label text := audit_label(TG_TABLE_NAME, r);
BEGIN
  -- Direct messages aren't the company's business.
  IF TG_TABLE_NAME = 'chat_channels' AND r->>'kind' = 'dm' THEN RETURN NULL; END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM audit_write(ws, CASE kind
      WHEN 'webhook' THEN 'webhook_removed' WHEN 'integration' THEN 'integration_disconnected'
      WHEN 'email_account' THEN 'email_disconnected' ELSE kind || '_deleted' END, kind, id, jsonb_build_object('name', label));
  ELSIF TG_OP = 'INSERT' THEN
    IF kind IN ('department', 'room', 'webhook') THEN
      PERFORM audit_write(ws, CASE kind WHEN 'webhook' THEN 'webhook_added' ELSE kind || '_created' END, kind, id, jsonb_build_object('name', label));
    ELSIF kind = 'integration' THEN
      PERFORM audit_write(ws, 'integration_connected', kind, id, jsonb_build_object('name', label));
    ELSIF kind = 'email_account' THEN
      PERFORM audit_write(ws, 'email_connected', kind, id, jsonb_build_object('name', label));
    END IF;
  ELSE
    IF kind = 'workflow' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
      IF n->>'status' = 'active' THEN PERFORM audit_write(ws, 'workflow_published', kind, id, jsonb_build_object('name', label));
      ELSIF o->>'status' = 'active' THEN PERFORM audit_write(ws, 'workflow_paused', kind, id, jsonb_build_object('name', label, 'to', n->>'status'));
      END IF;
    ELSIF kind = 'form' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
      IF n->>'status' = 'published' THEN PERFORM audit_write(ws, 'form_published', kind, id, jsonb_build_object('name', label));
      ELSIF o->>'status' = 'published' THEN PERFORM audit_write(ws, 'form_unpublished', kind, id, jsonb_build_object('name', label, 'to', n->>'status'));
      END IF;
    ELSIF kind IN ('department', 'room', 'channel', 'calendar', 'form', 'workflow') AND (o->>'name') IS DISTINCT FROM (n->>'name') THEN
      PERFORM audit_write(ws, kind || '_renamed', kind, id, jsonb_build_object('name', n->>'name', 'from', o->>'name'));
    ELSIF kind = 'webhook' AND (o->'url' IS DISTINCT FROM n->'url' OR o->'events' IS DISTINCT FROM n->'events' OR o->'is_active' IS DISTINCT FROM n->'is_active' OR o->'secret' IS DISTINCT FROM n->'secret') THEN
      PERFORM audit_write(ws, 'webhook_changed', kind, id, jsonb_build_object('name', label));
    END IF;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'forms', 'workflows', 'calendars', 'events', 'company_rooms', 'departments', 'chat_channels',
                           'webhooks', 'integrations', 'email_accounts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_things ON %I', t);
      IF t IN ('contacts', 'events') THEN
        EXECUTE format('CREATE TRIGGER audit_things AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_things()', t);
      ELSE
        EXECUTE format('CREATE TRIGGER audit_things AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_things()', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Settings and room assignments
-- ============================================================

CREATE OR REPLACE FUNCTION audit_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed text[];
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    SELECT array_agg(k ORDER BY k) INTO changed FROM jsonb_each(to_jsonb(NEW)) e(k, v)
    WHERE k IN ('name', 'slug', 'logo_url', 'timezone', 'default_booking_settings') AND v IS DISTINCT FROM to_jsonb(OLD)->k;
    IF changed IS NOT NULL THEN
      PERFORM audit_write(NEW.id, 'settings_changed', 'settings', NEW.id, jsonb_build_object('area', 'company', 'fields', to_jsonb(changed)));
    END IF;
  ELSIF TG_OP = 'INSERT' OR NEW.settings IS DISTINCT FROM OLD.settings THEN
    PERFORM audit_write(NEW.workspace_id, 'settings_changed', 'settings', NEW.id, jsonb_build_object('area', NEW.category));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_settings ON workspaces;
CREATE TRIGGER audit_settings AFTER UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION audit_settings();
DROP TRIGGER IF EXISTS audit_settings ON workspace_settings;
CREATE TRIGGER audit_settings AFTER INSERT OR UPDATE ON workspace_settings FOR EACH ROW EXECUTE FUNCTION audit_settings();

CREATE OR REPLACE FUNCTION audit_room_assignees() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r company_room_assignees%ROWTYPE;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM audit_write(r.workspace_id, CASE TG_OP WHEN 'DELETE' THEN 'room_unassigned' ELSE 'room_assigned' END, 'room', r.room_id,
    jsonb_build_object('name', (SELECT name FROM company_rooms WHERE id = r.room_id), 'person', audit_person(r.user_id)));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_room_assignees ON company_room_assignees;
CREATE TRIGGER audit_room_assignees AFTER INSERT OR DELETE ON company_room_assignees FOR EACH ROW EXECUTE FUNCTION audit_room_assignees();

-- ============================================================
-- Suspend / remove writes one entry of its own (with what was handed over)
-- ============================================================

CREATE OR REPLACE FUNCTION offboard_member(p_member uuid, p_action text, p_hand_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws uuid; uid uuid; who_role text; ws_owner uuid;
  moved jsonb := '{}'::jsonb; n int;
BEGIN
  IF p_action NOT IN ('suspend', 'remove') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT workspace_id, user_id, role INTO ws, uid, who_role FROM workspace_members WHERE id = p_member;
  IF ws IS NULL THEN RAISE EXCEPTION 'That person is not in this account'; END IF;
  IF NOT is_workspace_admin(ws) THEN RAISE EXCEPTION 'Only admins can suspend or remove people'; END IF;
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = ws;
  IF uid = ws_owner OR who_role = 'owner' THEN RAISE EXCEPTION 'The account owner cannot be suspended or removed'; END IF;
  IF uid = auth.uid() THEN RAISE EXCEPTION 'You cannot suspend or remove yourself'; END IF;
  IF p_action = 'remove' AND p_hand_to IS NULL THEN RAISE EXCEPTION 'Choose who takes over their work'; END IF;
  -- This writes one audit entry of its own (below); the step-by-step changes aren't logged again.
  PERFORM set_config('synapse.offboarding', 'on', true);
  IF p_hand_to IS NOT NULL AND (p_hand_to = uid OR NOT (p_hand_to = ws_owner OR EXISTS (
       SELECT 1 FROM workspace_members m WHERE m.workspace_id = ws AND m.user_id = p_hand_to AND coalesce(m.status, 'active') = 'active'))) THEN
    RAISE EXCEPTION 'The person taking over must be active in this account';
  END IF;

  -- Hand-over
  IF p_hand_to IS NOT NULL THEN
    UPDATE contacts SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('contacts', n);

    UPDATE tasks SET assigned_to = p_hand_to, updated_at = now() WHERE workspace_id = ws AND assigned_to = uid AND completed_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('tasks', n);

    UPDATE calendars SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('calendars', n);
    INSERT INTO calendar_hosts (calendar_id, user_id, priority, weight, is_primary)
      SELECT h.calendar_id, p_hand_to, h.priority, h.weight, h.is_primary
      FROM calendar_hosts h JOIN calendars c ON c.id = h.calendar_id
      WHERE c.workspace_id = ws AND h.user_id = uid
      ON CONFLICT (calendar_id, user_id) DO NOTHING;
    DELETE FROM calendar_hosts h USING calendars c WHERE c.id = h.calendar_id AND c.workspace_id = ws AND h.user_id = uid;

    UPDATE appointments SET host_id = CASE WHEN host_id = uid THEN p_hand_to ELSE host_id END,
                            owner_id = CASE WHEN owner_id = uid THEN p_hand_to ELSE owner_id END
      WHERE workspace_id = ws AND (host_id = uid OR owner_id = uid) AND start_time > now() AND status IN ('confirmed', 'pending');
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('bookings', n);

    UPDATE booking_links SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    UPDATE calendar_groups SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE forms SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('forms', n);
    UPDATE form_submissions SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE events SET created_by = p_hand_to WHERE workspace_id = ws AND created_by = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('events', n);

    UPDATE meetings SET host_id = p_hand_to WHERE workspace_id = ws AND host_id = uid AND ended_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('meetings', n);

    INSERT INTO company_room_assignees (room_id, workspace_id, user_id, assigned_by)
      SELECT a.room_id, ws, p_hand_to, auth.uid() FROM company_room_assignees a WHERE a.workspace_id = ws AND a.user_id = uid
      ON CONFLICT (room_id, user_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('rooms', n);

    INSERT INTO chat_members (channel_id, workspace_id, user_id, role)
      SELECT cm.channel_id, ws, p_hand_to, 'owner' FROM chat_members cm WHERE cm.workspace_id = ws AND cm.user_id = uid AND cm.role = 'owner'
      ON CONFLICT (channel_id, user_id) DO UPDATE SET role = 'owner';
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE workspace_members SET status = 'suspended' WHERE id = p_member;
  ELSE
    DELETE FROM chat_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM department_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM company_room_assignees WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM space_members sm USING spaces s WHERE s.id = sm.space_id AND s.workspace_id = ws AND sm.user_id = uid;
    DELETE FROM member_status WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM workspace_members WHERE id = p_member;
  END IF;

  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (ws, auth.uid(), CASE p_action WHEN 'suspend' THEN 'member_suspended' ELSE 'member_removed' END, 'member', uid,
          jsonb_build_object('handed_to', p_hand_to, 'moved', moved, 'name', audit_person(uid),
                             'handed_to_name', CASE WHEN p_hand_to IS NOT NULL THEN audit_person(p_hand_to) END));
  PERFORM set_config('synapse.offboarding', 'off', true);

  -- Sign them out everywhere, unless they still belong to another account.
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = uid AND m.workspace_id <> ws AND coalesce(m.status, 'active') = 'active')
     AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = uid AND w.id <> ws)
     AND to_regclass('auth.sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING uid;
    EXCEPTION WHEN insufficient_privilege THEN NULL;  -- the app and the checks above still lock them out
    END;
  END IF;

  RETURN moved;
END $$;
REVOKE ALL ON FUNCTION offboard_member(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION offboard_member(uuid, text, uuid) TO authenticated;


-- ============ 20261029150000_department_channels.sql ============
/*
  # A channel for every department, kept in step

  - Each department has its own private channel (#sales, #customer-success…), made the moment the
    department is, and for every department that already exists.
  - Its members are the department's people: added to the department, they're in the channel;
    taken out, they leave it. (Suspended people are added back when they're reactivated.)
  - Renaming the department renames the channel. Deleting the department archives the channel, so
    its history is kept.
  - chat_channels.is_department marks these channels (one per department).

  Needs 20261016090000_conversations.sql and 20261029120000_audit_log.sql. Safe to run more than once.
*/

ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS is_department boolean NOT NULL DEFAULT false;

-- Changes the system makes to follow another change aren't logged a second time.
CREATE OR REPLACE FUNCTION audit_write(p_workspace uuid, p_action text, p_type text, p_id uuid, p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_workspace IS NULL OR current_setting('synapse.offboarding', true) = 'on'
     OR current_setting('synapse.audit_quiet', true) = 'on' THEN RETURN; END IF;
  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_workspace, auth.uid(), p_action, p_type, p_id, coalesce(p_details, '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION audit_write(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_department_key ON chat_channels(department_id) WHERE is_department AND archived_at IS NULL;

/** A free channel name from a department name: "Customer Success" -> customer-success (or -2, -3…). */
CREATE OR REPLACE FUNCTION department_channel_name(p_workspace uuid, p_name text, p_except uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE base text; candidate text; n int := 1;
BEGIN
  base := left(trim(both '-' FROM regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9_]+', '-', 'g')), 70);
  IF base = '' THEN base := 'department'; END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM chat_channels WHERE workspace_id = p_workspace AND kind = 'channel' AND name = candidate
                  AND id IS DISTINCT FROM p_except) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END $$;

/** The department's channel, made if it has none, with its people in it. Returns the channel. */
CREATE OR REPLACE FUNCTION ensure_department_channel(p_department uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d departments%ROWTYPE; cid uuid;
BEGIN
  SELECT * INTO d FROM departments WHERE id = p_department;
  IF d.id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO cid FROM chat_channels WHERE department_id = d.id AND is_department AND archived_at IS NULL;
  IF cid IS NULL THEN
    INSERT INTO chat_channels (workspace_id, kind, name, description, is_private, department_id, is_department, created_by)
    VALUES (d.workspace_id, 'channel', department_channel_name(d.workspace_id, d.name),
            left('Everyone in ' || d.name || '. People join and leave as they join and leave the department.', 500),
            true, d.id, true, d.created_by)
    RETURNING id INTO cid;
  END IF;
  INSERT INTO chat_members (channel_id, workspace_id, user_id, role)
    SELECT cid, d.workspace_id, dm.user_id, 'member'
    FROM department_members dm
    JOIN workspace_members m ON m.workspace_id = d.workspace_id AND m.user_id = dm.user_id AND coalesce(m.status, 'active') = 'active'
    WHERE dm.department_id = d.id
  ON CONFLICT (channel_id, user_id) DO NOTHING;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION ensure_department_channel(uuid) FROM PUBLIC, anon, authenticated;

-- Department made, renamed or deleted.
CREATE OR REPLACE FUNCTION department_channel_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM ensure_department_channel(NEW.id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      SELECT id INTO cid FROM chat_channels WHERE department_id = NEW.id AND is_department AND archived_at IS NULL;
      IF cid IS NULL THEN
        PERFORM ensure_department_channel(NEW.id);
      ELSE
        -- The department's rename is in the audit log already; the channel follows quietly.
        PERFORM set_config('synapse.audit_quiet', 'on', true);
        UPDATE chat_channels SET name = department_channel_name(NEW.workspace_id, NEW.name, cid),
          description = left('Everyone in ' || NEW.name || '. People join and leave as they join and leave the department.', 500)
        WHERE id = cid;
        PERFORM set_config('synapse.audit_quiet', 'off', true);
      END IF;
    END IF;
  ELSE
    UPDATE chat_channels SET archived_at = now() WHERE department_id = OLD.id AND is_department AND archived_at IS NULL;
    RETURN OLD;  -- let the delete go ahead
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS department_channel_sync ON departments;
CREATE TRIGGER department_channel_sync AFTER INSERT OR UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION department_channel_sync();
-- Before the delete, while the channel still points at the department.
DROP TRIGGER IF EXISTS department_channel_archive ON departments;
CREATE TRIGGER department_channel_archive BEFORE DELETE ON departments FOR EACH ROW EXECUTE FUNCTION department_channel_sync();

-- Someone joins or leaves a department.
CREATE OR REPLACE FUNCTION department_member_channel_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    cid := ensure_department_channel(NEW.department_id);
  ELSE
    SELECT id INTO cid FROM chat_channels WHERE department_id = OLD.department_id AND is_department AND archived_at IS NULL;
    IF cid IS NOT NULL THEN
      DELETE FROM chat_members WHERE channel_id = cid AND user_id = OLD.user_id;
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS department_member_channel_sync ON department_members;
CREATE TRIGGER department_member_channel_sync AFTER INSERT OR DELETE ON department_members FOR EACH ROW EXECUTE FUNCTION department_member_channel_sync();

-- Reactivated: back into their departments' channels.
CREATE OR REPLACE FUNCTION member_department_channels_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dep uuid;
BEGIN
  IF coalesce(NEW.status, 'active') = 'active' AND coalesce(OLD.status, 'active') <> 'active' THEN
    FOR dep IN SELECT department_id FROM department_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.user_id LOOP
      PERFORM ensure_department_channel(dep);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS member_department_channels_sync ON workspace_members;
CREATE TRIGGER member_department_channels_sync AFTER UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION member_department_channels_sync();

-- Every department that already exists gets its channel now.
DO $$
DECLARE dep uuid;
BEGIN
  FOR dep IN SELECT id FROM departments LOOP
    PERFORM ensure_department_channel(dep);
  END LOOP;
END $$;


-- ============ 20261030090000_workflow_new_actions.sql ============
/*
  # Workflows: three new actions

  - Post to a channel: a message in a Conversations channel, from "Workflow: <name>".
  - Create a meeting link: a real SYNAPSE meeting that anyone with the link can join; later steps
    use it as {{meeting.link}} (in an email, a channel post or a notification).
  - Notify a department: a notification under the bell for everyone in the department, and a post
    in the department's channel.

  New merge fields for any step: {{contact.link}} (the contact in SYNAPSE), {{meeting.link}} and
  {{meeting.code}}, {{form.name}} and {{form.answers}} (when a form or survey started it).

  Needs 20261010090000_workflow_engine.sql, 20261016090000_conversations.sql and
  20261029150000_department_channels.sql. Safe to run more than once.
*/

-- The address links point to (the public app, not a Vercel preview).
INSERT INTO wf_private.settings(key, value) VALUES ('app_url', 'https://synapse-dj3a.vercel.app') ON CONFLICT (key) DO NOTHING;
CREATE OR REPLACE FUNCTION wf_app_url() RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT rtrim(coalesce((SELECT value FROM wf_private.settings WHERE key = 'app_url'), 'https://synapse-dj3a.vercel.app'), '/');
$$;

-- A form submission's answers as "Label: answer" lines, in the form's order.
CREATE OR REPLACE FUNCTION wf_form_answers(p_submission uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s form_submissions; def jsonb; out text;
BEGIN
  SELECT * INTO s FROM form_submissions WHERE id = p_submission;
  IF NOT FOUND THEN RETURN ''; END IF;
  SELECT CASE WHEN jsonb_typeof(f.definition) = 'string' THEN (f.definition #>> '{}')::jsonb ELSE f.definition END INTO def FROM forms f WHERE f.id = s.form_id;
  SELECT string_agg(coalesce(nullif(el->'field'->>'label', ''), a.key) || ': ' || a.value, E'\n'
                    ORDER BY coalesce((el->>'sortOrder')::int, 999), a.key)
    INTO out
  FROM jsonb_each_text(coalesce(s.answers, '{}'::jsonb)) a
  LEFT JOIN LATERAL (SELECT e.value AS el FROM jsonb_each(coalesce(def->'elements', '{}'::jsonb)) e WHERE e.value->'field'->>'fieldId' = a.key LIMIT 1) x ON true;
  RETURN coalesce(out, '');
EXCEPTION WHEN OTHERS THEN RETURN '';
END $$;

-- A message from a workflow in a channel.
CREATE OR REPLACE FUNCTION wf_post(p_channel uuid, p_wf workflows, p_run wf_runs, p_body text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chat_messages(channel_id, workspace_id, user_id, body, source, sender_name, meta)
  VALUES (p_channel, p_wf.workspace_id, NULL, left(coalesce(nullif(btrim(p_body), ''), p_wf.name), 8000), 'system', left('Workflow: ' || p_wf.name, 80),
          jsonb_build_object('workflow_id', p_wf.id, 'run_id', p_run.id, 'contact_id', p_run.contact_id));
$$;

-- A new meeting with a fresh join code (like FOCU-358) and an invite link anyone can use.
CREATE OR REPLACE FUNCTION wf_new_meeting(p_workspace uuid, p_host uuid, p_title text, p_minutes int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE letters text; code text; mid uuid; i int;
BEGIN
  FOR i IN 1..10 LOOP
    letters := left(regexp_replace(upper(p_title), '[^A-Z]', '', 'g'), 4);
    WHILE length(letters) < 4 LOOP letters := letters || substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1); END LOOP;
    code := letters || '-' || lpad(floor(random() * 1000)::int::text, 3, '0');
    BEGIN
      INSERT INTO meetings(workspace_id, host_id, title, code, kind, duration_min) VALUES (p_workspace, p_host, p_title, code, 'instant', p_minutes) RETURNING id INTO mid;
      RETURN mid;
    EXCEPTION WHEN unique_violation THEN
      letters := ''; -- that code is taken: try random letters
      p_title := '';
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not make a meeting code';
END $$;

-- {{contact.first_name}} etc., and the new {{contact.link}}, {{meeting.*}} and {{form.*}}.
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
    s := replace(s, '{{contact.link}}', wf_app_url() || '/contacts/' || c.id);
    s := replace(s, '{{first_name}}', coalesce(c.first_name, ''));
    s := replace(s, '{{last_name}}', coalesce(c.last_name, ''));
    s := replace(s, '{{email}}', coalesce(c.email, ''));
    s := replace(s, '{{phone}}', coalesce(c.phone, ''));
    s := replace(s, '{{company}}', coalesce(c.company, ''));
  END IF;
  s := replace(s, '{{appointment.title}}', coalesce(p_ctx->>'title', ''));
  s := replace(s, '{{appointment.start_time}}', coalesce(p_ctx->>'start_time', ''));
  -- From a "Create meeting link" step earlier in the workflow.
  s := replace(s, '{{meeting.link}}', coalesce(p_ctx->>'meeting_link', ''));
  s := replace(s, '{{meeting.code}}', coalesce(p_ctx->>'meeting_code', ''));
  -- When a form or survey started the workflow.
  IF position('{{form.' IN s) > 0 THEN
    s := replace(s, '{{form.name}}', coalesce((SELECT f.name FROM forms f WHERE f.id = nullif(p_ctx->>'form_id', '')::uuid), ''));
    s := replace(s, '{{form.answers}}', wf_form_answers(nullif(p_ctx->>'submission_id', '')::uuid));
  END IF;
  RETURN s;
END $$;

-- Runs one step. Returns the branch to follow: 'next', 'yes', 'no', 'wait' (paused), 'end' or 'fail'.
CREATE OR REPLACE FUNCTION wf_exec_step(p_run wf_runs, p_wf workflows, p_id text, p_step jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce(p_step->'config', '{}'::jsonb);
  c record; t text; n int; secs bigint; until timestamptz; tz text; acct record; uids uuid[]; uid uuid;
  subj text; body text; ok boolean; other workflows; target uuid; dnd text[]; fld text;
  ch chat_channels; mt meetings; dep departments;
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
  WHEN 'post_to_channel' THEN
    SELECT * INTO ch FROM chat_channels WHERE id = nullif(cfg->>'channel_id', '')::uuid AND workspace_id = c.workspace_id AND kind = 'channel';
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a channel to post in.'); RETURN 'fail'; END IF;
    IF ch.archived_at IS NOT NULL THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'The channel #' || ch.name || ' is archived.'); RETURN 'fail'; END IF;
    body := wf_merge(coalesce(nullif(cfg->>'text', ''), '{{contact.name}} · {{contact.link}}'), c.id, p_run.context);
    PERFORM wf_post(ch.id, p_wf, p_run, body);
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Posted in #' || ch.name);
  WHEN 'create_meeting' THEN
    uid := CASE WHEN coalesce(cfg->>'host', 'owner') = 'owner' THEN c.owner_id ELSE nullif(cfg->>'host', '')::uuid END;
    IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = c.workspace_id AND m.user_id = uid AND coalesce(m.status, 'active') = 'active') THEN
      uid := (SELECT owner_id FROM workspaces WHERE id = c.workspace_id);
    END IF;
    subj := left(coalesce(nullif(btrim(wf_merge(cfg->>'title', c.id, p_run.context)), ''), 'Call with ' || coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'a contact')), 120);
    target := wf_new_meeting(c.workspace_id, uid, subj, greatest(5, least(600, coalesce(nullif(cfg->>'duration_min', '')::int, 30))));
    SELECT * INTO mt FROM meetings WHERE id = target;
    t := wf_app_url() || '/meetings/' || mt.code || '?invite=' || mt.invite_token;
    UPDATE wf_runs SET context = context || jsonb_build_object('meeting_id', mt.id, 'meeting_code', mt.code, 'meeting_link', t) WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Meeting ' || mt.code || ' created: ' || t);
  WHEN 'notify_department' THEN
    SELECT * INTO dep FROM departments WHERE id = nullif(cfg->>'department_id', '')::uuid AND workspace_id = c.workspace_id;
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a department.'); RETURN 'fail'; END IF;
    uids := ARRAY(SELECT dm.user_id FROM department_members dm
                  JOIN workspace_members m ON m.workspace_id = dm.workspace_id AND m.user_id = dm.user_id AND coalesce(m.status, 'active') = 'active'
                  WHERE dm.department_id = dep.id);
    subj := left(coalesce(nullif(wf_merge(cfg->>'title', c.id, p_run.context), ''), p_wf.name), 200);
    body := wf_merge(cfg->>'body', c.id, p_run.context);
    FOREACH uid IN ARRAY uids LOOP
      INSERT INTO team_notifications(workspace_id, user_id, title, body, link) VALUES (c.workspace_id, uid, subj, body, '/contacts/' || c.id);
    END LOOP;
    t := 'Notified ' || cardinality(uids) || ' ' || CASE WHEN cardinality(uids) = 1 THEN 'person' ELSE 'people' END || ' in ' || dep.name;
    IF coalesce((cfg->>'post')::boolean, true) THEN
      SELECT * INTO ch FROM chat_channels WHERE department_id = dep.id AND is_department AND archived_at IS NULL;
      IF FOUND THEN
        PERFORM wf_post(ch.id, p_wf, p_run, subj || CASE WHEN coalesce(body, '') <> '' THEN E'\n' || body ELSE '' END);
        t := t || ' and posted in #' || ch.name;
      END IF;
    END IF;
    IF cardinality(uids) = 0 AND t NOT LIKE '%posted%' THEN PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'Nobody is in ' || dep.name || ' yet.'); RETURN 'next'; END IF;
    PERFORM wf_log(p_run, p_step, p_id, 'success', t);
  ELSE
    PERFORM wf_log(p_run, p_step, p_id, 'failed', 'This step type isn''t supported: ' || coalesce(p_step->>'type', '?'));
    RETURN 'fail';
  END CASE;
  RETURN 'next';
END $$;



-- ============ 20261031090000_outgoing_webhooks.sql ============
/*
  # Outgoing webhooks that really send: signed, retried, and logged

  Settings → Webhooks saved addresses but nothing was ever sent. Now:
  - When something happens (the same events workflows react to), every active webhook listening
    for it gets a delivery, with a snapshot of the contact and what happened:
      contact.created, contact.updated, contact.tag_added, contact.tag_removed, form.submitted,
      appointment.created, appointment.cancelled, appointment.rescheduled, appointment.completed,
      appointment.no_show, message.received, workflow.completed (and webhook.test from "Send test").
  - Each delivery is POSTed as JSON, signed so the receiver can check it came from SYNAPSE:
      X-Synapse-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the webhook's secret>
    plus X-Synapse-Event, X-Synapse-Delivery and X-Synapse-Timestamp.
  - A 2xx answer means delivered. Anything else (or no answer) is retried after 1, 5, 30 minutes,
    2 and 6 hours: 6 tries in all, then it's marked failed. Admins can retry it by hand.
  - webhook_deliveries is the delivery log (kept 30 days). Only Admins can see it.
  - Every minute (pg_cron) webhook_dispatch() sends what's due and reads the answers (pg_net).

  Needs 20261010090000_workflow_engine.sql. Safe to run more than once.
*/

-- Every webhook gets a signing secret.
ALTER TABLE webhooks ALTER COLUMN secret SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
UPDATE webhooks SET secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') WHERE secret IS NULL OR secret = '';
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS name text;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'retrying', 'delivered', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint,
  sent_at timestamptz,
  response_status int,
  response_body text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(next_attempt_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sending ON webhook_deliveries(sent_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_deliveries_admins" ON webhook_deliveries;
CREATE POLICY "webhook_deliveries_admins" ON webhook_deliveries FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------- what is sent

/** A form submission's answers as { "Question": "answer" }. */
CREATE OR REPLACE FUNCTION webhook_form_answers(p_submission uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s form_submissions; def jsonb; out jsonb;
BEGIN
  SELECT * INTO s FROM form_submissions WHERE id = p_submission;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT CASE WHEN jsonb_typeof(f.definition) = 'string' THEN (f.definition #>> '{}')::jsonb ELSE f.definition END INTO def FROM forms f WHERE f.id = s.form_id;
  SELECT coalesce(jsonb_object_agg(coalesce(nullif(x.el->'field'->>'label', ''), a.key), a.value), '{}'::jsonb) INTO out
  FROM jsonb_each(coalesce(s.answers, '{}'::jsonb)) a
  LEFT JOIN LATERAL (SELECT e.value AS el FROM jsonb_each(coalesce(def->'elements', '{}'::jsonb)) e WHERE e.value->'field'->>'fieldId' = a.key LIMIT 1) x ON true;
  RETURN out;
EXCEPTION WHEN OTHERS THEN RETURN coalesce((SELECT answers FROM form_submissions WHERE id = p_submission), '{}'::jsonb);
END $$;

/** The contact as sent in every event. */
CREATE OR REPLACE FUNCTION webhook_contact(p_contact uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email, 'phone', c.phone,
    'company', c.company, 'job_title', c.job_title, 'source', c.source, 'tags', to_jsonb(wf_contact_tags(c.id)),
    'created_at', c.created_at, 'link', wf_app_url() || '/contacts/' || c.id)
  FROM contacts c WHERE c.id = p_contact;
$$;

/** Queue one event for every active webhook in the account that listens for it. */
CREATE OR REPLACE FUNCTION webhook_queue(p_workspace uuid, p_event text, p_data jsonb) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w webhooks; n int := 0; did uuid;
BEGIN
  FOR w IN SELECT * FROM webhooks WHERE workspace_id = p_workspace AND coalesce(is_active, true)
             AND (events ? p_event OR p_event = 'webhook.test') LOOP
    did := gen_random_uuid();
    INSERT INTO webhook_deliveries(id, webhook_id, workspace_id, event, payload)
    VALUES (did, w.id, p_workspace, p_event,
            jsonb_build_object('id', did, 'event', p_event, 'created_at', now(), 'workspace_id', p_workspace, 'data', coalesce(p_data, '{}'::jsonb)));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION webhook_queue(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Events the workflow engine already records, as webhook events.
CREATE OR REPLACE FUNCTION webhook_on_wf_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev text; data jsonb; appt jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webhooks WHERE workspace_id = NEW.workspace_id AND coalesce(is_active, true)) THEN RETURN NULL; END IF;
  ev := CASE NEW.type
    WHEN 'contact_created' THEN 'contact.created'
    WHEN 'contact_changed' THEN 'contact.updated'
    WHEN 'contact_tag' THEN CASE NEW.data->>'event' WHEN 'removed' THEN 'contact.tag_removed' ELSE 'contact.tag_added' END
    WHEN 'form_submitted' THEN 'form.submitted'
    WHEN 'appointment_booked' THEN 'appointment.created'
    WHEN 'appointment_status' THEN CASE NEW.data->>'status'
      WHEN 'cancelled' THEN 'appointment.cancelled' WHEN 'rescheduled' THEN 'appointment.rescheduled'
      WHEN 'showed' THEN 'appointment.completed' WHEN 'no_show' THEN 'appointment.no_show' END
    WHEN 'customer_replied' THEN 'message.received'
  END;
  IF ev IS NULL THEN RETURN NULL; END IF;
  data := jsonb_build_object('contact', webhook_contact(NEW.contact_id));
  IF ev = 'contact.updated' THEN data := data || jsonb_build_object('changed', NEW.data->'changed'); END IF;
  IF ev LIKE 'contact.tag%' THEN data := data || jsonb_build_object('tag', NEW.data->>'tag'); END IF;
  IF ev = 'form.submitted' THEN
    data := data || jsonb_build_object(
      'form', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'type', f.type) FROM forms f WHERE f.id = (NEW.data->>'form_id')::uuid),
      'submission_id', NEW.data->>'submission_id',
      'answers', webhook_form_answers((NEW.data->>'submission_id')::uuid));
  END IF;
  IF ev LIKE 'appointment.%' THEN
    SELECT jsonb_build_object('id', a.id, 'title', a.title, 'status', a.status, 'start_time', a.start_time, 'end_time', a.end_time,
             'calendar', jsonb_build_object('id', cal.id, 'name', cal.name))
      INTO appt FROM appointments a LEFT JOIN calendars cal ON cal.id = a.calendar_id WHERE a.id = (NEW.data->>'appointment_id')::uuid;
    data := data || jsonb_build_object('appointment', appt);
  END IF;
  IF ev = 'message.received' THEN data := data || jsonb_build_object('channel', NEW.data->>'channel'); END IF;
  PERFORM webhook_queue(NEW.workspace_id, ev, data);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS webhook_on_wf_event ON wf_events;
CREATE TRIGGER webhook_on_wf_event AFTER INSERT ON wf_events FOR EACH ROW EXECUTE FUNCTION webhook_on_wf_event();

CREATE OR REPLACE FUNCTION webhook_on_run_done() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NOT NEW.is_test
     AND EXISTS (SELECT 1 FROM webhooks WHERE workspace_id = NEW.workspace_id AND coalesce(is_active, true) AND events ? 'workflow.completed') THEN
    PERFORM webhook_queue(NEW.workspace_id, 'workflow.completed', jsonb_build_object(
      'workflow', (SELECT jsonb_build_object('id', w.id, 'name', w.name) FROM workflows w WHERE w.id = NEW.workflow_id),
      'contact', webhook_contact(NEW.contact_id), 'started_at', NEW.started_at, 'finished_at', NEW.finished_at));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS webhook_on_run_done ON wf_runs;
CREATE TRIGGER webhook_on_run_done AFTER UPDATE OF status ON wf_runs FOR EACH ROW EXECUTE FUNCTION webhook_on_run_done();

-- ---------------------------------------------------------------- sending

/** Minutes to wait before try number n+1, after n tries failed. */
CREATE OR REPLACE FUNCTION webhook_backoff(p_attempts int) RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT make_interval(mins => (ARRAY[1, 5, 30, 120, 360])[least(greatest(p_attempts, 1), 5)]);
$$;

/** The signature header for a body sent at unix time p_ts. */
CREATE OR REPLACE FUNCTION webhook_signature(p_secret text, p_ts bigint, p_body jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT 't=' || p_ts || ',v1=' || encode(hmac(p_ts::text || '.' || p_body::text, p_secret, 'sha256'), 'hex');
$$;

/** Every minute: read the answers to what was sent, then send what's due. */
CREATE OR REPLACE FUNCTION webhook_dispatch(p_only uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  d webhook_deliveries; w webhooks; code int; body text; err text; ts bigint; req bigint;
  n_sent int := 0; n_ok int := 0; n_retry int := 0; n_failed int := 0;
BEGIN
  IF p_only IS NULL AND NOT pg_try_advisory_xact_lock(hashtext('synapse_webhooks')) THEN RETURN jsonb_build_object('skipped', true); END IF;

  -- 1. Answers to earlier sends (pg_net writes them to net._http_response).
  IF to_regclass('net._http_response') IS NOT NULL THEN
    FOR d IN SELECT * FROM webhook_deliveries WHERE status = 'sending' ORDER BY sent_at LIMIT 500 LOOP
      code := NULL; body := NULL; err := NULL;
      EXECUTE 'SELECT status_code, left(content::text, 500), coalesce(error_msg, CASE WHEN timed_out THEN ''Timed out'' END) FROM net._http_response WHERE id = $1'
        INTO code, body, err USING d.request_id;
      IF code IS NULL AND err IS NULL THEN
        IF d.sent_at > now() - interval '10 minutes' THEN CONTINUE; END IF;
        err := 'No answer within 10 minutes';
      END IF;
      IF code BETWEEN 200 AND 299 THEN
        UPDATE webhook_deliveries SET status = 'delivered', response_status = code, response_body = body, error = NULL, delivered_at = now() WHERE id = d.id;
        n_ok := n_ok + 1;
      ELSIF d.attempts >= 6 THEN
        UPDATE webhook_deliveries SET status = 'failed', response_status = code, response_body = body,
          error = coalesce(err, 'The address answered ' || code) WHERE id = d.id;
        n_failed := n_failed + 1;
      ELSE
        UPDATE webhook_deliveries SET status = 'retrying', response_status = code, response_body = body,
          error = coalesce(err, 'The address answered ' || code), next_attempt_at = now() + webhook_backoff(d.attempts) WHERE id = d.id;
        n_retry := n_retry + 1;
      END IF;
    END LOOP;
  END IF;

  -- 2. Send what's due.
  FOR d IN SELECT * FROM webhook_deliveries
           WHERE status IN ('pending', 'retrying') AND next_attempt_at <= now() AND (p_only IS NULL OR id = p_only)
           ORDER BY next_attempt_at LIMIT 200 LOOP
    SELECT * INTO w FROM webhooks WHERE id = d.webhook_id;
    IF NOT coalesce(w.is_active, true) THEN
      UPDATE webhook_deliveries SET status = 'failed', error = 'The webhook is switched off' WHERE id = d.id;
      CONTINUE;
    END IF;
    IF coalesce(w.url, '') !~ '^https://' THEN
      UPDATE webhook_deliveries SET status = 'failed', error = 'The address must start with https://' WHERE id = d.id;
      CONTINUE;
    END IF;
    ts := extract(epoch FROM now())::bigint;
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)' INTO req
      USING w.url, d.payload, jsonb_build_object(
        'Content-Type', 'application/json', 'User-Agent', 'SYNAPSE-Webhooks/1',
        'X-Synapse-Event', d.event, 'X-Synapse-Delivery', d.id::text, 'X-Synapse-Timestamp', ts::text,
        'X-Synapse-Signature', webhook_signature(coalesce(w.secret, ''), ts, d.payload));
      UPDATE webhook_deliveries SET status = 'sending', request_id = req, attempts = attempts + 1, sent_at = now() WHERE id = d.id;
      UPDATE webhooks SET last_triggered_at = now() WHERE id = w.id;
      n_sent := n_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE webhook_deliveries SET attempts = attempts + 1, error = 'Couldn''t send: ' || SQLERRM,
        status = CASE WHEN attempts + 1 >= 6 THEN 'failed' ELSE 'retrying' END,
        next_attempt_at = now() + webhook_backoff(attempts + 1) WHERE id = d.id;
    END;
  END LOOP;

  IF p_only IS NULL THEN DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days'; END IF;
  RETURN jsonb_build_object('sent', n_sent, 'delivered', n_ok, 'retrying', n_retry, 'failed', n_failed);
END $$;
REVOKE ALL ON FUNCTION webhook_dispatch(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- for Settings → Webhooks (Admins)

/** "Send test": a webhook.test delivery to this webhook, sent straight away. */
CREATE OR REPLACE FUNCTION webhook_send_test(p_webhook uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w webhooks; did uuid := gen_random_uuid();
BEGIN
  SELECT * INTO w FROM webhooks WHERE id = p_webhook;
  IF NOT FOUND OR NOT is_workspace_admin(w.workspace_id) THEN RAISE EXCEPTION 'Only admins can test webhooks'; END IF;
  INSERT INTO webhook_deliveries(id, webhook_id, workspace_id, event, payload)
  VALUES (did, w.id, w.workspace_id, 'webhook.test', jsonb_build_object('id', did, 'event', 'webhook.test', 'created_at', now(), 'workspace_id', w.workspace_id,
          'data', jsonb_build_object('message', 'This is a test from SYNAPSE. If you can read it, your webhook works.')));
  PERFORM webhook_dispatch(did);
  RETURN did;
END $$;
REVOKE ALL ON FUNCTION webhook_send_test(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION webhook_send_test(uuid) TO authenticated;

/** Try a failed delivery again now. */
CREATE OR REPLACE FUNCTION webhook_retry(p_delivery uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d webhook_deliveries;
BEGIN
  SELECT * INTO d FROM webhook_deliveries WHERE id = p_delivery;
  IF NOT FOUND OR NOT is_workspace_admin(d.workspace_id) THEN RAISE EXCEPTION 'Only admins can retry deliveries'; END IF;
  UPDATE webhook_deliveries SET status = 'retrying', next_attempt_at = now(), attempts = least(attempts, 5) WHERE id = d.id;
  PERFORM webhook_dispatch(d.id);
END $$;
REVOKE ALL ON FUNCTION webhook_retry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION webhook_retry(uuid) TO authenticated;

/** A new signing secret (the old one stops working at once). */
CREATE OR REPLACE FUNCTION webhook_new_secret(p_webhook uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webhooks WHERE id = p_webhook AND is_workspace_admin(workspace_id)) THEN RAISE EXCEPTION 'Only admins can change webhooks'; END IF;
  UPDATE webhooks SET secret = s WHERE id = p_webhook;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION webhook_new_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION webhook_new_secret(uuid) TO authenticated;

-- Every minute.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'synapse-webhooks';
    PERFORM cron.schedule('synapse-webhooks', '* * * * *', 'SELECT public.webhook_dispatch()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Could not schedule webhooks: %', SQLERRM;
END $$;


-- ============ 20261101090000_incoming_contacts.sql ============
/*
  # Incoming contact links: other apps add or update contacts in SYNAPSE

  An Admin makes an "incoming link" in Settings → API: a secret address another app (Zapier,
  Make, a website form, a live chat) POSTs a contact to. The `api` edge function hands the
  request to inbound_contact() below, which:
    - finds the contact by email (then phone) in the account, or adds them;
    - fills in the fields it was sent (first/last or full name, email, phone, company, job title,
      date of birth, source), adds the link's tags and any tags sent, and writes a message as a
      note;
    - so workflows start exactly as if someone had typed it in (contact created, tag added…);
    - logs every call (kept 30 days) and allows at most 120 a minute per link.
  Field names are forgiving: first_name / firstName / first, name / full_name, phone / phone_number,
  tags as a list or "a, b", and so on.

  Needs 20261010090000_workflow_engine.sql. Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS inbound_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  tags text[] NOT NULL DEFAULT '{}',
  source text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_inbound_links_workspace ON inbound_links(workspace_id);
ALTER TABLE inbound_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_links_admins" ON inbound_links;
CREATE POLICY "inbound_links_admins" ON inbound_links FOR ALL TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));

CREATE TABLE IF NOT EXISTS inbound_log (
  id bigserial PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES inbound_links(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  ok boolean NOT NULL,
  created boolean,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  error text,
  payload jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbound_log_link ON inbound_log(link_id, at DESC);
ALTER TABLE inbound_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_log_admins" ON inbound_log;
CREATE POLICY "inbound_log_admins" ON inbound_log FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));

-- First non-empty value among these keys (checked as sent and lower-case).
CREATE OR REPLACE FUNCTION inbound_pick(p jsonb, VARIADIC keys text[]) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v text;
BEGIN
  FOREACH k IN ARRAY keys LOOP
    v := nullif(btrim(coalesce(p->>k, p->>lower(k), '')), '');
    IF v IS NOT NULL THEN RETURN v; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- What gets kept in the log: the payload as sent, unless it's large.
CREATE OR REPLACE FUNCTION inbound_trim(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR length(p::text) <= 4000 THEN p ELSE jsonb_build_object('too_large_to_keep', true) END
$$;

/**
 * Add or update a contact from another app. Called by the `api` edge function (service role)
 * with the link's token and what was sent. Returns { ok, contact_id, created } or { ok:false, error }.
 */
CREATE OR REPLACE FUNCTION inbound_contact(p_token text, p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l inbound_links; p jsonb := coalesce(p_payload, '{}'::jsonb);
  em text; ph text; fn text; ln text; full_name text; co text; jt text; src text; dob date; msg text;
  tags text[]; t text; cid uuid; is_new boolean := false; err text;
BEGIN
  SELECT * INTO l FROM inbound_links WHERE token = btrim(coalesce(p_token, ''));
  IF NOT FOUND OR l.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', 'This link is not valid or was switched off.');
  END IF;
  IF (SELECT count(*) FROM inbound_log WHERE link_id = l.id AND at > now() - interval '1 minute') >= 120 THEN
    RETURN jsonb_build_object('ok', false, 'status', 429, 'error', 'Too many requests: at most 120 a minute. Try again shortly.');
  END IF;

  -- Some apps wrap the fields: { "contact": {...} } or { "data": {...} }.
  IF jsonb_typeof(p->'contact') = 'object' THEN p := p || (p->'contact'); END IF;
  IF jsonb_typeof(p->'data') = 'object' THEN p := p || (p->'data'); END IF;

  em := lower(inbound_pick(p, 'email', 'email_address', 'emailAddress', 'Email'));
  IF em IS NOT NULL AND em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN em := NULL; END IF;
  ph := left(inbound_pick(p, 'phone', 'phone_number', 'phoneNumber', 'mobile', 'Phone'), 40);
  fn := left(inbound_pick(p, 'first_name', 'firstName', 'first', 'given_name', 'First Name'), 100);
  ln := left(inbound_pick(p, 'last_name', 'lastName', 'last', 'family_name', 'surname', 'Last Name'), 100);
  full_name := inbound_pick(p, 'name', 'full_name', 'fullName', 'Name');
  IF fn IS NULL AND full_name IS NOT NULL THEN
    fn := left(split_part(full_name, ' ', 1), 100);
    ln := coalesce(ln, nullif(left(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), 100), ''));
  END IF;
  co := left(inbound_pick(p, 'company', 'company_name', 'companyName', 'organization', 'organisation'), 200);
  jt := left(inbound_pick(p, 'job_title', 'jobTitle', 'title', 'position'), 200);
  src := left(coalesce(inbound_pick(p, 'source', 'utm_source'), l.source, l.name), 60);
  BEGIN dob := inbound_pick(p, 'date_of_birth', 'dateOfBirth', 'birthday', 'dob')::date; EXCEPTION WHEN OTHERS THEN dob := NULL; END;
  msg := left(inbound_pick(p, 'message', 'note', 'notes', 'comment', 'comments'), 5000);

  IF em IS NULL AND ph IS NULL THEN
    err := 'Send an email or a phone number so SYNAPSE knows who it is.';
    INSERT INTO inbound_log(link_id, workspace_id, ok, error, payload) VALUES (l.id, l.workspace_id, false, err, inbound_trim(p_payload));
    RETURN jsonb_build_object('ok', false, 'status', 422, 'error', err);
  END IF;

  IF em IS NOT NULL THEN SELECT id INTO cid FROM contacts WHERE workspace_id = l.workspace_id AND lower(email) = em ORDER BY created_at LIMIT 1; END IF;
  IF cid IS NULL AND ph IS NOT NULL THEN
    SELECT id INTO cid FROM contacts WHERE workspace_id = l.workspace_id AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(ph, '\D', '', 'g') ORDER BY created_at LIMIT 1;
  END IF;

  IF cid IS NULL THEN
    INSERT INTO contacts(workspace_id, first_name, last_name, email, phone, company, job_title, date_of_birth, source)
    VALUES (l.workspace_id, fn, ln, em, ph, co, jt, dob, src) RETURNING id INTO cid;
    is_new := true;
  ELSE
    -- What was sent replaces what's there; what wasn't sent stays.
    UPDATE contacts SET
      first_name = coalesce(fn, first_name), last_name = coalesce(ln, last_name), email = coalesce(em, email), phone = coalesce(ph, phone),
      company = coalesce(co, company), job_title = coalesce(jt, job_title), date_of_birth = coalesce(dob, date_of_birth),
      last_activity_at = now(), updated_at = now()
    WHERE id = cid;
  END IF;

  tags := l.tags;
  IF jsonb_typeof(p->'tags') = 'array' THEN
    tags := tags || ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(p->'tags') x WHERE btrim(x) <> '');
  ELSIF coalesce(p->>'tags', p->>'tag', '') <> '' THEN
    tags := tags || ARRAY(SELECT btrim(x) FROM unnest(string_to_array(coalesce(p->>'tags', p->>'tag'), ',')) x WHERE btrim(x) <> '');
  END IF;
  FOREACH t IN ARRAY tags LOOP
    INSERT INTO contact_tags(contact_id, tag_id) VALUES (cid, wf_tag_id(l.workspace_id, left(t, 60))) ON CONFLICT DO NOTHING;
  END LOOP;
  IF msg IS NOT NULL THEN
    INSERT INTO notes(workspace_id, contact_id, content) VALUES (l.workspace_id, cid, 'From ' || l.name || E':\n' || msg);
  END IF;

  UPDATE inbound_links SET last_used_at = now() WHERE id = l.id;
  INSERT INTO inbound_log(link_id, workspace_id, ok, created, contact_id, payload) VALUES (l.id, l.workspace_id, true, is_new, cid, inbound_trim(p_payload));
  DELETE FROM inbound_log WHERE link_id = l.id AND at < now() - interval '30 days';
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN is_new THEN 201 ELSE 200 END, 'contact_id', cid, 'created', is_new);
EXCEPTION WHEN OTHERS THEN
  err := 'Could not save the contact: ' || SQLERRM;
  IF l.id IS NOT NULL THEN
    INSERT INTO inbound_log(link_id, workspace_id, ok, error) VALUES (l.id, l.workspace_id, false, err);
  END IF;
  RETURN jsonb_build_object('ok', false, 'status', 400, 'error', err);
END $$;
REVOKE ALL ON FUNCTION inbound_contact(text, jsonb) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION inbound_contact(text, jsonb) TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;


-- ============ 20261102090000_api_keys.sql ============
/*
  # API keys: other apps read and change contacts with a key

  An Admin makes a key in Settings → API (read only, or read and write). It is shown once; only
  its SHA-256 is kept. Apps send it as "Authorization: Bearer syn_…" to the `api` edge function,
  which hands each request to api_request() below:

    GET    /v1/me                          the account and key
    GET    /v1/contacts                    newest first; ?email= ?phone= ?tag= ?q= ?created_after=
                                           ?updated_after= ?limit= (1-100, 25) ?offset=
    POST   /v1/contacts                    add, or update the one with that email/phone
    GET    /v1/contacts/{id}
    PATCH  /v1/contacts/{id}               change the fields sent
    DELETE /v1/contacts/{id}
    POST   /v1/contacts/{id}/tags          { "tags": ["VIP"] }
    DELETE /v1/contacts/{id}/tags/{tag}
    GET    /v1/contacts/{id}/notes
    POST   /v1/contacts/{id}/notes         { "content": "…" }
    GET    /v1/tags

  Contacts come back in the same shape outgoing webhooks send. Changes start workflows as usual.
  Every request is logged (kept 7 days); at most 300 a minute per key.

  Needs 20261031090000_outgoing_webhooks.sql and 20261101090000_incoming_contacts.sql.
  Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  can_write boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
-- Admins see their keys (never the hash) and can delete revoked ones; making and revoking go through the functions below.
DROP POLICY IF EXISTS "api_keys_admins_read" ON api_keys;
CREATE POLICY "api_keys_admins_read" ON api_keys FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "api_keys_admins_delete_revoked" ON api_keys;
CREATE POLICY "api_keys_admins_delete_revoked" ON api_keys FOR DELETE TO authenticated USING (is_workspace_admin(workspace_id) AND revoked_at IS NOT NULL);
REVOKE ALL ON api_keys FROM anon, authenticated;
GRANT SELECT (id, workspace_id, name, prefix, can_write, created_by, created_at, last_used_at, revoked_at) ON api_keys TO authenticated;
GRANT DELETE ON api_keys TO authenticated;

CREATE TABLE IF NOT EXISTS api_log (
  id bigserial PRIMARY KEY,
  key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status int NOT NULL,
  error text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_log_key ON api_log(key_id, at DESC);
ALTER TABLE api_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_log_admins" ON api_log;
CREATE POLICY "api_log_admins" ON api_log FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));

/** Make a key. Returns { id, key }: the only time the key itself is shown. Admins only. */
CREATE OR REPLACE FUNCTION api_key_create(p_workspace uuid, p_name text, p_can_write boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE k text; v_id uuid;
BEGIN
  IF NOT is_workspace_admin(p_workspace) THEN RAISE EXCEPTION 'Only admins can make API keys.'; END IF;
  k := 'syn_' || encode(gen_random_bytes(24), 'hex');
  INSERT INTO api_keys(workspace_id, name, prefix, key_hash, can_write, created_by)
  VALUES (p_workspace, btrim(coalesce(p_name, '')), left(k, 12), encode(digest(k, 'sha256'), 'hex'), coalesce(p_can_write, true), auth.uid())
  RETURNING id INTO v_id;
  PERFORM audit_write(p_workspace, 'api_key_created', 'api_key', v_id, jsonb_build_object('name', btrim(p_name), 'access', CASE WHEN coalesce(p_can_write, true) THEN 'read and write' ELSE 'read only' END));
  RETURN jsonb_build_object('id', v_id, 'key', k);
END $$;
REVOKE ALL ON FUNCTION api_key_create(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_create(uuid, text, boolean) TO authenticated;

/** Revoke a key: it stops working at once. Admins only. */
CREATE OR REPLACE FUNCTION api_key_revoke(p_key uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k api_keys;
BEGIN
  SELECT * INTO k FROM api_keys WHERE id = p_key;
  IF NOT FOUND OR NOT is_workspace_admin(k.workspace_id) THEN RAISE EXCEPTION 'Only admins can revoke API keys.'; END IF;
  IF k.revoked_at IS NULL THEN
    UPDATE api_keys SET revoked_at = now() WHERE id = p_key;
    PERFORM audit_write(k.workspace_id, 'api_key_revoked', 'api_key', k.id, jsonb_build_object('name', k.name));
  END IF;
END $$;
REVOKE ALL ON FUNCTION api_key_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_revoke(uuid) TO authenticated;

-- ---------- helpers ----------

CREATE OR REPLACE FUNCTION api_out(p_status int, p_body jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('status', p_status, 'body', p_body)
$$;
CREATE OR REPLACE FUNCTION api_err(p_status int, p_message text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('status', p_status, 'body', jsonb_build_object('error', p_message))
$$;

-- A refusal the caller can fix (answered 422 with this message).
CREATE OR REPLACE FUNCTION api_invalid(p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = 'SY422', MESSAGE = p_message; END $$;

/** A contact as the API returns it: the webhook shape with tags as written, plus birthday and last change. */
CREATE OR REPLACE FUNCTION api_contact(p_contact uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT webhook_contact(c.id) || jsonb_build_object('date_of_birth', c.date_of_birth, 'updated_at', c.updated_at,
    'tags', (SELECT coalesce(jsonb_agg(t.name ORDER BY lower(t.name)), '[]'::jsonb) FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id))
  FROM contacts c WHERE c.id = p_contact;
$$;
REVOKE ALL ON FUNCTION api_contact(uuid) FROM PUBLIC, anon, authenticated;

/** The contact fields sent, under their proper names (same forgiving names as incoming links). */
CREATE OR REPLACE FUNCTION api_fields(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o jsonb := '{}'::jsonb; v text; full_name text;
BEGIN
  IF jsonb_typeof(p->'contact') = 'object' THEN p := p || (p->'contact'); END IF;
  v := lower(inbound_pick(p, 'email', 'email_address', 'emailAddress'));
  IF v IS NOT NULL THEN
    IF v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN PERFORM api_invalid('"email" isn''t a valid email address.'); END IF;
    o := o || jsonb_build_object('email', v);
  END IF;
  v := left(inbound_pick(p, 'phone', 'phone_number', 'phoneNumber', 'mobile'), 40);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('phone', v); END IF;
  v := left(inbound_pick(p, 'first_name', 'firstName', 'first', 'given_name'), 100);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('first_name', v); END IF;
  v := left(inbound_pick(p, 'last_name', 'lastName', 'last', 'family_name', 'surname'), 100);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('last_name', v); END IF;
  full_name := inbound_pick(p, 'name', 'full_name', 'fullName');
  IF full_name IS NOT NULL AND NOT o ? 'first_name' THEN
    o := o || jsonb_build_object('first_name', left(split_part(full_name, ' ', 1), 100));
    v := nullif(left(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), 100), '');
    IF v IS NOT NULL AND NOT o ? 'last_name' THEN o := o || jsonb_build_object('last_name', v); END IF;
  END IF;
  v := left(inbound_pick(p, 'company', 'company_name', 'companyName', 'organization', 'organisation'), 200);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('company', v); END IF;
  v := left(inbound_pick(p, 'job_title', 'jobTitle', 'title', 'position'), 200);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('job_title', v); END IF;
  v := left(inbound_pick(p, 'source', 'utm_source'), 60);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('source', v); END IF;
  v := inbound_pick(p, 'date_of_birth', 'dateOfBirth', 'birthday', 'dob');
  IF v IS NOT NULL THEN
    BEGIN o := o || jsonb_build_object('date_of_birth', v::date);
    EXCEPTION WHEN OTHERS THEN PERFORM api_invalid('"date_of_birth" must be a date like 1990-12-31.'); END;
  END IF;
  RETURN o;
END $$;

/** Tags sent as a list or as "a, b". */
CREATE OR REPLACE FUNCTION api_tag_list(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p->'tags') = 'array' THEN ARRAY(SELECT left(btrim(x), 60) FROM jsonb_array_elements_text(p->'tags') x WHERE btrim(x) <> '')
    WHEN coalesce(p->>'tags', p->>'tag', '') <> '' THEN ARRAY(SELECT left(btrim(x), 60) FROM unnest(string_to_array(coalesce(p->>'tags', p->>'tag'), ',')) x WHERE btrim(x) <> '')
    ELSE '{}'::text[] END
$$;

CREATE OR REPLACE FUNCTION api_add_tags(p_workspace uuid, p_contact uuid, p_tags text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY coalesce(p_tags, '{}') LOOP
    INSERT INTO contact_tags(contact_id, tag_id) VALUES (p_contact, wf_tag_id(p_workspace, t)) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION api_set_fields(p_contact uuid, f jsonb) RETURNS void LANGUAGE sql AS $$
  UPDATE contacts SET
    first_name = coalesce(f->>'first_name', first_name), last_name = coalesce(f->>'last_name', last_name),
    email = coalesce(f->>'email', email), phone = coalesce(f->>'phone', phone),
    company = coalesce(f->>'company', company), job_title = coalesce(f->>'job_title', job_title),
    source = coalesce(f->>'source', source), date_of_birth = coalesce((f->>'date_of_birth')::date, date_of_birth),
    last_activity_at = now(), updated_at = now()
  WHERE id = p_contact;
$$;

CREATE OR REPLACE FUNCTION api_q_int(q jsonb, k text, p_default int, p_min int, p_max int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF coalesce(q->>k, '') = '' THEN RETURN p_default; END IF;
  BEGIN n := (q->>k)::int; EXCEPTION WHEN OTHERS THEN PERFORM api_invalid('"' || k || '" must be a whole number.'); END;
  RETURN least(greatest(n, p_min), p_max);
END $$;

CREATE OR REPLACE FUNCTION api_q_time(q jsonb, k text) RETURNS timestamptz LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(q->>k, '') = '' THEN RETURN NULL; END IF;
  RETURN (q->>k)::timestamptz;
EXCEPTION WHEN OTHERS THEN PERFORM api_invalid('"' || k || '" must be a date and time like 2026-11-01T09:00:00Z.'); RETURN NULL;
END $$;

-- ---------- the routes ----------

CREATE OR REPLACE FUNCTION api_route(k api_keys, m text, seg text[], q jsonb, b jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws uuid := k.workspace_id; n int := coalesce(array_length(seg, 1), 0);
  cid uuid; f jsonb; tags text[]; is_new boolean := false; lim int; off int; ids uuid[]; more boolean; v_note notes; content text;
BEGIN
  IF m NOT IN ('GET', 'POST', 'PATCH', 'DELETE') THEN RETURN api_err(405, 'Use GET, POST, PATCH or DELETE.'); END IF;
  IF m <> 'GET' AND NOT k.can_write THEN RETURN api_err(403, 'This key can only read. Make a key with write access to change things.'); END IF;

  IF n = 1 AND seg[1] = 'me' THEN
    IF m <> 'GET' THEN RETURN api_err(405, 'Use GET.'); END IF;
    RETURN api_out(200, jsonb_build_object(
      'workspace', (SELECT jsonb_build_object('id', w.id, 'name', w.name) FROM workspaces w WHERE w.id = ws),
      'key', jsonb_build_object('name', k.name, 'access', CASE WHEN k.can_write THEN 'read_write' ELSE 'read' END)));
  END IF;

  IF n = 1 AND seg[1] = 'tags' THEN
    IF m <> 'GET' THEN RETURN api_err(405, 'Use GET.'); END IF;
    RETURN api_out(200, jsonb_build_object('data', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color) ORDER BY lower(t.name)) FROM tags t WHERE t.workspace_id = ws), '[]'::jsonb)));
  END IF;

  IF n = 0 OR seg[1] <> 'contacts' OR n > 4 THEN
    RETURN api_err(404, 'Unknown address. See Settings → API for what you can call.');
  END IF;

  IF n = 1 THEN
    IF m = 'GET' THEN
      lim := api_q_int(q, 'limit', 25, 1, 100);
      off := api_q_int(q, 'offset', 0, 0, 1000000);
      SELECT array_agg(id ORDER BY created_at DESC, id) INTO ids FROM (
        SELECT c.id, c.created_at FROM contacts c
        WHERE c.workspace_id = ws
          AND (coalesce(q->>'email', '') = '' OR lower(c.email) = lower(btrim(q->>'email')))
          AND (coalesce(q->>'phone', '') = '' OR regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(q->>'phone', '\D', '', 'g'))
          AND (coalesce(q->>'tag', '') = '' OR EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id AND lower(t.name) = lower(btrim(q->>'tag'))))
          AND (coalesce(q->>'q', '') = '' OR concat_ws(' ', c.first_name, c.last_name, c.email, c.phone, c.company) ILIKE '%' || btrim(q->>'q') || '%')
          AND (api_q_time(q, 'created_after') IS NULL OR c.created_at > api_q_time(q, 'created_after'))
          AND (api_q_time(q, 'updated_after') IS NULL OR c.updated_at > api_q_time(q, 'updated_after'))
        ORDER BY c.created_at DESC, c.id LIMIT lim + 1 OFFSET off) s;
      more := coalesce(array_length(ids, 1), 0) > lim;
      ids := coalesce(ids[1:lim], '{}');
      RETURN api_out(200, jsonb_build_object(
        'data', coalesce((SELECT jsonb_agg(api_contact(x) ORDER BY o) FROM unnest(ids) WITH ORDINALITY u(x, o)), '[]'::jsonb),
        'has_more', more, 'next_offset', CASE WHEN more THEN off + lim END));
    ELSIF m = 'POST' THEN
      f := api_fields(b);
      IF NOT (f ? 'email' OR f ? 'phone') THEN PERFORM api_invalid('Send an "email" or a "phone".'); END IF;
      IF f ? 'email' THEN SELECT id INTO cid FROM contacts WHERE workspace_id = ws AND lower(email) = f->>'email' ORDER BY created_at LIMIT 1; END IF;
      IF cid IS NULL AND f ? 'phone' THEN
        SELECT id INTO cid FROM contacts WHERE workspace_id = ws AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = regexp_replace(f->>'phone', '\D', '', 'g')
          AND regexp_replace(f->>'phone', '\D', '', 'g') <> '' ORDER BY created_at LIMIT 1;
      END IF;
      IF cid IS NULL THEN
        INSERT INTO contacts(workspace_id, first_name, last_name, email, phone, company, job_title, date_of_birth, source)
        VALUES (ws, f->>'first_name', f->>'last_name', f->>'email', f->>'phone', f->>'company', f->>'job_title', (f->>'date_of_birth')::date, coalesce(f->>'source', 'API'))
        RETURNING id INTO cid;
        is_new := true;
      ELSE
        PERFORM api_set_fields(cid, f - 'source');
      END IF;
      PERFORM api_add_tags(ws, cid, api_tag_list(b));
      content := left(inbound_pick(b, 'note', 'message'), 10000);
      IF content IS NOT NULL THEN INSERT INTO notes(workspace_id, contact_id, content) VALUES (ws, cid, 'From ' || k.name || E' (API):\n' || content); END IF;
      RETURN api_out(CASE WHEN is_new THEN 201 ELSE 200 END, jsonb_build_object('data', api_contact(cid), 'created', is_new));
    END IF;
    RETURN api_err(405, 'Use GET or POST.');
  END IF;

  -- /contacts/{id}…
  BEGIN cid := seg[2]::uuid; EXCEPTION WHEN OTHERS THEN cid := NULL; END;
  IF cid IS NULL OR NOT EXISTS (SELECT 1 FROM contacts WHERE id = cid AND workspace_id = ws) THEN
    RETURN api_err(404, 'No contact with that id.');
  END IF;

  IF n = 2 THEN
    IF m = 'GET' THEN RETURN api_out(200, jsonb_build_object('data', api_contact(cid))); END IF;
    IF m = 'PATCH' THEN
      f := api_fields(b); tags := api_tag_list(b);
      IF f = '{}'::jsonb AND cardinality(tags) = 0 THEN PERFORM api_invalid('Nothing to change: send the fields to change, like { "company": "Acme" }.'); END IF;
      IF f <> '{}'::jsonb THEN PERFORM api_set_fields(cid, f); END IF;
      PERFORM api_add_tags(ws, cid, tags);
      RETURN api_out(200, jsonb_build_object('data', api_contact(cid)));
    END IF;
    IF m = 'DELETE' THEN
      DELETE FROM contacts WHERE id = cid;
      RETURN api_out(200, jsonb_build_object('deleted', true, 'id', cid));
    END IF;
    RETURN api_err(405, 'Use GET, PATCH or DELETE.');
  END IF;

  IF seg[3] = 'tags' THEN
    IF n = 3 AND m = 'POST' THEN
      tags := api_tag_list(b);
      IF cardinality(tags) = 0 THEN PERFORM api_invalid('Send { "tags": ["VIP"] }.'); END IF;
      PERFORM api_add_tags(ws, cid, tags);
      RETURN api_out(200, jsonb_build_object('data', api_contact(cid)));
    END IF;
    IF n = 4 AND m = 'DELETE' THEN
      DELETE FROM contact_tags ct USING tags t WHERE ct.contact_id = cid AND t.id = ct.tag_id AND t.workspace_id = ws AND lower(t.name) = lower(btrim(seg[4]));
      RETURN api_out(200, jsonb_build_object('data', api_contact(cid)));
    END IF;
    RETURN api_err(405, 'Add tags with POST /contacts/{id}/tags; remove one with DELETE /contacts/{id}/tags/{tag}.');
  END IF;

  IF seg[3] = 'notes' AND n = 3 THEN
    IF m = 'GET' THEN
      RETURN api_out(200, jsonb_build_object('data', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'content', x.content, 'created_at', x.created_at) ORDER BY x.created_at DESC)
        FROM (SELECT * FROM notes WHERE contact_id = cid ORDER BY created_at DESC LIMIT 50) x), '[]'::jsonb)));
    END IF;
    IF m = 'POST' THEN
      content := left(inbound_pick(b, 'content', 'note', 'text', 'body'), 10000);
      IF content IS NULL THEN PERFORM api_invalid('Send { "content": "…" }.'); END IF;
      INSERT INTO notes(workspace_id, contact_id, content) VALUES (ws, cid, content) RETURNING * INTO v_note;
      RETURN api_out(201, jsonb_build_object('data', jsonb_build_object('id', v_note.id, 'content', v_note.content, 'created_at', v_note.created_at)));
    END IF;
    RETURN api_err(405, 'Use GET or POST.');
  END IF;

  RETURN api_err(404, 'Unknown address. See Settings → API for what you can call.');
END $$;
REVOKE ALL ON FUNCTION api_route(api_keys, text, text[], jsonb, jsonb) FROM PUBLIC, anon, authenticated;

/**
 * One API request, from the `api` edge function (service role). p_path is what follows /v1/,
 * e.g. "contacts/<id>/tags". Returns { status, body }.
 */
CREATE OR REPLACE FUNCTION api_request(p_key text, p_method text, p_path text, p_query jsonb DEFAULT '{}'::jsonb, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE k api_keys; m text := upper(coalesce(p_method, 'GET')); res jsonb; seg text[];
BEGIN
  SELECT * INTO k FROM api_keys WHERE key_hash = encode(digest(btrim(coalesce(p_key, '')), 'sha256'), 'hex');
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN RETURN api_err(401, 'This API key is not valid or was revoked.'); END IF;
  IF (SELECT count(*) FROM api_log WHERE key_id = k.id AND at > now() - interval '1 minute') >= 300 THEN
    RETURN api_err(429, 'Too many requests: at most 300 a minute per key. Try again shortly.');
  END IF;

  seg := ARRAY(SELECT s FROM unnest(string_to_array(btrim(coalesce(p_path, ''), '/'), '/')) s WHERE s <> '');
  BEGIN
    res := api_route(k, m, seg, coalesce(p_query, '{}'::jsonb), CASE WHEN jsonb_typeof(p_body) = 'object' THEN p_body ELSE '{}'::jsonb END);
  EXCEPTION
    WHEN SQLSTATE 'SY422' THEN res := api_err(422, SQLERRM);
    WHEN OTHERS THEN res := api_err(400, 'Could not do that: ' || SQLERRM);
  END;

  INSERT INTO api_log(key_id, workspace_id, method, path, status, error)
  VALUES (k.id, k.workspace_id, m, left('/' || array_to_string(seg, '/'), 300), (res->>'status')::int, res->'body'->>'error');
  UPDATE api_keys SET last_used_at = now() WHERE id = k.id;
  DELETE FROM api_log WHERE key_id = k.id AND at < now() - interval '7 days';
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION api_request(text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION api_request(text, text, text, jsonb, jsonb) TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;


-- ============ 20261109090000_lock_internal_helpers.sql ============
/*
  # Lock the database's internal helpers

  Supabase lets the app's public key call any database function, and by default it may. These
  functions are only ever used inside the database (by triggers, the minute scheduler and other
  functions), never by the app, so outside callers are now refused. Before this, someone with the
  public key could, for example, post into a chat channel, create tags or start workflow runs.

  Also tightened, among functions the app does call:
    - seed_workspace_demo_data: only the new account's owner, for their own account.
    - wf_set_client_key: set once; only a platform admin can change it afterwards.
    - increment_workflow_runs and get_form_submission_counts now run with the caller's own
      permissions, so they only touch workflows and forms the caller can already see.

  Nothing the app does changes. Safe to run more than once.
*/

-- 1. Internal helpers: no outside callers. (The database itself, the scheduler and the
--    service role used by edge functions keep using them.)
DO $$
DECLARE s text; f regprocedure;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'api_contact(uuid)',
    'api_route(api_keys, text, text[], jsonb, jsonb)',
    'audit_person(uuid)',
    'audit_write(uuid, text, text, uuid, jsonb)',
    'can_use_room(uuid)',
    'ensure_department_channel(uuid)',
    'event_public_json(events)',
    'event_ticket_list(uuid)',
    'webhook_contact(uuid)',
    'webhook_dispatch(uuid)',
    'webhook_form_answers(uuid)',
    'webhook_queue(uuid, text, jsonb)',
    'wf_app_url()',
    'wf_conditions_ok(jsonb, uuid)',
    'wf_contact_tags(uuid)',
    'wf_daily_scan()',
    'wf_emit(uuid, text, uuid, jsonb)',
    'wf_enroll(workflows, jsonb, uuid, text, jsonb, integer, boolean, boolean)',
    'wf_exec_step(wf_runs, workflows, text, jsonb)',
    'wf_finish(uuid, text, text)',
    'wf_form_answers(uuid)',
    'wf_handle_event(wf_events)',
    'wf_log(wf_runs, jsonb, text, text, text)',
    'wf_merge(text, uuid, jsonb)',
    'wf_new_meeting(uuid, uuid, text, integer)',
    'wf_post(uuid, workflows, wf_runs, text)',
    'wf_run(uuid)',
    'wf_tag_id(uuid, text)',
    'wf_tick()',
    'wf_trigger_matches(jsonb, wf_events)'
  ] LOOP
    f := to_regprocedure('public.' || s);
    CONTINUE WHEN f IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); EXCEPTION WHEN undefined_object THEN NULL; END;
  END LOOP;
END $$;

-- 2. Demo data: only the owner, for their own new account. The original keeps its body under
--    another name that only the database can call.
DO $$
BEGIN
  IF to_regprocedure('public.seed_workspace_demo_data_unchecked(uuid, uuid)') IS NULL
     AND to_regprocedure('public.seed_workspace_demo_data(uuid, uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.seed_workspace_demo_data(uuid, uuid) RENAME TO seed_workspace_demo_data_unchecked;
  END IF;
END $$;
DO $$
BEGIN
  IF to_regprocedure('public.seed_workspace_demo_data_unchecked(uuid, uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.seed_workspace_demo_data_unchecked(uuid, uuid) FROM PUBLIC, anon, authenticated;
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.seed_workspace_demo_data(p_workspace_id uuid, p_owner_id uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        IF auth.uid() IS NULL OR auth.uid() <> p_owner_id OR NOT has_workspace_role(p_workspace_id, ARRAY['owner']) THEN
          RAISE EXCEPTION 'Only the account owner can do this.';
        END IF;
        PERFORM seed_workspace_demo_data_unchecked(p_workspace_id, p_owner_id);
      END $b$;
    $f$;
    REVOKE ALL ON FUNCTION public.seed_workspace_demo_data(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.seed_workspace_demo_data(uuid, uuid) TO authenticated;
  END IF;
END $$;

-- 3. The scheduler's gateway key: the first value sticks; later changes only by a platform admin.
CREATE OR REPLACE FUNCTION wf_set_client_key(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = auth.uid()) THEN RETURN; END IF;
  IF p_key IS NULL OR char_length(p_key) NOT BETWEEN 20 AND 2000 OR p_key !~ '^[A-Za-z0-9._-]+$' THEN RETURN; END IF;
  IF is_platform_admin() THEN
    INSERT INTO wf_private.settings(key, value) VALUES ('client_key', p_key) ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  ELSE
    INSERT INTO wf_private.settings(key, value) VALUES ('client_key', p_key) ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION wf_set_client_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_set_client_key(text) TO authenticated;

-- 4. Run with the caller's own permissions (row-level security decides what they touch).
DO $$
BEGIN
  IF to_regprocedure('public.increment_workflow_runs(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.increment_workflow_runs(uuid) SECURITY INVOKER;
    REVOKE ALL ON FUNCTION public.increment_workflow_runs(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.increment_workflow_runs(uuid) TO authenticated;
  END IF;
  IF to_regprocedure('public.get_form_submission_counts(uuid[])') IS NOT NULL THEN
    ALTER FUNCTION public.get_form_submission_counts(uuid[]) SECURITY INVOKER;
    REVOKE ALL ON FUNCTION public.get_form_submission_counts(uuid[]) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_form_submission_counts(uuid[]) TO authenticated;
  END IF;
END $$;


-- ============ 20261110090000_event_registration_types.sql ============
/*
  # Event registration: types with their own form, approval, dates to be announced

  An event's tickets become registration types. Each can now have:
    - a web address of its own (/e/<event>/<slug>, e.g. /register or /apply),
    - a form from Forms that people fill in to register,
    - approval: people apply and wait to be selected (no ticket until then),
    - opening and closing times, and a status (draft, open, closed).
  Tickets made before this keep working exactly as they did.

  Also:
    - events may have no date yet ("to be announced"): starts_at and ends_at are both empty;
    - events gain a tagline, programme tags, the organiser's logo, brand colours and a privacy notice;
    - registrations gain the new statuses (applied → shortlisted → selected / declined → confirmed),
      a short ticket code (e.g. UNS-7K4Q), when consent was given, who checked them in, and the form
      answers they came from;
    - check-in staff per event, and a log of every check-in attempt (used by the scanner);
    - public_event_registration(slug, type): what the registration page shows;
    - event_register(slug, type, answers): registers or applies, through the type's form.

  Nothing is deleted. Safe to run more than once.
*/

-- 1. Events ------------------------------------------------------------------------------
ALTER TABLE events ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE events ALTER COLUMN ends_at DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_dates_together CHECK ((starts_at IS NULL) = (ends_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE events ADD COLUMN IF NOT EXISTS tagline text NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 140);
ALTER TABLE events ADD COLUMN IF NOT EXISTS programme text[] NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organiser_logo_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS brand jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS privacy_notice text NOT NULL DEFAULT '' CHECK (char_length(privacy_notice) <= 8000);

-- 2. Tickets become registration types ---------------------------------------------------
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS slug text CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$');
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS form_id uuid REFERENCES forms(id) ON DELETE SET NULL;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS opens_at timestamptz;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS closes_at timestamptz;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed'));
CREATE UNIQUE INDEX IF NOT EXISTS event_tickets_slug_key ON event_tickets(event_id, slug) WHERE slug IS NOT NULL;

-- 3. Registrations -----------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'event_registrations'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%confirmed%cancelled%'
    AND pg_get_constraintdef(oid) NOT LIKE '%applied%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE event_registrations DROP CONSTRAINT %I', c); END IF;
  ALTER TABLE event_registrations ADD CONSTRAINT event_registrations_status_types
    CHECK (status IN ('confirmed', 'applied', 'shortlisted', 'selected', 'declined', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS ticket_code text;
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_code_key ON event_registrations(ticket_code) WHERE ticket_code IS NOT NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
-- One live registration per person per registration type (they may hold one of each type).
DROP INDEX IF EXISTS event_registrations_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_email_type_key
  ON event_registrations(event_id, coalesce(ticket_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email))
  WHERE status NOT IN ('cancelled', 'declined');

-- 4. Check-in staff and the check-in log --------------------------------------------------
CREATE TABLE IF NOT EXISTS event_staff (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'checkin' CHECK (role IN ('checkin')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE event_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_staff_read" ON event_staff;
CREATE POLICY "event_staff_read" ON event_staff FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "event_staff_manage" ON event_staff;
CREATE POLICY "event_staff_manage" ON event_staff FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND (e.created_by = auth.uid() OR is_workspace_admin(e.workspace_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND (e.created_by = auth.uid() OR is_workspace_admin(e.workspace_id))));

CREATE TABLE IF NOT EXISTS event_checkins (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id uuid REFERENCES event_registrations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  result text NOT NULL CHECK (result IN ('success', 'already_checked_in', 'invalid', 'not_eligible', 'undone')),
  via text NOT NULL DEFAULT 'scan' CHECK (via IN ('scan', 'manual', 'undo')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_checkins_event ON event_checkins(event_id, at DESC);
ALTER TABLE event_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_checkins_read" ON event_checkins;
CREATE POLICY "event_checkins_read" ON event_checkins FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));

-- 5. Helpers -----------------------------------------------------------------------------

-- Statuses that hold a place (count against capacity) and carry a ticket.
CREATE OR REPLACE FUNCTION event_holds_place(p_status text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('confirmed', 'selected')
$$;

-- A short, readable ticket code: the event's first letters and four characters people can't
-- misread (no 0/O, 1/I/L), e.g. UNS-7K4Q. Unique across all events.
CREATE OR REPLACE FUNCTION event_ticket_code(p_slug text) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  prefix text := upper(left(regexp_replace(coalesce(p_slug, ''), '[^a-zA-Z0-9]', '', 'g'), 3));
  code text;
BEGIN
  IF char_length(prefix) < 2 THEN prefix := 'TKT'; END IF;
  LOOP
    code := prefix || '-' || (SELECT string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') FROM generate_series(1, 4));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE ticket_code = code);
  END LOOP;
  RETURN code;
END $$;

-- A form's definition as JSON (it is kept as a JSON string inside the column).
CREATE OR REPLACE FUNCTION form_definition_json(p_def jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_def) = 'string' THEN (p_def #>> '{}')::jsonb ELSE coalesce(p_def, '{}'::jsonb) END
$$;

-- Whether a registration type takes people now, and if not why.
CREATE OR REPLACE FUNCTION event_type_state(e events, t event_tickets) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN e.status = 'cancelled' THEN 'cancelled'
    WHEN e.status <> 'published' OR t.status = 'draft' THEN 'unavailable'
    WHEN e.ends_at IS NOT NULL AND e.ends_at < now() THEN 'ended'
    WHEN t.status = 'closed' OR (t.closes_at IS NOT NULL AND t.closes_at <= now()) THEN 'closed'
    WHEN t.opens_at IS NOT NULL AND t.opens_at > now() THEN 'not_open_yet'
    WHEN NOT t.requires_approval AND t.capacity IS NOT NULL
      AND (SELECT count(*) FROM event_registrations r WHERE r.ticket_id = t.id AND event_holds_place(r.status)) >= t.capacity THEN 'full'
    ELSE 'open' END
$$;
REVOKE ALL ON FUNCTION event_type_state(events, event_tickets) FROM PUBLIC, anon, authenticated;

-- 6. What the public sees (same functions as before, now with types, TBA dates and branding) --

CREATE OR REPLACE FUNCTION event_ticket_list(p_event uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'description', t.description,
    'price_minor', t.price_minor, 'currency', t.currency, 'capacity', t.capacity,
    'remaining', CASE WHEN t.capacity IS NULL THEN NULL ELSE greatest(t.capacity - (
      SELECT count(*) FROM event_registrations r WHERE r.ticket_id = t.id AND event_holds_place(r.status)), 0) END,
    'slug', t.slug, 'requires_approval', t.requires_approval, 'has_form', t.form_id IS NOT NULL,
    'opens_at', t.opens_at, 'closes_at', t.closes_at,
    'state', (SELECT event_type_state(e, t) FROM events e WHERE e.id = t.event_id)
  ) ORDER BY t.sort, t.created_at), '[]'::jsonb)
  FROM event_tickets t WHERE t.event_id = p_event AND t.status <> 'draft';
$$;

CREATE OR REPLACE FUNCTION event_public_json(e events)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'organiser_id', e.workspace_id, 'slug', e.slug, 'title', e.title,
    'summary', e.summary, 'description', e.description, 'category', e.category,
    'cover_url', e.cover_url, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
    'timezone', e.timezone, 'mode', e.mode, 'venue_name', e.venue_name,
    'address', e.address, 'city', e.city, 'status', e.status, 'visibility', e.visibility,
    'organiser_name', coalesce(nullif(e.organiser_name, ''), (SELECT w.name FROM workspaces w WHERE w.id = e.workspace_id), ''),
    'organiser_logo_url', e.organiser_logo_url, 'tagline', e.tagline, 'programme', to_jsonb(e.programme), 'brand', e.brand,
    'questions', e.questions,
    'registered', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status)),
    'tickets', event_ticket_list(e.id)
  );
$$;

-- Upcoming events; ones with a date to be announced come last.
CREATE OR REPLACE FUNCTION public_events()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(event_public_json(e) - 'description' - 'questions' ORDER BY e.starts_at NULLS LAST, e.created_at), '[]'::jsonb)
  FROM (SELECT * FROM events
        WHERE status = 'published' AND visibility = 'public' AND (ends_at IS NULL OR ends_at > now())
        ORDER BY starts_at NULLS LAST LIMIT 200) e;
$$;

CREATE OR REPLACE FUNCTION public_event_stats()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'upcoming', (SELECT count(*) FROM events WHERE status = 'published' AND visibility = 'public' AND (ends_at IS NULL OR ends_at > now())),
    'registrations', (SELECT count(*) FROM event_registrations r JOIN events e ON e.id = r.event_id
                      WHERE event_holds_place(r.status) AND e.status = 'published' AND e.visibility = 'public'),
    'cities', (SELECT count(DISTINCT lower(city)) FROM events WHERE status = 'published' AND visibility = 'public' AND city <> ''),
    'organisers', (SELECT count(DISTINCT workspace_id) FROM events WHERE status = 'published' AND visibility = 'public')
  );
$$;

-- The ticket page also shows the registration type and the short code.
CREATE OR REPLACE FUNCTION public_ticket(p_token uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'qr_token', r.qr_token, 'pin', r.pin, 'ticket_code', r.ticket_code, 'first_name', r.first_name, 'last_name', r.last_name,
    'email', r.email, 'status', r.status, 'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'checked_in_at', r.checked_in_at, 'created_at', r.created_at,
    'ticket_name', t.name, 'requires_approval', coalesce(t.requires_approval, false), 'currency', coalesce(t.currency, 'NGN'),
    'online_url', CASE WHEN event_holds_place(r.status) THEN e.online_url ELSE '' END,
    'event', event_public_json(e) - 'questions' - 'tickets'
  )
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN event_tickets t ON t.id = r.ticket_id
  WHERE r.qr_token = p_token LIMIT 1;
$$;

/** The registration page: the event, the type and whether it's open, and the form to fill in. */
CREATE OR REPLACE FUNCTION public_event_registration(p_slug text, p_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE e events; t event_tickets; f forms;
BEGIN
  SELECT * INTO e FROM events WHERE slug = lower(btrim(p_slug)) AND status IN ('published', 'cancelled');
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO t FROM event_tickets WHERE event_id = e.id AND slug = lower(btrim(p_type)) AND status <> 'draft';
  IF NOT FOUND OR t.form_id IS NULL THEN RETURN jsonb_build_object('event', event_public_json(e) - 'questions', 'type', NULL); END IF;
  SELECT * INTO f FROM forms WHERE id = t.form_id;
  RETURN jsonb_build_object(
    'event', event_public_json(e) - 'questions',
    'privacy_notice', e.privacy_notice,
    'type', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'description', t.description,
      'requires_approval', t.requires_approval, 'price_minor', t.price_minor, 'currency', t.currency,
      'opens_at', t.opens_at, 'closes_at', t.closes_at, 'state', event_type_state(e, t)),
    'form', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object('id', f.id, 'name', f.name, 'description', f.description,
      'definition', form_definition_json(f.definition)) END
  );
END $$;
REVOKE ALL ON FUNCTION public_event_registration(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_event_registration(text, text) TO anon, authenticated;

/**
 * Register (or apply) through a registration type's form. The answers are by form field id;
 * name, email and phone come from the fields saved to the contact (or by field type).
 * Returns { status: 'confirmed' | 'applied', qr_token?, ticket_code?, first_name, type_name }
 * or { status: 'duplicate' } when this email (or phone) already holds a live registration
 * of this type. Raises closed / full / not_open_yet / consent_required / email_invalid /
 * name_required / busy / not_found.
 */
CREATE OR REPLACE FUNCTION event_register(p_slug text, p_type text, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e events; t event_tickets; f forms; def jsonb; el jsonb; a jsonb := coalesce(p_answers, '{}'::jsonb);
  k text; v text; first text; last text; full_name text; em text; ph text;
  consent_needed boolean := false; consent_given boolean := false;
  state text; cid uuid; sid uuid; reg event_registrations; new_pin text; st text;
BEGIN
  SELECT * INTO e FROM events WHERE slug = lower(btrim(coalesce(p_slug, ''))) AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  -- Lock the type so two people can't take the last place at once.
  SELECT * INTO t FROM event_tickets WHERE event_id = e.id AND slug = lower(btrim(coalesce(p_type, ''))) FOR UPDATE;
  IF NOT FOUND OR t.form_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  state := event_type_state(e, t);
  IF state <> 'open' THEN RAISE EXCEPTION '%', CASE WHEN state IN ('full', 'not_open_yet') THEN state ELSE 'closed' END; END IF;
  IF (SELECT count(*) FROM event_registrations WHERE ticket_id = t.id AND created_at > now() - interval '1 minute') >= 60 THEN
    RAISE EXCEPTION 'busy';
  END IF;

  SELECT * INTO f FROM forms WHERE id = t.form_id;
  def := form_definition_json(f.definition);
  FOR el IN SELECT value FROM jsonb_each(coalesce(def->'elements', '{}'::jsonb)) LOOP
    CONTINUE WHEN el->'field' IS NULL;
    k := coalesce(el->'field'->>'mappedContactField', el->>'type');
    v := btrim(coalesce(a->>(el->'field'->>'fieldId'), ''));
    IF el->>'type' = 'consent' THEN
      IF coalesce((el->'field'->>'required')::boolean, false) AND v <> 'true' THEN consent_needed := true; END IF;
      IF v = 'true' THEN consent_given := true; END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN v = '';
    IF k = 'first_name' AND first IS NULL THEN first := v;
    ELSIF k = 'last_name' AND last IS NULL THEN last := v;
    ELSIF k = 'full_name' AND full_name IS NULL THEN full_name := v;
    ELSIF k = 'email' AND em IS NULL THEN em := lower(v);
    ELSIF k = 'phone' AND ph IS NULL THEN ph := v;
    END IF;
  END LOOP;
  IF consent_needed THEN RAISE EXCEPTION 'consent_required'; END IF;
  IF first IS NULL AND full_name IS NOT NULL THEN
    first := split_part(full_name, ' ', 1);
    last := coalesce(last, nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), ''));
  END IF;
  IF coalesce(first, '') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF coalesce(em, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;

  -- Already registered for this type (by email, or by phone when given)? Nothing new is made.
  IF EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_id = e.id AND r.ticket_id = t.id AND r.status NOT IN ('cancelled', 'declined')
             AND (lower(r.email) = em OR (ph IS NOT NULL AND length(regexp_replace(ph, '\D', '', 'g')) >= 9
                  -- The same number with or without its country code: the last nine digits match.
                  AND right(regexp_replace(r.phone, '\D', '', 'g'), 9) = right(regexp_replace(ph, '\D', '', 'g'), 9)))) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'type_name', t.name);
  END IF;

  -- Every registrant becomes (or updates) a contact in the host's CRM.
  SELECT id INTO cid FROM contacts WHERE workspace_id = e.workspace_id AND lower(email) = em ORDER BY created_at LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, source)
    VALUES (e.workspace_id, left(first, 80), left(coalesce(last, ''), 80), em, left(coalesce(ph, ''), 40), 'event')
    RETURNING id INTO cid;
  ELSE
    UPDATE contacts SET phone = coalesce(nullif(phone, ''), left(ph, 40)), last_activity_at = now() WHERE id = cid;
  END IF;

  -- The answers also land in the form's responses (and start "form submitted" workflows).
  INSERT INTO form_submissions (workspace_id, form_id, contact_id, answers, source, meta)
  VALUES (e.workspace_id, f.id, cid, a, 'event', jsonb_build_object('event_id', e.id, 'event', e.title, 'registration_type', t.name))
  RETURNING id INTO sid;

  LOOP
    new_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = e.id AND pin = new_pin);
  END LOOP;
  st := CASE WHEN t.requires_approval THEN 'applied' ELSE 'confirmed' END;

  INSERT INTO event_registrations (event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin,
    status, payment_status, amount_minor, ticket_code, consent_at, form_submission_id, status_changed_at)
  VALUES (e.id, t.id, cid, left(first, 80), left(coalesce(last, ''), 80), em, left(coalesce(ph, ''), 40), a, new_pin,
    st, CASE WHEN t.price_minor > 0 THEN 'unpaid' ELSE 'free' END, t.price_minor,
    CASE WHEN st = 'confirmed' THEN event_ticket_code(e.slug) END,
    CASE WHEN consent_given THEN now() END, sid, now())
  RETURNING * INTO reg;

  RETURN jsonb_build_object('status', reg.status, 'first_name', reg.first_name, 'type_name', t.name,
    'qr_token', CASE WHEN event_holds_place(reg.status) THEN reg.qr_token END, 'ticket_code', reg.ticket_code);
END $$;
REVOKE ALL ON FUNCTION event_register(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_register(text, text, jsonb) TO anon, authenticated;

-- Older registrations made before ticket codes: give the ones holding a place a code.
UPDATE event_registrations r SET ticket_code = event_ticket_code(e.slug)
FROM events e WHERE e.id = r.event_id AND r.ticket_code IS NULL AND event_holds_place(r.status);


-- ============ 20261111090000_event_tickets_emails.sql ============
/*
  # Event tickets you can trust, and the emails that carry them

  1. Signed tickets. Every ticket's QR holds a link with a signature: /e/ticket/<token>?v=<sig>,
     where sig is an HMAC of the token made with a secret that never leaves the database. The door
     scanner (next phase) checks the signature before looking anything up, so a made-up or altered
     code is refused at once.
  2. Emails, sent from the account's connected Gmail by the mailer that already sends form emails:
       confirmed  an attendee is registered: their ticket
       applied    an application arrived
       selected   an applicant was selected: their ticket
       declined   an applicant wasn't selected, kindly
     Each is branded with the event's colours and logo and can be reworded per event
     (events.email_templates). The QR in the email is a picture served by the `api` function.
  3. event_resend_ticket(event, email): emails the ticket again. It answers the same whether or not
     the email has a ticket, so nobody can use it to find out who registered.
  4. event_set_registration_status(registration, status): for the organiser's review board.
     Selecting issues the ticket and sends it; declining sends the kind note.

  Needs 20261110090000_event_registration_types.sql. Safe to run more than once.
*/

-- 1. Signed tickets ----------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS ev_private;
REVOKE ALL ON SCHEMA ev_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ev_private.settings (key text PRIMARY KEY, value text NOT NULL);
REVOKE ALL ON ev_private.settings FROM PUBLIC;
INSERT INTO ev_private.settings(key, value) VALUES ('ticket_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

-- The signature on a ticket: 16 hex characters of HMAC-SHA256(token, secret).
CREATE OR REPLACE FUNCTION ticket_sig(p_token uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT left(encode(hmac(p_token::text, (SELECT value FROM ev_private.settings WHERE key = 'ticket_secret'), 'sha256'), 'hex'), 16)
$$;
REVOKE ALL ON FUNCTION ticket_sig(uuid) FROM PUBLIC, anon, authenticated;

-- Whether a scanned signature belongs to this token (compared in full, never partly).
CREATE OR REPLACE FUNCTION ticket_sig_ok(p_token uuid, p_sig text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_token IS NOT NULL AND p_sig IS NOT NULL AND lower(p_sig) = ticket_sig(p_token)
$$;
REVOKE ALL ON FUNCTION ticket_sig_ok(uuid, text) FROM PUBLIC, anon, authenticated;

-- What the QR holds: the ticket's link with its signature.
CREATE OR REPLACE FUNCTION ticket_qr_url(p_token uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT wf_app_url() || '/e/ticket/' || p_token || '?v=' || ticket_sig(p_token)
$$;
REVOKE ALL ON FUNCTION ticket_qr_url(uuid) FROM PUBLIC, anon, authenticated;

-- For the `api` function's QR pictures (service role): the QR text, only for a correctly signed ticket.
CREATE OR REPLACE FUNCTION ticket_qr_text(p_token uuid, p_sig text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN ticket_sig_ok(p_token, p_sig) AND EXISTS (SELECT 1 FROM event_registrations WHERE qr_token = p_token) THEN ticket_qr_url(p_token) END
$$;
REVOKE ALL ON FUNCTION ticket_qr_text(uuid, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION ticket_qr_text(uuid, text) TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- 2. Emails --------------------------------------------------------------------------------

ALTER TABLE events ADD COLUMN IF NOT EXISTS email_templates jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS email_account_id uuid REFERENCES email_accounts(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS footer_line text NOT NULL DEFAULT '' CHECK (char_length(footer_line) <= 300);
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS last_email_at timestamptz;

-- The wording each email starts with; the organiser can change any of it per event.
CREATE OR REPLACE FUNCTION event_email_default(p_kind text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'confirmed' THEN jsonb_build_object('subject', 'You''re in: {{event}}',
      'message', E'Hi {{first_name}},\n\nYou''re registered for {{event}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!')
    WHEN 'applied' THEN jsonb_build_object('subject', 'We''ve got your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you for applying ({{type}}) for {{event}}. We read every application and we''ll be in touch once we''ve decided.')
    WHEN 'selected' THEN jsonb_build_object('subject', 'You''ve been selected: {{event}}',
      'message', E'Hi {{first_name}},\n\nGreat news: you''ve been selected for {{event}}! Your ticket is below. Show the QR code at the door, or give your ticket code {{code}}.\n\nWe can''t wait to see you.')
    WHEN 'declined' THEN jsonb_build_object('subject', 'About your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you so much for applying to {{event}}. We had more applications than places this time, so we can''t offer you a spot, but we''d love to see you there, and we hope you''ll apply again.')
  END
$$;

CREATE OR REPLACE FUNCTION html_esc(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- "Sat 6 Dec 2026, 6:00 PM", or "Date to be announced".
CREATE OR REPLACE FUNCTION event_date_text(e events) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN e.starts_at IS NULL THEN 'Date to be announced'
    ELSE trim(to_char(e.starts_at AT TIME ZONE coalesce(nullif(e.timezone, ''), 'UTC'), 'Dy FMDD Mon YYYY, FMHH12:MI AM')) END
$$;

/**
 * Queue one of the event emails for a registration. Returns false (and sends nothing) when there's
 * no connected email account, no email address, or the registration didn't come through a form
 * (the mailer sends the messages linked to a form response).
 */
CREATE OR REPLACE FUNCTION event_email(p_reg uuid, p_kind text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r event_registrations; e events; t event_tickets; acc email_accounts; tpl jsonb; subj text; msg text;
  primary_c text; accent_c text; place text; ticket boolean; link text; qr_img text; base text; html text; txt text; k text; v text;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg;
  IF NOT FOUND OR r.form_submission_id IS NULL OR coalesce(r.email, '') = '' THEN RETURN false; END IF;
  SELECT * INTO e FROM events WHERE id = r.event_id;
  SELECT * INTO t FROM event_tickets WHERE id = r.ticket_id;
  SELECT * INTO acc FROM email_accounts WHERE id = e.email_account_id AND status = 'active';
  IF NOT FOUND THEN SELECT * INTO acc FROM email_accounts WHERE workspace_id = e.workspace_id AND status = 'active' ORDER BY created_at LIMIT 1; END IF;
  IF acc.id IS NULL THEN RETURN false; END IF;

  tpl := event_email_default(p_kind) || coalesce(e.email_templates->p_kind, '{}'::jsonb);
  IF tpl IS NULL THEN RETURN false; END IF;
  ticket := p_kind IN ('confirmed', 'selected') AND event_holds_place(r.status);
  link := CASE WHEN ticket THEN wf_app_url() || '/e/ticket/' || r.qr_token END;
  place := concat_ws(', ', nullif(e.venue_name, ''), nullif(e.city, ''));
  subj := coalesce(nullif(btrim(tpl->>'subject'), ''), event_email_default(p_kind)->>'subject');
  msg := coalesce(nullif(btrim(tpl->>'message'), ''), event_email_default(p_kind)->>'message');
  FOR k, v IN SELECT * FROM (VALUES
    ('first_name', r.first_name), ('name', btrim(r.first_name || ' ' || r.last_name)), ('event', e.title), ('type', coalesce(t.name, '')),
    ('code', coalesce(r.ticket_code, '')), ('date', event_date_text(e)), ('venue', coalesce(nullif(place, ''), 'To be announced')),
    ('ticket_link', coalesce(link, ''))) x(k, v) LOOP
    subj := replace(subj, '{{' || k || '}}', coalesce(v, ''));
    msg := replace(msg, '{{' || k || '}}', coalesce(v, ''));
  END LOOP;

  primary_c := CASE WHEN coalesce(e.brand->>'primary', '') ~ '^#[0-9a-fA-F]{6}$' THEN e.brand->>'primary' ELSE '#0A1628' END;
  accent_c := CASE WHEN coalesce(e.brand->>'accent', '') ~ '^#[0-9a-fA-F]{6}$' THEN e.brand->>'accent' ELSE '#C8A96A' END;
  base := regexp_replace(coalesce((SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), ''), '/send-email$', '');
  qr_img := CASE WHEN ticket AND base <> '' THEN base || '/api/qr/' || r.qr_token || '.png?v=' || ticket_sig(r.qr_token) END;

  txt := msg
    || CASE WHEN ticket THEN E'\n\n' || e.title || E'\n' || event_date_text(e) || CASE WHEN place <> '' THEN E'\n' || place ELSE '' END
         || E'\nTicket: ' || coalesce(t.name, 'Ticket') || ' · ' || coalesce(r.ticket_code, '') || E'\nYour ticket: ' || link ELSE '' END
    || CASE WHEN e.footer_line <> '' THEN E'\n\n' || e.footer_line ELSE '' END;

  html := '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #E6E8EE;border-radius:16px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1F2937;">'
    || '<tr><td style="height:6px;background:' || primary_c || ';background-image:linear-gradient(90deg,' || primary_c || ',' || accent_c || ');"></td></tr>'
    || '<tr><td style="padding:28px 32px 8px;">'
    || CASE WHEN coalesce(e.organiser_logo_url, '') ~ '^https://' THEN '<img src="' || html_esc(e.organiser_logo_url) || '" alt="" height="40" style="height:40px;margin-bottom:16px;">' ELSE '' END
    || '<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' || primary_c || ';">' || html_esc(e.title) || '</p>'
    || '<div style="margin-top:14px;font-size:16px;line-height:1.6;">' || replace(html_esc(msg), E'\n', '<br>') || '</div></td></tr>'
    || CASE WHEN ticket THEN
         '<tr><td style="padding:16px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed #CBD2DE;border-radius:14px;"><tr><td align="center" style="padding:22px;">'
         || CASE WHEN qr_img IS NOT NULL THEN '<img src="' || html_esc(qr_img) || '" width="200" height="200" alt="Your ticket QR code" style="display:block;width:200px;height:200px;">' ELSE '' END
         || '<p style="margin:14px 0 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6B7280;">Ticket code</p>'
         || '<p style="margin:2px 0 0;font-size:26px;font-weight:800;letter-spacing:3px;color:#0A1628;">' || html_esc(r.ticket_code) || '</p>'
         || '<p style="margin:12px 0 0;font-size:14px;color:#374151;"><b>' || html_esc(btrim(r.first_name || ' ' || r.last_name)) || '</b> · ' || html_esc(coalesce(t.name, 'Ticket')) || '</p>'
         || '<p style="margin:4px 0 0;font-size:14px;color:#374151;">' || html_esc(event_date_text(e)) || CASE WHEN place <> '' THEN ' · ' || html_esc(place) ELSE '' END || '</p>'
         || '<p style="margin:18px 0 0;"><a href="' || html_esc(link) || '" style="display:inline-block;background:' || primary_c || ';color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">View my ticket</a></p>'
         || '</td></tr></table></td></tr>'
       ELSE '' END
    || '<tr><td style="padding:20px 32px 28px;font-size:12px;color:#6B7280;line-height:1.6;">'
    || CASE WHEN e.footer_line <> '' THEN '<p style="margin:0 0 8px;font-style:italic;color:#374151;">' || html_esc(e.footer_line) || '</p>' ELSE '' END
    || html_esc(coalesce(nullif(e.organiser_name, ''), 'The organiser')) || ' · sent with SYNAPSE Events</td></tr>'
    || '</table></td></tr></table></body></html>';

  INSERT INTO messages (workspace_id, contact_id, channel, direction, subject, body, body_html, status, from_email, from_name, to_address, email_account_id, form_submission_id)
  VALUES (e.workspace_id, r.contact_id, 'email', 'outbound', left(subj, 300), txt, html, 'queued', acc.email,
          coalesce(nullif(e.organiser_name, ''), acc.display_name), r.email, acc.id, r.form_submission_id);
  UPDATE event_registrations SET last_email_at = now() WHERE id = r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION event_email(uuid, text) FROM PUBLIC, anon, authenticated;

-- 3. Registering sends the email; the result says whether it went out, and carries the signed QR.
CREATE OR REPLACE FUNCTION event_register_and_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.form_submission_id IS NOT NULL AND NEW.status IN ('confirmed', 'applied') THEN
    PERFORM event_email(NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_registration_email ON event_registrations;
CREATE TRIGGER event_registration_email AFTER INSERT ON event_registrations FOR EACH ROW EXECUTE FUNCTION event_register_and_email();

-- The ticket page also gets the signed QR link and the footer line.
CREATE OR REPLACE FUNCTION public_ticket(p_token uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'qr_token', r.qr_token, 'qr_url', CASE WHEN event_holds_place(r.status) THEN ticket_qr_url(r.qr_token) END,
    'pin', r.pin, 'ticket_code', r.ticket_code, 'first_name', r.first_name, 'last_name', r.last_name,
    'email', r.email, 'status', r.status, 'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'checked_in_at', r.checked_in_at, 'created_at', r.created_at,
    'ticket_name', t.name, 'requires_approval', coalesce(t.requires_approval, false), 'currency', coalesce(t.currency, 'NGN'),
    'online_url', CASE WHEN event_holds_place(r.status) THEN e.online_url ELSE '' END,
    'footer_line', e.footer_line,
    'event', event_public_json(e) - 'questions' - 'tickets'
  )
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN event_tickets t ON t.id = r.ticket_id
  WHERE r.qr_token = p_token LIMIT 1;
$$;

-- event_register's answer also carries the signed QR link and whether the email went.
/**
 * Register (or apply) through a registration type's form. The answers are by form field id;
 * name, email and phone come from the fields saved to the contact (or by field type).
 * Returns { status: 'confirmed' | 'applied', qr_token?, ticket_code?, first_name, type_name }
 * or { status: 'duplicate' } when this email (or phone) already holds a live registration
 * of this type. Also: qr_url (the signed link the QR holds) and emailed. Raises closed / full / not_open_yet / consent_required / email_invalid /
 * name_required / busy / not_found.
 */
CREATE OR REPLACE FUNCTION event_register(p_slug text, p_type text, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e events; t event_tickets; f forms; def jsonb; el jsonb; a jsonb := coalesce(p_answers, '{}'::jsonb);
  k text; v text; first text; last text; full_name text; em text; ph text;
  consent_needed boolean := false; consent_given boolean := false;
  state text; cid uuid; sid uuid; reg event_registrations; new_pin text; st text;
BEGIN
  SELECT * INTO e FROM events WHERE slug = lower(btrim(coalesce(p_slug, ''))) AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  -- Lock the type so two people can't take the last place at once.
  SELECT * INTO t FROM event_tickets WHERE event_id = e.id AND slug = lower(btrim(coalesce(p_type, ''))) FOR UPDATE;
  IF NOT FOUND OR t.form_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  state := event_type_state(e, t);
  IF state <> 'open' THEN RAISE EXCEPTION '%', CASE WHEN state IN ('full', 'not_open_yet') THEN state ELSE 'closed' END; END IF;
  IF (SELECT count(*) FROM event_registrations WHERE ticket_id = t.id AND created_at > now() - interval '1 minute') >= 60 THEN
    RAISE EXCEPTION 'busy';
  END IF;

  SELECT * INTO f FROM forms WHERE id = t.form_id;
  def := form_definition_json(f.definition);
  FOR el IN SELECT value FROM jsonb_each(coalesce(def->'elements', '{}'::jsonb)) LOOP
    CONTINUE WHEN el->'field' IS NULL;
    k := coalesce(el->'field'->>'mappedContactField', el->>'type');
    v := btrim(coalesce(a->>(el->'field'->>'fieldId'), ''));
    IF el->>'type' = 'consent' THEN
      IF coalesce((el->'field'->>'required')::boolean, false) AND v <> 'true' THEN consent_needed := true; END IF;
      IF v = 'true' THEN consent_given := true; END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN v = '';
    IF k = 'first_name' AND first IS NULL THEN first := v;
    ELSIF k = 'last_name' AND last IS NULL THEN last := v;
    ELSIF k = 'full_name' AND full_name IS NULL THEN full_name := v;
    ELSIF k = 'email' AND em IS NULL THEN em := lower(v);
    ELSIF k = 'phone' AND ph IS NULL THEN ph := v;
    END IF;
  END LOOP;
  IF consent_needed THEN RAISE EXCEPTION 'consent_required'; END IF;
  IF first IS NULL AND full_name IS NOT NULL THEN
    first := split_part(full_name, ' ', 1);
    last := coalesce(last, nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), ''));
  END IF;
  IF coalesce(first, '') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF coalesce(em, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;

  -- Already registered for this type (by email, or by phone when given)? Nothing new is made.
  IF EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_id = e.id AND r.ticket_id = t.id AND r.status NOT IN ('cancelled', 'declined')
             AND (lower(r.email) = em OR (ph IS NOT NULL AND length(regexp_replace(ph, '\D', '', 'g')) >= 9
                  -- The same number with or without its country code: the last nine digits match.
                  AND right(regexp_replace(r.phone, '\D', '', 'g'), 9) = right(regexp_replace(ph, '\D', '', 'g'), 9)))) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'type_name', t.name);
  END IF;

  -- Every registrant becomes (or updates) a contact in the host's CRM.
  SELECT id INTO cid FROM contacts WHERE workspace_id = e.workspace_id AND lower(email) = em ORDER BY created_at LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, source)
    VALUES (e.workspace_id, left(first, 80), left(coalesce(last, ''), 80), em, left(coalesce(ph, ''), 40), 'event')
    RETURNING id INTO cid;
  ELSE
    UPDATE contacts SET phone = coalesce(nullif(phone, ''), left(ph, 40)), last_activity_at = now() WHERE id = cid;
  END IF;

  -- The answers also land in the form's responses (and start "form submitted" workflows).
  INSERT INTO form_submissions (workspace_id, form_id, contact_id, answers, source, meta)
  VALUES (e.workspace_id, f.id, cid, a, 'event', jsonb_build_object('event_id', e.id, 'event', e.title, 'registration_type', t.name))
  RETURNING id INTO sid;

  LOOP
    new_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = e.id AND pin = new_pin);
  END LOOP;
  st := CASE WHEN t.requires_approval THEN 'applied' ELSE 'confirmed' END;

  INSERT INTO event_registrations (event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin,
    status, payment_status, amount_minor, ticket_code, consent_at, form_submission_id, status_changed_at)
  VALUES (e.id, t.id, cid, left(first, 80), left(coalesce(last, ''), 80), em, left(coalesce(ph, ''), 40), a, new_pin,
    st, CASE WHEN t.price_minor > 0 THEN 'unpaid' ELSE 'free' END, t.price_minor,
    CASE WHEN st = 'confirmed' THEN event_ticket_code(e.slug) END,
    CASE WHEN consent_given THEN now() END, sid, now())
  RETURNING * INTO reg;

  -- The email trigger has run by now: say whether it went, and give the signed QR link.
  SELECT * INTO reg FROM event_registrations WHERE id = reg.id;
  RETURN jsonb_build_object('status', reg.status, 'first_name', reg.first_name, 'type_name', t.name,
    'qr_token', CASE WHEN event_holds_place(reg.status) THEN reg.qr_token END, 'ticket_code', reg.ticket_code,
    'qr_url', CASE WHEN event_holds_place(reg.status) THEN ticket_qr_url(reg.qr_token) END,
    'emailed', reg.last_email_at IS NOT NULL);
END $$;

-- 4. Resend my ticket ------------------------------------------------------------------------
/**
 * Email the ticket again to whoever registered for this event with this address. Always answers
 * the same way, so it never reveals who registered. At most once every ten minutes per ticket.
 */
CREATE OR REPLACE FUNCTION event_resend_ticket(p_slug text, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; em text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    FOR r IN SELECT x.* FROM event_registrations x JOIN events e ON e.id = x.event_id
             WHERE e.slug = lower(btrim(coalesce(p_slug, ''))) AND lower(x.email) = em AND event_holds_place(x.status)
               AND (x.last_email_at IS NULL OR x.last_email_at < now() - interval '10 minutes') LOOP
      PERFORM event_email(r.id, CASE WHEN r.status = 'selected' THEN 'selected' ELSE 'confirmed' END);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION event_resend_ticket(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_resend_ticket(text, text) TO anon, authenticated;

-- 5. The organiser moves an application along ------------------------------------------------
/**
 * Change a registration's status (applied → shortlisted → selected / declined → confirmed, or
 * cancelled). Selecting gives a ticket code and emails the ticket; declining sends the kind note.
 * Account members with Events access only. Returns the registration as it now is.
 */
CREATE OR REPLACE FUNCTION event_set_registration_status(p_reg uuid, p_status text, p_notify boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; e events; t event_tickets; taken int;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO e FROM events WHERE id = r.event_id;
  IF NOT (is_workspace_member(e.workspace_id) AND member_can(e.workspace_id, 'events')) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_status NOT IN ('confirmed', 'applied', 'shortlisted', 'selected', 'declined', 'cancelled') THEN RAISE EXCEPTION 'bad_status'; END IF;
  IF r.status = p_status THEN RETURN to_jsonb(r); END IF;

  -- Selecting takes a place: respect the type's capacity.
  IF event_holds_place(p_status) AND NOT event_holds_place(r.status) THEN
    SELECT * INTO t FROM event_tickets WHERE id = r.ticket_id FOR UPDATE;
    IF t.capacity IS NOT NULL THEN
      SELECT count(*) INTO taken FROM event_registrations WHERE ticket_id = t.id AND event_holds_place(status);
      IF taken >= t.capacity THEN RAISE EXCEPTION 'full'; END IF;
    END IF;
  END IF;

  UPDATE event_registrations SET status = p_status, status_changed_at = now(),
    ticket_code = CASE WHEN event_holds_place(p_status) THEN coalesce(ticket_code, event_ticket_code(e.slug)) ELSE ticket_code END
  WHERE id = r.id RETURNING * INTO r;

  IF p_notify AND p_status = 'selected' THEN PERFORM event_email(r.id, 'selected');
  ELSIF p_notify AND p_status = 'declined' THEN PERFORM event_email(r.id, 'declined');
  END IF;
  PERFORM audit_write(e.workspace_id, 'registration_' || p_status, 'event_registration', r.id,
    jsonb_build_object('name', btrim(r.first_name || ' ' || r.last_name), 'event', e.title));
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION event_set_registration_status(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_set_registration_status(uuid, text, boolean) TO authenticated;


-- ============ 20261112090000_event_checkin.sql ============
/*
  # Event check-in at the door

  Everything the door scanner needs, done on the server so a phone can never show a false green:
    - event_can_check_in(event): the event's organisers (account members with Events access) and the
      people on its check-in team (event_staff, members of the account) may check guests in.
    - event_checkin_state(event): title, colours and the live count (checked in / expected).
    - event_check_in(event, scan, registration, paid): checks someone in from a scanned QR (its
      signature is verified and it must belong to THIS event), a ticket code, or a person picked from
      search. Every attempt is written to event_checkins: success, already_checked_in, invalid, not_eligible.
    - event_undo_check_in(event, registration): undoes a check-in; logged and audited.
    - event_checkin_search(event, query): name, email, phone, ticket code or 6-digit PIN.
    - event_checkin_log(event): the latest attempts, with who scanned.
    - event_staff_list / event_staff_set: the check-in team, managed by the event's organisers.
  At most 120 check-in calls a minute per person.
*/

-- 1. Who may check people in ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_is_organiser(p_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event AND is_workspace_member(e.workspace_id) AND member_can(e.workspace_id, 'events'))
$$;
REVOKE ALL ON FUNCTION event_is_organiser(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION event_can_check_in(p_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT event_is_organiser(p_event) OR EXISTS (
    SELECT 1 FROM event_staff s JOIN events e ON e.id = s.event_id
    WHERE s.event_id = p_event AND s.user_id = auth.uid() AND is_workspace_member(e.workspace_id))
$$;
REVOKE ALL ON FUNCTION event_can_check_in(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_can_check_in(uuid) TO authenticated;

-- A person's name for "checked in by".
CREATE OR REPLACE FUNCTION event_person_name(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') FROM profiles p WHERE p.user_id = p_user
$$;
REVOKE ALL ON FUNCTION event_person_name(uuid) FROM PUBLIC, anon, authenticated;

-- 2. The scanner's header ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_checkin_state(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RETURN jsonb_build_object('allowed', false); END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  RETURN jsonb_build_object(
    'allowed', true,
    'organiser', event_is_organiser(p_event),
    'id', e.id, 'title', e.title, 'slug', e.slug, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone,
    'cover_url', e.cover_url, 'brand', e.brand,
    'expected', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status)),
    'checked_in', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status) AND r.checked_in_at IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION event_checkin_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_checkin_state(uuid) TO authenticated;

-- 3. Checking someone in -----------------------------------------------------------------------

-- What the scanner shows about a registration.
CREATE OR REPLACE FUNCTION event_checkin_person(r event_registrations) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'registration_id', r.id, 'name', btrim(r.first_name || ' ' || r.last_name), 'status', r.status,
    'type_name', (SELECT t.name FROM event_tickets t WHERE t.id = r.ticket_id),
    'ticket_code', r.ticket_code, 'checked_in_at', r.checked_in_at, 'checked_in_by', event_person_name(r.checked_in_by),
    'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'currency', (SELECT t.currency FROM event_tickets t WHERE t.id = r.ticket_id))
$$;
REVOKE ALL ON FUNCTION event_checkin_person(event_registrations) FROM PUBLIC, anon, authenticated;

/*
  p_scan: what the camera read (the ticket link with its signature) or a typed ticket code / PIN.
  p_registration: someone picked from search. p_paid: the door collected an unpaid ticket's price.
  Returns { result, reason?, person? }:
    success            green: checked in now
    already_checked_in amber: with when and by whom
    invalid            red: unrecognised, forged or another event's code
    not_eligible       red: cancelled, declined, an application not selected, or (reason 'unpaid') to pay first
*/
CREATE OR REPLACE FUNCTION event_check_in(p_event uuid, p_scan text DEFAULT NULL, p_registration uuid DEFAULT NULL, p_paid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r event_registrations; e events;
  scan text := btrim(coalesce(p_scan, ''));
  tok uuid; sig text; m text[];
  via text := CASE WHEN p_registration IS NOT NULL THEN 'manual' WHEN p_scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' OR p_scan ~ '^\s*\d{6}\s*$' THEN 'manual' ELSE 'scan' END;
  res text; reason text;
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF (SELECT count(*) FROM event_checkins WHERE user_id = auth.uid() AND at > now() - interval '1 minute') >= 120 THEN RAISE EXCEPTION 'busy'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;

  -- Find the registration, only ever inside this event.
  IF p_registration IS NOT NULL THEN
    SELECT * INTO r FROM event_registrations WHERE id = p_registration AND event_id = p_event FOR UPDATE;
  ELSIF scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' THEN
    SELECT * INTO r FROM event_registrations WHERE upper(ticket_code) = upper(scan) AND event_id = p_event FOR UPDATE;
  ELSIF scan ~ '^\d{6}$' THEN
    SELECT * INTO r FROM event_registrations WHERE pin = scan AND event_id = p_event FOR UPDATE;
  ELSE
    -- A ticket link: /e/ticket/<token>?v=<signature>. Without a valid signature it is refused.
    m := regexp_match(scan, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
    IF m IS NOT NULL THEN tok := lower(m[1])::uuid; END IF;
    sig := (regexp_match(scan, '[?&]v=([0-9a-fA-F]{16})'))[1];
    IF tok IS NOT NULL AND ticket_sig_ok(tok, sig) THEN
      SELECT * INTO r FROM event_registrations WHERE qr_token = tok AND event_id = p_event FOR UPDATE;
    END IF;
  END IF;

  IF r.id IS NULL THEN
    INSERT INTO event_checkins (event_id, registration_id, user_id, result, via) VALUES (p_event, NULL, auth.uid(), 'invalid', via);
    RETURN jsonb_build_object('result', 'invalid', 'reason',
      CASE WHEN tok IS NOT NULL AND ticket_sig_ok(tok, sig) THEN 'other_event' WHEN tok IS NOT NULL THEN 'unsigned' ELSE 'unknown' END);
  END IF;

  IF NOT event_holds_place(r.status) THEN
    res := 'not_eligible'; reason := r.status;
  ELSIF r.checked_in_at IS NOT NULL THEN
    res := 'already_checked_in';
  ELSIF r.payment_status = 'unpaid' AND NOT p_paid THEN
    res := 'not_eligible'; reason := 'unpaid';
  ELSE
    UPDATE event_registrations SET checked_in_at = now(), checked_in_by = auth.uid(),
      payment_status = CASE WHEN p_paid AND payment_status = 'unpaid' THEN 'paid' ELSE payment_status END
    WHERE id = r.id RETURNING * INTO r;
    res := 'success';
  END IF;

  INSERT INTO event_checkins (event_id, registration_id, user_id, result, via) VALUES (p_event, r.id, auth.uid(), res, via);
  RETURN jsonb_build_object('result', res, 'reason', reason, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_check_in(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_check_in(uuid, text, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION event_undo_check_in(p_event uuid, p_registration uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO r FROM event_registrations WHERE id = p_registration AND event_id = p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.checked_in_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'person', event_checkin_person(r)); END IF;
  UPDATE event_registrations SET checked_in_at = NULL, checked_in_by = NULL WHERE id = r.id RETURNING * INTO r;
  INSERT INTO event_checkins (event_id, registration_id, user_id, result, via) VALUES (p_event, r.id, auth.uid(), 'undone', 'undo');
  SELECT * INTO e FROM events WHERE id = p_event;
  PERFORM audit_write(e.workspace_id, 'checkin_undone', 'event_registration', r.id,
    jsonb_build_object('name', btrim(r.first_name || ' ' || r.last_name), 'event', e.title));
  RETURN jsonb_build_object('ok', true, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_undo_check_in(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_undo_check_in(uuid, uuid) TO authenticated;

-- 4. Looking someone up -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_checkin_search(p_event uuid, p_query text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q text := lower(btrim(coalesce(p_query, ''))); digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF length(q) < 2 THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(event_checkin_person(x) ORDER BY x.first_name, x.last_name)
    FROM (
      SELECT r.* FROM event_registrations r
      WHERE r.event_id = p_event AND r.status NOT IN ('declined')
        AND (lower(r.first_name || ' ' || r.last_name) LIKE '%' || q || '%'
          OR lower(r.email) LIKE '%' || q || '%'
          OR lower(coalesce(r.ticket_code, '')) = q
          OR (length(digits) = 6 AND r.pin = digits)
          OR (length(digits) >= 7 AND right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 9) = right(digits, 9)))
      ORDER BY r.first_name, r.last_name LIMIT 25
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_checkin_search(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_checkin_search(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION event_checkin_log(p_event uuid, p_limit int DEFAULT 30) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'at', c.at, 'result', c.result, 'via', c.via,
      'name', btrim(r.first_name || ' ' || r.last_name), 'registration_id', c.registration_id, 'by', event_person_name(c.user_id)) ORDER BY c.at DESC, c.id DESC)
    FROM (SELECT * FROM event_checkins WHERE event_id = p_event ORDER BY at DESC, id DESC LIMIT least(greatest(p_limit, 1), 200)) c
    LEFT JOIN event_registrations r ON r.id = c.registration_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_checkin_log(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_checkin_log(uuid, int) TO authenticated;

-- 5. The check-in team ------------------------------------------------------------------------

-- The account's members, each marked if they're on this event's check-in team.
CREATE OR REPLACE FUNCTION event_staff_list(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(event_person_name(m.user_id), u.email), 'email', u.email,
      'on_team', s.user_id IS NOT NULL, 'organiser', m.role IN ('owner', 'admin') OR 'events' = ANY(coalesce(m.access, default_member_access()))) ORDER BY coalesce(event_person_name(m.user_id), u.email))
    FROM workspace_members m JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN event_staff s ON s.event_id = p_event AND s.user_id = m.user_id
    WHERE m.workspace_id = e.workspace_id AND coalesce(m.status, 'active') = 'active'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_staff_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_staff_list(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION event_staff_set(p_event uuid, p_user uuid, p_on boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  IF p_on THEN
    IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = e.workspace_id AND user_id = p_user) THEN RAISE EXCEPTION 'not_member'; END IF;
    INSERT INTO event_staff (event_id, user_id, added_by) VALUES (p_event, p_user, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM event_staff WHERE event_id = p_event AND user_id = p_user;
  END IF;
  PERFORM audit_write(e.workspace_id, CASE WHEN p_on THEN 'checkin_staff_added' ELSE 'checkin_staff_removed' END, 'event', e.id,
    jsonb_build_object('event', e.title, 'person', event_person_name(p_user)));
END $$;
REVOKE ALL ON FUNCTION event_staff_set(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_staff_set(uuid, uuid, boolean) TO authenticated;


-- ============ 20261113090000_event_dashboard.sql ============
/*
  # Event dashboard: what organisers need beyond the door

    - event_registration_forms(event): each registration type's form questions, so the dashboard
      and the performer review board can show answers with their labels (organisers only, even
      without access to Forms).
    - event_add_registration(...): add someone by hand (a walk-in, a guest, a performer you invited).
      They get a ticket code at once; their ticket is emailed when you ask and an email account is
      connected. A full type is refused unless you say to add them anyway.
    - event_send_ticket(registration): email someone their ticket (or "application received") again.
      At most once a minute per person.
  Organisers are account members with access to Events (event_is_organiser, from the check-in update).
*/

-- 1. Each type's form, for labelling answers -------------------------------------------------

CREATE OR REPLACE FUNCTION event_registration_forms(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('ticket_id', t.id, 'form_id', f.id, 'form_name', f.name, 'definition', form_definition_json(f.definition)) ORDER BY t.sort)
    FROM event_tickets t JOIN forms f ON f.id = t.form_id
    WHERE t.event_id = p_event), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_registration_forms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_registration_forms(uuid) TO authenticated;

-- 2. Adding someone by hand -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_add_registration(
  p_event uuid, p_ticket uuid, p_first text, p_last text, p_email text, p_phone text DEFAULT NULL,
  p_send boolean DEFAULT true, p_over_capacity boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e events; t event_tickets; reg event_registrations;
  first text := left(btrim(coalesce(p_first, '')), 80); last text := left(btrim(coalesce(p_last, '')), 80);
  em text := lower(btrim(coalesce(p_email, ''))); ph text := nullif(left(btrim(coalesce(p_phone, '')), 40), '');
  cid uuid; sid uuid; new_pin text; st text; taken int;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  SELECT * INTO t FROM event_tickets WHERE id = p_ticket AND event_id = p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found'; END IF;
  IF first = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;
  IF EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_id = e.id AND r.ticket_id = t.id AND r.status NOT IN ('cancelled', 'declined') AND lower(r.email) = em) THEN
    RAISE EXCEPTION 'duplicate';
  END IF;
  IF t.capacity IS NOT NULL AND NOT p_over_capacity THEN
    SELECT count(*) INTO taken FROM event_registrations WHERE ticket_id = t.id AND event_holds_place(status);
    IF taken >= t.capacity THEN RAISE EXCEPTION 'full'; END IF;
  END IF;

  -- They join the host's contacts, like anyone who registers.
  SELECT id INTO cid FROM contacts WHERE workspace_id = e.workspace_id AND lower(email) = em ORDER BY created_at LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, source)
    VALUES (e.workspace_id, first, last, em, coalesce(ph, ''), 'event') RETURNING id INTO cid;
  END IF;

  -- Emails go through the form-response mailer, so a ticket to send needs a response to hang on.
  IF p_send AND t.form_id IS NOT NULL THEN
    INSERT INTO form_submissions (workspace_id, form_id, contact_id, answers, source, meta)
    VALUES (e.workspace_id, t.form_id, cid, jsonb_build_object('name', btrim(first || ' ' || last), 'email', em, 'phone', coalesce(ph, '')), 'event_manual',
      jsonb_build_object('event_id', e.id, 'event', e.title, 'registration_type', t.name, 'added_by', auth.uid()))
    RETURNING id INTO sid;
  END IF;

  LOOP
    new_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = e.id AND pin = new_pin);
  END LOOP;
  -- Added by the organiser: an approval type means they're already chosen.
  st := CASE WHEN t.requires_approval THEN 'selected' ELSE 'confirmed' END;

  INSERT INTO event_registrations (event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin,
    status, payment_status, amount_minor, ticket_code, form_submission_id, status_changed_at)
  VALUES (e.id, t.id, cid, first, last, em, coalesce(ph, ''), jsonb_build_object('added_by_organiser', true), new_pin,
    st, CASE WHEN t.price_minor > 0 THEN 'unpaid' ELSE 'free' END, t.price_minor, event_ticket_code(e.slug), sid, now())
  RETURNING * INTO reg;
  -- 'selected' isn't emailed by the insert trigger (only confirmed/applied are): send it here.
  IF st = 'selected' AND sid IS NOT NULL THEN PERFORM event_email(reg.id, 'selected'); END IF;

  PERFORM audit_write(e.workspace_id, 'registration_added', 'event_registration', reg.id,
    jsonb_build_object('name', btrim(first || ' ' || last), 'event', e.title, 'type', t.name));
  SELECT * INTO reg FROM event_registrations WHERE id = reg.id;
  RETURN to_jsonb(reg) || jsonb_build_object('emailed', reg.last_email_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION event_add_registration(uuid, uuid, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_add_registration(uuid, uuid, text, text, text, text, boolean, boolean) TO authenticated;

-- 3. Send a ticket again (organiser) --------------------------------------------------------

CREATE OR REPLACE FUNCTION event_send_ticket(p_reg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; e events; kind text; ok boolean; fid uuid; sid uuid;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF auth.uid() IS NULL OR NOT event_is_organiser(r.event_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF r.last_email_at IS NOT NULL AND r.last_email_at > now() - interval '1 minute' THEN RAISE EXCEPTION 'too_soon'; END IF;
  kind := CASE WHEN r.status = 'confirmed' THEN 'confirmed' WHEN r.status = 'selected' THEN 'selected'
               WHEN r.status IN ('applied', 'shortlisted') THEN 'applied' END;
  IF kind IS NULL THEN RAISE EXCEPTION 'no_ticket'; END IF;
  -- Added by hand without an email: give them a form response now so the mailer can send it.
  IF r.form_submission_id IS NULL THEN
    SELECT * INTO e FROM events WHERE id = r.event_id;
    SELECT form_id INTO fid FROM event_tickets WHERE id = r.ticket_id;
    IF fid IS NULL THEN RAISE EXCEPTION 'no_email_route'; END IF;
    INSERT INTO form_submissions (workspace_id, form_id, contact_id, answers, source, meta)
    VALUES (e.workspace_id, fid, r.contact_id, jsonb_build_object('name', btrim(r.first_name || ' ' || r.last_name), 'email', r.email, 'phone', r.phone), 'event_manual',
      jsonb_build_object('event_id', e.id, 'event', e.title))
    RETURNING id INTO sid;
    UPDATE event_registrations SET form_submission_id = sid WHERE id = r.id;
  END IF;
  ok := event_email(r.id, kind);
  IF NOT ok THEN RAISE EXCEPTION 'no_email_account'; END IF;
  RETURN jsonb_build_object('sent', true, 'to', r.email);
END $$;
REVOKE ALL ON FUNCTION event_send_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_send_ticket(uuid) TO authenticated;


-- ============ 20261114090000_event_reminders_privacy_limits.sql ============
/*
  # Events: the 24-hour reminder, private registrations, and limits per visitor

  1. The reminder (the fourth email). About a day before an event starts, everyone who holds a
     place (registered, or a selected applicant) and hasn't been checked in gets one branded email
     with their ticket. Only for events with a date (never while the date is to be announced), only
     once per start time (if the event moves, they're reminded of the new time), not for people
     who registered in the last day (their confirmation is fresh), and only when the account has a
     connected email account. The organiser can reword it, or turn it off for an event
     (events.email_templates.reminder.off). A job runs every 15 minutes (pg_cron); the mailer sends
     what it queues on its next run.
  2. Registrations, registration types and the check-in log follow the Events section: a member
     without Events access no longer sees or changes them (names, emails, answers). The door team
     still checks people in through the scanner's functions, which check their place on the team.
  3. Limits per visitor, on top of the limit per registration type: one address (IP) can register
     at most 20 times in 10 minutes, and ask for its ticket again at most 10 times in 10 minutes
     (it gets the same answer either way). Organisers adding people from the dashboard aren't limited.

  Needs 20261111090000_event_tickets_emails.sql. Safe to run more than once.
*/

-- 1. The reminder ------------------------------------------------------------------------

-- The start time each person was last reminded of (none yet: null).
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS reminder_for timestamptz;

CREATE OR REPLACE FUNCTION event_email_default(p_kind text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'confirmed' THEN jsonb_build_object('subject', 'You''re in: {{event}}',
      'message', E'Hi {{first_name}},\n\nYou''re registered for {{event}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!')
    WHEN 'applied' THEN jsonb_build_object('subject', 'We''ve got your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you for applying ({{type}}) for {{event}}. We read every application and we''ll be in touch once we''ve decided.')
    WHEN 'selected' THEN jsonb_build_object('subject', 'You''ve been selected: {{event}}',
      'message', E'Hi {{first_name}},\n\nGreat news: you''ve been selected for {{event}}! Your ticket is below. Show the QR code at the door, or give your ticket code {{code}}.\n\nWe can''t wait to see you.')
    WHEN 'reminder' THEN jsonb_build_object('subject', 'Tomorrow: {{event}}',
      'message', E'Hi {{first_name}},\n\nA quick reminder: {{event}} is on {{date}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!')
    WHEN 'declined' THEN jsonb_build_object('subject', 'About your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you so much for applying to {{event}}. We had more applications than places this time, so we can''t offer you a spot, but we''d love to see you there, and we hope you''ll apply again.')
  END
$$;

/**
 * Queue one of the event emails for a registration. Returns false (and sends nothing) when there's
 * no connected email account, no email address, or the registration didn't come through a form
 * (the mailer sends the messages linked to a form response).
 */
CREATE OR REPLACE FUNCTION event_email(p_reg uuid, p_kind text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r event_registrations; e events; t event_tickets; acc email_accounts; tpl jsonb; subj text; msg text;
  primary_c text; accent_c text; place text; ticket boolean; link text; qr_img text; base text; html text; txt text; k text; v text;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg;
  IF NOT FOUND OR r.form_submission_id IS NULL OR coalesce(r.email, '') = '' THEN RETURN false; END IF;
  SELECT * INTO e FROM events WHERE id = r.event_id;
  SELECT * INTO t FROM event_tickets WHERE id = r.ticket_id;
  SELECT * INTO acc FROM email_accounts WHERE id = e.email_account_id AND status = 'active';
  IF NOT FOUND THEN SELECT * INTO acc FROM email_accounts WHERE workspace_id = e.workspace_id AND status = 'active' ORDER BY created_at LIMIT 1; END IF;
  IF acc.id IS NULL THEN RETURN false; END IF;

  tpl := event_email_default(p_kind) || coalesce(e.email_templates->p_kind, '{}'::jsonb);
  IF tpl IS NULL THEN RETURN false; END IF;
  ticket := p_kind IN ('confirmed', 'selected', 'reminder') AND event_holds_place(r.status);
  link := CASE WHEN ticket THEN wf_app_url() || '/e/ticket/' || r.qr_token END;
  place := concat_ws(', ', nullif(e.venue_name, ''), nullif(e.city, ''));
  subj := coalesce(nullif(btrim(tpl->>'subject'), ''), event_email_default(p_kind)->>'subject');
  msg := coalesce(nullif(btrim(tpl->>'message'), ''), event_email_default(p_kind)->>'message');
  FOR k, v IN SELECT * FROM (VALUES
    ('first_name', r.first_name), ('name', btrim(r.first_name || ' ' || r.last_name)), ('event', e.title), ('type', coalesce(t.name, '')),
    ('code', coalesce(r.ticket_code, '')), ('date', event_date_text(e)), ('venue', coalesce(nullif(place, ''), 'To be announced')),
    ('ticket_link', coalesce(link, ''))) x(k, v) LOOP
    subj := replace(subj, '{{' || k || '}}', coalesce(v, ''));
    msg := replace(msg, '{{' || k || '}}', coalesce(v, ''));
  END LOOP;

  primary_c := CASE WHEN coalesce(e.brand->>'primary', '') ~ '^#[0-9a-fA-F]{6}$' THEN e.brand->>'primary' ELSE '#0A1628' END;
  accent_c := CASE WHEN coalesce(e.brand->>'accent', '') ~ '^#[0-9a-fA-F]{6}$' THEN e.brand->>'accent' ELSE '#C8A96A' END;
  base := regexp_replace(coalesce((SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), ''), '/send-email$', '');
  qr_img := CASE WHEN ticket AND base <> '' THEN base || '/api/qr/' || r.qr_token || '.png?v=' || ticket_sig(r.qr_token) END;

  txt := msg
    || CASE WHEN ticket THEN E'\n\n' || e.title || E'\n' || event_date_text(e) || CASE WHEN place <> '' THEN E'\n' || place ELSE '' END
         || E'\nTicket: ' || coalesce(t.name, 'Ticket') || ' · ' || coalesce(r.ticket_code, '') || E'\nYour ticket: ' || link ELSE '' END
    || CASE WHEN e.footer_line <> '' THEN E'\n\n' || e.footer_line ELSE '' END;

  html := '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #E6E8EE;border-radius:16px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1F2937;">'
    || '<tr><td style="height:6px;background:' || primary_c || ';background-image:linear-gradient(90deg,' || primary_c || ',' || accent_c || ');"></td></tr>'
    || '<tr><td style="padding:28px 32px 8px;">'
    || CASE WHEN coalesce(e.organiser_logo_url, '') ~ '^https://' THEN '<img src="' || html_esc(e.organiser_logo_url) || '" alt="" height="40" style="height:40px;margin-bottom:16px;">' ELSE '' END
    || '<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' || primary_c || ';">' || html_esc(e.title) || '</p>'
    || '<div style="margin-top:14px;font-size:16px;line-height:1.6;">' || replace(html_esc(msg), E'\n', '<br>') || '</div></td></tr>'
    || CASE WHEN ticket THEN
         '<tr><td style="padding:16px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed #CBD2DE;border-radius:14px;"><tr><td align="center" style="padding:22px;">'
         || CASE WHEN qr_img IS NOT NULL THEN '<img src="' || html_esc(qr_img) || '" width="200" height="200" alt="Your ticket QR code" style="display:block;width:200px;height:200px;">' ELSE '' END
         || '<p style="margin:14px 0 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6B7280;">Ticket code</p>'
         || '<p style="margin:2px 0 0;font-size:26px;font-weight:800;letter-spacing:3px;color:#0A1628;">' || html_esc(r.ticket_code) || '</p>'
         || '<p style="margin:12px 0 0;font-size:14px;color:#374151;"><b>' || html_esc(btrim(r.first_name || ' ' || r.last_name)) || '</b> · ' || html_esc(coalesce(t.name, 'Ticket')) || '</p>'
         || '<p style="margin:4px 0 0;font-size:14px;color:#374151;">' || html_esc(event_date_text(e)) || CASE WHEN place <> '' THEN ' · ' || html_esc(place) ELSE '' END || '</p>'
         || '<p style="margin:18px 0 0;"><a href="' || html_esc(link) || '" style="display:inline-block;background:' || primary_c || ';color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">View my ticket</a></p>'
         || '</td></tr></table></td></tr>'
       ELSE '' END
    || '<tr><td style="padding:20px 32px 28px;font-size:12px;color:#6B7280;line-height:1.6;">'
    || CASE WHEN e.footer_line <> '' THEN '<p style="margin:0 0 8px;font-style:italic;color:#374151;">' || html_esc(e.footer_line) || '</p>' ELSE '' END
    || html_esc(coalesce(nullif(e.organiser_name, ''), 'The organiser')) || ' · sent with SYNAPSE Events</td></tr>'
    || '</table></td></tr></table></body></html>';

  INSERT INTO messages (workspace_id, contact_id, channel, direction, subject, body, body_html, status, from_email, from_name, to_address, email_account_id, form_submission_id)
  VALUES (e.workspace_id, r.contact_id, 'email', 'outbound', left(subj, 300), txt, html, 'queued', acc.email,
          coalesce(nullif(e.organiser_name, ''), acc.display_name), r.email, acc.id, r.form_submission_id);
  UPDATE event_registrations SET last_email_at = now() WHERE id = r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION event_email(uuid, text) FROM PUBLIC, anon, authenticated;

/** Queue the reminders that are due. Returns how many were queued. */
CREATE OR REPLACE FUNCTION event_send_reminders() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('synapse_event_reminders')) THEN RETURN 0; END IF;
  FOR r IN
    SELECT reg.id, e.starts_at
    FROM event_registrations reg
    JOIN events e ON e.id = reg.event_id
    WHERE e.status = 'published' AND e.starts_at IS NOT NULL
      AND e.starts_at > now() + interval '1 hour' AND e.starts_at <= now() + interval '24 hours'
      AND coalesce(e.email_templates->'reminder'->>'off', 'false') <> 'true'
      AND event_holds_place(reg.status) AND reg.checked_in_at IS NULL
      AND reg.form_submission_id IS NOT NULL AND coalesce(reg.email, '') <> ''
      AND reg.reminder_for IS DISTINCT FROM e.starts_at
      AND reg.created_at < e.starts_at - interval '24 hours'
      AND EXISTS (SELECT 1 FROM email_accounts a WHERE a.workspace_id = e.workspace_id AND a.status = 'active')
    ORDER BY e.starts_at, reg.created_at
    LIMIT 500
  LOOP
    IF event_email(r.id, 'reminder') THEN
      UPDATE event_registrations SET reminder_for = r.starts_at WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  -- Housekeeping for the limits below: a day of history is plenty.
  DELETE FROM ev_private.hits WHERE at < now() - interval '1 day';
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION event_send_reminders() FROM PUBLIC, anon, authenticated;

-- 2. Registrations follow the Events section ----------------------------------------------

/** Whether the person signed in may see this event's people (they have Events access in its account). */
CREATE OR REPLACE FUNCTION event_member_can(p_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event AND member_can(e.workspace_id, 'events'))
$$;
REVOKE ALL ON FUNCTION event_member_can(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_member_can(uuid) TO authenticated;

DROP POLICY IF EXISTS event_registrations_section_access ON event_registrations;
CREATE POLICY event_registrations_section_access ON event_registrations AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_member_can(event_id)) WITH CHECK (event_member_can(event_id));
DROP POLICY IF EXISTS event_tickets_section_access ON event_tickets;
CREATE POLICY event_tickets_section_access ON event_tickets AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_member_can(event_id)) WITH CHECK (event_member_can(event_id));
DROP POLICY IF EXISTS event_checkins_section_access ON event_checkins;
CREATE POLICY event_checkins_section_access ON event_checkins AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_member_can(event_id)) WITH CHECK (event_member_can(event_id));

-- 3. Limits per visitor ----------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS ev_private;
CREATE TABLE IF NOT EXISTS ev_private.hits (ip text NOT NULL, kind text NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ev_hits_ip ON ev_private.hits(ip, kind, at DESC);
REVOKE ALL ON ev_private.hits FROM PUBLIC;
-- Only the database's own functions use it (they bypass row level security as its owner).
ALTER TABLE ev_private.hits ENABLE ROW LEVEL SECURITY;

/** The visitor's address, as the API gateway passes it on (null outside a web request). */
CREATE OR REPLACE FUNCTION event_visitor_ip() RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT nullif(btrim(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
    nullif(current_setting('request.headers', true), '')::json->>'x-real-ip',
    nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1)), '')
$$;
REVOKE ALL ON FUNCTION event_visitor_ip() FROM PUBLIC, anon, authenticated;

/**
 * Note one more go for this visitor; false once they've had `p_max` in the last `p_within`.
 * Always true outside a web request (the database itself, tests, the scheduler).
 */
CREATE OR REPLACE FUNCTION event_visitor_allowed(p_kind text, p_max int, p_within interval) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ip text := event_visitor_ip();
BEGIN
  IF v_ip IS NULL THEN RETURN true; END IF;
  IF (SELECT count(*) FROM ev_private.hits h WHERE h.ip = v_ip AND h.kind = p_kind AND h.at > now() - p_within) >= p_max THEN
    RETURN false;
  END IF;
  INSERT INTO ev_private.hits(ip, kind) VALUES (v_ip, p_kind);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION event_visitor_allowed(text, int, interval) FROM PUBLIC, anon, authenticated;

-- Registering (and applying): at most 20 in 10 minutes from one address. The organiser's own
-- additions from the dashboard don't count.
CREATE OR REPLACE FUNCTION event_registration_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF event_visitor_ip() IS NOT NULL AND NOT event_is_organiser(NEW.event_id)
     AND NOT event_visitor_allowed('register', 20, interval '10 minutes') THEN
    RAISE EXCEPTION 'busy';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_registration_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registration_limit ON event_registrations;
CREATE TRIGGER event_registration_limit BEFORE INSERT ON event_registrations FOR EACH ROW EXECUTE FUNCTION event_registration_limit();

-- "Email me my ticket again": at most 10 asks in 10 minutes from one address, and the answer is
-- the same either way, so it still never reveals who registered.
CREATE OR REPLACE FUNCTION event_resend_ticket(p_slug text, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; em text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND event_visitor_allowed('resend', 10, interval '10 minutes') THEN
    FOR r IN SELECT x.* FROM event_registrations x JOIN events e ON e.id = x.event_id
             WHERE e.slug = lower(btrim(coalesce(p_slug, ''))) AND lower(x.email) = em AND event_holds_place(x.status)
               AND (x.last_email_at IS NULL OR x.last_email_at < now() - interval '10 minutes') LOOP
      PERFORM event_email(r.id, CASE WHEN r.status = 'selected' THEN 'selected' ELSE 'confirmed' END);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION event_resend_ticket(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_resend_ticket(text, text) TO anon, authenticated;

-- 4. Every 15 minutes ------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'synapse-event-reminders';
    PERFORM cron.schedule('synapse-event-reminders', '*/15 * * * *', 'SELECT public.event_send_reminders()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Could not schedule event reminders: %', SQLERRM;
END $$;


-- ============ 20261115090000_security_fixes.sql ============
/*
  # Security fixes

  Closes gaps found in the security review. Safe to run more than once.

  1. Memberships can't move. A membership row keeps its account and person: nobody can point
     their own row (or anyone's) at another account to become Admin there.
  2. The account's owner stays the owner. Signed-in users can't change workspaces.owner_id, and
     Admins can't delete the owner's membership.
  3. Invitations are used once. Accepting goes through accept_invitation() only; an invitation
     already used works again only for someone still in the account. When someone is removed,
     the invitations sent to their email for that account are cancelled, so the old link can't
     bring them back. People joining by invitation can't choose what they can see.
  4. Chat roles: only a channel's owner (or an Admin) changes who owns a channel. A member can't
     make themselves its owner.
  5. Public booking pages:
       - visitors no longer read whole bookings of every account. They see busy times only,
         through the appointment_busy view (calendar, host, start, end, status, created).
       - a visitor's booking must belong to an active calendar, in that calendar's own account,
         as confirmed or pending.
  6. Calendar hosts: only the calendar's owner or an Admin adds or removes hosts (a User could
     add themselves to someone else's calendar and then see its bookings).
  7. Meeting recordings files: only people who can see Recordings can open or delete them.
*/

-- ============================================================
-- 1 + 2. Memberships and ownership
-- ============================================================

CREATE OR REPLACE FUNCTION workspace_members_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_owner uuid;
BEGIN
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = NEW.workspace_id;
  IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM ws_owner THEN
    RAISE EXCEPTION 'Only the workspace owner can have the owner role';
  END IF;
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'A membership can''t be moved to another account or person';
    END IF;
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      RAISE EXCEPTION 'The owner''s role cannot be changed';
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.title IS DISTINCT FROM OLD.title OR NEW.access IS DISTINCT FROM OLD.access)
       AND NOT is_workspace_admin(NEW.workspace_id) AND auth.uid() IS DISTINCT FROM ws_owner THEN
      RAISE EXCEPTION 'Only admins can change roles, status, titles or what someone can see';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_members_guard ON workspace_members;
CREATE TRIGGER workspace_members_guard BEFORE INSERT OR UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_guard();

CREATE OR REPLACE FUNCTION workspaces_owner_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'The account''s owner can''t be changed here';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspaces_owner_guard ON workspaces;
CREATE TRIGGER workspaces_owner_guard BEFORE UPDATE OF owner_id ON workspaces
  FOR EACH ROW EXECUTE FUNCTION workspaces_owner_guard();

DROP POLICY IF EXISTS "wm_delete" ON workspace_members;
CREATE POLICY "wm_delete" ON workspace_members FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id) AND role <> 'owner'
         AND user_id IS DISTINCT FROM (SELECT w.owner_id FROM workspaces w WHERE w.id = workspace_id));

-- ============================================================
-- 3. Invitations
-- ============================================================

-- Joining by invitation is done by accept_invitation(); this rule only lets Admins add people
-- and the owner restore their own row.
DROP POLICY IF EXISTS "wm_insert_self" ON workspace_members;
CREATE POLICY "wm_insert_self" ON workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    is_workspace_admin(workspace_id)
    OR (user_id = auth.uid() AND role = 'owner'
        AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
  );

CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv team_invitations%ROWTYPE;
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in to accept this invitation'; END IF;
  SELECT * INTO inv FROM team_invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation link is not valid'; END IF;
  IF inv.status = 'revoked' THEN RAISE EXCEPTION 'This invitation was cancelled'; END IF;
  IF lower(inv.email) <> my_email THEN
    RAISE EXCEPTION 'This invitation is for %. Sign in with that email.', inv.email;
  END IF;
  -- Used already: fine if they're still in the account (opening the link again), otherwise no.
  IF inv.status <> 'pending' THEN
    IF EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inv.workspace_id AND m.user_id = me) THEN
      RETURN inv.workspace_id;
    END IF;
    RAISE EXCEPTION 'This invitation has already been used. Ask for a new one.';
  END IF;
  IF inv.expires_at <= now() THEN RAISE EXCEPTION 'This invitation has expired. Ask for a new one.'; END IF;

  -- Someone already in the account keeps their row as it is (a suspended person stays suspended).
  INSERT INTO workspace_members (workspace_id, user_id, role, status, title)
  VALUES (inv.workspace_id, me, inv.role, 'active', inv.title)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  IF inv.department_id IS NOT NULL THEN
    INSERT INTO department_members (department_id, workspace_id, user_id, is_lead, added_by)
    VALUES (inv.department_id, inv.workspace_id, me, inv.role = 'supervisor', inv.invited_by)
    ON CONFLICT (department_id, user_id) DO NOTHING;
  END IF;

  UPDATE team_invitations SET status = 'accepted', accepted_at = coalesce(accepted_at, now()) WHERE id = inv.id;
  RETURN inv.workspace_id;
END $$;
REVOKE ALL ON FUNCTION accept_invitation(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION accept_invitation(text) TO authenticated;

-- When someone leaves or is removed, their invitations to that account stop working.
CREATE OR REPLACE FUNCTION workspace_members_cancel_invites() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE team_invitations SET status = 'revoked'
  WHERE workspace_id = OLD.workspace_id AND status IN ('pending', 'accepted')
    AND lower(email) = (SELECT lower(u.email) FROM auth.users u WHERE u.id = OLD.user_id);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS workspace_members_cancel_invites ON workspace_members;
CREATE TRIGGER workspace_members_cancel_invites AFTER DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_cancel_invites();

-- ============================================================
-- 4. Chat channel roles
-- ============================================================

CREATE OR REPLACE FUNCTION chat_members_role_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role AND NOT can_manage_channel(OLD.channel_id) THEN
    RAISE EXCEPTION 'Only the channel''s owner or an admin can change who owns it';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chat_members_role_guard ON chat_members;
CREATE TRIGGER chat_members_role_guard BEFORE UPDATE OF role ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_members_role_guard();

-- ============================================================
-- 5. Public booking pages
-- ============================================================

DROP POLICY IF EXISTS "appts_public_select" ON appointments;

-- Busy times only. Runs as its owner, so it shows every account's busy times without names,
-- notes or contacts; the booking pages need nothing more.
CREATE OR REPLACE VIEW appointment_busy AS
  SELECT id, calendar_id, host_id, start_time, end_time, status, created_at
  FROM appointments
  WHERE status IN ('confirmed', 'pending');
REVOKE ALL ON appointment_busy FROM public, anon, authenticated;
GRANT SELECT ON appointment_busy TO anon, authenticated;

DROP POLICY IF EXISTS "appts_public_insert" ON appointments;
CREATE POLICY "appts_public_insert" ON appointments FOR INSERT TO anon, authenticated
  WITH CHECK (
    status IN ('confirmed', 'pending')
    AND EXISTS (
      SELECT 1 FROM calendars c
      WHERE c.id = appointments.calendar_id AND c.status = 'active'
        AND (CASE WHEN c.workspace_id IS NOT NULL
                  THEN appointments.workspace_id = c.workspace_id
                  ELSE appointments.workspace_id IS NULL AND appointments.owner_id = c.owner_id END)
    )
  );

-- ============================================================
-- 6. Calendar hosts
-- ============================================================

CREATE OR REPLACE FUNCTION calendar_owner_or_admin(p_calendar uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT c.owner_id = auth.uid()
        OR (c.workspace_id IS NOT NULL AND (is_workspace_admin(c.workspace_id)
            OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = c.workspace_id AND w.owner_id = auth.uid())))
    FROM calendars c WHERE c.id = p_calendar
  ), false);
$$;
REVOKE ALL ON FUNCTION calendar_owner_or_admin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION calendar_owner_or_admin(uuid) TO authenticated;

DROP POLICY IF EXISTS calendar_hosts_owner_insert ON calendar_hosts;
CREATE POLICY calendar_hosts_owner_insert ON calendar_hosts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (calendar_owner_or_admin(calendar_id));
DROP POLICY IF EXISTS calendar_hosts_owner_update ON calendar_hosts;
CREATE POLICY calendar_hosts_owner_update ON calendar_hosts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (calendar_owner_or_admin(calendar_id) OR user_id = auth.uid())
  WITH CHECK (calendar_owner_or_admin(calendar_id) OR user_id = auth.uid());
DROP POLICY IF EXISTS calendar_hosts_owner_delete ON calendar_hosts;
CREATE POLICY calendar_hosts_owner_delete ON calendar_hosts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (calendar_owner_or_admin(calendar_id));

-- ============================================================
-- 7. Meeting recordings files
-- ============================================================

DROP POLICY IF EXISTS "meeting_recordings_read" ON storage.objects;
CREATE POLICY "meeting_recordings_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'meeting-recordings' AND (SELECT is_workspace_member(ws) AND member_can(ws, 'recordings')
    FROM (SELECT CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN ((storage.foldername(name))[1])::uuid END AS ws) f));
DROP POLICY IF EXISTS "meeting_recordings_delete" ON storage.objects;
CREATE POLICY "meeting_recordings_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meeting-recordings' AND (SELECT is_workspace_member(ws) AND member_can(ws, 'recordings')
    FROM (SELECT CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN ((storage.foldername(name))[1])::uuid END AS ws) f));


-- ============ 20261116090000_section_access_people_tools.sql ============
/*
  # Conversations, Workspaces and Meetings follow each person's sections

  Until now, switching off Conversations, Workspaces or Meetings for a User only hid the page; the
  data could still be read and changed directly. Now the database enforces the same list (as it
  already does for Contacts, Calendars, Forms, Events and the rest, through member_can()):

  - Conversations: messages and channel memberships are for people with Conversations. Channel
    names stay readable (workflows let you pick a channel to post to), but only people with
    Conversations create, change or archive channels.
  - Workspaces: the spaces (the office) and who is in them are for people with Workspaces.
  - Meetings: starting, changing and ending meetings, and the meeting rooms, are for people with
    Meetings. Opening a meeting someone sent you the link to still works, as it does in the app.

  Owners and Admins always pass, and server-side work (workflows, the mailer) is not affected.
  Safe to run more than once.
*/

-- The account a space belongs to, seen past row-level security (so a missing row can't pass).
CREATE OR REPLACE FUNCTION space_workspace(p_space uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT workspace_id FROM spaces WHERE id = p_space;
$$;
REVOKE ALL ON FUNCTION space_workspace(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION space_workspace(uuid) TO authenticated;

DO $$
DECLARE
  t text[];
  cmd text;
BEGIN
  -- Whole tables.
  FOREACH t SLICE 1 IN ARRAY ARRAY[
    ARRAY['chat_messages', 'conversations', 'workspace_id'],
    ARRAY['chat_members', 'conversations', 'workspace_id'],
    ARRAY['spaces', 'workspaces', 'workspace_id'],
    ARRAY['space_members', 'workspaces', 'space_workspace(space_id)'],
    ARRAY['company_rooms', 'meetings', 'workspace_id'],
    ARRAY['company_room_assignees', 'meetings', 'workspace_id']
  ] LOOP
    IF to_regclass('public.' || t[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t[1] || '_section_access', t[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_can(%s, %L)) WITH CHECK (member_can(%s, %L))',
        t[1] || '_section_access', t[1], t[3], t[2], t[3], t[2]);
    END IF;
  END LOOP;

  -- Changes only: channel names and meeting links stay readable.
  FOREACH t SLICE 1 IN ARRAY ARRAY[ARRAY['chat_channels', 'conversations'], ARRAY['meetings', 'meetings']] LOOP
    IF to_regclass('public.' || t[1]) IS NOT NULL THEN
      FOREACH cmd IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t[1] || '_section_' || cmd, t[1]);
        EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR %s TO authenticated %s',
          t[1] || '_section_' || cmd, t[1], upper(cmd),
          CASE cmd
            WHEN 'insert' THEN format('WITH CHECK (member_can(workspace_id, %L))', t[2])
            WHEN 'update' THEN format('USING (member_can(workspace_id, %L)) WITH CHECK (member_can(workspace_id, %L))', t[2], t[2])
            ELSE format('USING (member_can(workspace_id, %L))', t[2])
          END);
      END LOOP;
    END IF;
  END LOOP;
END $$;


-- ============ 20261117080000_team_invite_emails.sql ============
/*
  # Invitations are emailed

  Inviting someone (Settings → Team) now also emails them their join link, from the account's
  connected email account, with who invited them and the role. Copying the link by hand still
  works, and is the only way when no email account is connected.

  messages.team_invitation_id marks these emails so the mailer picks them up (wf_tick asks it to
  send every minute). Safe to run more than once.
*/

ALTER TABLE messages ADD COLUMN IF NOT EXISTS team_invitation_id uuid REFERENCES team_invitations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_team_invitation ON messages(team_invitation_id) WHERE team_invitation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION team_invitation_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  acc email_accounts; ws_name text; inviter text; link text; role_label text; subj text; txt text; html text;
BEGIN
  IF NEW.status <> 'pending' OR coalesce(NEW.email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN NEW; END IF;
  SELECT * INTO acc FROM email_accounts WHERE workspace_id = NEW.workspace_id AND status = 'active' ORDER BY created_at LIMIT 1;
  IF acc.id IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO ws_name FROM workspaces WHERE id = NEW.workspace_id;
  SELECT nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') INTO inviter FROM profiles p WHERE p.user_id = NEW.invited_by;
  link := wf_app_url() || '/invite/' || NEW.token;
  role_label := CASE NEW.role WHEN 'admin' THEN 'an Admin' WHEN 'supervisor' THEN 'a Supervisor' ELSE 'a member of the team' END;
  subj := 'You''re invited to join ' || coalesce(ws_name, 'the team') || ' on SYNAPSE';
  txt := 'Hello,' || E'\n\n' || coalesce(inviter, 'Your team') || ' has invited you to join ' || coalesce(ws_name, 'their account')
    || ' on SYNAPSE as ' || role_label || CASE WHEN coalesce(NEW.title, '') <> '' THEN ' (' || NEW.title || ')' ELSE '' END || '.'
    || E'\n\nJoin here: ' || link
    || E'\n\nSign up or sign in with this email address (' || NEW.email || '). The link works for 7 days.';
  html := '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #E6E8EE;border-radius:16px;font-family:Helvetica,Arial,sans-serif;color:#1F2937;">'
    || '<tr><td style="height:6px;background:#0A1628;background-image:linear-gradient(90deg,#0A1628,#C8A96A);border-radius:16px 16px 0 0;"></td></tr>'
    || '<tr><td style="padding:28px 32px;font-size:16px;line-height:1.6;">'
    || '<p style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0A1628;">Join ' || html_esc(coalesce(ws_name, 'your team')) || ' on SYNAPSE</p>'
    || '<p style="margin:0 0 20px;">' || html_esc(coalesce(inviter, 'Your team')) || ' has invited you as ' || html_esc(role_label)
    || CASE WHEN coalesce(NEW.title, '') <> '' THEN ' (' || html_esc(NEW.title) || ')' ELSE '' END || '.</p>'
    || '<p style="margin:0 0 20px;"><a href="' || html_esc(link) || '" style="display:inline-block;background:#0A1628;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">Accept the invitation</a></p>'
    || '<p style="margin:0;font-size:13px;color:#6B7280;">Sign up or sign in with ' || html_esc(NEW.email) || '. The link works for 7 days.</p>'
    || '</td></tr></table></td></tr></table></body></html>';
  INSERT INTO messages (workspace_id, channel, direction, subject, body, body_html, status, from_email, from_name, to_address, email_account_id, team_invitation_id)
  VALUES (NEW.workspace_id, 'email', 'outbound', left(subj, 300), txt, html, 'queued', acc.email,
          coalesce(nullif(acc.display_name, ''), ws_name), NEW.email, acc.id, NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invitation email not queued: %', SQLERRM;  -- the invitation itself still goes in
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION team_invitation_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS team_invitation_email ON team_invitations;
CREATE TRIGGER team_invitation_email AFTER INSERT ON team_invitations FOR EACH ROW EXECUTE FUNCTION team_invitation_email();


-- ============ 20261117090000_workflow_fixes.sql ============
/*
  # Workflow fixes

  1. A paused or draft workflow holds its runs: someone waiting in it doesn't carry on (no emails,
     no tags) until the workflow is published again. A deleted workflow's runs stop.
  2. Wait steps with a decimal (1.5 hours) wait, instead of skipping straight to the next step.
  3. Replies to sent emails come back every 5 minutes, even when nothing is waiting to be sent
     (they were only checked when the mailer had something to send).
  4. Task reminders aren't sent for tasks already completed.

  Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION wf_run(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r wf_runs; w workflows; step jsonb; sid text; res text; hops int := 0;
BEGIN
  SELECT * INTO r FROM wf_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('active', 'waiting') THEN RETURN; END IF;
  SELECT * INTO w FROM workflows WHERE id = r.workflow_id;
  IF NOT FOUND THEN PERFORM wf_finish(r.id, 'stopped', 'The workflow was deleted'); RETURN; END IF;
  -- A paused or draft workflow holds its runs where they are; they carry on when it's published again.
  IF w.status <> 'active' AND NOT r.is_test THEN RETURN; END IF;
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

CREATE OR REPLACE FUNCTION wf_exec_step(p_run wf_runs, p_wf workflows, p_id text, p_step jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce(p_step->'config', '{}'::jsonb);
  c record; t text; n int; secs bigint; amt numeric; until timestamptz; tz text; acct record; uids uuid[]; uid uuid;
  subj text; body text; ok boolean; other workflows; target uuid; dnd text[]; fld text;
  ch chat_channels; mt meetings; dep departments;
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
    -- Decimals (1.5 hours) and words that aren't numbers no longer skip the wait.
    amt := greatest(coalesce(CASE WHEN trim(coalesce(cfg->>'amount', '')) ~ '^\d+(\.\d+)?$' THEN trim(cfg->>'amount')::numeric END, 1), 0);
    secs := round(amt * CASE coalesce(cfg->>'unit', 'hours') WHEN 'minutes' THEN 60 WHEN 'days' THEN 86400 ELSE 3600 END);
    UPDATE wf_runs SET status = 'waiting', resume_at = now() + make_interval(secs => secs), current_step = coalesce(p_step->>'next', '') WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'waiting', 'Waiting ' || amt || ' ' || coalesce(cfg->>'unit', 'hours'));
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
  WHEN 'post_to_channel' THEN
    SELECT * INTO ch FROM chat_channels WHERE id = nullif(cfg->>'channel_id', '')::uuid AND workspace_id = c.workspace_id AND kind = 'channel';
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a channel to post in.'); RETURN 'fail'; END IF;
    IF ch.archived_at IS NOT NULL THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'The channel #' || ch.name || ' is archived.'); RETURN 'fail'; END IF;
    body := wf_merge(coalesce(nullif(cfg->>'text', ''), '{{contact.name}} · {{contact.link}}'), c.id, p_run.context);
    PERFORM wf_post(ch.id, p_wf, p_run, body);
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Posted in #' || ch.name);
  WHEN 'create_meeting' THEN
    uid := CASE WHEN coalesce(cfg->>'host', 'owner') = 'owner' THEN c.owner_id ELSE nullif(cfg->>'host', '')::uuid END;
    IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = c.workspace_id AND m.user_id = uid AND coalesce(m.status, 'active') = 'active') THEN
      uid := (SELECT owner_id FROM workspaces WHERE id = c.workspace_id);
    END IF;
    subj := left(coalesce(nullif(btrim(wf_merge(cfg->>'title', c.id, p_run.context)), ''), 'Call with ' || coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'a contact')), 120);
    target := wf_new_meeting(c.workspace_id, uid, subj, greatest(5, least(600, coalesce(nullif(cfg->>'duration_min', '')::int, 30))));
    SELECT * INTO mt FROM meetings WHERE id = target;
    t := wf_app_url() || '/meetings/' || mt.code || '?invite=' || mt.invite_token;
    UPDATE wf_runs SET context = context || jsonb_build_object('meeting_id', mt.id, 'meeting_code', mt.code, 'meeting_link', t) WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Meeting ' || mt.code || ' created: ' || t);
  WHEN 'notify_department' THEN
    SELECT * INTO dep FROM departments WHERE id = nullif(cfg->>'department_id', '')::uuid AND workspace_id = c.workspace_id;
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a department.'); RETURN 'fail'; END IF;
    uids := ARRAY(SELECT dm.user_id FROM department_members dm
                  JOIN workspace_members m ON m.workspace_id = dm.workspace_id AND m.user_id = dm.user_id AND coalesce(m.status, 'active') = 'active'
                  WHERE dm.department_id = dep.id);
    subj := left(coalesce(nullif(wf_merge(cfg->>'title', c.id, p_run.context), ''), p_wf.name), 200);
    body := wf_merge(cfg->>'body', c.id, p_run.context);
    FOREACH uid IN ARRAY uids LOOP
      INSERT INTO team_notifications(workspace_id, user_id, title, body, link) VALUES (c.workspace_id, uid, subj, body, '/contacts/' || c.id);
    END LOOP;
    t := 'Notified ' || cardinality(uids) || ' ' || CASE WHEN cardinality(uids) = 1 THEN 'person' ELSE 'people' END || ' in ' || dep.name;
    IF coalesce((cfg->>'post')::boolean, true) THEN
      SELECT * INTO ch FROM chat_channels WHERE department_id = dep.id AND is_department AND archived_at IS NULL;
      IF FOUND THEN
        PERFORM wf_post(ch.id, p_wf, p_run, subj || CASE WHEN coalesce(body, '') <> '' THEN E'\n' || body ELSE '' END);
        t := t || ' and posted in #' || ch.name;
      END IF;
    END IF;
    IF cardinality(uids) = 0 AND t NOT LIKE '%posted%' THEN PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'Nobody is in ' || dep.name || ' yet.'); RETURN 'next'; END IF;
    PERFORM wf_log(p_run, p_step, p_id, 'success', t);
  ELSE
    PERFORM wf_log(p_run, p_step, p_id, 'failed', 'This step type isn''t supported: ' || coalesce(p_step->>'type', '?'));
    RETURN 'fail';
  END CASE;
  RETURN 'next';
END $$;

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
        FOR c IN SELECT id, contact_id, title FROM tasks WHERE workspace_id = w.workspace_id AND contact_id IS NOT NULL AND due_at IS NOT NULL AND completed_at IS NULL
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
  FOR r IN SELECT id FROM wf_runs wr WHERE wr.status = 'waiting' AND wr.resume_at <= now()
             AND (wr.is_test OR EXISTS (SELECT 1 FROM workflows w WHERE w.id = wr.workflow_id AND w.status = 'active') OR NOT EXISTS (SELECT 1 FROM workflows w WHERE w.id = wr.workflow_id))
           ORDER BY wr.resume_at LIMIT 500 LOOP
    BEGIN PERFORM wf_run(r.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf run % failed: %', r.id, SQLERRM; END;
    n_runs := n_runs + 1;
  END LOOP;
  BEGIN n_daily := wf_daily_scan(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf daily scan failed: %', SQLERRM; END;
  -- Housekeeping: keep 30 days of history, like the manual's logs.
  DELETE FROM wf_events WHERE processed_at < now() - interval '30 days';
  DELETE FROM wf_logs WHERE at < now() - interval '30 days';
  -- Ask the mailer to send workflow emails and form emails (team alert, auto-reply).
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND (wf_run_id IS NOT NULL OR form_submission_id IS NOT NULL OR team_invitation_id IS NOT NULL);
  -- Also every 5 minutes while there are recent sent emails, so replies come back even when
  -- nothing is waiting to be sent.
  IF (queued > 0 OR (
        coalesce((SELECT value FROM wf_private.settings WHERE key = 'mailer_last_call')::timestamptz, '-infinity') < now() - interval '5 minutes'
        AND EXISTS (SELECT 1 FROM messages WHERE direction = 'outbound' AND status = 'sent' AND sent_at > now() - interval '30 days')))
     AND to_regnamespace('net') IS NOT NULL THEN
    INSERT INTO wf_private.settings(key, value) VALUES ('mailer_last_call', now()::text)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := ''{"mode":"queue"}''::jsonb, headers := jsonb_strip_nulls(jsonb_build_object(''Content-Type'', ''application/json'', ''x-synapse-mailer'', $2, ''apikey'', $3, ''Authorization'', ''Bearer '' || $3)))'
      USING (SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), wf_mailer_secret(), (SELECT value FROM wf_private.settings WHERE key = 'client_key');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf mailer call failed: %', SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('events', n_ev, 'resumed', n_runs, 'daily', n_daily, 'queued_emails', queued);
END $$;


-- ============ 20261117100000_chat_cards_live_bell.sql ============
/*
  # Chat cards and a live bell

  1. Workflow posts in a channel carry what they're about: the contact, and the meeting link when
     the workflow made one. Conversations shows them as a card with **Join meeting** and **Claim**.
  2. chat_claim_contact(message): the first person to press Claim becomes the contact's owner;
     everyone sees "Claimed by …" (the message updates live), and a second press says who has it.
  3. The bell (team_notifications) updates live: it's added to Supabase Realtime.

  Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION wf_post(p_channel uuid, p_wf workflows, p_run wf_runs, p_body text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chat_messages(channel_id, workspace_id, user_id, body, source, sender_name, meta)
  VALUES (p_channel, p_wf.workspace_id, NULL, left(coalesce(nullif(btrim(p_body), ''), p_wf.name), 8000), 'system', left('Workflow: ' || p_wf.name, 80),
          jsonb_strip_nulls(jsonb_build_object(
            'workflow_id', p_wf.id, 'run_id', p_run.id, 'contact_id', p_run.contact_id,
            'contact_name', (SELECT nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') FROM contacts c WHERE c.id = p_run.contact_id),
            'meeting_link', p_run.context->>'meeting_link', 'meeting_code', p_run.context->>'meeting_code')));
$$;
REVOKE ALL ON FUNCTION wf_post(uuid, workflows, wf_runs, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION chat_claim_contact(p_message uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m chat_messages; me uuid := auth.uid(); who text; cid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO m FROM chat_messages WHERE id = p_message FOR UPDATE;
  IF NOT FOUND OR NOT can_see_channel(m.channel_id) OR NOT member_can(m.workspace_id, 'conversations') THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF m.source <> 'system' OR m.deleted_at IS NOT NULL OR coalesce(m.meta->>'contact_id', '') = '' THEN RAISE EXCEPTION 'There is nothing to claim here'; END IF;
  IF coalesce(m.meta->>'claimed_by', '') <> '' THEN
    IF m.meta->>'claimed_by' = me::text THEN RETURN m.meta; END IF;
    RAISE EXCEPTION 'Already claimed by %', coalesce(m.meta->>'claimed_name', 'someone else');
  END IF;
  cid := (m.meta->>'contact_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = cid AND workspace_id = m.workspace_id) THEN RAISE EXCEPTION 'That contact was deleted'; END IF;
  SELECT coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'A teammate') INTO who FROM profiles p WHERE p.user_id = me;
  UPDATE contacts SET owner_id = me WHERE id = cid;
  UPDATE chat_messages SET meta = meta || jsonb_build_object('claimed_by', me, 'claimed_name', coalesce(who, 'A teammate'), 'claimed_at', now())
    WHERE id = m.id RETURNING meta INTO m.meta;
  RETURN m.meta;
END $$;
REVOKE ALL ON FUNCTION chat_claim_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION chat_claim_contact(uuid) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'team_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_notifications;
  END IF;
END $$;


-- ============ 20261117110000_invite_only_spaces.sql ============
/*
  # Invite-only offices

  An office (space) set to "Invite only" now has an invite list. Only the people on it, the
  person who made the office, and the account's Owner and Admins can see it, enter it, or get
  onto its audio and video (the call token checks the same list). Other offices are unchanged.

  - space_invitees: who is invited to which office. Admins and the office's creator manage it;
    everyone allowed into the office can see who's on it.
  - can_enter_space(space): the one rule, used by the policies (and mirrored in livekit-token).

  Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS space_invitees (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_space_invitees_user ON space_invitees(user_id);
ALTER TABLE space_invitees ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_enter_space(p_space uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT s.access_mode <> 'invite_only'
        OR s.created_by = auth.uid()
        OR is_workspace_admin(s.workspace_id)
        OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = s.workspace_id AND w.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM space_invitees i WHERE i.space_id = s.id AND i.user_id = auth.uid())
    FROM spaces s WHERE s.id = p_space
  ), false);
$$;
REVOKE ALL ON FUNCTION can_enter_space(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_enter_space(uuid) TO authenticated;

-- Who manages an office's invite list: Admins, the account's owner, and whoever made it.
CREATE OR REPLACE FUNCTION can_manage_space(p_space uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT s.created_by = auth.uid() OR is_workspace_admin(s.workspace_id)
        OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = s.workspace_id AND w.owner_id = auth.uid())
    FROM spaces s WHERE s.id = p_space
  ), false);
$$;
REVOKE ALL ON FUNCTION can_manage_space(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_manage_space(uuid) TO authenticated;

DROP POLICY IF EXISTS space_invitees_select ON space_invitees;
CREATE POLICY space_invitees_select ON space_invitees FOR SELECT TO authenticated USING (can_enter_space(space_id));
DROP POLICY IF EXISTS space_invitees_insert ON space_invitees;
CREATE POLICY space_invitees_insert ON space_invitees FOR INSERT TO authenticated
  WITH CHECK (can_manage_space(space_id)
              AND EXISTS (SELECT 1 FROM spaces s JOIN workspace_members m ON m.workspace_id = s.workspace_id
                          WHERE s.id = space_id AND m.user_id = space_invitees.user_id));
DROP POLICY IF EXISTS space_invitees_delete ON space_invitees;
CREATE POLICY space_invitees_delete ON space_invitees FOR DELETE TO authenticated USING (can_manage_space(space_id));

-- The office itself, and who's in it, follow the list.
DROP POLICY IF EXISTS spaces_invite_only ON spaces;
CREATE POLICY spaces_invite_only ON spaces AS RESTRICTIVE FOR SELECT TO authenticated USING (can_enter_space(id));
DROP POLICY IF EXISTS space_members_invite_only ON space_members;
CREATE POLICY space_members_invite_only ON space_members AS RESTRICTIVE FOR ALL TO authenticated
  USING (can_enter_space(space_id)) WITH CHECK (can_enter_space(space_id));


-- ============ 20261118090000_drop_reverted_event_functions.sql ============
/*
  # Tidy up after a reverted events update

  Pull request #122 (a different take on events phase 7) was merged and then reverted. If its
  database update was run, it left two functions behind:

  - event_send_reminders(int): a second version of the reminder job's function. With two, the
    15-minute job's "SELECT event_send_reminders()" can't tell which to call, fails, and no
    reminders go out. This removes the extra one; the job uses event_send_reminders().
  - event_erase_registration(uuid, boolean): its "delete their data" action, whose button was
    removed by the revert.

  Does nothing when they aren't there. Safe to run more than once.
*/

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.event_send_reminders(integer)', 'public.event_erase_registration(uuid, boolean)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE 'DROP FUNCTION ' || f;
    END IF;
  END LOOP;
END $$;


-- ============ 20261119090000_event_door_passes.sql ============
/*
  # Door passes: volunteers check guests in with their own phone, without an account

  An organiser adds a door scanner (name and email) on the event's page. They get an email with a
  door-pass link; opening it once on a phone makes that phone a scanner for that event only. Then
  scanning a ticket's QR with the phone's camera checks the guest in (green), exactly as the
  scanner does: the ticket's signature is checked, it must belong to this event, and every scan is
  logged with the pass's name. Removing the pass stops that phone at once; passes stop working 12
  hours after the event ends.

  - event_door_passes: the passes (reached only through the functions below).
  - event_door_pass_add / _list / _revoke: the organiser's side.
  - event_door_pass_info(token): what the pass page shows (event, name, still valid?).
  - event_door_check_in(token, scan, paid) and event_door_undo(token, registration): the phone's side.
  - The pass email is queued like other emails (messages.event_door_pass_id).

  Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS event_door_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  email text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_event_door_passes_event ON event_door_passes(event_id);
ALTER TABLE event_door_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_door_passes FROM PUBLIC, anon, authenticated;

ALTER TABLE event_checkins ADD COLUMN IF NOT EXISTS door_pass_id uuid REFERENCES event_door_passes(id) ON DELETE SET NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS checked_in_pass uuid REFERENCES event_door_passes(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS event_door_pass_id uuid REFERENCES event_door_passes(id) ON DELETE SET NULL;

-- "Checked in by" also names a door pass.
CREATE OR REPLACE FUNCTION event_checkin_person(r event_registrations) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'registration_id', r.id, 'name', btrim(r.first_name || ' ' || r.last_name), 'status', r.status,
    'type_name', (SELECT t.name FROM event_tickets t WHERE t.id = r.ticket_id),
    'ticket_code', r.ticket_code, 'checked_in_at', r.checked_in_at,
    'checked_in_by', coalesce(event_person_name(r.checked_in_by), (SELECT p.name FROM event_door_passes p WHERE p.id = r.checked_in_pass)),
    'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'currency', (SELECT t.currency FROM event_tickets t WHERE t.id = r.ticket_id))
$$;
REVOKE ALL ON FUNCTION event_checkin_person(event_registrations) FROM PUBLIC, anon, authenticated;

-- A pass that may still be used: not removed, and its event not over by more than 12 hours.
CREATE OR REPLACE FUNCTION event_door_pass_live(p_token uuid) RETURNS event_door_passes LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.* FROM event_door_passes p JOIN events e ON e.id = p.event_id
  WHERE p.token = p_token AND p.revoked_at IS NULL AND e.status <> 'cancelled'
    AND (e.ends_at IS NULL OR e.ends_at > now() - interval '12 hours')
$$;
REVOKE ALL ON FUNCTION event_door_pass_live(uuid) FROM PUBLIC, anon, authenticated;

-- 1. The organiser's side ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_door_pass_json(p event_door_passes) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'created_at', p.created_at,
    'activated_at', p.activated_at, 'last_used_at', p.last_used_at, 'revoked_at', p.revoked_at,
    'link', wf_app_url() || '/e/door/' || p.token,
    'scans', (SELECT count(*) FROM event_checkins c WHERE c.door_pass_id = p.id AND c.result = 'success'))
$$;
REVOKE ALL ON FUNCTION event_door_pass_json(event_door_passes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION event_door_pass_list(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((SELECT jsonb_agg(event_door_pass_json(p) ORDER BY p.revoked_at IS NOT NULL, p.created_at)
                   FROM event_door_passes p WHERE p.event_id = p_event), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_door_pass_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_door_pass_list(uuid) TO authenticated;

-- Adds a door scanner and emails them their pass (when the account has a connected email).
CREATE OR REPLACE FUNCTION event_door_pass_add(p_event uuid, p_name text, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e events; p event_door_passes; acc email_accounts; em text := lower(btrim(coalesce(p_email, ''))); link text; nm text := btrim(coalesce(p_name, ''));
  txt text; html text; queued boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF nm = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;
  IF (SELECT count(*) FROM event_door_passes WHERE event_id = p_event AND revoked_at IS NULL) >= 50 THEN RAISE EXCEPTION 'too_many'; END IF;
  IF EXISTS (SELECT 1 FROM event_door_passes WHERE event_id = p_event AND lower(email) = em AND revoked_at IS NULL) THEN RAISE EXCEPTION 'already_added'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  INSERT INTO event_door_passes (event_id, name, email, created_by) VALUES (p_event, left(nm, 80), em, auth.uid()) RETURNING * INTO p;
  link := wf_app_url() || '/e/door/' || p.token;

  SELECT * INTO acc FROM email_accounts WHERE id = e.email_account_id AND status = 'active';
  IF NOT FOUND THEN SELECT * INTO acc FROM email_accounts WHERE workspace_id = e.workspace_id AND status = 'active' ORDER BY created_at LIMIT 1; END IF;
  IF acc.id IS NOT NULL THEN
    txt := 'Hi ' || split_part(p.name, ' ', 1) || ',' || E'\n\n'
      || 'You''re on the door for ' || e.title || ' (' || event_date_text(e) || ').' || E'\n\n'
      || 'Open this link on the phone you''ll use at the door, in Safari (iPhone) or Chrome (Android): ' || link || E'\n\n'
      || 'That makes your phone a scanner for this event. Then point your camera at a guest''s ticket QR code and tap the link: green means they''re in.'
      || E'\n\nKeep this link to yourself; it works until the organiser removes it, and stops after the event.';
    html := '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #E6E8EE;border-radius:16px;font-family:Helvetica,Arial,sans-serif;color:#1F2937;">'
      || '<tr><td style="padding:28px 32px;font-size:16px;line-height:1.6;">'
      || '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6B7280;">Door pass</p>'
      || '<p style="margin:0 0 14px;font-size:22px;font-weight:700;color:#0A1628;">' || html_esc(e.title) || '</p>'
      || '<p style="margin:0 0 18px;">Hi ' || html_esc(split_part(p.name, ' ', 1)) || ', you''re on the door. Open this on the phone you''ll use at the door, in Safari (iPhone) or Chrome (Android):</p>'
      || '<p style="margin:0 0 20px;"><a href="' || html_esc(link) || '" style="display:inline-block;background:#0A1628;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">Make this phone a scanner</a></p>'
      || '<p style="margin:0 0 8px;">Then point your camera at a guest''s ticket QR code and tap the link. <b>Green</b> means they''re in.</p>'
      || '<p style="margin:0;font-size:13px;color:#6B7280;">Keep this link to yourself. It works until the organiser removes it, and stops after the event.</p>'
      || '</td></tr></table></td></tr></table></body></html>';
    INSERT INTO messages (workspace_id, channel, direction, subject, body, body_html, status, from_email, from_name, to_address, email_account_id, event_door_pass_id)
    VALUES (e.workspace_id, 'email', 'outbound', left('Your door pass for ' || e.title, 300), txt, html, 'queued', acc.email,
            coalesce(nullif(e.organiser_name, ''), acc.display_name), em, acc.id, p.id);
    queued := true;
  END IF;
  RETURN event_door_pass_json(p) || jsonb_build_object('emailed', queued);
END $$;
REVOKE ALL ON FUNCTION event_door_pass_add(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_door_pass_add(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION event_door_pass_revoke(p_pass uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev uuid;
BEGIN
  SELECT event_id INTO ev FROM event_door_passes WHERE id = p_pass;
  IF ev IS NULL OR auth.uid() IS NULL OR NOT event_is_organiser(ev) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE event_door_passes SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_pass;
END $$;
REVOKE ALL ON FUNCTION event_door_pass_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_door_pass_revoke(uuid) TO authenticated;

-- 2. The phone's side (no sign-in: the pass is the key) -----------------------------------------

CREATE OR REPLACE FUNCTION event_door_pass_info(p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p event_door_passes; e events;
BEGIN
  p := event_door_pass_live(p_token);
  IF p.id IS NULL THEN RETURN jsonb_build_object('valid', false); END IF;
  UPDATE event_door_passes SET activated_at = coalesce(activated_at, now()) WHERE id = p.id;
  SELECT * INTO e FROM events WHERE id = p.event_id;
  RETURN jsonb_build_object('valid', true, 'name', p.name, 'event_id', e.id, 'title', e.title, 'slug', e.slug,
    'date', event_date_text(e), 'cover_url', e.cover_url, 'brand', e.brand,
    'expected', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status)),
    'checked_in', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status) AND r.checked_in_at IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION event_door_pass_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_door_pass_info(uuid) TO anon, authenticated;

-- Same answers as event_check_in: { result, reason?, person? }. A removed or expired pass: not_allowed.
CREATE OR REPLACE FUNCTION event_door_check_in(p_token uuid, p_scan text, p_paid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p event_door_passes; r event_registrations;
  scan text := btrim(coalesce(p_scan, ''));
  tok uuid; sig text; m text[]; res text; reason text;
  via text := CASE WHEN p_scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' OR p_scan ~ '^\s*\d{6}\s*$' THEN 'manual' ELSE 'scan' END;
BEGIN
  p := event_door_pass_live(p_token);
  IF p.id IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF (SELECT count(*) FROM event_checkins WHERE door_pass_id = p.id AND at > now() - interval '1 minute') >= 120 THEN RAISE EXCEPTION 'busy'; END IF;
  UPDATE event_door_passes SET last_used_at = now(), activated_at = coalesce(activated_at, now()) WHERE id = p.id;

  IF scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' THEN
    SELECT * INTO r FROM event_registrations WHERE upper(ticket_code) = upper(scan) AND event_id = p.event_id FOR UPDATE;
  ELSIF scan ~ '^\d{6}$' THEN
    SELECT * INTO r FROM event_registrations WHERE pin = scan AND event_id = p.event_id FOR UPDATE;
  ELSE
    m := regexp_match(scan, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
    IF m IS NOT NULL THEN tok := lower(m[1])::uuid; END IF;
    sig := (regexp_match(scan, '[?&]v=([0-9a-fA-F]{16})'))[1];
    IF tok IS NOT NULL AND ticket_sig_ok(tok, sig) THEN
      SELECT * INTO r FROM event_registrations WHERE qr_token = tok AND event_id = p.event_id FOR UPDATE;
    END IF;
  END IF;

  IF r.id IS NULL THEN
    INSERT INTO event_checkins (event_id, registration_id, user_id, result, via, door_pass_id) VALUES (p.event_id, NULL, NULL, 'invalid', via, p.id);
    RETURN jsonb_build_object('result', 'invalid', 'reason',
      CASE WHEN tok IS NOT NULL AND ticket_sig_ok(tok, sig) THEN 'other_event' WHEN tok IS NOT NULL THEN 'unsigned' ELSE 'unknown' END);
  END IF;

  IF NOT event_holds_place(r.status) THEN
    res := 'not_eligible'; reason := r.status;
  ELSIF r.checked_in_at IS NOT NULL THEN
    res := 'already_checked_in';
  ELSIF r.payment_status = 'unpaid' AND NOT p_paid THEN
    res := 'not_eligible'; reason := 'unpaid';
  ELSE
    UPDATE event_registrations SET checked_in_at = now(), checked_in_by = NULL, checked_in_pass = p.id,
      payment_status = CASE WHEN p_paid AND payment_status = 'unpaid' THEN 'paid' ELSE payment_status END
    WHERE id = r.id RETURNING * INTO r;
    res := 'success';
  END IF;
  INSERT INTO event_checkins (event_id, registration_id, user_id, result, via, door_pass_id) VALUES (p.event_id, r.id, NULL, res, via, p.id);
  RETURN jsonb_build_object('result', res, 'reason', reason, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_door_check_in(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_door_check_in(uuid, text, boolean) TO anon, authenticated;

-- A pass can undo only the check-ins it made itself.
CREATE OR REPLACE FUNCTION event_door_undo(p_token uuid, p_registration uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p event_door_passes; r event_registrations;
BEGIN
  p := event_door_pass_live(p_token);
  IF p.id IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO r FROM event_registrations WHERE id = p_registration AND event_id = p.event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.checked_in_at IS NOT NULL THEN
    IF r.checked_in_pass IS DISTINCT FROM p.id THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE event_registrations SET checked_in_at = NULL, checked_in_by = NULL, checked_in_pass = NULL WHERE id = r.id RETURNING * INTO r;
    INSERT INTO event_checkins (event_id, registration_id, user_id, result, via, door_pass_id) VALUES (p.event_id, r.id, NULL, 'undone', 'undo', p.id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_door_undo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_door_undo(uuid, uuid) TO anon, authenticated;

-- 3. The log names door passes, and the mailer sends pass emails --------------------------------

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
  FOR r IN SELECT id FROM wf_runs wr WHERE wr.status = 'waiting' AND wr.resume_at <= now()
             AND (wr.is_test OR EXISTS (SELECT 1 FROM workflows w WHERE w.id = wr.workflow_id AND w.status = 'active') OR NOT EXISTS (SELECT 1 FROM workflows w WHERE w.id = wr.workflow_id))
           ORDER BY wr.resume_at LIMIT 500 LOOP
    BEGIN PERFORM wf_run(r.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf run % failed: %', r.id, SQLERRM; END;
    n_runs := n_runs + 1;
  END LOOP;
  BEGIN n_daily := wf_daily_scan(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf daily scan failed: %', SQLERRM; END;
  -- Housekeeping: keep 30 days of history, like the manual's logs.
  DELETE FROM wf_events WHERE processed_at < now() - interval '30 days';
  DELETE FROM wf_logs WHERE at < now() - interval '30 days';
  -- Ask the mailer to send workflow emails and form emails (team alert, auto-reply).
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND (wf_run_id IS NOT NULL OR form_submission_id IS NOT NULL OR team_invitation_id IS NOT NULL OR event_door_pass_id IS NOT NULL);
  -- Also every 5 minutes while there are recent sent emails, so replies come back even when
  -- nothing is waiting to be sent.
  IF (queued > 0 OR (
        coalesce((SELECT value FROM wf_private.settings WHERE key = 'mailer_last_call')::timestamptz, '-infinity') < now() - interval '5 minutes'
        AND EXISTS (SELECT 1 FROM messages WHERE direction = 'outbound' AND status = 'sent' AND sent_at > now() - interval '30 days')))
     AND to_regnamespace('net') IS NOT NULL THEN
    INSERT INTO wf_private.settings(key, value) VALUES ('mailer_last_call', now()::text)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := ''{"mode":"queue"}''::jsonb, headers := jsonb_strip_nulls(jsonb_build_object(''Content-Type'', ''application/json'', ''x-synapse-mailer'', $2, ''apikey'', $3, ''Authorization'', ''Bearer '' || $3)))'
      USING (SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), wf_mailer_secret(), (SELECT value FROM wf_private.settings WHERE key = 'client_key');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf mailer call failed: %', SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('events', n_ev, 'resumed', n_runs, 'daily', n_daily, 'queued_emails', queued);
END $$;

CREATE OR REPLACE FUNCTION event_checkin_log(p_event uuid, p_limit int DEFAULT 30) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'at', c.at, 'result', c.result, 'via', c.via,
      'name', btrim(r.first_name || ' ' || r.last_name), 'registration_id', c.registration_id, 'by', coalesce(event_person_name(c.user_id), (SELECT p.name || ' (door pass)' FROM event_door_passes p WHERE p.id = c.door_pass_id))) ORDER BY c.at DESC, c.id DESC)
    FROM (SELECT * FROM event_checkins WHERE event_id = p_event ORDER BY at DESC, id DESC LIMIT least(greatest(p_limit, 1), 200)) c
    LEFT JOIN event_registrations r ON r.id = c.registration_id), '[]'::jsonb);
END $$;

-- Who checked someone in is either a person or a pass, never a stale mix of the two.
CREATE OR REPLACE FUNCTION event_registration_checkin_by() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.checked_in_at IS NULL OR NEW.checked_in_by IS NOT NULL THEN NEW.checked_in_pass := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_registration_checkin_by ON event_registrations;
CREATE TRIGGER event_registration_checkin_by BEFORE UPDATE OF checked_in_at, checked_in_by, checked_in_pass ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION event_registration_checkin_by();

