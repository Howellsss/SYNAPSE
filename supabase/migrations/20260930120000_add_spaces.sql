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
