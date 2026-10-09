/*
  # Meetings: waiting room, lock, breakout rooms, recordings

  Everything the meeting tools need in the database, in one file. Safe to run more than once.

  1. meetings.waiting_room   true: everyone except the host waits until the host admits them
     meetings.locked         true: nobody new can join (people already admitted can rejoin)
     meetings.breakout       the host's breakout rooms while they are open, e.g.
                               {"open": true, "rooms": [{"n": 1, "name": "Room 1"}],
                                "assign": {"<participant id>": 1}}
                             null when there are no breakout rooms

  2. meeting_admissions
     One row per person who asked to join (members, other-account users and guests). The
     livekit-token function writes these with the service key; the browser only reads them
     and the host (or an account admin) changes their status.
       - ticket      what the joining browser keeps so it can ask again ("am I in yet?")
       - identity    their id in the call (user id, or guest_<…> for guests)
       - status      waiting | admitted | denied | removed

  3. meeting_by_invite() also returns waiting_room, locked and breakout, so guests (who
     can't read the meetings table) can follow breakout rooms.

  4. recordings.meeting_id, and a private storage bucket "meeting-recordings" where files are
     kept under <account id>/<file>. Only members of that account can read or add them.
*/

-- 1. Meeting settings ------------------------------------------------------------------------
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS waiting_room boolean NOT NULL DEFAULT false;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS breakout jsonb;

-- 2. Admissions ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_admissions (
  ticket uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  identity text NOT NULL CHECK (char_length(identity) BETWEEN 1 AND 80),
  name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 120),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'admitted', 'denied', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_meeting_admissions_meeting ON meeting_admissions(meeting_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_meeting_admissions_identity ON meeting_admissions(meeting_id, identity);

ALTER TABLE meeting_admissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_admissions_select" ON meeting_admissions;
CREATE POLICY "meeting_admissions_select" ON meeting_admissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id AND is_workspace_member(m.workspace_id)));

DROP POLICY IF EXISTS "meeting_admissions_update" ON meeting_admissions;
CREATE POLICY "meeting_admissions_update" ON meeting_admissions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR is_workspace_admin(m.workspace_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_id AND (m.host_id = auth.uid() OR is_workspace_admin(m.workspace_id))));

-- 3. Guests can see the meeting's live settings ---------------------------------------------
CREATE OR REPLACE FUNCTION meeting_by_invite(p_code text, p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', m.id,
    'workspace_id', m.workspace_id,
    'host_id', m.host_id,
    'title', m.title,
    'code', m.code,
    'nickname', NULL,
    'kind', m.kind,
    'scheduled_at', m.scheduled_at,
    'duration_min', m.duration_min,
    'ended_at', m.ended_at,
    'created_at', m.created_at,
    'invite_token', m.invite_token,
    'waiting_room', m.waiting_room,
    'locked', m.locked,
    'breakout', m.breakout,
    'host_name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), w.name, '')
  )
  FROM meetings m
  LEFT JOIN profiles p ON p.user_id = m.host_id
  LEFT JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.code = upper(btrim(p_code))
    AND coalesce(btrim(p_token), '') <> ''
    AND m.invite_token = btrim(p_token)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION meeting_by_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meeting_by_invite(text, text) TO anon, authenticated;

-- 4. Recordings ------------------------------------------------------------------------------
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings(meeting_id);

INSERT INTO storage.buckets (id, name, public) VALUES ('meeting-recordings', 'meeting-recordings', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "meeting_recordings_read" ON storage.objects;
CREATE POLICY "meeting_recordings_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'meeting-recordings' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));
DROP POLICY IF EXISTS "meeting_recordings_upload" ON storage.objects;
CREATE POLICY "meeting_recordings_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meeting-recordings' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));
DROP POLICY IF EXISTS "meeting_recordings_delete" ON storage.objects;
CREATE POLICY "meeting_recordings_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'meeting-recordings' AND is_workspace_member(CASE WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ((storage.foldername(name))[1])::uuid END));
