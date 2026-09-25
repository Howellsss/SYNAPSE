-- Add definition JSONB column for the visual form builder
-- This stores the complete form definition: pages, sections, elements, theme, logic, settings
ALTER TABLE forms ADD COLUMN IF NOT EXISTS definition jsonb DEFAULT '{}';
