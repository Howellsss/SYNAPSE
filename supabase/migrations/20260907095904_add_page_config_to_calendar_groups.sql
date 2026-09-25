/*
# Add page_config JSONB column to calendar_groups

1. Modified Tables
- `calendar_groups`: Add `page_config` jsonb column (nullable) for storing the
  reusable public page presentation configuration (branding, typography, layout,
  header, footer, navigation). This is presentation-only config and does NOT
  affect calendar availability, booking logic, or form data.

2. Security
- No RLS policy changes needed — the column inherits the table's existing RLS.
- Public SELECT already exists on calendar_groups for active groups.
- Owner-scoped UPDATE already exists for the workspace owner.
*/

ALTER TABLE calendar_groups
  ADD COLUMN IF NOT EXISTS page_config jsonb;
