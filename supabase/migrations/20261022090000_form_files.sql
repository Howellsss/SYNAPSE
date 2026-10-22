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
