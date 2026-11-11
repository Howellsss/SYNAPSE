/*
  # Security fixes

  Closes gaps found in the security review. Safe to run more than once.

  1. Memberships can't move. A membership row keeps its account and person: nobody can point
     their own row (or anyone's) at another account to become Admin there.
  2. The account's owner stays the owner. Signed-in users can't change workspaces.owner_id, and
     Admins can't delete the owner's membership.
  3. Invitations are used once. Accepting goes through accept_invitation() only; an invitation
     already used works again only for someone still in the account. When someone is removed,
     the invitations sent to their email for that account are cancelled, so the old link can't
     bring them back. People joining by invitation can't choose what they can see.
  4. Chat roles: only a channel's owner (or an Admin) changes who owns a channel. A member can't
     make themselves its owner.
  5. Public booking pages:
       - visitors no longer read whole bookings of every account. They see busy times only,
         through the appointment_busy view (calendar, host, start, end, status, created).
       - a visitor's booking must belong to an active calendar, in that calendar's own account,
         as confirmed or pending.
  6. Calendar hosts: only the calendar's owner or an Admin adds or removes hosts (a User could
     add themselves to someone else's calendar and then see its bookings).
  7. Meeting recordings files: only people who can see Recordings can open or delete them.
*/

-- ============================================================
-- 1 + 2. Memberships and ownership
-- ============================================================

CREATE OR REPLACE FUNCTION workspace_members_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_owner uuid;
BEGIN
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = NEW.workspace_id;
  IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM ws_owner THEN
    RAISE EXCEPTION 'Only the workspace owner can have the owner role';
  END IF;
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'A membership can''t be moved to another account or person';
    END IF;
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      RAISE EXCEPTION 'The owner''s role cannot be changed';
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.title IS DISTINCT FROM OLD.title OR NEW.access IS DISTINCT FROM OLD.access)
       AND NOT is_workspace_admin(NEW.workspace_id) AND auth.uid() IS DISTINCT FROM ws_owner THEN
      RAISE EXCEPTION 'Only admins can change roles, status, titles or what someone can see';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_members_guard ON workspace_members;
CREATE TRIGGER workspace_members_guard BEFORE INSERT OR UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_guard();

CREATE OR REPLACE FUNCTION workspaces_owner_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'The account''s owner can''t be changed here';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspaces_owner_guard ON workspaces;
CREATE TRIGGER workspaces_owner_guard BEFORE UPDATE OF owner_id ON workspaces
  FOR EACH ROW EXECUTE FUNCTION workspaces_owner_guard();

DROP POLICY IF EXISTS "wm_delete" ON workspace_members;
CREATE POLICY "wm_delete" ON workspace_members FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id) AND role <> 'owner'
         AND user_id IS DISTINCT FROM (SELECT w.owner_id FROM workspaces w WHERE w.id = workspace_id));

-- ============================================================
-- 3. Invitations
-- ============================================================

-- Joining by invitation is done by accept_invitation(); this rule only lets Admins add people
-- and the owner restore their own row.
DROP POLICY IF EXISTS "wm_insert_self" ON workspace_members;
CREATE POLICY "wm_insert_self" ON workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    is_workspace_admin(workspace_id)
    OR (user_id = auth.uid() AND role = 'owner'
        AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
  );

CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv team_invitations%ROWTYPE;
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in to accept this invitation'; END IF;
  SELECT * INTO inv FROM team_invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation link is not valid'; END IF;
  IF inv.status = 'revoked' THEN RAISE EXCEPTION 'This invitation was cancelled'; END IF;
  IF lower(inv.email) <> my_email THEN
    RAISE EXCEPTION 'This invitation is for %. Sign in with that email.', inv.email;
  END IF;
  -- Used already: fine if they're still in the account (opening the link again), otherwise no.
  IF inv.status <> 'pending' THEN
    IF EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inv.workspace_id AND m.user_id = me) THEN
      RETURN inv.workspace_id;
    END IF;
    RAISE EXCEPTION 'This invitation has already been used. Ask for a new one.';
  END IF;
  IF inv.expires_at <= now() THEN RAISE EXCEPTION 'This invitation has expired. Ask for a new one.'; END IF;

  -- Someone already in the account keeps their row as it is (a suspended person stays suspended).
  INSERT INTO workspace_members (workspace_id, user_id, role, status, title)
  VALUES (inv.workspace_id, me, inv.role, 'active', inv.title)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  IF inv.department_id IS NOT NULL THEN
    INSERT INTO department_members (department_id, workspace_id, user_id, is_lead, added_by)
    VALUES (inv.department_id, inv.workspace_id, me, inv.role = 'supervisor', inv.invited_by)
    ON CONFLICT (department_id, user_id) DO NOTHING;
  END IF;

  UPDATE team_invitations SET status = 'accepted', accepted_at = coalesce(accepted_at, now()) WHERE id = inv.id;
  RETURN inv.workspace_id;
END $$;
REVOKE ALL ON FUNCTION accept_invitation(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION accept_invitation(text) TO authenticated;

-- When someone leaves or is removed, their invitations to that account stop working.
CREATE OR REPLACE FUNCTION workspace_members_cancel_invites() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE team_invitations SET status = 'revoked'
  WHERE workspace_id = OLD.workspace_id AND status IN ('pending', 'accepted')
    AND lower(email) = (SELECT lower(u.email) FROM auth.users u WHERE u.id = OLD.user_id);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS workspace_members_cancel_invites ON workspace_members;
CREATE TRIGGER workspace_members_cancel_invites AFTER DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_cancel_invites();

-- ============================================================
-- 4. Chat channel roles
-- ============================================================

CREATE OR REPLACE FUNCTION chat_members_role_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role AND NOT can_manage_channel(OLD.channel_id) THEN
    RAISE EXCEPTION 'Only the channel''s owner or an admin can change who owns it';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chat_members_role_guard ON chat_members;
CREATE TRIGGER chat_members_role_guard BEFORE UPDATE OF role ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_members_role_guard();

-- ============================================================
-- 5. Public booking pages
-- ============================================================

DROP POLICY IF EXISTS "appts_public_select" ON appointments;

-- Busy times only. Runs as its owner, so it shows every account's busy times without names,
-- notes or contacts; the booking pages need nothing more.
CREATE OR REPLACE VIEW appointment_busy AS
  SELECT id, calendar_id, host_id, start_time, end_time, status, created_at
  FROM appointments
  WHERE status IN ('confirmed', 'pending');
REVOKE ALL ON appointment_busy FROM public, anon, authenticated;
GRANT SELECT ON appointment_busy TO anon, authenticated;

DROP POLICY IF EXISTS "appts_public_insert" ON appointments;
CREATE POLICY "appts_public_insert" ON appointments FOR INSERT TO anon, authenticated
  WITH CHECK (
    status IN ('confirmed', 'pending')
    AND EXISTS (
      SELECT 1 FROM calendars c
      WHERE c.id = appointments.calendar_id AND c.status = 'active'
        AND (CASE WHEN c.workspace_id IS NOT NULL
                  THEN appointments.workspace_id = c.workspace_id
                  ELSE appointments.workspace_id IS NULL AND appointments.owner_id = c.owner_id END)
    )
  );

-- ============================================================
-- 6. Calendar hosts
-- ============================================================

CREATE OR REPLACE FUNCTION calendar_owner_or_admin(p_calendar uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT c.owner_id = auth.uid()
        OR (c.workspace_id IS NOT NULL AND (is_workspace_admin(c.workspace_id)
            OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = c.workspace_id AND w.owner_id = auth.uid())))
    FROM calendars c WHERE c.id = p_calendar
  ), false);
$$;
REVOKE ALL ON FUNCTION calendar_owner_or_admin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION calendar_owner_or_admin(uuid) TO authenticated;

DROP POLICY IF EXISTS calendar_hosts_owner_insert ON calendar_hosts;
CREATE POLICY calendar_hosts_owner_insert ON calendar_hosts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (calendar_owner_or_admin(calendar_id));
DROP POLICY IF EXISTS calendar_hosts_owner_update ON calendar_hosts;
CREATE POLICY calendar_hosts_owner_update ON calendar_hosts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (calendar_owner_or_admin(calendar_id) OR user_id = auth.uid())
  WITH CHECK (calendar_owner_or_admin(calendar_id) OR user_id = auth.uid());
DROP POLICY IF EXISTS calendar_hosts_owner_delete ON calendar_hosts;
CREATE POLICY calendar_hosts_owner_delete ON calendar_hosts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (calendar_owner_or_admin(calendar_id));

-- ============================================================
-- 7. Meeting recordings files
-- ============================================================

DROP POLICY IF EXISTS "meeting_recordings_read" ON storage.objects;
CREATE POLICY "meeting_recordings_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'meeting-recordings' AND (SELECT is_workspace_member(ws) AND member_can(ws, 'recordings')
    FROM (SELECT CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN ((storage.foldername(name))[1])::uuid END AS ws) f));
DROP POLICY IF EXISTS "meeting_recordings_delete" ON storage.objects;
CREATE POLICY "meeting_recordings_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meeting-recordings' AND (SELECT is_workspace_member(ws) AND member_can(ws, 'recordings')
    FROM (SELECT CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN ((storage.foldername(name))[1])::uuid END AS ws) f));
