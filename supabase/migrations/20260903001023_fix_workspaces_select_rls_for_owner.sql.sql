-- Fix: workspace owners couldn't read their own workspace right after creating it
-- because the SELECT policy only checked is_workspace_member (which queries workspace_members,
-- but the member row doesn't exist yet at insert time). Add owner_id check so the owner
-- can always read their workspace.

DROP POLICY IF EXISTS workspaces_select ON workspaces;

CREATE POLICY workspaces_select ON workspaces FOR SELECT
  TO authenticated USING (is_workspace_member(id) OR owner_id = auth.uid());
