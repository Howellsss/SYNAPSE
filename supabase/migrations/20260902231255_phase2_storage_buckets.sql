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
