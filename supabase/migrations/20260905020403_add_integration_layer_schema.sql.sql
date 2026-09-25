/*
# Add integration layer columns and sync logs table

## Changes

### 1. appointments — add external calendar sync + payment columns
- `external_event_id text` — ID of the event created in the external calendar (Google Calendar writeback). NULL until synced.
- `sync_status text DEFAULT 'pending'` — sync state: 'pending' (needs sync), 'synced' (event created externally), 'error' (sync failed), 'not_required' (no writeback configured).
- `payment_status text DEFAULT 'free'` — payment state: 'free', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'.
- `payment_provider text` — which provider handled the payment (e.g. 'stripe'). NULL if free.
- `payment_intent_id text` — provider's payment intent / charge ID. NULL if free.

### 2. integration_sync_logs — new table
Tracks each sync run between SYNAPSE and an external calendar provider.
- `id` uuid PK
- `integration_id` uuid FK → integrations(id) ON DELETE CASCADE
- `sync_type text` — 'busy_periods' (fetching busy times) or 'event_writeback' (creating/updating external events) or 'event_cancellation' (removing external events)
- `status text` — 'success', 'failed', 'partial'
- `error_message text` — NULL on success
- `events_synced int DEFAULT 0` — count of events processed
- `started_at timestamptz DEFAULT now()`
- `completed_at timestamptz` — NULL until done

### 3. integrations — add selected_calendar_ids column
- `selected_calendar_ids jsonb DEFAULT '[]'` — array of external calendar IDs the user selected for conflict checking (e.g. Google "Work" and "Personal" calendars).

### 4. Update Integration TypeScript type
The DB already has access_token, refresh_token, token_expires_at columns. The TS type will be updated in the frontend code separately.

## Security
- integration_sync_logs: RLS enabled, owner-scoped via integration ownership (user_id on integrations).
- No new anon policies needed — all integration management is authenticated-only.
- appointments columns are accessible via existing appointment policies.
*/

-- 1. Add columns to appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS external_event_id text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sync_status text DEFAULT 'pending';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'free';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_provider text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_intent_id text;

-- 2. Add selected_calendar_ids to integrations
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS selected_calendar_ids jsonb DEFAULT '[]'::jsonb;

-- 3. Create integration_sync_logs table
CREATE TABLE IF NOT EXISTS integration_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  sync_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  events_synced int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Enable RLS on integration_sync_logs
ALTER TABLE integration_sync_logs ENABLE ROW LEVEL SECURITY;

-- Policies: owner can manage their sync logs (scoped through integrations.user_id)
DROP POLICY IF EXISTS "select_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "select_own_sync_logs" ON integration_sync_logs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "insert_own_sync_logs" ON integration_sync_logs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "update_own_sync_logs" ON integration_sync_logs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_sync_logs" ON integration_sync_logs;
CREATE POLICY "delete_own_sync_logs" ON integration_sync_logs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM integrations WHERE integrations.id = integration_sync_logs.integration_id AND integrations.user_id = auth.uid())
  );

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_integration_sync_logs_integration_id ON integration_sync_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_appointments_sync_status ON appointments(sync_status) WHERE sync_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_appointments_payment_status ON appointments(payment_status) WHERE payment_status NOT IN ('free');
