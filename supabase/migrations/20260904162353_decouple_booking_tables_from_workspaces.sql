/*
# Decouple Booking Tables from Workspaces

## Purpose
The public booking flow (BookingPage) inserts rows into booking_locks,
contacts, appointments, form_submissions, and messages. All of these
tables currently require workspace_id NOT NULL, but calendars can now
exist without a workspace (owner_id instead). This migration makes
workspace_id nullable on all booking-related tables and adds owner_id
so bookings can complete for workspace-independent calendars.

## Changes

### 1. booking_locks
- Made workspace_id nullable
- Added owner_id column (references auth.users, ON DELETE SET NULL)

### 2. contacts
- Made workspace_id nullable
- Added owner_id column

### 3. appointments
- Made workspace_id nullable
- Added owner_id column

### 4. form_submissions
- Made workspace_id nullable
- Added owner_id column

### 5. messages
- Made workspace_id nullable
- Added owner_id column

### 6. RLS Policies
- Added public INSERT policy for contacts (anon needs to create contacts during booking)
- Added public INSERT policy for form_submissions (anon needs to submit forms during booking)
- Updated authenticated policies on contacts, appointments, form_submissions, messages
  to allow access via workspace membership OR direct owner_id match

## Security
- RLS remains enabled on all tables
- Public/anon policies are scoped to INSERT only (plus existing SELECT/UPDATE where already present)
- Authenticated policies now check both workspace membership and direct ownership
*/

-- ============================================================
-- Make workspace_id nullable + add owner_id
-- ============================================================

ALTER TABLE booking_locks ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE booking_locks ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE contacts ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id) WHERE owner_id IS NOT NULL;

ALTER TABLE appointments ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_owner ON appointments(owner_id) WHERE owner_id IS NOT NULL;

ALTER TABLE form_submissions ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE messages ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- Public INSERT policy for contacts (anon booking flow)
-- ============================================================
DROP POLICY IF EXISTS "contacts_public_insert" ON contacts;
CREATE POLICY "contacts_public_insert"
  ON contacts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ============================================================
-- Public INSERT policy for form_submissions (anon booking flow)
-- ============================================================
DROP POLICY IF EXISTS "form_submissions_public_insert" ON form_submissions;
CREATE POLICY "form_submissions_public_insert"
  ON form_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ============================================================
-- Update authenticated policies to allow owner_id-based access
-- ============================================================

-- contacts: update existing authenticated SELECT to also allow owner_id
DROP POLICY IF EXISTS "contacts_select" ON contacts;
CREATE POLICY "contacts_select" ON contacts FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "contacts_insert" ON contacts;
CREATE POLICY "contacts_insert" ON contacts FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "contacts_update" ON contacts;
CREATE POLICY "contacts_update" ON contacts FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "contacts_delete" ON contacts;
CREATE POLICY "contacts_delete" ON contacts FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- appointments: update authenticated policies
DROP POLICY IF EXISTS "appts_select" ON appointments;
CREATE POLICY "appts_select" ON appointments FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "appts_insert" ON appointments;
CREATE POLICY "appts_insert" ON appointments FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "appts_update" ON appointments;
CREATE POLICY "appts_update" ON appointments FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "appts_delete" ON appointments;
CREATE POLICY "appts_delete" ON appointments FOR DELETE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- form_submissions: update authenticated policies
DROP POLICY IF EXISTS "form_submissions_select" ON form_submissions;
CREATE POLICY "form_submissions_select" ON form_submissions FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "form_submissions_insert" ON form_submissions;
CREATE POLICY "form_submissions_insert" ON form_submissions FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

-- messages: update authenticated policies
DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );

DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update" ON messages FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id))
  );