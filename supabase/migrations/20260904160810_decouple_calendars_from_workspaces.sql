/*
# Decouple Calendars from Workspaces

## Purpose
The calendar feature should work independently of the workspace feature.
Currently calendars require a workspace_id (NOT NULL), which blocks calendar
creation when no workspace exists. This migration makes workspace_id nullable
on calendars and calendar_groups, adds an owner_id column to both tables so
calendars can belong directly to a user, and updates RLS policies accordingly.

## Changes

### 1. calendars table
- Added `owner_id` column (uuid, references auth.users, ON DELETE SET NULL)
- Made `workspace_id` nullable (was NOT NULL)
- Added index on `owner_id`

### 2. calendar_groups table
- Added `owner_id` column (uuid, references auth.users, ON DELETE SET NULL)
- Made `workspace_id` nullable (was NOT NULL)
- Added index on `owner_id`

### 3. RLS Policies
- Updated calendar SELECT policy to allow access via workspace membership OR direct ownership
- Updated calendar INSERT policy to allow access via workspace membership OR direct ownership
- Updated calendar UPDATE policy to allow access via workspace membership OR direct ownership
- Updated calendar DELETE policy to allow access via workspace membership OR direct ownership
- Same set of updates for calendar_groups

## Security
- RLS remains enabled on both tables
- Access is granted via workspace membership (existing) OR direct ownership (new)
- Public/anon SELECT policies for active calendars remain unchanged
*/

-- ============================================================
-- calendars table: add owner_id, make workspace_id nullable
-- ============================================================

ALTER TABLE calendars ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE calendars ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendars_owner ON calendars(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================
-- calendar_groups table: add owner_id, make workspace_id nullable
-- ============================================================

ALTER TABLE calendar_groups ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE calendar_groups ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_groups_owner ON calendar_groups(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================
-- Update RLS policies on calendars
-- ============================================================

-- Helper: can the current user access this calendar (via workspace OR direct ownership)?
CREATE OR REPLACE FUNCTION can_access_calendar(check_calendar_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM calendars c
    WHERE c.id = check_calendar_id
    AND (
      c.owner_id = auth.uid()
      OR (c.workspace_id IS NOT NULL AND can_access_workspace(c.workspace_id))
    )
  );
$$;

-- SELECT (authenticated)
DROP POLICY IF EXISTS "calendars_select" ON calendars;
CREATE POLICY "calendars_select" ON calendars FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- INSERT
DROP POLICY IF EXISTS "calendars_insert" ON calendars;
CREATE POLICY "calendars_insert" ON calendars FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- UPDATE
DROP POLICY IF EXISTS "calendars_update" ON calendars;
CREATE POLICY "calendars_update" ON calendars FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- DELETE
DROP POLICY IF EXISTS "calendars_delete" ON calendars;
CREATE POLICY "calendars_delete" ON calendars FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- ============================================================
-- Update RLS policies on calendar_groups
-- ============================================================

DROP POLICY IF EXISTS "cal_groups_select" ON calendar_groups;
CREATE POLICY "cal_groups_select" ON calendar_groups FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "cal_groups_insert" ON calendar_groups;
CREATE POLICY "cal_groups_insert" ON calendar_groups FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "cal_groups_update" ON calendar_groups;
CREATE POLICY "cal_groups_update" ON calendar_groups FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "cal_groups_delete" ON calendar_groups;
CREATE POLICY "cal_groups_delete" ON calendar_groups FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- ============================================================
-- Update availability_rules policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "avail_rules_select" ON availability_rules;
CREATE POLICY "avail_rules_select" ON availability_rules FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_rules_insert" ON availability_rules;
CREATE POLICY "avail_rules_insert" ON availability_rules FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_rules_update" ON availability_rules;
CREATE POLICY "avail_rules_update" ON availability_rules FOR UPDATE
  TO authenticated USING (can_access_calendar(calendar_id)) WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_rules_delete" ON availability_rules;
CREATE POLICY "avail_rules_delete" ON availability_rules FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));

-- ============================================================
-- Update availability_overrides policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "avail_overrides_select" ON availability_overrides;
CREATE POLICY "avail_overrides_select" ON availability_overrides FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_overrides_insert" ON availability_overrides;
CREATE POLICY "avail_overrides_insert" ON availability_overrides FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_overrides_update" ON availability_overrides;
CREATE POLICY "avail_overrides_update" ON availability_overrides FOR UPDATE
  TO authenticated USING (can_access_calendar(calendar_id)) WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "avail_overrides_delete" ON availability_overrides;
CREATE POLICY "avail_overrides_delete" ON availability_overrides FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));

-- ============================================================
-- Update calendar_hosts policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "cal_hosts_select" ON calendar_hosts;
CREATE POLICY "cal_hosts_select" ON calendar_hosts FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_hosts_insert" ON calendar_hosts;
CREATE POLICY "cal_hosts_insert" ON calendar_hosts FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_hosts_update" ON calendar_hosts;
CREATE POLICY "cal_hosts_update" ON calendar_hosts FOR UPDATE
  TO authenticated USING (can_access_calendar(calendar_id)) WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_hosts_delete" ON calendar_hosts;
CREATE POLICY "cal_hosts_delete" ON calendar_hosts FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));

-- ============================================================
-- Update calendar_group_members policies to use can_access_calendar
-- ============================================================
DROP POLICY IF EXISTS "cal_group_members_select" ON calendar_group_members;
CREATE POLICY "cal_group_members_select" ON calendar_group_members FOR SELECT
  TO authenticated USING (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_group_members_insert" ON calendar_group_members;
CREATE POLICY "cal_group_members_insert" ON calendar_group_members FOR INSERT
  TO authenticated WITH CHECK (can_access_calendar(calendar_id));

DROP POLICY IF EXISTS "cal_group_members_delete" ON calendar_group_members;
CREATE POLICY "cal_group_members_delete" ON calendar_group_members FOR DELETE
  TO authenticated USING (can_access_calendar(calendar_id));
