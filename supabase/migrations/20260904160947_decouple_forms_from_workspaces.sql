/*
# Decouple Forms from Workspaces + Fix Unique Constraints

## Purpose
The calendar wizard queries forms by owner_id when no workspace exists.
The forms table currently has no owner_id column, so that query would error.
This migration adds owner_id to forms, makes its workspace_id nullable, and
adds partial unique indexes so calendar/calendar_group slugs stay unique
per-owner (not just per-workspace).

## Changes

### 1. forms table
- Added `owner_id` column (uuid, references auth.users, ON DELETE SET NULL)
- Made `workspace_id` nullable (was NOT NULL)
- Added index on `owner_id`
- Updated RLS policies to allow access via workspace membership OR direct ownership

### 2. Unique constraints
- Added partial unique index on calendars(owner_id, slug) WHERE workspace_id IS NULL
- Added partial unique index on calendar_groups(owner_id, slug) WHERE workspace_id IS NULL

### 3. forms RLS policies
- SELECT: allow via workspace membership OR direct ownership
- INSERT: allow via workspace membership OR direct ownership
- UPDATE: allow via workspace membership OR direct ownership
- DELETE: allow via workspace membership OR direct ownership
*/

-- ============================================================
-- forms table: add owner_id, make workspace_id nullable
-- ============================================================
ALTER TABLE forms ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE forms ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forms_owner ON forms(owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================
-- Partial unique indexes for owner-scoped calendars and groups
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_owner_slug
  ON calendars(owner_id, slug) WHERE workspace_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_groups_owner_slug
  ON calendar_groups(owner_id, slug) WHERE workspace_id IS NULL;

-- ============================================================
-- Update forms RLS policies
-- ============================================================
DROP POLICY IF EXISTS "forms_select" ON forms;
CREATE POLICY "forms_select" ON forms FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "forms_insert" ON forms;
CREATE POLICY "forms_insert" ON forms FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "forms_update" ON forms;
CREATE POLICY "forms_update" ON forms FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "forms_delete" ON forms;
CREATE POLICY "forms_delete" ON forms FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );
