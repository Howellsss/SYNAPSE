/*
  # Conversations: channels, direct messages, threads, incoming webhooks, email replies

  Needs 20261014090000_company_foundations.sql first. Safe to run more than once.

  1. chat_channels      a channel (#general, #video-team) or a direct message between people
                        - kind: 'channel' | 'dm'; private channels are visible to their members only
                        - dm_key: the sorted user ids of a direct message, so each pair has one
  2. chat_members       who is in a channel; last_read_at drives unread counts
  3. chat_messages      messages; parent_id makes a thread reply
                        - source: 'user' | 'webhook' (Zapier, Airtable, Modal…) | 'system'
                        - sender_name: shown for webhook posts (no SYNAPSE person behind them)
  4. chat_webhooks      incoming webhook links per channel (a secret token in the URL).
                        The chat-webhook Edge Function posts with it; only channel owners and
                        admins see or manage them.
  5. messages.provider_thread_id, messages.reply_checked_at
                        the Gmail thread an email went out in, so replies can be brought back
                        (send-email's scheduler run reads new replies and saves them as inbound;
                        reply_checked_at spreads the checking over the sent emails)

  Who can do what
  - everyone in the account sees public channels and their messages; private channels and direct
    messages only their members
  - anyone in the account can create a channel (they own it) and join public ones
  - channel owners and admins rename, archive, add or remove people, and manage webhooks
  - you edit and delete your own messages; owners and admins can delete any in their channels
*/

-- ---------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel', 'dm')),
  name text CHECK (name IS NULL OR name ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  is_private boolean NOT NULL DEFAULT false,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  dm_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  last_message_at timestamptz,
  CHECK ((kind = 'channel' AND name IS NOT NULL AND dm_key IS NULL) OR (kind = 'dm' AND dm_key IS NOT NULL AND is_private))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_name_key ON chat_channels(workspace_id, name) WHERE kind = 'channel';
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_dm_key ON chat_channels(workspace_id, dm_key) WHERE kind = 'dm';
CREATE INDEX IF NOT EXISTS idx_chat_channels_workspace ON chat_channels(workspace_id);

CREATE TABLE IF NOT EXISTS chat_members (
  channel_id uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  muted boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, workspace_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'webhook', 'system')),
  sender_name text CHECK (sender_name IS NULL OR char_length(sender_name) <= 80),
  webhook_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  reply_count integer NOT NULL DEFAULT 0,
  last_reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace ON chat_messages(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chat_webhooks_channel ON chat_webhooks(channel_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_thread_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(provider_thread_id) WHERE provider_thread_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_key ON messages(workspace_id, provider_message_id) WHERE provider_message_id IS NOT NULL AND direction = 'inbound';

-- ---------------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION is_chat_member(p_channel uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM chat_members WHERE channel_id = p_channel AND user_id = auth.uid());
$$;

/** See a channel: its members, or anyone active in the account when it's public. */
CREATE OR REPLACE FUNCTION can_see_channel(p_channel uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel
      AND has_workspace_role(c.workspace_id, ARRAY['owner', 'admin', 'supervisor', 'member'])
      AND (NOT c.is_private OR is_chat_member(c.id))
  );
$$;

/** Rename, archive, add or remove people, manage webhooks. */
CREATE OR REPLACE FUNCTION can_manage_channel(p_channel uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channels c
    WHERE c.id = p_channel AND c.kind = 'channel'
      AND (is_workspace_admin(c.workspace_id)
           OR EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = auth.uid() AND m.role = 'owner'))
  );
$$;

REVOKE ALL ON FUNCTION is_chat_member(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_see_channel(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION can_manage_channel(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION is_chat_member(uuid), can_see_channel(uuid), can_manage_channel(uuid) TO authenticated;

-- ---------------------------------------------------------------- row-level security

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_channels_select" ON chat_channels;
CREATE POLICY "chat_channels_select" ON chat_channels FOR SELECT TO authenticated USING (can_see_channel(id));

-- Channels are created through create_channel / open_dm (they add the creator as owner).
DROP POLICY IF EXISTS "chat_channels_update" ON chat_channels;
CREATE POLICY "chat_channels_update" ON chat_channels FOR UPDATE TO authenticated
  USING (can_manage_channel(id)) WITH CHECK (can_manage_channel(id));

DROP POLICY IF EXISTS "chat_channels_delete" ON chat_channels;
CREATE POLICY "chat_channels_delete" ON chat_channels FOR DELETE TO authenticated
  USING (kind = 'channel' AND is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "chat_members_select" ON chat_members;
CREATE POLICY "chat_members_select" ON chat_members FOR SELECT TO authenticated USING (can_see_channel(channel_id));

-- Join a public channel yourself; owners and admins add anyone in the account.
DROP POLICY IF EXISTS "chat_members_insert" ON chat_members;
CREATE POLICY "chat_members_insert" ON chat_members FOR INSERT TO authenticated
  WITH CHECK (
    role = 'member'
    AND (
      (user_id = auth.uid() AND EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = channel_id AND c.kind = 'channel' AND NOT c.is_private AND c.archived_at IS NULL)
        AND can_see_channel(channel_id))
      OR can_manage_channel(channel_id)
    )
  );

-- Your own read marker and mute; owners and admins can make someone an owner.
DROP POLICY IF EXISTS "chat_members_update" ON chat_members;
CREATE POLICY "chat_members_update" ON chat_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR can_manage_channel(channel_id))
  WITH CHECK (user_id = auth.uid() OR can_manage_channel(channel_id));

DROP POLICY IF EXISTS "chat_members_delete" ON chat_members;
CREATE POLICY "chat_members_delete" ON chat_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR can_manage_channel(channel_id));

DROP POLICY IF EXISTS "chat_messages_select" ON chat_messages;
CREATE POLICY "chat_messages_select" ON chat_messages FOR SELECT TO authenticated USING (can_see_channel(channel_id));

DROP POLICY IF EXISTS "chat_messages_insert" ON chat_messages;
CREATE POLICY "chat_messages_insert" ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND source = 'user' AND webhook_id IS NULL AND sender_name IS NULL
    AND is_chat_member(channel_id)
    AND EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = channel_id AND c.archived_at IS NULL)
  );

DROP POLICY IF EXISTS "chat_messages_update" ON chat_messages;
CREATE POLICY "chat_messages_update" ON chat_messages FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR can_manage_channel(channel_id))
  WITH CHECK (user_id = auth.uid() OR can_manage_channel(channel_id));

DROP POLICY IF EXISTS "chat_webhooks_select" ON chat_webhooks;
CREATE POLICY "chat_webhooks_select" ON chat_webhooks FOR SELECT TO authenticated USING (can_manage_channel(channel_id));
DROP POLICY IF EXISTS "chat_webhooks_insert" ON chat_webhooks;
CREATE POLICY "chat_webhooks_insert" ON chat_webhooks FOR INSERT TO authenticated
  WITH CHECK (can_manage_channel(channel_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "chat_webhooks_update" ON chat_webhooks;
CREATE POLICY "chat_webhooks_update" ON chat_webhooks FOR UPDATE TO authenticated
  USING (can_manage_channel(channel_id)) WITH CHECK (can_manage_channel(channel_id));
DROP POLICY IF EXISTS "chat_webhooks_delete" ON chat_webhooks;
CREATE POLICY "chat_webhooks_delete" ON chat_webhooks FOR DELETE TO authenticated USING (can_manage_channel(channel_id));

-- ---------------------------------------------------------------- guards

-- Members and webhooks: same account as the channel; members must be active in it.
CREATE OR REPLACE FUNCTION chat_members_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT c.workspace_id INTO NEW.workspace_id FROM chat_channels c WHERE c.id = NEW.channel_id;
  IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members m WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'Only people in this account can be in its channels';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION chat_webhooks_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT c.workspace_id INTO NEW.workspace_id FROM chat_channels c WHERE c.id = NEW.channel_id AND c.kind = 'channel';
  IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_members_check ON chat_members;
CREATE TRIGGER chat_members_check BEFORE INSERT OR UPDATE OF channel_id, user_id ON chat_members
  FOR EACH ROW EXECUTE FUNCTION chat_members_check();
DROP TRIGGER IF EXISTS chat_webhooks_check ON chat_webhooks;
CREATE TRIGGER chat_webhooks_check BEFORE INSERT OR UPDATE OF channel_id ON chat_webhooks
  FOR EACH ROW EXECUTE FUNCTION chat_webhooks_check();

-- Messages: account from the channel, thread replies stay in their channel (one level deep),
-- edits only change the text, and the channel and thread counters stay current.
CREATE OR REPLACE FUNCTION chat_messages_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_parent chat_messages;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT c.workspace_id INTO NEW.workspace_id FROM chat_channels c WHERE c.id = NEW.channel_id;
    IF NEW.workspace_id IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
    NEW.reply_count := 0; NEW.last_reply_at := NULL; NEW.edited_at := NULL; NEW.deleted_at := NULL;
    NEW.created_at := now();
    IF NEW.parent_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM chat_messages WHERE id = NEW.parent_id;
      IF v_parent.id IS NULL OR v_parent.channel_id <> NEW.channel_id THEN RAISE EXCEPTION 'Reply to a message in this channel'; END IF;
      IF v_parent.parent_id IS NOT NULL THEN NEW.parent_id := v_parent.parent_id; END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the text (an edit) or a delete marker; counters only from the trigger below.
  IF NEW.channel_id <> OLD.channel_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.source <> OLD.source OR NEW.created_at <> OLD.created_at OR NEW.sender_name IS DISTINCT FROM OLD.sender_name THEN
    RAISE EXCEPTION 'Only the text of a message can change';
  END IF;
  IF current_setting('synapse.chat_counts', true) IS DISTINCT FROM 'on' THEN
    NEW.reply_count := OLD.reply_count; NEW.last_reply_at := OLD.last_reply_at;
    IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'This message was deleted'; END IF;
    IF NEW.deleted_at IS NOT NULL THEN
      -- Deleting removes the words; the gap stays so threads still make sense.
      NEW.deleted_at := now(); NEW.body := 'This message was deleted.'; NEW.meta := '{}'::jsonb;
      RETURN NEW;
    END IF;
    IF NEW.body <> OLD.body THEN
      IF OLD.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You can only edit your own messages'; END IF;
      NEW.edited_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_messages_guard ON chat_messages;
CREATE TRIGGER chat_messages_guard BEFORE INSERT OR UPDATE ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_guard();

CREATE OR REPLACE FUNCTION chat_messages_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('synapse.chat_counts', 'on', true);
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE chat_messages SET reply_count = reply_count + 1, last_reply_at = NEW.created_at WHERE id = NEW.parent_id;
  END IF;
  UPDATE chat_channels SET last_message_at = NEW.created_at WHERE id = NEW.channel_id;
  -- Posting counts as reading.
  IF NEW.user_id IS NOT NULL THEN
    UPDATE chat_members SET last_read_at = NEW.created_at WHERE channel_id = NEW.channel_id AND user_id = NEW.user_id;
  END IF;
  PERFORM set_config('synapse.chat_counts', 'off', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS chat_messages_after ON chat_messages;
CREATE TRIGGER chat_messages_after AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_after();

-- Channels: kind, account and direct-message pairs never change.
CREATE OR REPLACE FUNCTION chat_channels_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.kind <> OLD.kind OR NEW.dm_key IS DISTINCT FROM OLD.dm_key THEN
    RAISE EXCEPTION 'That cannot change';
  END IF;
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'That department belongs to another account';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_channels_guard ON chat_channels;
CREATE TRIGGER chat_channels_guard BEFORE UPDATE ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION chat_channels_guard();

-- ---------------------------------------------------------------- actions

/** Create a channel; you become its owner. Name: lowercase letters, numbers, - and _. */
CREATE OR REPLACE FUNCTION create_channel(p_workspace uuid, p_name text, p_description text DEFAULT NULL, p_private boolean DEFAULT false, p_department uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text := lower(btrim(p_name));
BEGIN
  IF NOT has_workspace_role(p_workspace, ARRAY['owner', 'admin', 'supervisor', 'member']) THEN RAISE EXCEPTION 'Not in this account'; END IF;
  IF p_department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments WHERE id = p_department AND workspace_id = p_workspace) THEN
    RAISE EXCEPTION 'That department belongs to another account';
  END IF;
  INSERT INTO chat_channels (workspace_id, kind, name, description, is_private, department_id, created_by)
  VALUES (p_workspace, 'channel', v_name, nullif(btrim(p_description), ''), coalesce(p_private, false), p_department, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO chat_members (channel_id, workspace_id, user_id, role) VALUES (v_id, p_workspace, auth.uid(), 'owner');
  RETURN v_id;
END;
$$;

/** The direct message between you and these people (made the first time). */
CREATE OR REPLACE FUNCTION open_dm(p_workspace uuid, p_users uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[]; v_key text; v_id uuid; v_user uuid;
BEGIN
  IF NOT has_workspace_role(p_workspace, ARRAY['owner', 'admin', 'supervisor', 'member']) THEN RAISE EXCEPTION 'Not in this account'; END IF;
  SELECT array_agg(DISTINCT u ORDER BY u) INTO v_ids FROM unnest(array_append(p_users, auth.uid())) u;
  IF array_length(v_ids, 1) < 2 OR array_length(v_ids, 1) > 9 THEN RAISE EXCEPTION 'A direct message is between 2 and 9 people'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) u WHERE NOT EXISTS (
      SELECT 1 FROM workspace_members m WHERE m.workspace_id = p_workspace AND m.user_id = u AND m.status = 'active')) THEN
    RAISE EXCEPTION 'Everyone in a direct message must be in this account';
  END IF;
  v_key := array_to_string(v_ids, ',');
  SELECT id INTO v_id FROM chat_channels WHERE workspace_id = p_workspace AND kind = 'dm' AND dm_key = v_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO chat_channels (workspace_id, kind, is_private, dm_key, created_by) VALUES (p_workspace, 'dm', true, v_key, auth.uid())
  RETURNING id INTO v_id;
  FOREACH v_user IN ARRAY v_ids LOOP
    INSERT INTO chat_members (channel_id, workspace_id, user_id, role) VALUES (v_id, p_workspace, v_user, 'member');
  END LOOP;
  RETURN v_id;
END;
$$;

/** Unread messages per channel you're in (top-level and thread replies by others since you last read). */
CREATE OR REPLACE FUNCTION chat_unread(p_workspace uuid)
RETURNS TABLE (channel_id uuid, unread bigint) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT m.channel_id, count(x.id)
  FROM chat_members m
  JOIN chat_messages x ON x.channel_id = m.channel_id AND x.created_at > m.last_read_at
    AND x.deleted_at IS NULL AND x.user_id IS DISTINCT FROM auth.uid()
  WHERE m.user_id = auth.uid() AND m.workspace_id = p_workspace
  GROUP BY m.channel_id;
$$;

REVOKE ALL ON FUNCTION create_channel(uuid, text, text, boolean, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION open_dm(uuid, uuid[]) FROM public, anon;
REVOKE ALL ON FUNCTION chat_unread(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION create_channel(uuid, text, text, boolean, uuid), open_dm(uuid, uuid[]), chat_unread(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_channels, chat_members, chat_messages, chat_webhooks TO authenticated;

-- Live updates: new and edited messages and channels reach the app as they happen.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chat_members') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_members;
    END IF;
  END IF;
END $$;
