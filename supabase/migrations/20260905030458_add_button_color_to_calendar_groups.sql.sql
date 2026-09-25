-- Add button_color to calendar_groups theme fields
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'button_color') THEN
    ALTER TABLE calendar_groups ADD COLUMN button_color text DEFAULT '#E4A93C';
  END IF;
END $$;
