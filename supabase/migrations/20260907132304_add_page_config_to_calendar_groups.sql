ALTER TABLE calendar_groups
  ADD COLUMN IF NOT EXISTS page_config jsonb;