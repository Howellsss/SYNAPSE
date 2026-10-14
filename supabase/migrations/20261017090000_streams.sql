/*
  # Streams: one person broadcasts, many watch

  A stream is a LiveKit room (stream_<id>) where only the host sends video and sound; viewers
  watch, chat and react. Viewers join with the watch link (/live/CODE?watch=<token>), no account
  needed; people in the account can open it from Streams. The call-token function only lets
  viewers in while the stream is live. Safe to run more than once.

  1. streams
     - code: like meetings (FOCU-358), used in links
     - watch_token: the private part of the watch link
     - status: scheduled -> live -> ended (started_at / ended_at are set on the way)
  2. stream_by_watch(code, token): what the public watch page needs, only with the right token
  3. RLS: everyone in the account sees its streams; members create streams they host; the host
     or an admin changes or deletes them
*/

CREATE TABLE IF NOT EXISTS streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{4}-[0-9]{3}$'),
  watch_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  chat_enabled boolean NOT NULL DEFAULT true,
  peak_viewers integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_streams_workspace ON streams(workspace_id, created_at DESC);

ALTER TABLE streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "streams_select" ON streams;
CREATE POLICY "streams_select" ON streams FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "streams_insert" ON streams;
CREATE POLICY "streams_insert" ON streams FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'supervisor', 'member']));

DROP POLICY IF EXISTS "streams_update" ON streams;
CREATE POLICY "streams_update" ON streams FOR UPDATE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id))
  WITH CHECK (host_id = auth.uid() OR is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "streams_delete" ON streams;
CREATE POLICY "streams_delete" ON streams FOR DELETE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id));

-- Status only moves forward, with its times; the account, host and code never change.
CREATE OR REPLACE FUNCTION streams_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'scheduled'; NEW.started_at := NULL; NEW.ended_at := NULL; NEW.peak_viewers := 0;
    RETURN NEW;
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.host_id <> OLD.host_id OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'That cannot change';
  END IF;
  IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN RAISE EXCEPTION 'This stream has ended'; END IF;
  IF OLD.status = 'live' AND NEW.status = 'scheduled' THEN RAISE EXCEPTION 'A live stream can only end'; END IF;
  IF NEW.status = 'live' AND OLD.status <> 'live' THEN NEW.started_at := now(); END IF;
  IF NEW.status = 'ended' AND OLD.status <> 'ended' THEN NEW.ended_at := now(); END IF;
  NEW.peak_viewers := greatest(OLD.peak_viewers, NEW.peak_viewers);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS streams_guard ON streams;
CREATE TRIGGER streams_guard BEFORE INSERT OR UPDATE ON streams FOR EACH ROW EXECUTE FUNCTION streams_guard();

/** The public watch page: title, status and who's hosting, only with the right watch token. */
CREATE OR REPLACE FUNCTION stream_by_watch(p_code text, p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', s.id, 'title', s.title, 'description', s.description, 'code', s.code, 'status', s.status,
    'scheduled_at', s.scheduled_at, 'started_at', s.started_at, 'ended_at', s.ended_at, 'chat_enabled', s.chat_enabled,
    'host_id', s.host_id,
    'host_name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), w.name, ''),
    'workspace_name', w.name
  )
  FROM streams s
  LEFT JOIN profiles p ON p.user_id = s.host_id
  LEFT JOIN workspaces w ON w.id = s.workspace_id
  WHERE s.code = upper(btrim(p_code)) AND coalesce(btrim(p_token), '') <> '' AND s.watch_token = btrim(p_token)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION stream_by_watch(text, text) FROM public;
GRANT EXECUTE ON FUNCTION stream_by_watch(text, text) TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON streams TO authenticated;
