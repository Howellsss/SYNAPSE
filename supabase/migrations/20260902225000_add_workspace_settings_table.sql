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
