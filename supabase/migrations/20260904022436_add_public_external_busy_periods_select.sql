/*
# Add public SELECT policy for external_busy_periods

## Problem
The scheduling engine queries `external_busy_periods` during slot generation
to filter out times when hosts are busy. This query runs from the browser
using the anon key on the public booking page. Without a public SELECT
policy, the query returns zero rows (not an error), so the engine sees
no busy periods — which is fine for correctness (it just means no
external conflicts are filtered) but is consistent with how other
booking-related tables expose read access to anon.

## Changes
1. Add `busy_periods_public_select` — allows anon+authenticated to SELECT
   on external_busy_periods. This is safe because busy periods contain
   only time ranges (no sensitive event titles or attendee data), and
   the public booking page needs them to generate accurate availability.
*/

DROP POLICY IF EXISTS "busy_periods_public_select" ON external_busy_periods;
CREATE POLICY "busy_periods_public_select"
  ON external_busy_periods FOR SELECT
  TO anon, authenticated
  USING (true);