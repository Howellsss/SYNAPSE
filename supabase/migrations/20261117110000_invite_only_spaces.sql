/*
  # Invite-only offices

  An office (space) set to "Invite only" now has an invite list. Only the people on it, the
  person who made the office, and the account's Owner and Admins can see it, enter it, or get
  onto its audio and video (the call token checks the same list). Other offices are unchanged.

  - space_invitees: who is invited to which office. Admins and the office's creator manage it;
    everyone allowed into the office can see who's on it.
  - can_enter_space(space): the one rule, used by the policies (and mirrored in livekit-token).

  Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS space_invitees (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_space_invitees_user ON space_invitees(user_id);
ALTER TABLE space_invitees ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_enter_space(p_space uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT s.access_mode <> 'invite_only'
        OR s.created_by = auth.uid()
        OR is_workspace_admin(s.workspace_id)
        OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = s.workspace_id AND w.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM space_invitees i WHERE i.space_id = s.id AND i.user_id = auth.uid())
    FROM spaces s WHERE s.id = p_space
  ), false);
$$;
REVOKE ALL ON FUNCTION can_enter_space(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_enter_space(uuid) TO authenticated;

-- Who manages an office's invite list: Admins, the account's owner, and whoever made it.
CREATE OR REPLACE FUNCTION can_manage_space(p_space uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT s.created_by = auth.uid() OR is_workspace_admin(s.workspace_id)
        OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = s.workspace_id AND w.owner_id = auth.uid())
    FROM spaces s WHERE s.id = p_space
  ), false);
$$;
REVOKE ALL ON FUNCTION can_manage_space(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_manage_space(uuid) TO authenticated;

DROP POLICY IF EXISTS space_invitees_select ON space_invitees;
CREATE POLICY space_invitees_select ON space_invitees FOR SELECT TO authenticated USING (can_enter_space(space_id));
DROP POLICY IF EXISTS space_invitees_insert ON space_invitees;
CREATE POLICY space_invitees_insert ON space_invitees FOR INSERT TO authenticated
  WITH CHECK (can_manage_space(space_id)
              AND EXISTS (SELECT 1 FROM spaces s JOIN workspace_members m ON m.workspace_id = s.workspace_id
                          WHERE s.id = space_id AND m.user_id = space_invitees.user_id));
DROP POLICY IF EXISTS space_invitees_delete ON space_invitees;
CREATE POLICY space_invitees_delete ON space_invitees FOR DELETE TO authenticated USING (can_manage_space(space_id));

-- The office itself, and who's in it, follow the list.
DROP POLICY IF EXISTS spaces_invite_only ON spaces;
CREATE POLICY spaces_invite_only ON spaces AS RESTRICTIVE FOR SELECT TO authenticated USING (can_enter_space(id));
DROP POLICY IF EXISTS space_members_invite_only ON space_members;
CREATE POLICY space_members_invite_only ON space_members AS RESTRICTIVE FOR ALL TO authenticated
  USING (can_enter_space(space_id)) WITH CHECK (can_enter_space(space_id));
