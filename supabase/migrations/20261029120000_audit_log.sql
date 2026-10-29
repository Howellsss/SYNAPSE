/*
  # Audit log: the database writes down who changed what

  Every important change is recorded by the database itself, with the person who made it (they
  can't be left out or faked from the app):
    - People: someone joins, is invited, an invite is cancelled, a role / what someone can see /
      suspended or active changes, someone is removed.
    - Deletions: contacts, forms, workflows, calendars, events, rooms, departments, channels.
    - Publishing: a workflow switched on or off, a form published or taken down.
    - Settings: company details and settings pages, connected email accounts, webhooks,
      integrations, departments and rooms created or renamed, room assignments.
  Only changes made by a signed-in person are written (not the system's own), and only Admins can
  read the log (as before). Entries can't be edited or deleted.

  Safe to run more than once.
*/

-- A person's name for the log (kept in the entry, so it still reads after they leave).
CREATE OR REPLACE FUNCTION audit_person(p_user uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(
    nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    (SELECT u.email::text FROM auth.users u WHERE u.id = p_user),
    'Someone')
  FROM (SELECT 1) one LEFT JOIN profiles p ON p.user_id = p_user;
$$;

-- Write one entry, for changes a signed-in person makes.
CREATE OR REPLACE FUNCTION audit_write(p_workspace uuid, p_action text, p_type text, p_id uuid, p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_workspace IS NULL OR current_setting('synapse.offboarding', true) = 'on' THEN RETURN; END IF;
  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_workspace, auth.uid(), p_action, p_type, p_id, coalesce(p_details, '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION audit_write(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Entries name the person who really made them, and stay as written.
CREATE OR REPLACE FUNCTION audit_logs_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.user_id := auth.uid(); END IF;
  NEW.details := coalesce(NEW.details, '{}'::jsonb) || jsonb_build_object('actor', CASE WHEN NEW.user_id IS NOT NULL THEN audit_person(NEW.user_id) END);
  NEW.created_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_logs_stamp ON audit_logs;
CREATE TRIGGER audit_logs_stamp BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_stamp();
DROP POLICY IF EXISTS "audit_logs_update" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete" ON audit_logs;

-- ============================================================
-- People
-- ============================================================

CREATE OR REPLACE FUNCTION audit_members() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r workspace_members%ROWTYPE;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_OP = 'INSERT' THEN
    PERFORM audit_write(r.workspace_id, 'member_joined', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id), 'role', r.role));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM audit_write(r.workspace_id, 'member_removed', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id)));
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      PERFORM audit_write(r.workspace_id, 'role_changed', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id), 'from', OLD.role, 'to', NEW.role));
    END IF;
    IF NEW.access IS DISTINCT FROM OLD.access THEN
      PERFORM audit_write(r.workspace_id, 'access_changed', 'member', r.user_id, jsonb_build_object('name', audit_person(r.user_id),
        'from', to_jsonb(coalesce(OLD.access, default_member_access())), 'to', to_jsonb(coalesce(NEW.access, default_member_access()))));
    END IF;
    IF coalesce(NEW.status, 'active') IS DISTINCT FROM coalesce(OLD.status, 'active') THEN
      PERFORM audit_write(r.workspace_id, CASE WHEN NEW.status = 'suspended' THEN 'member_suspended' ELSE 'member_reactivated' END, 'member', r.user_id,
        jsonb_build_object('name', audit_person(r.user_id)));
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_members ON workspace_members;
CREATE TRIGGER audit_members AFTER INSERT OR UPDATE OR DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION audit_members();

CREATE OR REPLACE FUNCTION audit_invitations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM audit_write(NEW.workspace_id, 'member_invited', 'invitation', NEW.id, jsonb_build_object('email', NEW.email, 'role', NEW.role));
  ELSIF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    PERFORM audit_write(NEW.workspace_id, 'invite_cancelled', 'invitation', NEW.id, jsonb_build_object('email', NEW.email));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_invitations ON team_invitations;
CREATE TRIGGER audit_invitations AFTER INSERT OR UPDATE ON team_invitations FOR EACH ROW EXECUTE FUNCTION audit_invitations();

-- ============================================================
-- Deletions, publishing, renames
-- ============================================================

/** The name a row goes by, for each audited table. */
CREATE OR REPLACE FUNCTION audit_label(p_table text, p_row jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_table
    WHEN 'contacts' THEN coalesce(nullif(trim(coalesce(p_row->>'first_name', '') || ' ' || coalesce(p_row->>'last_name', '')), ''), p_row->>'email', 'a contact')
    WHEN 'events' THEN p_row->>'title'
    WHEN 'webhooks' THEN p_row->>'url'
    WHEN 'integrations' THEN p_row->>'provider'
    WHEN 'email_accounts' THEN p_row->>'email'
    ELSE p_row->>'name'
  END;
$$;

CREATE OR REPLACE FUNCTION audit_things() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  kind text := CASE TG_TABLE_NAME
    WHEN 'contacts' THEN 'contact' WHEN 'forms' THEN 'form' WHEN 'workflows' THEN 'workflow' WHEN 'calendars' THEN 'calendar'
    WHEN 'events' THEN 'event' WHEN 'company_rooms' THEN 'room' WHEN 'departments' THEN 'department' WHEN 'chat_channels' THEN 'channel'
    WHEN 'webhooks' THEN 'webhook' WHEN 'integrations' THEN 'integration' WHEN 'email_accounts' THEN 'email_account' ELSE TG_TABLE_NAME END;
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r jsonb := coalesce(n, o);
  ws uuid := (r->>'workspace_id')::uuid;
  id uuid := (r->>'id')::uuid;
  label text := audit_label(TG_TABLE_NAME, r);
BEGIN
  -- Direct messages aren't the company's business.
  IF TG_TABLE_NAME = 'chat_channels' AND r->>'kind' = 'dm' THEN RETURN NULL; END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM audit_write(ws, CASE kind
      WHEN 'webhook' THEN 'webhook_removed' WHEN 'integration' THEN 'integration_disconnected'
      WHEN 'email_account' THEN 'email_disconnected' ELSE kind || '_deleted' END, kind, id, jsonb_build_object('name', label));
  ELSIF TG_OP = 'INSERT' THEN
    IF kind IN ('department', 'room', 'webhook') THEN
      PERFORM audit_write(ws, CASE kind WHEN 'webhook' THEN 'webhook_added' ELSE kind || '_created' END, kind, id, jsonb_build_object('name', label));
    ELSIF kind = 'integration' THEN
      PERFORM audit_write(ws, 'integration_connected', kind, id, jsonb_build_object('name', label));
    ELSIF kind = 'email_account' THEN
      PERFORM audit_write(ws, 'email_connected', kind, id, jsonb_build_object('name', label));
    END IF;
  ELSE
    IF kind = 'workflow' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
      IF n->>'status' = 'active' THEN PERFORM audit_write(ws, 'workflow_published', kind, id, jsonb_build_object('name', label));
      ELSIF o->>'status' = 'active' THEN PERFORM audit_write(ws, 'workflow_paused', kind, id, jsonb_build_object('name', label, 'to', n->>'status'));
      END IF;
    ELSIF kind = 'form' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
      IF n->>'status' = 'published' THEN PERFORM audit_write(ws, 'form_published', kind, id, jsonb_build_object('name', label));
      ELSIF o->>'status' = 'published' THEN PERFORM audit_write(ws, 'form_unpublished', kind, id, jsonb_build_object('name', label, 'to', n->>'status'));
      END IF;
    ELSIF kind IN ('department', 'room', 'channel', 'calendar', 'form', 'workflow') AND (o->>'name') IS DISTINCT FROM (n->>'name') THEN
      PERFORM audit_write(ws, kind || '_renamed', kind, id, jsonb_build_object('name', n->>'name', 'from', o->>'name'));
    ELSIF kind = 'webhook' AND (o->'url' IS DISTINCT FROM n->'url' OR o->'events' IS DISTINCT FROM n->'events' OR o->'is_active' IS DISTINCT FROM n->'is_active' OR o->'secret' IS DISTINCT FROM n->'secret') THEN
      PERFORM audit_write(ws, 'webhook_changed', kind, id, jsonb_build_object('name', label));
    END IF;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'forms', 'workflows', 'calendars', 'events', 'company_rooms', 'departments', 'chat_channels',
                           'webhooks', 'integrations', 'email_accounts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_things ON %I', t);
      IF t IN ('contacts', 'events') THEN
        EXECUTE format('CREATE TRIGGER audit_things AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_things()', t);
      ELSE
        EXECUTE format('CREATE TRIGGER audit_things AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_things()', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Settings and room assignments
-- ============================================================

CREATE OR REPLACE FUNCTION audit_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed text[];
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    SELECT array_agg(k ORDER BY k) INTO changed FROM jsonb_each(to_jsonb(NEW)) e(k, v)
    WHERE k IN ('name', 'slug', 'logo_url', 'timezone', 'default_booking_settings') AND v IS DISTINCT FROM to_jsonb(OLD)->k;
    IF changed IS NOT NULL THEN
      PERFORM audit_write(NEW.id, 'settings_changed', 'settings', NEW.id, jsonb_build_object('area', 'company', 'fields', to_jsonb(changed)));
    END IF;
  ELSIF TG_OP = 'INSERT' OR NEW.settings IS DISTINCT FROM OLD.settings THEN
    PERFORM audit_write(NEW.workspace_id, 'settings_changed', 'settings', NEW.id, jsonb_build_object('area', NEW.category));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_settings ON workspaces;
CREATE TRIGGER audit_settings AFTER UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION audit_settings();
DROP TRIGGER IF EXISTS audit_settings ON workspace_settings;
CREATE TRIGGER audit_settings AFTER INSERT OR UPDATE ON workspace_settings FOR EACH ROW EXECUTE FUNCTION audit_settings();

CREATE OR REPLACE FUNCTION audit_room_assignees() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r company_room_assignees%ROWTYPE;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM audit_write(r.workspace_id, CASE TG_OP WHEN 'DELETE' THEN 'room_unassigned' ELSE 'room_assigned' END, 'room', r.room_id,
    jsonb_build_object('name', (SELECT name FROM company_rooms WHERE id = r.room_id), 'person', audit_person(r.user_id)));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS audit_room_assignees ON company_room_assignees;
CREATE TRIGGER audit_room_assignees AFTER INSERT OR DELETE ON company_room_assignees FOR EACH ROW EXECUTE FUNCTION audit_room_assignees();

-- ============================================================
-- Suspend / remove writes one entry of its own (with what was handed over)
-- ============================================================

CREATE OR REPLACE FUNCTION offboard_member(p_member uuid, p_action text, p_hand_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws uuid; uid uuid; who_role text; ws_owner uuid;
  moved jsonb := '{}'::jsonb; n int;
BEGIN
  IF p_action NOT IN ('suspend', 'remove') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT workspace_id, user_id, role INTO ws, uid, who_role FROM workspace_members WHERE id = p_member;
  IF ws IS NULL THEN RAISE EXCEPTION 'That person is not in this account'; END IF;
  IF NOT is_workspace_admin(ws) THEN RAISE EXCEPTION 'Only admins can suspend or remove people'; END IF;
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = ws;
  IF uid = ws_owner OR who_role = 'owner' THEN RAISE EXCEPTION 'The account owner cannot be suspended or removed'; END IF;
  IF uid = auth.uid() THEN RAISE EXCEPTION 'You cannot suspend or remove yourself'; END IF;
  IF p_action = 'remove' AND p_hand_to IS NULL THEN RAISE EXCEPTION 'Choose who takes over their work'; END IF;
  -- This writes one audit entry of its own (below); the step-by-step changes aren't logged again.
  PERFORM set_config('synapse.offboarding', 'on', true);
  IF p_hand_to IS NOT NULL AND (p_hand_to = uid OR NOT (p_hand_to = ws_owner OR EXISTS (
       SELECT 1 FROM workspace_members m WHERE m.workspace_id = ws AND m.user_id = p_hand_to AND coalesce(m.status, 'active') = 'active'))) THEN
    RAISE EXCEPTION 'The person taking over must be active in this account';
  END IF;

  -- Hand-over
  IF p_hand_to IS NOT NULL THEN
    UPDATE contacts SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('contacts', n);

    UPDATE tasks SET assigned_to = p_hand_to, updated_at = now() WHERE workspace_id = ws AND assigned_to = uid AND completed_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('tasks', n);

    UPDATE calendars SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('calendars', n);
    INSERT INTO calendar_hosts (calendar_id, user_id, priority, weight, is_primary)
      SELECT h.calendar_id, p_hand_to, h.priority, h.weight, h.is_primary
      FROM calendar_hosts h JOIN calendars c ON c.id = h.calendar_id
      WHERE c.workspace_id = ws AND h.user_id = uid
      ON CONFLICT (calendar_id, user_id) DO NOTHING;
    DELETE FROM calendar_hosts h USING calendars c WHERE c.id = h.calendar_id AND c.workspace_id = ws AND h.user_id = uid;

    UPDATE appointments SET host_id = CASE WHEN host_id = uid THEN p_hand_to ELSE host_id END,
                            owner_id = CASE WHEN owner_id = uid THEN p_hand_to ELSE owner_id END
      WHERE workspace_id = ws AND (host_id = uid OR owner_id = uid) AND start_time > now() AND status IN ('confirmed', 'pending');
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('bookings', n);

    UPDATE booking_links SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    UPDATE calendar_groups SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE forms SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('forms', n);
    UPDATE form_submissions SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE events SET created_by = p_hand_to WHERE workspace_id = ws AND created_by = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('events', n);

    UPDATE meetings SET host_id = p_hand_to WHERE workspace_id = ws AND host_id = uid AND ended_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('meetings', n);

    INSERT INTO company_room_assignees (room_id, workspace_id, user_id, assigned_by)
      SELECT a.room_id, ws, p_hand_to, auth.uid() FROM company_room_assignees a WHERE a.workspace_id = ws AND a.user_id = uid
      ON CONFLICT (room_id, user_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('rooms', n);

    INSERT INTO chat_members (channel_id, workspace_id, user_id, role)
      SELECT cm.channel_id, ws, p_hand_to, 'owner' FROM chat_members cm WHERE cm.workspace_id = ws AND cm.user_id = uid AND cm.role = 'owner'
      ON CONFLICT (channel_id, user_id) DO UPDATE SET role = 'owner';
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE workspace_members SET status = 'suspended' WHERE id = p_member;
  ELSE
    DELETE FROM chat_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM department_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM company_room_assignees WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM space_members sm USING spaces s WHERE s.id = sm.space_id AND s.workspace_id = ws AND sm.user_id = uid;
    DELETE FROM member_status WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM workspace_members WHERE id = p_member;
  END IF;

  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (ws, auth.uid(), CASE p_action WHEN 'suspend' THEN 'member_suspended' ELSE 'member_removed' END, 'member', uid,
          jsonb_build_object('handed_to', p_hand_to, 'moved', moved, 'name', audit_person(uid),
                             'handed_to_name', CASE WHEN p_hand_to IS NOT NULL THEN audit_person(p_hand_to) END));
  PERFORM set_config('synapse.offboarding', 'off', true);

  -- Sign them out everywhere, unless they still belong to another account.
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = uid AND m.workspace_id <> ws AND coalesce(m.status, 'active') = 'active')
     AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = uid AND w.id <> ws)
     AND to_regclass('auth.sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING uid;
    EXCEPTION WHEN insufficient_privilege THEN NULL;  -- the app and the checks above still lock them out
    END;
  END IF;

  RETURN moved;
END $$;
REVOKE ALL ON FUNCTION offboard_member(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION offboard_member(uuid, text, uuid) TO authenticated;
