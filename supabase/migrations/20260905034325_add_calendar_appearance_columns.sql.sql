/*
# Add appearance columns to calendars table

1. Changes
- Adds `logo_url`, `cover_url`, `background_color`, `button_color`, `font_family` columns to `calendars`.
- These mirror the same fields on `calendar_groups` so individual calendars can also be themed.
- All columns are nullable with safe defaults applied via `IF NOT EXISTS`.
- No RLS changes — existing policies on `calendars` remain unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'logo_url') THEN
    ALTER TABLE calendars ADD COLUMN logo_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'cover_url') THEN
    ALTER TABLE calendars ADD COLUMN cover_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'background_color') THEN
    ALTER TABLE calendars ADD COLUMN background_color text DEFAULT '#FAF6F0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'button_color') THEN
    ALTER TABLE calendars ADD COLUMN button_color text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendars' AND column_name = 'font_family') THEN
    ALTER TABLE calendars ADD COLUMN font_family text DEFAULT 'Inter';
  END IF;
END $$;