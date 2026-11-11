-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Access update (16 November 2026): Conversations, Workspaces and Meetings follow each person's sections in the
-- database too, not only in the menu. Run database-updates-13.sql first. Safe to run more than once.
-- Made from supabase/migrations/20261116090000_section_access_people_tools.sql; don't edit here.

/*
  # Conversations, Workspaces and Meetings follow each person's sections

  Until now, switching off Conversations, Workspaces or Meetings for a User only hid the page; the
  data could still be read and changed directly. Now the database enforces the same list (as it
  already does for Contacts, Calendars, Forms, Events and the rest, through member_can()):

  - Conversations: messages and channel memberships are for people with Conversations. Channel
    names stay readable (workflows let you pick a channel to post to), but only people with
    Conversations create, change or archive channels.
  - Workspaces: the spaces (the office) and who is in them are for people with Workspaces.
  - Meetings: starting, changing and ending meetings, and the meeting rooms, are for people with
    Meetings. Opening a meeting someone sent you the link to still works, as it does in the app.

  Owners and Admins always pass, and server-side work (workflows, the mailer) is not affected.
  Safe to run more than once.
*/

-- The account a space belongs to, seen past row-level security (so a missing row can't pass).
CREATE OR REPLACE FUNCTION space_workspace(p_space uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT workspace_id FROM spaces WHERE id = p_space;
$$;
REVOKE ALL ON FUNCTION space_workspace(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION space_workspace(uuid) TO authenticated;

DO $$
DECLARE
  t text[];
  cmd text;
BEGIN
  -- Whole tables.
  FOREACH t SLICE 1 IN ARRAY ARRAY[
    ARRAY['chat_messages', 'conversations', 'workspace_id'],
    ARRAY['chat_members', 'conversations', 'workspace_id'],
    ARRAY['spaces', 'workspaces', 'workspace_id'],
    ARRAY['space_members', 'workspaces', 'space_workspace(space_id)'],
    ARRAY['company_rooms', 'meetings', 'workspace_id'],
    ARRAY['company_room_assignees', 'meetings', 'workspace_id']
  ] LOOP
    IF to_regclass('public.' || t[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t[1] || '_section_access', t[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_can(%s, %L)) WITH CHECK (member_can(%s, %L))',
        t[1] || '_section_access', t[1], t[3], t[2], t[3], t[2]);
    END IF;
  END LOOP;

  -- Changes only: channel names and meeting links stay readable.
  FOREACH t SLICE 1 IN ARRAY ARRAY[ARRAY['chat_channels', 'conversations'], ARRAY['meetings', 'meetings']] LOOP
    IF to_regclass('public.' || t[1]) IS NOT NULL THEN
      FOREACH cmd IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t[1] || '_section_' || cmd, t[1]);
        EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR %s TO authenticated %s',
          t[1] || '_section_' || cmd, t[1], upper(cmd),
          CASE cmd
            WHEN 'insert' THEN format('WITH CHECK (member_can(workspace_id, %L))', t[2])
            WHEN 'update' THEN format('USING (member_can(workspace_id, %L)) WITH CHECK (member_can(workspace_id, %L))', t[2], t[2])
            ELSE format('USING (member_can(workspace_id, %L))', t[2])
          END);
      END LOOP;
    END IF;
  END LOOP;
END $$;
