/*
# Scheduling Engine - Schema Additions

1. New Tables
- `booking_locks` — Atomic slot reservation locks to prevent double booking.
  When a booking transaction starts, a row is inserted. When it completes, the row is deleted.
  Two simultaneous requests for the same slot collide on the unique constraint.
- `host_availability_rules` — Per-host working hours complementing calendar-level availability.
  For round robin and collective calendars, each host can have their own working hours.

2. Constraints
- UNIQUE on (calendar_id, slot_start) — only one lock per slot per calendar.
- `expires_at` — locks auto-expire so abandoned transactions don't block forever.
  Expired locks are cleaned up before new inserts.

3. Security
- RLS enabled on both new tables.
- Policies allow authenticated workspace members to manage locks and host availability.

4. Notes
- No existing tables or columns modified or removed.
*/

-- Booking locks table
CREATE TABLE IF NOT EXISTS booking_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  host_id uuid,
  locked_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_locks_calendar_slot_idx
  ON booking_locks (calendar_id, slot_start);

ALTER TABLE booking_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_workspace_locks" ON booking_locks;
CREATE POLICY "select_workspace_locks" ON booking_locks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = booking_locks.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = booking_locks.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "insert_workspace_locks" ON booking_locks;
CREATE POLICY "insert_workspace_locks" ON booking_locks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = booking_locks.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = booking_locks.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "delete_workspace_locks" ON booking_locks;
CREATE POLICY "delete_workspace_locks" ON booking_locks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = booking_locks.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = booking_locks.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

-- Host availability rules table
CREATE TABLE IF NOT EXISTS host_availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_availability_rules_calendar_user_idx
  ON host_availability_rules (calendar_id, user_id, day_of_week);

ALTER TABLE host_availability_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "select_workspace_host_availability" ON host_availability_rules FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "insert_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "insert_workspace_host_availability" ON host_availability_rules FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "update_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "update_workspace_host_availability" ON host_availability_rules FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );

DROP POLICY IF EXISTS "delete_workspace_host_availability" ON host_availability_rules;
CREATE POLICY "delete_workspace_host_availability" ON host_availability_rules FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = host_availability_rules.workspace_id AND w.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = host_availability_rules.workspace_id AND wm.user_id = auth.uid() AND wm.status = 'active')
  );
