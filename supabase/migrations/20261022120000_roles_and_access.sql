/*
  # Roles: Owner, Admin, User, and what each User can see

  - Three roles. Owner (the account holder) and Admins see and do everything; an Admin can make
    other people Admins. Everyone else is a User ('member' in the database). There are no
    Supervisors any more: they become Users, and department leads are cleared.
  - What a User sees: `workspace_members.access`, a list of sections. Empty (NULL) means the
    standard set: Conversations, Workspaces, Meetings (with the rooms assigned to them) and
    Calendars (only the calendars they own or are a host of). Admins switch more on per person.
  - Enforced in the database, not only in the menu: a restrictive policy on each section's tables
    lets a User of the account reach them only when that section is on for them. People outside
    the account (public booking pages, public forms) are untouched: their own policies decide.
  - Company settings, connected email accounts, webhooks, integrations and the audit log can only
    be changed by Admins. Only Admins change roles, status, titles or what someone can see.
  - Rooms: only Admins create, change and assign them.

  Safe to run more than once.
*/

-- ============================================================
-- 1. No more Supervisors
-- ============================================================

UPDATE workspace_members SET role = 'member' WHERE role = 'supervisor';
UPDATE team_invitations SET role = 'member' WHERE role = 'supervisor';
UPDATE department_members SET is_lead = false WHERE is_lead;

ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));
ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_role_check;
ALTER TABLE team_invitations ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('admin', 'member')) NOT VALID;

-- Nobody leads a department now (rooms and department changes are for Admins).
CREATE OR REPLACE FUNCTION is_department_lead(check_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION can_create_rooms(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_workspace_admin(p_workspace);
$$;

CREATE OR REPLACE FUNCTION can_manage_room(p_room uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM company_rooms r WHERE r.id = p_room AND is_workspace_admin(r.workspace_id));
$$;

-- ============================================================
-- 2. What each User can see
-- ============================================================

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS access text[];

/** The sections a User sees when nobody has chosen for them. Keep in step with src/lib/access.ts. */
CREATE OR REPLACE FUNCTION default_member_access() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['conversations', 'workspaces', 'meetings', 'calendars'];
$$;

/**
 * May the signed-in person use this section of this account? Owners and Admins: always. Users: when
 * it is in their list. Someone who is not in the account at all (or a row with no account): yes,
 * because this only narrows what the account's own people can do; their other policies still apply.
 */
CREATE OR REPLACE FUNCTION member_can(p_workspace uuid, p_feature text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT m.role IN ('owner', 'admin') OR p_feature = ANY(coalesce(m.access, default_member_access()))
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() AND coalesce(m.status, 'active') = 'active'
    LIMIT 1
  ), true) END;
$$;

/** Admin-only parts of an account (same rule: people outside the account are not affected). */
CREATE OR REPLACE FUNCTION member_is_admin_or_outside(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT m.role IN ('owner', 'admin')
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() AND coalesce(m.status, 'active') = 'active'
    LIMIT 1
  ), true) END;
$$;

/** A User sees only the calendars they own or host; Admins (and outsiders' own rules) see the rest. */
CREATE OR REPLACE FUNCTION member_sees_calendar(p_calendar uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_calendar IS NULL THEN true ELSE coalesce((
    SELECT member_is_admin_or_outside(c.workspace_id)
      OR (member_can(c.workspace_id, 'calendars')
          AND (c.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM calendar_hosts h WHERE h.calendar_id = c.id AND h.user_id = auth.uid())))
    FROM calendars c WHERE c.id = p_calendar
  ), true) END;
$$;

-- Only Admins (or the owner) change roles, status, titles or what someone can see.
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

-- ============================================================
-- 3. Each section's tables follow it
-- ============================================================

DO $$
DECLARE
  pair text[];
  sections text[][] := ARRAY[
    ARRAY['contacts', 'contacts'], ARRAY['tags', 'contacts'], ARRAY['notes', 'contacts'],
    ARRAY['smart_lists', 'contacts'], ARRAY['tasks', 'contacts'], ARRAY['messages', 'contacts'],
    ARRAY['calendar_groups', 'calendars'], ARRAY['booking_links', 'calendars'],
    ARRAY['host_availability_rules', 'calendars'], ARRAY['external_busy_periods', 'calendars'],
    ARRAY['forms', 'forms'], ARRAY['form_submissions', 'forms'],
    ARRAY['form_notification_logs', 'forms'], ARRAY['form_activity_timeline', 'forms'],
    ARRAY['workflows', 'workflows'], ARRAY['wf_events', 'workflows'], ARRAY['wf_runs', 'workflows'],
    ARRAY['events', 'events'], ARRAY['streams', 'streams'], ARRAY['recordings', 'recordings']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY sections LOOP
    IF to_regclass('public.' || pair[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1] || '_section_access', pair[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_can(workspace_id, %L)) WITH CHECK (member_can(workspace_id, %L))',
        pair[1] || '_section_access', pair[1], pair[2], pair[2]);
    END IF;
  END LOOP;

  -- Admin-only to read and change.
  FOREACH pair SLICE 1 IN ARRAY ARRAY[ARRAY['webhooks', ''], ARRAY['integrations', ''], ARRAY['audit_logs', '']] LOOP
    IF to_regclass('public.' || pair[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1] || '_admins_only', pair[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id))',
        pair[1] || '_admins_only', pair[1]);
    END IF;
  END LOOP;
END $$;

-- Calendars and their bookings: a User sees only their own calendars.
DROP POLICY IF EXISTS calendars_section_access ON calendars;
CREATE POLICY calendars_section_access ON calendars AS RESTRICTIVE FOR ALL TO authenticated
  USING (member_sees_calendar(id))
  WITH CHECK (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND owner_id = auth.uid()));
DROP POLICY IF EXISTS appointments_section_access ON appointments;
CREATE POLICY appointments_section_access ON appointments AS RESTRICTIVE FOR ALL TO authenticated
  USING (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND member_sees_calendar(calendar_id)))
  WITH CHECK (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND member_sees_calendar(calendar_id)));

-- Company settings and connected email accounts: everyone in the account may read (sending email
-- from a contact needs the account), only Admins change them.
DROP POLICY IF EXISTS workspace_settings_admin_insert ON workspace_settings;
CREATE POLICY workspace_settings_admin_insert ON workspace_settings AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS workspace_settings_admin_update ON workspace_settings;
CREATE POLICY workspace_settings_admin_update ON workspace_settings AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS workspace_settings_admin_delete ON workspace_settings;
CREATE POLICY workspace_settings_admin_delete ON workspace_settings AS RESTRICTIVE FOR DELETE TO authenticated
  USING (member_is_admin_or_outside(workspace_id));

DROP POLICY IF EXISTS email_accounts_admin_insert ON email_accounts;
CREATE POLICY email_accounts_admin_insert ON email_accounts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS email_accounts_admin_update ON email_accounts;
CREATE POLICY email_accounts_admin_update ON email_accounts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS email_accounts_admin_delete ON email_accounts;
CREATE POLICY email_accounts_admin_delete ON email_accounts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (member_is_admin_or_outside(workspace_id));
