-- Add definition JSONB column for visual form builder (if not already present)
ALTER TABLE forms ADD COLUMN IF NOT EXISTS definition jsonb DEFAULT '{}';
