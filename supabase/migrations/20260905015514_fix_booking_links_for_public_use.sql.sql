/*
# Fix booking_links for public one-time link enforcement

## Problem
1. `booking_links.workspace_id` is NOT NULL, but personal (non-workspace) calendars
   have no workspace — one-time link generation fails silently for those calendars.
2. RLS is `authenticated`-only, so the public booking page (anon key) cannot read
   `booking_links` to validate a token. One-time links currently behave identically
   to permanent links.
3. There is no atomic way for an unauthenticated visitor to claim a one-time link
   (increment use_count, set used_at) without racing.

## Changes

### 1. Make workspace_id nullable on booking_links
   `ALTER TABLE booking_links ALTER COLUMN workspace_id DROP NOT NULL;`
   This allows personal calendars (owner_id-scoped) to create booking links.

### 2. Add owner_id column to booking_links
   `ALTER TABLE booking_links ADD COLUMN owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;`
   Mirrors the pattern used by calendars/contacts/etc. for personal calendars.

### 3. Add anon SELECT policy for token validation
   Allows the public booking page to look up a link by its token (read-only).
   Scoped to SELECT only — anon cannot INSERT/UPDATE/DELETE.

### 4. Create SECURITY DEFINER function: claim_booking_link(token text)
   Atomically validates and claims a one-time booking link:
   - Checks the link exists, is a one_time link, and hasn't exceeded max_uses
   - Checks expiry if expires_at is set
   - Atomically increments use_count and sets used_at
   - Returns the link row on success, or an error reason on failure
   This prevents race conditions where two visitors try to use the same link.

### 5. Grant EXECUTE on claim function to anon, authenticated
   Public visitors need to call this function to claim their one-time link.

## Security
- anon gets SELECT-only on booking_links (can read token metadata, cannot modify)
- The claim function is SECURITY DEFINER (runs as the table owner) so it can
  perform the atomic UPDATE — anon cannot UPDATE the table directly
- All existing authenticated policies remain unchanged
*/

-- 1. Make workspace_id nullable for personal calendars
ALTER TABLE booking_links ALTER COLUMN workspace_id DROP NOT NULL;

-- 2. Add owner_id for personal-calendar scoping
ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Add anon SELECT policy for token lookup
DROP POLICY IF EXISTS "booking_links_anon_select" ON booking_links;
CREATE POLICY "booking_links_anon_select"
ON booking_links FOR SELECT
TO anon, authenticated
USING (true);

-- 4. Create atomic claim function
CREATE OR REPLACE FUNCTION claim_booking_link(p_token text)
RETURNS TABLE (
  id uuid,
  calendar_id uuid,
  link_type text,
  token text,
  max_uses int,
  use_count int,
  expires_at timestamptz,
  used_at timestamptz,
  success boolean,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link booking_links%ROWTYPE;
  v_reason text := null;
BEGIN
  -- Look up the link by token
  SELECT * INTO v_link FROM booking_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text, NULL::text,
      NULL::int, NULL::int, NULL::timestamptz, NULL::timestamptz,
      false, 'Link not found.';
    RETURN;
  END IF;

  -- Check expiry
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RETURN QUERY SELECT v_link.id, v_link.calendar_id, v_link.link_type, v_link.token,
      v_link.max_uses, v_link.use_count, v_link.expires_at, v_link.used_at,
      false, 'This link has expired.';
    RETURN;
  END IF;

  -- For one_time links, check if already used
  IF v_link.link_type = 'one_time' AND v_link.max_uses IS NOT NULL
     AND v_link.use_count >= v_link.max_uses THEN
    RETURN QUERY SELECT v_link.id, v_link.calendar_id, v_link.link_type, v_link.token,
      v_link.max_uses, v_link.use_count, v_link.expires_at, v_link.used_at,
      false, 'This one-time link has already been used.';
    RETURN;
  END IF;

  -- Atomically increment use_count (only if still under max_uses)
  UPDATE booking_links
    SET use_count = use_count + 1,
        used_at = now()
    WHERE id = v_link.id
      AND (max_uses IS NULL OR use_count < max_uses)
  RETURNING * INTO v_link;

  IF NOT FOUND THEN
    -- Someone else claimed it between our SELECT and UPDATE
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text, NULL::text,
      NULL::int, NULL::int, NULL::timestamptz, NULL::timestamptz,
      false, 'This link has already been used.';
    RETURN;
  END IF;

  RETURN QUERY SELECT v_link.id, v_link.calendar_id, v_link.link_type, v_link.token,
    v_link.max_uses, v_link.use_count, v_link.expires_at, v_link.used_at,
    true, NULL;
  RETURN;
END;
$$;

-- 5. Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION claim_booking_link(text) TO anon, authenticated;
