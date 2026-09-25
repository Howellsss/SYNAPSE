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
