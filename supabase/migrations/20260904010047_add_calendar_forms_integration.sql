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
