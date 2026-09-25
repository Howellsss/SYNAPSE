/*
# Fix is_workspace_member to check workspace ownership, and fix form_fields INSERT policy

## Problem
The `is_workspace_member` function only checked the `workspace_members` table.
If a workspace owner had no row in `workspace_members` (which can happen due to
timing or missing insert), `can_access_workspace()` returned false, blocking ALL
RLS-checked inserts: forms, form_fields, contacts, calendar_groups, and
calendar_group_members. This was the root cause of form creation, contact
creation, CSV import, and group calendar member insertion all failing.

## Changes

1. `is_workspace_member` — now also returns true if the user is the owner of the
   workspace (checked via `workspaces.owner_id = auth.uid()`). This is a
   superset of the old check: members still pass, and owners always pass even
   if their `workspace_members` row is missing or delayed.

2. `form_fields_insert` policy — the old policy only checked
   `can_access_workspace(forms.workspace_id)`, which failed when the workspace
   owner had no `workspace_members` row. The new policy also checks
   `forms.owner_id = auth.uid()`, so form fields can be inserted by the form's
   owner regardless of workspace membership state.

## Security
- No policies are weakened. The owner check is the same identity check, just
  via a different table column. An attacker still cannot access another user's
  workspace data.
- `is_workspace_member` remains SECURITY DEFINER with `search_path = 'public'`.
*/

-- 1. Fix is_workspace_member to also check workspace ownership
CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = check_workspace_id AND user_id = auth.uid()
) OR EXISTS (
  SELECT 1 FROM workspaces
  WHERE id = check_workspace_id AND owner_id = auth.uid()
);
$function$;

-- 2. Fix form_fields INSERT policy to also check form ownership
DROP POLICY IF EXISTS "form_fields_insert" ON form_fields;
CREATE POLICY "form_fields_insert"
ON form_fields FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM forms
    WHERE forms.id = form_fields.form_id
    AND (
      forms.owner_id = auth.uid()
      OR (forms.workspace_id IS NOT NULL AND can_access_workspace(forms.workspace_id))
    )
  )
);
