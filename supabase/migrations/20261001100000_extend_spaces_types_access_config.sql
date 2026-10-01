/*
  # Spaces: more types, access, availability, branding and room configuration

  Extends the spaces table from 20260930120000_add_spaces.sql. Safe to run more than once.

  1. space_type
     Allowed values become: office, coworking, classroom, event_hall, coaching_studio,
     town_square, campus, custom. Existing 'community_hub' rows become 'town_square'.

  2. New columns on spaces
     - access_mode       members | invite_only | guest_link (default members)
     - guest_link_token  unique secret for "anyone with a guest link"; null otherwise
     - permissions       which roles may edit the office, lock rooms, broadcast, invite
     - persistence       always_on | scheduled (default always_on)
     - schedule          { opens_at, closes_at, recurrence, days, date, timezone, calendar_id }
     - branding          { logo_url, accent }
     - config            { rooms: [{ id, name, type, capacity, lockable, knock_to_enter }] }

  3. join_space_as_guest(p_token)
     For people outside the account who open a guest link. Returns a small JSON object
     describing that one space, and only when its access_mode is 'guest_link'.
     It never returns the account (workspace_id), members, or any other data.
*/

-- 1. space_type: drop the old check, move community_hub, add the wider check
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_space_type_check;
UPDATE spaces SET space_type = 'town_square' WHERE space_type = 'community_hub';
ALTER TABLE spaces ADD CONSTRAINT spaces_space_type_check CHECK (
  space_type IN ('office', 'coworking', 'classroom', 'event_hall', 'coaching_studio', 'town_square', 'campus', 'custom')
);

-- 2. New columns
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'members';
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_access_mode_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_access_mode_check
  CHECK (access_mode IN ('members', 'invite_only', 'guest_link'));

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS guest_link_token text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_guest_link_token_key') THEN
    ALTER TABLE spaces ADD CONSTRAINT spaces_guest_link_token_key UNIQUE (guest_link_token);
  END IF;
END $$;

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT
  '{"edit_office":["owner","admin"],"lock_rooms":["owner","admin"],"broadcast":["owner","admin"],"invite":["owner","admin"]}'::jsonb;

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS persistence text NOT NULL DEFAULT 'always_on';
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_persistence_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_persistence_check
  CHECK (persistence IN ('always_on', 'scheduled'));

ALTER TABLE spaces ADD COLUMN IF NOT EXISTS schedule jsonb;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. Guest entry: limited details of one guest-link space, nothing else.
CREATE OR REPLACE FUNCTION join_space_as_guest(p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'slug', s.slug,
    'description', s.description,
    'space_type', s.space_type,
    'template_key', s.template_key,
    'capacity', s.capacity,
    'persistence', s.persistence,
    'schedule', s.schedule,
    'branding', s.branding,
    'config', s.config,
    'map', s.map
  )
  FROM spaces s
  WHERE coalesce(btrim(p_token), '') <> ''
    AND s.guest_link_token = p_token
    AND s.access_mode = 'guest_link'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION join_space_as_guest(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_space_as_guest(text) TO anon, authenticated;
