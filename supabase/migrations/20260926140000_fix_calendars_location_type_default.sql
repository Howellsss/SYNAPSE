/*
  # Fix calendars.location_type default

  20260905022204 restricted location_type to
  ('synapse_meeting', 'phone', 'in_person', 'custom', 'none') but left the
  column default as 'google_meet', so any insert that omits location_type
  (including seed_workspace_demo_data) violates the check constraint.
*/

ALTER TABLE calendars ALTER COLUMN location_type SET DEFAULT 'synapse_meeting';
