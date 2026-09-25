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
