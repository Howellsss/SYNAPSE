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
