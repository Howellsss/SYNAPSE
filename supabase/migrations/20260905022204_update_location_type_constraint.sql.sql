-- Step 1: Drop the old check constraint
ALTER TABLE calendars DROP CONSTRAINT IF EXISTS calendars_location_type_check;

-- Step 2: Migrate existing data to the new location type
UPDATE calendars SET location_type = 'synapse_meeting' WHERE location_type IN ('google_meet', 'zoom', 'teams');

-- Step 3: Add the new check constraint
ALTER TABLE calendars ADD CONSTRAINT calendars_location_type_check
  CHECK (location_type IN ('synapse_meeting', 'phone', 'in_person', 'custom', 'none'));

-- Step 4: Update workspace default_booking_settings if they reference old location types
UPDATE workspace_settings
  SET settings = jsonb_set(settings, '{default_location}', '"synapse_meeting"')
  WHERE settings->>'default_location' IN ('google_meet', 'zoom', 'teams');
