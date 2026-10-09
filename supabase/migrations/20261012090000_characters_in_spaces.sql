/*
  # Characters in spaces

  The character people appear as when they walk around a workspace's spaces, and which of its
  animation clips plays for standing, walking, wave and cheer. Safe to run more than once.

  - characters.use_in_spaces   at most one per workspace (when none is chosen, the newest is used)
  - characters.space_clips     { "idle": "...", "walk": "...", "wave": "...", "cheer": "..." }
*/
ALTER TABLE characters ADD COLUMN IF NOT EXISTS use_in_spaces boolean NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS space_clips jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_one_in_spaces ON characters(workspace_id) WHERE use_in_spaces;
