-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Phase 14 database update (31 October 2026): outgoing webhooks that really send, signed and retried,
-- with a delivery log. Safe to run more than once.
-- Made from supabase/migrations/20261031090000_outgoing_webhooks.sql; don't edit here.

/*
  # Outgoing webhooks that really send: signed, retried, and logged

  Settings → Webhooks saved addresses but nothing was ever sent. Now:
  - When something happens (the same events workflows react to), every active webhook listening
    for it gets a delivery, with a snapshot of the contact and what happened:
      contact.created, contact.updated, contact.tag_added, contact.tag_removed, form.submitted,
      appointment.created, appointment.cancelled, appointment.rescheduled, appointment.completed,
      appointment.no_show, message.received, workflow.completed (and webhook.test from "Send test").
  - Each delivery is POSTed as JSON, signed so the receiver can check it came from SYNAPSE:
      X-Synapse-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the webhook's secret>
    plus X-Synapse-Event, X-Synapse-Delivery and X-Synapse-Timestamp.
  - A 2xx answer means delivered. Anything else (or no answer) is retried after 1, 5, 30 minutes,
    2 and 6 hours: 6 tries in all, then it's marked failed. Admins can retry it by hand.
  - webhook_deliveries is the delivery log (kept 30 days). Only Admins can see it.
  - Every minute (pg_cron) webhook_dispatch() sends what's due and reads the answers (pg_net).

  Needs 20261010090000_workflow_engine.sql. Safe to run more than once.
*/

-- Every webhook gets a signing secret.
ALTER TABLE webhooks ALTER COLUMN secret SET DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
UPDATE webhooks SET secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') WHERE secret IS NULL OR secret = '';
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS name text;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'retrying', 'delivered', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint,
  sent_at timestamptz,
  response_status int,
  response_body text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(next_attempt_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sending ON webhook_deliveries(sent_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_deliveries_admins" ON webhook_deliveries;
CREATE POLICY "webhook_deliveries_admins" ON webhook_deliveries FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------- what is sent

/** A form submission's answers as { "Question": "answer" }. */
CREATE OR REPLACE FUNCTION webhook_form_answers(p_submission uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s form_submissions; def jsonb; out jsonb;
BEGIN
  SELECT * INTO s FROM form_submissions WHERE id = p_submission;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  SELECT CASE WHEN jsonb_typeof(f.definition) = 'string' THEN (f.definition #>> '{}')::jsonb ELSE f.definition END INTO def FROM forms f WHERE f.id = s.form_id;
  SELECT coalesce(jsonb_object_agg(coalesce(nullif(x.el->'field'->>'label', ''), a.key), a.value), '{}'::jsonb) INTO out
  FROM jsonb_each(coalesce(s.answers, '{}'::jsonb)) a
  LEFT JOIN LATERAL (SELECT e.value AS el FROM jsonb_each(coalesce(def->'elements', '{}'::jsonb)) e WHERE e.value->'field'->>'fieldId' = a.key LIMIT 1) x ON true;
  RETURN out;
EXCEPTION WHEN OTHERS THEN RETURN coalesce((SELECT answers FROM form_submissions WHERE id = p_submission), '{}'::jsonb);
END $$;

/** The contact as sent in every event. */
CREATE OR REPLACE FUNCTION webhook_contact(p_contact uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name, 'email', c.email, 'phone', c.phone,
    'company', c.company, 'job_title', c.job_title, 'source', c.source, 'tags', to_jsonb(wf_contact_tags(c.id)),
    'created_at', c.created_at, 'link', wf_app_url() || '/contacts/' || c.id)
  FROM contacts c WHERE c.id = p_contact;
$$;

/** Queue one event for every active webhook in the account that listens for it. */
CREATE OR REPLACE FUNCTION webhook_queue(p_workspace uuid, p_event text, p_data jsonb) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w webhooks; n int := 0; did uuid;
BEGIN
  FOR w IN SELECT * FROM webhooks WHERE workspace_id = p_workspace AND coalesce(is_active, true)
             AND (events ? p_event OR p_event = 'webhook.test') LOOP
    did := gen_random_uuid();
    INSERT INTO webhook_deliveries(id, webhook_id, workspace_id, event, payload)
    VALUES (did, w.id, p_workspace, p_event,
            jsonb_build_object('id', did, 'event', p_event, 'created_at', now(), 'workspace_id', p_workspace, 'data', coalesce(p_data, '{}'::jsonb)));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION webhook_queue(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Events the workflow engine already records, as webhook events.
CREATE OR REPLACE FUNCTION webhook_on_wf_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev text; data jsonb; appt jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webhooks WHERE workspace_id = NEW.workspace_id AND coalesce(is_active, true)) THEN RETURN NULL; END IF;
  ev := CASE NEW.type
    WHEN 'contact_created' THEN 'contact.created'
    WHEN 'contact_changed' THEN 'contact.updated'
    WHEN 'contact_tag' THEN CASE NEW.data->>'event' WHEN 'removed' THEN 'contact.tag_removed' ELSE 'contact.tag_added' END
    WHEN 'form_submitted' THEN 'form.submitted'
    WHEN 'appointment_booked' THEN 'appointment.created'
    WHEN 'appointment_status' THEN CASE NEW.data->>'status'
      WHEN 'cancelled' THEN 'appointment.cancelled' WHEN 'rescheduled' THEN 'appointment.rescheduled'
      WHEN 'showed' THEN 'appointment.completed' WHEN 'no_show' THEN 'appointment.no_show' END
    WHEN 'customer_replied' THEN 'message.received'
  END;
  IF ev IS NULL THEN RETURN NULL; END IF;
  data := jsonb_build_object('contact', webhook_contact(NEW.contact_id));
  IF ev = 'contact.updated' THEN data := data || jsonb_build_object('changed', NEW.data->'changed'); END IF;
  IF ev LIKE 'contact.tag%' THEN data := data || jsonb_build_object('tag', NEW.data->>'tag'); END IF;
  IF ev = 'form.submitted' THEN
    data := data || jsonb_build_object(
      'form', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'type', f.type) FROM forms f WHERE f.id = (NEW.data->>'form_id')::uuid),
      'submission_id', NEW.data->>'submission_id',
      'answers', webhook_form_answers((NEW.data->>'submission_id')::uuid));
  END IF;
  IF ev LIKE 'appointment.%' THEN
    SELECT jsonb_build_object('id', a.id, 'title', a.title, 'status', a.status, 'start_time', a.start_time, 'end_time', a.end_time,
             'calendar', jsonb_build_object('id', cal.id, 'name', cal.name))
      INTO appt FROM appointments a LEFT JOIN calendars cal ON cal.id = a.calendar_id WHERE a.id = (NEW.data->>'appointment_id')::uuid;
    data := data || jsonb_build_object('appointment', appt);
  END IF;
  IF ev = 'message.received' THEN data := data || jsonb_build_object('channel', NEW.data->>'channel'); END IF;
  PERFORM webhook_queue(NEW.workspace_id, ev, data);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS webhook_on_wf_event ON wf_events;
CREATE TRIGGER webhook_on_wf_event AFTER INSERT ON wf_events FOR EACH ROW EXECUTE FUNCTION webhook_on_wf_event();

CREATE OR REPLACE FUNCTION webhook_on_run_done() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NOT NEW.is_test
     AND EXISTS (SELECT 1 FROM webhooks WHERE workspace_id = NEW.workspace_id AND coalesce(is_active, true) AND events ? 'workflow.completed') THEN
    PERFORM webhook_queue(NEW.workspace_id, 'workflow.completed', jsonb_build_object(
      'workflow', (SELECT jsonb_build_object('id', w.id, 'name', w.name) FROM workflows w WHERE w.id = NEW.workflow_id),
      'contact', webhook_contact(NEW.contact_id), 'started_at', NEW.started_at, 'finished_at', NEW.finished_at));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS webhook_on_run_done ON wf_runs;
CREATE TRIGGER webhook_on_run_done AFTER UPDATE OF status ON wf_runs FOR EACH ROW EXECUTE FUNCTION webhook_on_run_done();

-- ---------------------------------------------------------------- sending

/** Minutes to wait before try number n+1, after n tries failed. */
CREATE OR REPLACE FUNCTION webhook_backoff(p_attempts int) RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT make_interval(mins => (ARRAY[1, 5, 30, 120, 360])[least(greatest(p_attempts, 1), 5)]);
$$;

/** The signature header for a body sent at unix time p_ts. */
CREATE OR REPLACE FUNCTION webhook_signature(p_secret text, p_ts bigint, p_body jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT 't=' || p_ts || ',v1=' || encode(hmac(p_ts::text || '.' || p_body::text, p_secret, 'sha256'), 'hex');
$$;

/** Every minute: read the answers to what was sent, then send what's due. */
CREATE OR REPLACE FUNCTION webhook_dispatch(p_only uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  d webhook_deliveries; w webhooks; code int; body text; err text; ts bigint; req bigint;
  n_sent int := 0; n_ok int := 0; n_retry int := 0; n_failed int := 0;
BEGIN
  IF p_only IS NULL AND NOT pg_try_advisory_xact_lock(hashtext('synapse_webhooks')) THEN RETURN jsonb_build_object('skipped', true); END IF;

  -- 1. Answers to earlier sends (pg_net writes them to net._http_response).
  IF to_regclass('net._http_response') IS NOT NULL THEN
    FOR d IN SELECT * FROM webhook_deliveries WHERE status = 'sending' ORDER BY sent_at LIMIT 500 LOOP
      code := NULL; body := NULL; err := NULL;
      EXECUTE 'SELECT status_code, left(content::text, 500), coalesce(error_msg, CASE WHEN timed_out THEN ''Timed out'' END) FROM net._http_response WHERE id = $1'
        INTO code, body, err USING d.request_id;
      IF code IS NULL AND err IS NULL THEN
        IF d.sent_at > now() - interval '10 minutes' THEN CONTINUE; END IF;
        err := 'No answer within 10 minutes';
      END IF;
      IF code BETWEEN 200 AND 299 THEN
        UPDATE webhook_deliveries SET status = 'delivered', response_status = code, response_body = body, error = NULL, delivered_at = now() WHERE id = d.id;
        n_ok := n_ok + 1;
      ELSIF d.attempts >= 6 THEN
        UPDATE webhook_deliveries SET status = 'failed', response_status = code, response_body = body,
          error = coalesce(err, 'The address answered ' || code) WHERE id = d.id;
        n_failed := n_failed + 1;
      ELSE
        UPDATE webhook_deliveries SET status = 'retrying', response_status = code, response_body = body,
          error = coalesce(err, 'The address answered ' || code), next_attempt_at = now() + webhook_backoff(d.attempts) WHERE id = d.id;
        n_retry := n_retry + 1;
      END IF;
    END LOOP;
  END IF;

  -- 2. Send what's due.
  FOR d IN SELECT * FROM webhook_deliveries
           WHERE status IN ('pending', 'retrying') AND next_attempt_at <= now() AND (p_only IS NULL OR id = p_only)
           ORDER BY next_attempt_at LIMIT 200 LOOP
    SELECT * INTO w FROM webhooks WHERE id = d.webhook_id;
    IF NOT coalesce(w.is_active, true) THEN
      UPDATE webhook_deliveries SET status = 'failed', error = 'The webhook is switched off' WHERE id = d.id;
      CONTINUE;
    END IF;
    IF coalesce(w.url, '') !~ '^https://' THEN
      UPDATE webhook_deliveries SET status = 'failed', error = 'The address must start with https://' WHERE id = d.id;
      CONTINUE;
    END IF;
    ts := extract(epoch FROM now())::bigint;
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)' INTO req
      USING w.url, d.payload, jsonb_build_object(
        'Content-Type', 'application/json', 'User-Agent', 'SYNAPSE-Webhooks/1',
        'X-Synapse-Event', d.event, 'X-Synapse-Delivery', d.id::text, 'X-Synapse-Timestamp', ts::text,
        'X-Synapse-Signature', webhook_signature(coalesce(w.secret, ''), ts, d.payload));
      UPDATE webhook_deliveries SET status = 'sending', request_id = req, attempts = attempts + 1, sent_at = now() WHERE id = d.id;
      UPDATE webhooks SET last_triggered_at = now() WHERE id = w.id;
      n_sent := n_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE webhook_deliveries SET attempts = attempts + 1, error = 'Couldn''t send: ' || SQLERRM,
        status = CASE WHEN attempts + 1 >= 6 THEN 'failed' ELSE 'retrying' END,
        next_attempt_at = now() + webhook_backoff(attempts + 1) WHERE id = d.id;
    END;
  END LOOP;

  IF p_only IS NULL THEN DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days'; END IF;
  RETURN jsonb_build_object('sent', n_sent, 'delivered', n_ok, 'retrying', n_retry, 'failed', n_failed);
END $$;
REVOKE ALL ON FUNCTION webhook_dispatch(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- for Settings → Webhooks (Admins)

/** "Send test": a webhook.test delivery to this webhook, sent straight away. */
CREATE OR REPLACE FUNCTION webhook_send_test(p_webhook uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w webhooks; did uuid := gen_random_uuid();
BEGIN
  SELECT * INTO w FROM webhooks WHERE id = p_webhook;
  IF NOT FOUND OR NOT is_workspace_admin(w.workspace_id) THEN RAISE EXCEPTION 'Only admins can test webhooks'; END IF;
  INSERT INTO webhook_deliveries(id, webhook_id, workspace_id, event, payload)
  VALUES (did, w.id, w.workspace_id, 'webhook.test', jsonb_build_object('id', did, 'event', 'webhook.test', 'created_at', now(), 'workspace_id', w.workspace_id,
          'data', jsonb_build_object('message', 'This is a test from SYNAPSE. If you can read it, your webhook works.')));
  PERFORM webhook_dispatch(did);
  RETURN did;
END $$;
REVOKE ALL ON FUNCTION webhook_send_test(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION webhook_send_test(uuid) TO authenticated;

/** Try a failed delivery again now. */
CREATE OR REPLACE FUNCTION webhook_retry(p_delivery uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d webhook_deliveries;
BEGIN
  SELECT * INTO d FROM webhook_deliveries WHERE id = p_delivery;
  IF NOT FOUND OR NOT is_workspace_admin(d.workspace_id) THEN RAISE EXCEPTION 'Only admins can retry deliveries'; END IF;
  UPDATE webhook_deliveries SET status = 'retrying', next_attempt_at = now(), attempts = least(attempts, 5) WHERE id = d.id;
  PERFORM webhook_dispatch(d.id);
END $$;
REVOKE ALL ON FUNCTION webhook_retry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION webhook_retry(uuid) TO authenticated;

/** A new signing secret (the old one stops working at once). */
CREATE OR REPLACE FUNCTION webhook_new_secret(p_webhook uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM webhooks WHERE id = p_webhook AND is_workspace_admin(workspace_id)) THEN RAISE EXCEPTION 'Only admins can change webhooks'; END IF;
  UPDATE webhooks SET secret = s WHERE id = p_webhook;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION webhook_new_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION webhook_new_secret(uuid) TO authenticated;

-- Every minute.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'synapse-webhooks';
    PERFORM cron.schedule('synapse-webhooks', '* * * * *', 'SELECT public.webhook_dispatch()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Could not schedule webhooks: %', SQLERRM;
END $$;
