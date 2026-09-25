/*
# Add avatar_url to contacts table

## Purpose
Adds an optional `avatar_url` column to the `contacts` table so contacts can have profile photos displayed in the dashboard, contact lists, and appointment rows.

## Changes
1. New column on `contacts`:
   - `avatar_url` (text, nullable) — stores a URL to the contact's profile image. Nullable because most contacts won't have one initially.

## Security
- No RLS policy changes. The existing workspace-scoped policies on `contacts` already cover the new column since column-level privileges inherit from the table-level policy.
*/

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS avatar_url text;
