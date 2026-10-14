/*
  # Company rooms: rooms supervisors create and assign, links experts send to clients

  Needs 20261014090000_company_foundations.sql (supervisor role, departments) first.
  Safe to run more than once.

  1. company_rooms
     A standing video room of the account (e.g. "Video Support 3"), optionally in a department.
     Admins and supervisors create them; experts cannot. Shows busy while a call is going on in it.
     - open_to_department: everyone in the room's department may use it (not only those assigned)
     - busy_until / busy_meeting / busy_by: kept fresh by the person in the call (room_heartbeat)

  2. company_room_assignees
     Who may use a room: start a call in it and create links for clients or teammates.

  3. meetings.room_id, meetings.for_whom
     A link made in a room is a meeting in that room ("Video Support 3 · Jane Client"). Only
     people who may use the room can put a meeting in it (trigger meetings_room_guard).

  4. Who can do what
     - see rooms and who is assigned: everyone in the account
     - create rooms: admins, and supervisors (in departments they lead, or with no department)
     - change, assign, delete: admins, the supervisor who created the room, or a lead of its department
     - use a room: those above, the people assigned, and (if open_to_department) its department
*/

-- ---------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS company_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  open_to_department boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  busy_until timestamptz,
  busy_meeting uuid,
  busy_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_company_rooms_workspace ON company_rooms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_company_rooms_department ON company_rooms(department_id);

CREATE TABLE IF NOT EXISTS company_room_assignees (
  room_id uuid NOT NULL REFERENCES company_rooms(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_room_assignees_user ON company_room_assignees(user_id);

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES company_rooms(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS for_whom text CHECK (for_whom IS NULL OR char_length(for_whom) <= 120);
CREATE INDEX IF NOT EXISTS idx_meetings_room ON meetings(room_id, created_at DESC) WHERE room_id IS NOT NULL;

-- ---------------------------------------------------------------- helpers

/** Admins, and active supervisors, can create rooms in this account. */
CREATE OR REPLACE FUNCTION can_create_rooms(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_workspace_admin(p_workspace) OR has_workspace_role(p_workspace, ARRAY['supervisor']);
$$;

/** Change, assign or delete this room. */
CREATE OR REPLACE FUNCTION can_manage_room(p_room uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_rooms r
    WHERE r.id = p_room
      AND (
        is_workspace_admin(r.workspace_id)
        OR (has_workspace_role(r.workspace_id, ARRAY['supervisor'])
            AND (r.created_by = auth.uid() OR (r.department_id IS NOT NULL AND is_department_lead(r.department_id))))
      )
  );
$$;

/** Start a call or make links in this room. */
CREATE OR REPLACE FUNCTION can_use_room(p_room uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT can_manage_room(p_room) OR EXISTS (
    SELECT 1 FROM company_rooms r
    WHERE r.id = p_room
      AND has_workspace_role(r.workspace_id, ARRAY['owner', 'admin', 'supervisor', 'member'])
      AND (
        EXISTS (SELECT 1 FROM company_room_assignees a WHERE a.room_id = r.id AND a.user_id = auth.uid())
        OR (r.open_to_department AND r.department_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM department_members dm WHERE dm.department_id = r.department_id AND dm.user_id = auth.uid()))
      )
  );
$$;

REVOKE ALL ON FUNCTION can_create_rooms(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_manage_room(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_use_room(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_create_rooms(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_use_room(uuid) TO authenticated;

-- ---------------------------------------------------------------- row-level security

ALTER TABLE company_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_room_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_rooms_select" ON company_rooms;
CREATE POLICY "company_rooms_select" ON company_rooms FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "company_rooms_insert" ON company_rooms;
CREATE POLICY "company_rooms_insert" ON company_rooms FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND can_create_rooms(workspace_id)
    AND (department_id IS NULL OR is_workspace_admin(workspace_id) OR is_department_lead(department_id))
  );

DROP POLICY IF EXISTS "company_rooms_update" ON company_rooms;
CREATE POLICY "company_rooms_update" ON company_rooms FOR UPDATE TO authenticated
  USING (can_manage_room(id))
  WITH CHECK (department_id IS NULL OR is_workspace_admin(workspace_id) OR is_department_lead(department_id));

DROP POLICY IF EXISTS "company_rooms_delete" ON company_rooms;
CREATE POLICY "company_rooms_delete" ON company_rooms FOR DELETE TO authenticated
  USING (can_manage_room(id));

DROP POLICY IF EXISTS "company_room_assignees_select" ON company_room_assignees;
CREATE POLICY "company_room_assignees_select" ON company_room_assignees FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "company_room_assignees_insert" ON company_room_assignees;
CREATE POLICY "company_room_assignees_insert" ON company_room_assignees FOR INSERT TO authenticated
  WITH CHECK (can_manage_room(room_id));

DROP POLICY IF EXISTS "company_room_assignees_delete" ON company_room_assignees;
CREATE POLICY "company_room_assignees_delete" ON company_room_assignees FOR DELETE TO authenticated
  USING (can_manage_room(room_id));

-- ---------------------------------------------------------------- guards

-- Rooms: the workspace never changes, busy fields only change through room_heartbeat/room_release,
-- and a room's department belongs to the same account.
CREATE OR REPLACE FUNCTION company_rooms_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'That department belongs to another account';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id <> OLD.workspace_id THEN RAISE EXCEPTION 'A room cannot move to another account'; END IF;
    IF current_setting('synapse.room_busy', true) IS DISTINCT FROM 'on'
       AND (NEW.busy_until IS DISTINCT FROM OLD.busy_until OR NEW.busy_meeting IS DISTINCT FROM OLD.busy_meeting OR NEW.busy_by IS DISTINCT FROM OLD.busy_by) THEN
      NEW.busy_until := OLD.busy_until; NEW.busy_meeting := OLD.busy_meeting; NEW.busy_by := OLD.busy_by;
    END IF;
  ELSIF current_setting('synapse.room_busy', true) IS DISTINCT FROM 'on' THEN
    NEW.busy_until := NULL; NEW.busy_meeting := NULL; NEW.busy_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS company_rooms_guard ON company_rooms;
CREATE TRIGGER company_rooms_guard BEFORE INSERT OR UPDATE ON company_rooms
  FOR EACH ROW EXECUTE FUNCTION company_rooms_guard();

-- Assignees: same account as the room, and an active member of it.
CREATE OR REPLACE FUNCTION company_room_assignees_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT r.workspace_id INTO NEW.workspace_id FROM company_rooms r WHERE r.id = NEW.room_id;
  IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'Only people in this account can be assigned to its rooms';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS company_room_assignees_check ON company_room_assignees;
CREATE TRIGGER company_room_assignees_check BEFORE INSERT OR UPDATE ON company_room_assignees
  FOR EACH ROW EXECUTE FUNCTION company_room_assignees_check();

-- Meetings in a room: only people who may use the room, in the same account.
CREATE OR REPLACE FUNCTION meetings_room_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.room_id IS NULL OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.room_id IS NOT DISTINCT FROM OLD.room_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM company_rooms r WHERE r.id = NEW.room_id AND r.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'That room belongs to another account';
  END IF;
  IF NOT can_use_room(NEW.room_id) THEN
    RAISE EXCEPTION 'You are not assigned to this room. Ask a supervisor to assign you.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS meetings_room_guard ON meetings;
CREATE TRIGGER meetings_room_guard BEFORE INSERT OR UPDATE OF room_id ON meetings
  FOR EACH ROW EXECUTE FUNCTION meetings_room_guard();

-- ---------------------------------------------------------------- busy

/** Mark the room of this meeting busy for the next 90 seconds (called every ~45 s during the call). */
CREATE OR REPLACE FUNCTION room_heartbeat(p_meeting uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room uuid; v_ws uuid; v_until timestamptz := now() + interval '90 seconds';
BEGIN
  SELECT m.room_id, m.workspace_id INTO v_room, v_ws FROM meetings m WHERE m.id = p_meeting AND m.ended_at IS NULL;
  IF v_room IS NULL OR NOT is_workspace_member(v_ws) THEN RETURN NULL; END IF;
  PERFORM set_config('synapse.room_busy', 'on', true);
  UPDATE company_rooms SET busy_until = v_until, busy_meeting = p_meeting, busy_by = auth.uid() WHERE id = v_room;
  RETURN v_until;
END;
$$;

/** The call in this meeting is over: the room is free again (unless another call took it over). */
CREATE OR REPLACE FUNCTION room_release(p_meeting uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room uuid; v_ws uuid;
BEGIN
  SELECT m.room_id, m.workspace_id INTO v_room, v_ws FROM meetings m WHERE m.id = p_meeting;
  IF v_room IS NULL OR NOT is_workspace_member(v_ws) THEN RETURN; END IF;
  PERFORM set_config('synapse.room_busy', 'on', true);
  UPDATE company_rooms SET busy_until = NULL, busy_meeting = NULL, busy_by = NULL WHERE id = v_room AND busy_meeting = p_meeting;
END;
$$;

REVOKE ALL ON FUNCTION room_heartbeat(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION room_release(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION room_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION room_release(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON company_rooms, company_room_assignees TO authenticated;
