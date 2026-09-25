/*
# Group Calendar Theme, Settings & Analytics

## Purpose
Extend the existing `calendar_groups` table with branding/theme fields
and create a new `calendar_group_analytics` table to track public page
visitors, calendar selections, and booking conversions.

## 1. Modified Tables

### `calendar_groups` — new columns
- `logo_url` (text, nullable) — optional group logo image URL
- `cover_url` (text, nullable) — optional cover/banner image URL
- `primary_color` (text, default '#E4A93C') — accent color for cards/buttons
- `background_color` (text, default '#09132b') — page background color
- `font_family` (text, default 'Inter') — font family for public page
- `layout` (text, default 'grid', CHECK in 'grid'|'list') — card layout style
- `is_active` (boolean, default true) — toggle public visibility without deleting
- `updated_at` (timestamptz, default now()) — track settings changes

## 2. New Tables

### `calendar_group_analytics`
- `id` (uuid PK, gen_random_uuid())
- `group_id` (uuid, FK calendar_groups CASCADE)
- `calendar_id` (uuid, FK calendars SET NULL, nullable — null for group-page views)
- `event_type` (text, CHECK in 'page_view'|'calendar_selected'|'booking_started'|'booking_completed')
- `visitor_ip` (text, nullable) — hashed IP for dedup, nullable
- `metadata` (jsonb, default '{}') — extra context (referrer, user-agent summary)
- `created_at` (timestamptz, default now())

## 3. Security

### `calendar_groups` — public SELECT policy
- New `calendar_groups_public_select` policy: `TO anon, authenticated`
  USING `(is_active = true)` — only active groups are visible publicly.
- Existing authenticated policies remain unchanged (owner/workspace access).

### `calendar_group_members` — public SELECT policy
- New `calendar_group_members_public_select` policy: `TO anon, authenticated`
  USING (EXISTS (SELECT 1 FROM calendar_groups WHERE id = group_id AND is_active = true))
  — public can only see members of active groups.

### `calendar_group_analytics` — public INSERT only
- `calendar_group_analytics_public_insert`: `TO anon, authenticated WITH CHECK (true)`
  — anyone can record analytics events (page views, selections).
- `calendar_group_analytics_select_own`: `TO authenticated` — owners can read
  analytics for their groups.
- No public SELECT, no UPDATE, no DELETE via anon.

## 4. Indexes
- `idx_calendar_group_analytics_group` on `group_id`
- `idx_calendar_group_analytics_calendar` on `calendar_id`
- `idx_calendar_group_analytics_event` on `event_type`
*/

-- ── Extend calendar_groups with theme/branding fields ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'logo_url') THEN
    ALTER TABLE calendar_groups ADD COLUMN logo_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'cover_url') THEN
    ALTER TABLE calendar_groups ADD COLUMN cover_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'primary_color') THEN
    ALTER TABLE calendar_groups ADD COLUMN primary_color text DEFAULT '#E4A93C';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'background_color') THEN
    ALTER TABLE calendar_groups ADD COLUMN background_color text DEFAULT '#09132b';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'font_family') THEN
    ALTER TABLE calendar_groups ADD COLUMN font_family text DEFAULT 'Inter';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'layout') THEN
    ALTER TABLE calendar_groups ADD COLUMN layout text DEFAULT 'grid' CHECK (layout IN ('grid', 'list'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'is_active') THEN
    ALTER TABLE calendar_groups ADD COLUMN is_active boolean DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_groups' AND column_name = 'updated_at') THEN
    ALTER TABLE calendar_groups ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- ── Create analytics table ──
CREATE TABLE IF NOT EXISTS calendar_group_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES calendar_groups(id) ON DELETE CASCADE,
  calendar_id uuid REFERENCES calendars(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('page_view', 'calendar_selected', 'booking_started', 'booking_completed')),
  visitor_ip text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE calendar_group_analytics ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_calendar_group_analytics_group ON calendar_group_analytics(group_id);
CREATE INDEX IF NOT EXISTS idx_calendar_group_analytics_calendar ON calendar_group_analytics(calendar_id);
CREATE INDEX IF NOT EXISTS idx_calendar_group_analytics_event ON calendar_group_analytics(event_type);

-- ── Public SELECT on calendar_groups (only active groups) ──
DROP POLICY IF EXISTS "calendar_groups_public_select" ON calendar_groups;
CREATE POLICY "calendar_groups_public_select"
  ON calendar_groups FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- ── Public SELECT on calendar_group_members (only for active groups) ──
DROP POLICY IF EXISTS "calendar_group_members_public_select" ON calendar_group_members;
CREATE POLICY "calendar_group_members_public_select"
  ON calendar_group_members FOR SELECT
  TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM calendar_groups WHERE id = group_id AND is_active = true));

-- ── Analytics: public INSERT (anyone can record events) ──
DROP POLICY IF EXISTS "calendar_group_analytics_public_insert" ON calendar_group_analytics;
CREATE POLICY "calendar_group_analytics_public_insert"
  ON calendar_group_analytics FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ── Analytics: authenticated SELECT (owners only) ──
DROP POLICY IF EXISTS "calendar_group_analytics_select_own" ON calendar_group_analytics;
CREATE POLICY "calendar_group_analytics_select_own"
  ON calendar_group_analytics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM calendar_groups
      WHERE id = group_id
      AND (owner_id = auth.uid() OR (workspace_id IS NOT NULL AND can_access_workspace(workspace_id)))
    )
  );