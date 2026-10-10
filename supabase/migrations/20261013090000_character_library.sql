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
