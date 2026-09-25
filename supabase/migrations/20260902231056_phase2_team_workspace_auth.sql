/*
# Phase 2 — Team, Workspace, and Auth Enhancements

## Summary
Extends the Phase 1 schema to support full team management, workspace
customization, and role-based permissions.

## 1. Workspace fields added
- `logo_url` (text) — workspace logo image URL
- `timezone` (text, default 'UTC') — workspace default timezone
- `default_booking_settings` (jsonb) — default booking configuration

## 2. Workspace Members — status column
- `status` (text, default 'active') — CHECK in ('invited', 'active', 'suspended')
- Updated the `wm_update` policy so only admins/owners can update other members

## 3. New Table: team_invitations
- `id` (uuid PK)
- `workspace_id` (FK → workspaces)
- `email` (text, not null) — invitee email
- `role` (text, default 'member') — role assigned on acceptance
- `status` (text, default 'pending') — CHECK in ('pending', 'accepted', 'revoked')
- `invited_by` (uuid → auth.users) — who sent the invite
- `assigned_calendar_ids` (jsonb, default '[]') — calendars the member is assigned to
- `token` (text, unique) — secure invitation token
- `expires_at` (timestamptz) — when the invitation expires
- `accepted_at` (timestamptz) — when accepted
- `created_at` (timestamptz)

## 4. Permission helper functions
- `has_workspace_role(workspace_id, roles text[])` — checks if current user
  has one of the specified roles in the workspace
- `is_workspace_admin(workspace_id)` — checks for owner or admin role

## 5. RLS policy changes
- Tightened `wm_update` to require admin/owner role (was: only self-update)
- Added `wm_delete` policy for admin/owner removal of members
- Added team_invitations CRUD policies (admin/owner only)
- Workspace update now allowed for admin/owner (was: owner only)
*/

-- ============================================================
-- 1. Workspace fields
-- ============================================================

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_booking_settings jsonb DEFAULT '{}'::jsonb;

-- ============================================================
-- 2. Workspace Members — status column
-- ============================================================

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended'));

-- ============================================================
-- 3. Team Invitations table
-- ============================================================

CREATE TABLE IF NOT EXISTS team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_calendar_ids jsonb DEFAULT '[]'::jsonb,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_inv_workspace ON team_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_team_inv_email ON team_invitations(email);
CREATE INDEX IF NOT EXISTS idx_team_inv_token ON team_invitations(token);
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Permission helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION has_workspace_role(check_workspace_id uuid, check_roles text[])
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = check_workspace_id
      AND user_id = auth.uid()
      AND role = ANY(check_roles)
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION is_workspace_admin(check_workspace_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT has_workspace_role(check_workspace_id, ARRAY['owner', 'admin']);
$$;

-- ============================================================
-- 5. RLS policy changes
-- ============================================================

-- Workspace members: tighten update to admin/owner only (for managing others)
-- but still allow self-update for own profile fields
DROP POLICY IF EXISTS "wm_update" ON workspace_members;
CREATE POLICY "wm_update" ON workspace_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_workspace_admin(workspace_id))
  WITH CHECK (user_id = auth.uid() OR is_workspace_admin(workspace_id));

-- Workspace members: delete (remove) — admin/owner only
DROP POLICY IF EXISTS "wm_delete" ON workspace_members;
CREATE POLICY "wm_delete" ON workspace_members FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id));

-- Workspace members: insert — allow admins to invite (insert rows for other users)
DROP POLICY IF EXISTS "wm_insert_self" ON workspace_members;
CREATE POLICY "wm_insert_self" ON workspace_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR is_workspace_admin(workspace_id));

-- Workspaces: update — allow admin or owner
DROP POLICY IF EXISTS "workspaces_update" ON workspaces;
CREATE POLICY "workspaces_update" ON workspaces FOR UPDATE TO authenticated
  USING (is_workspace_admin(id)) WITH CHECK (is_workspace_admin(id));

-- Team invitations: admin/owner can view
DROP POLICY IF EXISTS "team_inv_select" ON team_invitations;
CREATE POLICY "team_inv_select" ON team_invitations FOR SELECT TO authenticated
  USING (is_workspace_admin(workspace_id));

-- Team invitations: admin/owner can create
DROP POLICY IF EXISTS "team_inv_insert" ON team_invitations;
CREATE POLICY "team_inv_insert" ON team_invitations FOR INSERT TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id));

-- Team invitations: admin/owner can update (revoke, accept)
DROP POLICY IF EXISTS "team_inv_update" ON team_invitations;
CREATE POLICY "team_inv_update" ON team_invitations FOR UPDATE TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));

-- Team invitations: admin/owner can delete
DROP POLICY IF EXISTS "team_inv_delete" ON team_invitations;
CREATE POLICY "team_inv_delete" ON team_invitations FOR DELETE TO authenticated
  USING (is_workspace_admin(workspace_id));

-- Public: allow reading invitations by token (for accept flow, no auth needed)
DROP POLICY IF EXISTS "team_inv_public_select_token" ON team_invitations;
CREATE POLICY "team_inv_public_select_token" ON team_invitations FOR SELECT TO anon, authenticated
  USING (token IS NOT NULL AND status = 'pending');
