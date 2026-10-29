#!/usr/bin/env bash
# Builds the whole database in a throwaway Postgres from supabase/migrations and runs the tests in
# supabase/tests/*.test.sql. Needs psql and a Postgres server you can create databases on:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/test-database.sh
# (CI starts one; locally, any Postgres 15+ will do). Nothing touches the real Supabase project.
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_URL="${DATABASE_URL:?Set DATABASE_URL to a Postgres server (e.g. postgres://postgres:postgres@localhost:5432/postgres)}"
DB="synapse_test_$$"
TEST_URL="$(printf %s "$ADMIN_URL" | sed -E "s#^(postgres(ql)?://[^/]*/)[^?]*#\1$DB#")"
# Migrations that only add data belonging to the live account (they need its rows to exist).
SKIP=" 20260905042433_add_invite_pastor_tolu_form.sql 20260905042505_update_pastor_tolu_form_fields.sql "

psql "$ADMIN_URL" -qAt -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB" >/dev/null
trap 'psql "$ADMIN_URL" -qAt -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true' EXIT
run() { PGOPTIONS='--client-min-messages=warning' psql "$TEST_URL" -qAt -v ON_ERROR_STOP=1 -f "$1"; }

run supabase/tests/supabase-stand-in.sql
failed=0
for f in supabase/migrations/*.sql; do
  name="$(basename "$f")"
  [[ "$SKIP" == *" $name "* ]] && continue
  if ! out="$(run "$f" 2>&1)"; then
    echo "✗ migration $name"; echo "$out" | head -5; failed=1
  fi
done
[ "$failed" = 0 ] || { echo "Some migrations failed."; exit 1; }
echo "✓ all migrations applied"

for t in supabase/tests/*.test.sql; do
  echo "— $(basename "$t")"
  if ! PGOPTIONS='--client-min-messages=notice' psql "$TEST_URL" -qAt -v ON_ERROR_STOP=1 -f "$t" 2>&1 | sed -e 's/^psql:[^:]*:[0-9]*: //' -e 's/^NOTICE:  //'; then
    failed=1
  fi
done
exit "$failed"
