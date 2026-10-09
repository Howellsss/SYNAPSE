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
