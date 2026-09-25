/*
# Add booking_links table for permanent and one-time booking links

1. New Tables
- `booking_links`
  - `id` (uuid, primary key)
  - `workspace_id` (uuid, FK to workspaces, cascade delete)
  - `calendar_id` (uuid, FK to calendars, cascade delete)
  - `token` (text, unique, not null) — cryptographically random, non-sequential
  - `link_type` (text, 'permanent' or 'one_time')
  - `max_uses` (int, default 1 for one-time, null for permanent)
  - `use_count` (int, default 0)
  - `expires_at` (timestamptz, nullable — null means no expiry)
  - `used_at` (timestamptz, nullable — when first booking was made)
  - `created_by` (uuid, FK to auth.users)
  - `created_at` (timestamptz, default now())
2. Security
- Enable RLS on `booking_links`.
- Workspace members can read/insert/update/delete links for their workspace.
3. Indexes
- Index on `calendar_id` for quick lookups
- Index on `token` for booking page lookups
4. Notes
- One-time links expire after a single successful booking (use_count >= max_uses).
- Tokens use gen_random_uuid() for non-guessable, non-sequential URLs.
*/

CREATE TABLE IF NOT EXISTS booking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  link_type text NOT NULL DEFAULT 'permanent' CHECK (link_type IN ('permanent', 'one_time')),
  max_uses int,
  use_count int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_links_calendar ON booking_links(calendar_id);
CREATE INDEX IF NOT EXISTS idx_booking_links_token ON booking_links(token);
ALTER TABLE booking_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_booking_links_workspace" ON booking_links;
CREATE POLICY "select_booking_links_workspace"
ON booking_links FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "insert_booking_links_workspace" ON booking_links;
CREATE POLICY "insert_booking_links_workspace"
ON booking_links FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "update_booking_links_workspace" ON booking_links;
CREATE POLICY "update_booking_links_workspace"
ON booking_links FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "delete_booking_links_workspace" ON booking_links;
CREATE POLICY "delete_booking_links_workspace"
ON booking_links FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = booking_links.workspace_id
    AND workspace_members.user_id = auth.uid()
  )
);