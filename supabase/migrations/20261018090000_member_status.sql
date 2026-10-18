/*
  # Member status: what people are up to, and whether they are away

  Everyone in the account sees each other's status (an emoji and a short line, like "In a
  meeting"), when it clears, and whether they set themselves away. Each person sets only their
  own. Who is online right now is not stored: the app works that out live. Safe to run more
  than once.

  1. member_status: one row per person per account
  2. RLS: members read the account's statuses; each person writes only their own row
  3. Realtime: changes reach everyone straight away
*/

CREATE TABLE IF NOT EXISTS member_status (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text CHECK (emoji IS NULL OR char_length(emoji) <= 16),
  text text CHECK (text IS NULL OR char_length(text) <= 100),
  clear_at timestamptz,
  away boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE member_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_status_select" ON member_status;
CREATE POLICY "member_status_select" ON member_status FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_insert" ON member_status;
CREATE POLICY "member_status_insert" ON member_status FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_update" ON member_status;
CREATE POLICY "member_status_update" ON member_status FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_delete" ON member_status;
CREATE POLICY "member_status_delete" ON member_status FOR DELETE TO authenticated USING (user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'member_status') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE member_status;
    END IF;
  END IF;
END $$;
