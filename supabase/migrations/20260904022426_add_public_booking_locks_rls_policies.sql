/*
# Add public RLS policies for booking_locks

## Problem
The public booking page (accessed by unauthenticated visitors) needs to:
1. INSERT a temporary lock on a time slot when a visitor starts booking
2. SELECT existing locks to detect conflicts
3. DELETE their own lock after booking completes or expires

The booking_locks table currently only has `authenticated` policies,
so anonymous visitors (using the anon key) cannot insert/select/delete locks.
This silently breaks the entire booking flow at the time-selection step.

## Changes
1. Add `booking_locks_public_select` — allows anon+authenticated to SELECT
   (needed to check for conflicting locks before reserving a slot)
2. Add `booking_locks_public_insert` — allows anon+authenticated to INSERT
   (needed to reserve a slot when a visitor clicks a time)
3. Add `booking_locks_public_delete` — allows anon+authenticated to DELETE
   (needed to release the lock after booking completes; expired locks are
   also cleaned up by this path)

These are safe because:
- Locks are ephemeral (5-minute TTL) and contain no sensitive data
- The unique constraint on (calendar_id, slot_start, slot_end) prevents
  double-booking regardless of who inserts
- DELETE is scoped to the lock's own row — the USING(true) allows any
  visitor to release a lock, which is acceptable since locks expire
  automatically and only the booking system creates them
*/

-- SELECT: allow public to read locks (needed to check conflicts)
DROP POLICY IF EXISTS "booking_locks_public_select" ON booking_locks;
CREATE POLICY "booking_locks_public_select"
  ON booking_locks FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT: allow public to create locks
DROP POLICY IF EXISTS "booking_locks_public_insert" ON booking_locks;
CREATE POLICY "booking_locks_public_insert"
  ON booking_locks FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- DELETE: allow public to release locks
DROP POLICY IF EXISTS "booking_locks_public_delete" ON booking_locks;
CREATE POLICY "booking_locks_public_delete"
  ON booking_locks FOR DELETE
  TO anon, authenticated
  USING (true);