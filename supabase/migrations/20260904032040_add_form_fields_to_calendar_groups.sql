/*
# Add form support to calendar groups

1. Modified Tables
- `calendar_groups`: Added `connected_form_id` (uuid, FK to forms) and `booking_flow` (text, defaults to 'calendar_first')
  so group calendars can present a form to visitors before showing the calendar chooser.
2. Security
- No new policies needed; existing calendar_groups RLS policies already cover SELECT/INSERT/UPDATE for workspace members
  and the public SELECT policy allows anon access for booking.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_groups' AND column_name = 'connected_form_id'
  ) THEN
    ALTER TABLE calendar_groups
      ADD COLUMN connected_form_id uuid REFERENCES forms(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendar_groups' AND column_name = 'booking_flow'
  ) THEN
    ALTER TABLE calendar_groups
      ADD COLUMN booking_flow text DEFAULT 'calendar_first' CHECK (booking_flow IN ('calendar_first', 'form_first'));
  END IF;
END $$;
