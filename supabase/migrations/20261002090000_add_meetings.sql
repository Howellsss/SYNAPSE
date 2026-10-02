/*
  # Meetings (video rooms outside the spatial workspaces)

  A meeting is a LiveKit room (`meeting_<id>`) that members of a SYNAPSE account can join with a
  code like FOCU-358 or an optional nickname. Safe to run more than once.

  1. meetings
     - workspace_id   the account (tenant) that owns it
     - host_id        who created it
     - title          shown on the Meetings page and in the room
     - code           unique join code, e.g. FOCU-358 (shared in links: /meetings/FOCU-358)
     - nickname       optional easy name, unique within the account (e.g. "weekly-sync")
     - kind           instant (started now) | later (link made for later) | scheduled
     - scheduled_at   start time for scheduled meetings
     - duration_min   planned length
     - ended_at       set when the host ends it; ended meetings show under Calls

  2. RLS
     - members of the account can see its meetings
     - members can create meetings they host
     - the host or an account admin can change or delete a meeting
*/

CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Meeting' CHECK (char_length(title) BETWEEN 1 AND 120),
  code text NOT NULL CHECK (code ~ '^[A-Z]{4}-[0-9]{3}$'),
  nickname text CHECK (nickname IS NULL OR nickname ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  kind text NOT NULL DEFAULT 'instant' CHECK (kind IN ('instant', 'later', 'scheduled')),
  scheduled_at timestamptz,
  duration_min integer NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 600),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'scheduled' OR scheduled_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS meetings_code_key ON meetings(code);
CREATE UNIQUE INDEX IF NOT EXISTS meetings_nickname_key ON meetings(workspace_id, nickname) WHERE nickname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_workspace_time ON meetings(workspace_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_workspace_created ON meetings(workspace_id, created_at DESC);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meetings_select" ON meetings;
CREATE POLICY "meetings_select" ON meetings FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "meetings_insert" ON meetings;
CREATE POLICY "meetings_insert" ON meetings FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "meetings_update" ON meetings;
CREATE POLICY "meetings_update" ON meetings FOR UPDATE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "meetings_delete" ON meetings;
CREATE POLICY "meetings_delete" ON meetings FOR DELETE TO authenticated
  USING (host_id = auth.uid() OR is_workspace_admin(workspace_id));
