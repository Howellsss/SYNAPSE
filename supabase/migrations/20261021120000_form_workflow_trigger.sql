/*
  # Forms: start "Form submitted" workflows when the contact is attached

  The form-submit function saves the submission first and attaches the contact a moment later
  (an UPDATE). The workflow trigger only listened for INSERTs with a contact already set, so
  form and survey submissions never started a workflow.

  This adds a second trigger for the moment a submission gets its contact. A submission saved
  with its contact already set still fires once (on INSERT); one saved without a contact fires
  once when the contact is attached.

  It also wakes the mailer for a form's own emails (the team alert and the auto-reply). The
  once-a-minute job only called the mailer when a workflow email was waiting, so form emails
  stayed queued until some workflow happened to send one. Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION wf_on_form_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM wf_emit(NEW.workspace_id, 'form_submitted', NEW.contact_id, jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS wf_form_events ON form_submissions;
CREATE TRIGGER wf_form_events AFTER INSERT ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION wf_on_form_submission();

DROP TRIGGER IF EXISTS wf_form_contact_events ON form_submissions;
CREATE TRIGGER wf_form_contact_events AFTER UPDATE OF contact_id ON form_submissions
  FOR EACH ROW WHEN (OLD.contact_id IS NULL AND NEW.contact_id IS NOT NULL)
  EXECUTE FUNCTION wf_on_form_submission();

-- The column form emails are linked by (also added by 20261021090000_forms_upgrade.sql).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION wf_tick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev wf_events; r record; n_ev int := 0; n_runs int := 0; n_daily int := 0; queued int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('synapse_wf_tick')) THEN RETURN jsonb_build_object('skipped', true); END IF;
  FOR ev IN SELECT * FROM wf_events WHERE processed_at IS NULL ORDER BY id LIMIT 500 LOOP
    BEGIN
      PERFORM wf_handle_event(ev);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf event % failed: %', ev.id, SQLERRM;
    END;
    UPDATE wf_events SET processed_at = now() WHERE id = ev.id;
    n_ev := n_ev + 1;
  END LOOP;
  FOR r IN SELECT id FROM wf_runs WHERE status = 'waiting' AND resume_at <= now() ORDER BY resume_at LIMIT 500 LOOP
    BEGIN PERFORM wf_run(r.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf run % failed: %', r.id, SQLERRM; END;
    n_runs := n_runs + 1;
  END LOOP;
  BEGIN n_daily := wf_daily_scan(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf daily scan failed: %', SQLERRM; END;
  -- Housekeeping: keep 30 days of history, like the manual's logs.
  DELETE FROM wf_events WHERE processed_at < now() - interval '30 days';
  DELETE FROM wf_logs WHERE at < now() - interval '30 days';
  -- Ask the mailer to send workflow emails and form emails (team alert, auto-reply).
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND (wf_run_id IS NOT NULL OR form_submission_id IS NOT NULL);
  IF queued > 0 AND to_regnamespace('net') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := ''{"mode":"queue"}''::jsonb, headers := jsonb_strip_nulls(jsonb_build_object(''Content-Type'', ''application/json'', ''x-synapse-mailer'', $2, ''apikey'', $3, ''Authorization'', ''Bearer '' || $3)))'
      USING (SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), wf_mailer_secret(), (SELECT value FROM wf_private.settings WHERE key = 'client_key');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf mailer call failed: %', SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('events', n_ev, 'resumed', n_runs, 'daily', n_daily, 'queued_emails', queued);
END $$;
REVOKE ALL ON FUNCTION wf_tick() FROM PUBLIC, anon, authenticated;
