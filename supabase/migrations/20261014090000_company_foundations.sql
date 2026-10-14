/*
# Company foundations: roles, departments, safe invitations

For company accounts (e.g. a support company with 200 staff): a Supervisor role, departments
that supervisors lead, job titles, invitations that carry a department and title, and fixes
to how people join a workspace.

## 1. Security fixes
- `wm_insert_self` let any signed-in user add themselves to ANY workspace with ANY role
  (including owner/admin). Now a member row can only be added by a workspace admin, by the
  workspace's owner for themselves, or by someone holding a pending, unexpired invitation for
  that workspace, for their own email, with exactly the invited role.
- `wm_update` let members update their own row, including `role` and `status` (promote
  themselves to admin, un-suspend themselves). A trigger now stops anyone but a workspace admin
  changing role, status, title or department; `owner` can only ever be the workspace's owner.
- `team_inv_public_select_token` let anyone (even signed out) list EVERY pending invitation with
  its email and token. Replaced by:
    - `get_invitation(token)`: the one invitation for a token (for the accept page), and
    - a policy letting a signed-in user see invitations sent to their own email.
- Invitees could not mark their invitation accepted (update was admin-only), so invitations stayed
  "pending" forever. `accept_invitation(token)` does the whole accept server-side, and a policy
  lets invitees mark their own invitation accepted.

## 2. Supervisor role
`workspace_members.role` and `team_invitations.role`: owner, admin, supervisor, member.

## 3. Departments
- `departments` (name, color, description) per workspace.
- `department_members` (department, member, is_lead). A lead is a supervisor of that department.
- Everyone in the workspace can see departments; admins create/rename/delete them; admins and
  the department's leads add and remove members (only admins choose leads).

## 4. Job titles and invitation details
- `workspace_members.title`
- `team_invitations.title`, `team_invitations.department_id` (joined on accept)
*/

-- ============================================================
-- 1. Roles: add 'supervisor'
-- ============================================================

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('public.workspace_members'::regclass, 'public.team_invitations'::regclass)
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'supervisor', 'member'));
-- NOT VALID: any old 'owner' invitation stays readable; new and changed ones must use these roles.
ALTER TABLE team_invitations ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('admin', 'supervisor', 'member')) NOT VALID;

-- ============================================================
-- 2. Departments
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 500),
  color text NOT NULL DEFAULT '#0D1C3B' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_departments_workspace ON departments(workspace_id);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS department_members (
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_lead boolean NOT NULL DEFAULT false,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(workspace_id, user_id);
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;

-- The department's workspace must match (no cross-workspace rows).
CREATE OR REPLACE FUNCTION department_members_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'Department is not in this workspace';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Only members of the workspace can join its departments';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS department_members_check ON department_members;
CREATE TRIGGER department_members_check BEFORE INSERT OR UPDATE ON department_members
  FOR EACH ROW EXECUTE FUNCTION department_members_check();

-- Leads of a department (its supervisors).
CREATE OR REPLACE FUNCTION is_department_lead(check_department_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM department_members dm
    JOIN workspace_members m ON m.workspace_id = dm.workspace_id AND m.user_id = dm.user_id
    WHERE dm.department_id = check_department_id AND dm.user_id = auth.uid()
      AND dm.is_lead AND m.status = 'active'
  );
$$;

DROP POLICY IF EXISTS departments_select ON departments;
CREATE POLICY departments_select ON departments FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS departments_insert ON departments;
CREATE POLICY departments_insert ON departments FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS departments_update ON departments;
CREATE POLICY departments_update ON departments FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS departments_delete ON departments;
CREATE POLICY departments_delete ON departments FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS department_members_select ON department_members;
CREATE POLICY department_members_select ON department_members FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));
-- Admins add anyone (and choose leads); a department's leads add plain members to it.
DROP POLICY IF EXISTS department_members_insert ON department_members;
CREATE POLICY department_members_insert ON department_members FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id) OR (is_department_lead(department_id) AND NOT is_lead));
DROP POLICY IF EXISTS department_members_update ON department_members;
CREATE POLICY department_members_update ON department_members FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS department_members_delete ON department_members;
CREATE POLICY department_members_delete ON department_members FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id) OR (is_department_lead(department_id) AND NOT is_lead));

-- ============================================================
-- 3. Job titles, invitation department/title
-- ============================================================

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS title text
  CHECK (title IS NULL OR length(title) <= 80);
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS title text
  CHECK (title IS NULL OR length(title) <= 80);
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES departments(id) ON DELETE SET NULL;

-- ============================================================
-- 4. Who may add and change member rows
-- ============================================================

DROP POLICY IF EXISTS "wm_insert_self" ON workspace_members;
CREATE POLICY "wm_insert_self" ON workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    -- Admins add people.
    is_workspace_admin(workspace_id)
    -- The workspace's owner restores their own owner row.
    OR (user_id = auth.uid() AND role = 'owner'
        AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
    -- Someone accepting their own pending invitation, with exactly the invited role.
    OR (user_id = auth.uid() AND role <> 'owner' AND EXISTS (
      SELECT 1 FROM team_invitations i
      WHERE i.workspace_id = workspace_members.workspace_id
        AND i.status = 'pending' AND i.expires_at > now()
        AND lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        AND i.role = workspace_members.role
    ))
  );

-- Role, status, title and departments are the admins' to change. 'owner' is only ever the
-- workspace's owner. Server-side code (no signed-in user) is not limited.
CREATE OR REPLACE FUNCTION workspace_members_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_owner uuid;
BEGIN
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = NEW.workspace_id;
  IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM ws_owner THEN
    RAISE EXCEPTION 'Only the workspace owner can have the owner role';
  END IF;
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      RAISE EXCEPTION 'The owner''s role cannot be changed';
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.title IS DISTINCT FROM OLD.title)
       AND NOT is_workspace_admin(NEW.workspace_id) AND auth.uid() IS DISTINCT FROM ws_owner THEN
      RAISE EXCEPTION 'Only workspace admins can change roles, status or titles';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_members_guard ON workspace_members;
CREATE TRIGGER workspace_members_guard BEFORE INSERT OR UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_guard();

-- ============================================================
-- 5. Invitations: no public listing; accept on the server
-- ============================================================

DROP POLICY IF EXISTS "team_inv_public_select_token" ON team_invitations;

-- Signed-in people see invitations sent to their own email (used when they sign in).
DROP POLICY IF EXISTS "team_inv_select_own" ON team_invitations;
CREATE POLICY "team_inv_select_own" ON team_invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ... and can mark them accepted.
DROP POLICY IF EXISTS "team_inv_accept_own" ON team_invitations;
CREATE POLICY "team_inv_accept_own" ON team_invitations FOR UPDATE TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND status = 'pending')
  WITH CHECK (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND status = 'accepted');

-- One invitation by its token, for the accept page (works signed out). Nothing else is listable.
CREATE OR REPLACE FUNCTION get_invitation(p_token text)
RETURNS TABLE (
  id uuid, workspace_id uuid, workspace_name text, email text, role text, title text,
  department_name text, status text, expires_at timestamptz
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT i.id, i.workspace_id, w.name, i.email, i.role, i.title, d.name, i.status, i.expires_at
  FROM team_invitations i
  JOIN workspaces w ON w.id = i.workspace_id
  LEFT JOIN departments d ON d.id = i.department_id
  WHERE p_token IS NOT NULL AND length(p_token) >= 32 AND i.token = p_token;
$$;
REVOKE ALL ON FUNCTION get_invitation(text) FROM public;
GRANT EXECUTE ON FUNCTION get_invitation(text) TO anon, authenticated;

-- Accept an invitation for the signed-in user: join with the invited role, title and department.
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
  IF inv.status = 'pending' AND inv.expires_at <= now() THEN RAISE EXCEPTION 'This invitation has expired. Ask for a new one.'; END IF;
  IF lower(inv.email) <> my_email THEN
    RAISE EXCEPTION 'This invitation is for %. Sign in with that email.', inv.email;
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, role, status, title)
  VALUES (inv.workspace_id, me, inv.role, 'active', inv.title)
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET status = 'active',
        title = coalesce(workspace_members.title, EXCLUDED.title);

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

-- ============================================================
-- 6. Team directory
-- ============================================================

-- Teammates can see each other's name and avatar (people in a shared workspace).
DROP POLICY IF EXISTS "profiles_select_teammates" ON profiles;
CREATE POLICY "profiles_select_teammates" ON profiles FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM workspace_members a
    JOIN workspace_members b ON b.workspace_id = a.workspace_id
    WHERE a.user_id = auth.uid() AND b.user_id = profiles.user_id
  ));

-- Everyone in a workspace, for the team page: name, avatar, role, status, title and departments.
-- Emails only for the workspace's admins.
CREATE OR REPLACE FUNCTION workspace_directory(p_workspace_id uuid)
RETURNS TABLE (
  member_id uuid, user_id uuid, first_name text, last_name text, avatar_url text, email text,
  role text, status text, title text, joined_at timestamptz, department_ids uuid[], lead_department_ids uuid[]
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT m.id, m.user_id, p.first_name, p.last_name, p.avatar_url,
         CASE WHEN is_workspace_admin(p_workspace_id) THEN u.email::text END,
         m.role, m.status, m.title, m.created_at,
         coalesce(array_agg(dm.department_id) FILTER (WHERE dm.department_id IS NOT NULL), '{}'),
         coalesce(array_agg(dm.department_id) FILTER (WHERE dm.is_lead), '{}')
  FROM workspace_members m
  LEFT JOIN profiles p ON p.user_id = m.user_id
  LEFT JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN department_members dm ON dm.workspace_id = m.workspace_id AND dm.user_id = m.user_id
  WHERE m.workspace_id = p_workspace_id AND is_workspace_member(p_workspace_id)
  GROUP BY m.id, p.first_name, p.last_name, p.avatar_url, u.email
  ORDER BY lower(coalesce(p.first_name, '')), lower(coalesce(p.last_name, ''));
$$;
REVOKE ALL ON FUNCTION workspace_directory(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION workspace_directory(uuid) TO authenticated;
