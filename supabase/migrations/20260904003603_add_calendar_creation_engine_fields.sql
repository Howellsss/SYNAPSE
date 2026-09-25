/*
# Calendar Creation Engine - Schema Additions

1. New Columns on `calendars`
- `round_robin_strategy` (text, default 'balanced') — distribution strategy for round robin calendars.
  Values: 'balanced', 'least_recently_booked', 'priority_order', 'weighted'.
- `price` (numeric, nullable) — price for service-based calendars.
- `currency` (text, default 'USD') — currency for service pricing.
- `color` already exists but ensure default is set.

2. New Columns on `calendar_hosts`
- `priority` already exists (integer) — used for priority_order and weighted strategies.
- `weight` already exists (integer) — used for weighted distribution.

3. Notes
- All columns are nullable or have safe defaults so existing calendars are unaffected.
- No tables dropped, no columns removed, no types changed.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendars' AND column_name = 'round_robin_strategy'
  ) THEN
    ALTER TABLE calendars ADD COLUMN round_robin_strategy text DEFAULT 'balanced';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendars' AND column_name = 'price'
  ) THEN
    ALTER TABLE calendars ADD COLUMN price numeric(10,2);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calendars' AND column_name = 'currency'
  ) THEN
    ALTER TABLE calendars ADD COLUMN currency text DEFAULT 'USD';
  END IF;
END $$;
