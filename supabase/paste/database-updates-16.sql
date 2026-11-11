-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Tidy-up (18 November 2026): removes two functions left by a reverted events update, if they're there.
-- Safe to run more than once; does nothing when they aren't there.
-- Made from supabase/migrations/20261118090000_drop_reverted_event_functions.sql; don't edit here.

/*
  # Tidy up after a reverted events update

  Pull request #122 (a different take on events phase 7) was merged and then reverted. If its
  database update was run, it left two functions behind:

  - event_send_reminders(int): a second version of the reminder job's function. With two, the
    15-minute job's "SELECT event_send_reminders()" can't tell which to call, fails, and no
    reminders go out. This removes the extra one; the job uses event_send_reminders().
  - event_erase_registration(uuid, boolean): its "delete their data" action, whose button was
    removed by the revert.

  Does nothing when they aren't there. Safe to run more than once.
*/

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.event_send_reminders(integer)', 'public.event_erase_registration(uuid, boolean)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE 'DROP FUNCTION ' || f;
    END IF;
  END LOOP;
END $$;
