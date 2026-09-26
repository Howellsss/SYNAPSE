#!/bin/sh
# Regenerates supabase-setup.sql from supabase/migrations for a FRESH project.
# Skips migrations that only insert data tied to the original Bolt database.
cd "$(dirname "$0")/.."
out=supabase-setup.sql
{
  echo "-- SYNAPSE: full database setup for a fresh Supabase project."
  echo "-- Generated from supabase/migrations by scripts/build-supabase-setup.sh; do not edit by hand."
  echo "-- Paste into the Supabase SQL Editor and run once."
  for f in supabase/migrations/*.sql; do
    case "$f" in
      *_add_invite_pastor_tolu_form.sql|*_update_pastor_tolu_form_fields.sql)
        printf '\n-- ============ %s (skipped: data from the original database) ============\n' "$(basename "$f")"
        continue ;;
    esac
    printf '\n-- ============ %s ============\n' "$(basename "$f")"
    cat "$f"; printf '\n'
  done
} > "$out"
