-- Backfill: Create workspaces and memberships for existing users who don't have one,
-- then seed demo data into each.

DO $$
DECLARE
  u RECORD;
  v_ws_id uuid;
  v_slug text;
BEGIN
  FOR u IN
    SELECT au2.id, au2.email,
      COALESCE(au2.raw_user_meta_data->>'first_name', 'User') AS first_name,
      COALESCE(au2.raw_user_meta_data->>'last_name', '') AS last_name
    FROM auth.users au2
    WHERE au2.id NOT IN (SELECT user_id FROM workspace_members)
  LOOP
    v_slug := lower(
      regexp_replace(
        COALESCE(u.first_name, 'user') || '-' || COALESCE(NULLIF(u.last_name, ''), 'workspace'),
        '[^a-zA-Z0-9]', '-', 'g'
      )
    );
    v_slug := regexp_replace(v_slug, '-+', '-', 'g');
    v_slug := trim(both '-' from v_slug);

    INSERT INTO workspaces (name, slug, owner_id)
    VALUES (COALESCE(u.first_name, 'User') || '''s Workspace', v_slug, u.id)
    RETURNING id INTO v_ws_id;

    INSERT INTO workspace_members (workspace_id, user_id, role, status)
    VALUES (v_ws_id, u.id, 'owner', 'active');

    PERFORM seed_workspace_demo_data(v_ws_id, u.id);
  END LOOP;
END $$;
