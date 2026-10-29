/*
  # A channel for every department, kept in step

  - Each department has its own private channel (#sales, #customer-success…), made the moment the
    department is, and for every department that already exists.
  - Its members are the department's people: added to the department, they're in the channel;
    taken out, they leave it. (Suspended people are added back when they're reactivated.)
  - Renaming the department renames the channel. Deleting the department archives the channel, so
    its history is kept.
  - chat_channels.is_department marks these channels (one per department).

  Needs 20261016090000_conversations.sql and 20261029120000_audit_log.sql. Safe to run more than once.
*/

ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS is_department boolean NOT NULL DEFAULT false;

-- Changes the system makes to follow another change aren't logged a second time.
CREATE OR REPLACE FUNCTION audit_write(p_workspace uuid, p_action text, p_type text, p_id uuid, p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_workspace IS NULL OR current_setting('synapse.offboarding', true) = 'on'
     OR current_setting('synapse.audit_quiet', true) = 'on' THEN RETURN; END IF;
  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (p_workspace, auth.uid(), p_action, p_type, p_id, coalesce(p_details, '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION audit_write(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_department_key ON chat_channels(department_id) WHERE is_department AND archived_at IS NULL;

/** A free channel name from a department name: "Customer Success" -> customer-success (or -2, -3…). */
CREATE OR REPLACE FUNCTION department_channel_name(p_workspace uuid, p_name text, p_except uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE base text; candidate text; n int := 1;
BEGIN
  base := left(trim(both '-' FROM regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9_]+', '-', 'g')), 70);
  IF base = '' THEN base := 'department'; END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM chat_channels WHERE workspace_id = p_workspace AND kind = 'channel' AND name = candidate
                  AND id IS DISTINCT FROM p_except) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END $$;

/** The department's channel, made if it has none, with its people in it. Returns the channel. */
CREATE OR REPLACE FUNCTION ensure_department_channel(p_department uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d departments%ROWTYPE; cid uuid;
BEGIN
  SELECT * INTO d FROM departments WHERE id = p_department;
  IF d.id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO cid FROM chat_channels WHERE department_id = d.id AND is_department AND archived_at IS NULL;
  IF cid IS NULL THEN
    INSERT INTO chat_channels (workspace_id, kind, name, description, is_private, department_id, is_department, created_by)
    VALUES (d.workspace_id, 'channel', department_channel_name(d.workspace_id, d.name),
            left('Everyone in ' || d.name || '. People join and leave as they join and leave the department.', 500),
            true, d.id, true, d.created_by)
    RETURNING id INTO cid;
  END IF;
  INSERT INTO chat_members (channel_id, workspace_id, user_id, role)
    SELECT cid, d.workspace_id, dm.user_id, 'member'
    FROM department_members dm
    JOIN workspace_members m ON m.workspace_id = d.workspace_id AND m.user_id = dm.user_id AND coalesce(m.status, 'active') = 'active'
    WHERE dm.department_id = d.id
  ON CONFLICT (channel_id, user_id) DO NOTHING;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION ensure_department_channel(uuid) FROM PUBLIC, anon, authenticated;

-- Department made, renamed or deleted.
CREATE OR REPLACE FUNCTION department_channel_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM ensure_department_channel(NEW.id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      SELECT id INTO cid FROM chat_channels WHERE department_id = NEW.id AND is_department AND archived_at IS NULL;
      IF cid IS NULL THEN
        PERFORM ensure_department_channel(NEW.id);
      ELSE
        -- The department's rename is in the audit log already; the channel follows quietly.
        PERFORM set_config('synapse.audit_quiet', 'on', true);
        UPDATE chat_channels SET name = department_channel_name(NEW.workspace_id, NEW.name, cid),
          description = left('Everyone in ' || NEW.name || '. People join and leave as they join and leave the department.', 500)
        WHERE id = cid;
        PERFORM set_config('synapse.audit_quiet', 'off', true);
      END IF;
    END IF;
  ELSE
    UPDATE chat_channels SET archived_at = now() WHERE department_id = OLD.id AND is_department AND archived_at IS NULL;
    RETURN OLD;  -- let the delete go ahead
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS department_channel_sync ON departments;
CREATE TRIGGER department_channel_sync AFTER INSERT OR UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION department_channel_sync();
-- Before the delete, while the channel still points at the department.
DROP TRIGGER IF EXISTS department_channel_archive ON departments;
CREATE TRIGGER department_channel_archive BEFORE DELETE ON departments FOR EACH ROW EXECUTE FUNCTION department_channel_sync();

-- Someone joins or leaves a department.
CREATE OR REPLACE FUNCTION department_member_channel_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    cid := ensure_department_channel(NEW.department_id);
  ELSE
    SELECT id INTO cid FROM chat_channels WHERE department_id = OLD.department_id AND is_department AND archived_at IS NULL;
    IF cid IS NOT NULL THEN
      DELETE FROM chat_members WHERE channel_id = cid AND user_id = OLD.user_id;
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS department_member_channel_sync ON department_members;
CREATE TRIGGER department_member_channel_sync AFTER INSERT OR DELETE ON department_members FOR EACH ROW EXECUTE FUNCTION department_member_channel_sync();

-- Reactivated: back into their departments' channels.
CREATE OR REPLACE FUNCTION member_department_channels_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dep uuid;
BEGIN
  IF coalesce(NEW.status, 'active') = 'active' AND coalesce(OLD.status, 'active') <> 'active' THEN
    FOR dep IN SELECT department_id FROM department_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.user_id LOOP
      PERFORM ensure_department_channel(dep);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS member_department_channels_sync ON workspace_members;
CREATE TRIGGER member_department_channels_sync AFTER UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION member_department_channels_sync();

-- Every department that already exists gets its channel now.
DO $$
DECLARE dep uuid;
BEGIN
  FOR dep IN SELECT id FROM departments LOOP
    PERFORM ensure_department_channel(dep);
  END LOOP;
END $$;
