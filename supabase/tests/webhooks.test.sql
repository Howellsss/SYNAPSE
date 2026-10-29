-- Outgoing webhooks: events are queued for the webhooks that listen for them, sent signed, marked
-- delivered on a 2xx, retried on anything else, and given up after 6 tries. pg_net is played by
-- the stand-in: net.requests holds what was sent; a test writes net._http_response to answer.

SET client_min_messages = notice;
CREATE SCHEMA IF NOT EXISTS tw;
CREATE TABLE IF NOT EXISTS tw.failures (name text, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS tw.passes (n int);
TRUNCATE tw.failures, tw.passes;

CREATE OR REPLACE FUNCTION tw.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(p_ok, false) THEN INSERT INTO tw.passes VALUES (1); RAISE NOTICE '  ✓ %', p_what;
  ELSE INSERT INTO tw.failures(name) VALUES (p_what); RAISE NOTICE '  ✗ %', p_what; END IF;
END $$;
CREATE OR REPLACE FUNCTION tw.crashed(p_case text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO tw.failures(name) VALUES (p_case || ': crashed: ' || p_err); RAISE NOTICE '  ✗ crashed: %', p_err; END $$;

CREATE OR REPLACE FUNCTION tw.ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'b0000000-0000-4000-8000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION tw.owner() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'b0000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE OR REPLACE FUNCTION tw.member() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'b0000000-0000-4000-8000-0000000000a2'::uuid $$;
INSERT INTO auth.users(id, email) VALUES (tw.owner(), 'hooks-owner@example.com'), (tw.member(), 'hooks-member@example.com') ON CONFLICT DO NOTHING;
INSERT INTO workspaces(id, name, slug, owner_id) VALUES (tw.ws(), 'Hooks Co', 'hooks-co', tw.owner()) ON CONFLICT DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (tw.ws(), tw.owner(), 'owner'), (tw.ws(), tw.member(), 'member') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION tw.reset() RETURNS void LANGUAGE sql AS $$
  DELETE FROM webhooks WHERE workspace_id = tw.ws();
  DELETE FROM net.requests; DELETE FROM net._http_response;
$$;
CREATE OR REPLACE FUNCTION tw.hook(p_events text[], p_url text DEFAULT 'https://example.com/hook', p_active boolean DEFAULT true) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO webhooks(workspace_id, url, events, is_active) VALUES (tw.ws(), p_url, to_jsonb(p_events), p_active) RETURNING id;
$$;
CREATE OR REPLACE FUNCTION tw.contact(p_first text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO contacts(workspace_id, first_name, email) VALUES (tw.ws(), p_first, lower(p_first) || '@example.com') RETURNING id;
$$;
-- The receiving server answers the last request it got.
CREATE OR REPLACE FUNCTION tw.answer(p_code int, p_body text DEFAULT 'ok') RETURNS void LANGUAGE sql AS $$
  INSERT INTO net._http_response(id, status_code, content) SELECT max(id), p_code, p_body FROM net.requests;
$$;

DO $$ DECLARE h1 uuid; h2 uuid; h3 uuid; c uuid; BEGIN
  RAISE NOTICE 'Events reach the webhooks that listen for them';
  PERFORM tw.reset();
  h1 := tw.hook(ARRAY['contact.created', 'contact.tag_added']);
  h2 := tw.hook(ARRAY['form.submitted']);
  h3 := tw.hook(ARRAY['contact.created'], 'https://example.com/off', false);
  c := tw.contact('Ada');
  PERFORM tw.check((SELECT count(*) FROM webhook_deliveries WHERE webhook_id = h1 AND event = 'contact.created') = 1, 'a new contact is queued for the webhook listening for contact.created');
  PERFORM tw.check(NOT EXISTS (SELECT 1 FROM webhook_deliveries WHERE webhook_id = h2), 'not for a webhook listening for something else');
  PERFORM tw.check(NOT EXISTS (SELECT 1 FROM webhook_deliveries WHERE webhook_id = h3), 'not for a webhook that is switched off');
  PERFORM tw.check((SELECT payload->'data'->'contact'->>'first_name' = 'Ada' AND payload->>'event' = 'contact.created' AND payload->>'id' = id::text
    FROM webhook_deliveries WHERE webhook_id = h1), 'the payload has the event, its id and the contact');
  INSERT INTO contact_tags(contact_id, tag_id) VALUES (c, wf_tag_id(tw.ws(), 'VIP'));
  PERFORM tw.check((SELECT payload->'data'->>'tag' = 'VIP' AND payload->'data'->'contact'->'tags' ? 'vip' FROM webhook_deliveries WHERE webhook_id = h1 AND event = 'contact.tag_added'),
    'tag added: the tag, and the contact''s tags');
EXCEPTION WHEN OTHERS THEN PERFORM tw.crashed('Events reach the webhooks', SQLERRM); END $$;

DO $$ DECLARE h uuid; d webhook_deliveries; r net.requests; sec text; ts text; BEGIN
  RAISE NOTICE 'Sending: signed, then delivered on a 2xx';
  PERFORM tw.reset();
  h := tw.hook(ARRAY['contact.created']);
  PERFORM tw.contact('Ben');
  PERFORM webhook_dispatch();
  SELECT * INTO r FROM net.requests ORDER BY id DESC LIMIT 1;
  SELECT * INTO d FROM webhook_deliveries WHERE webhook_id = h;
  SELECT secret INTO sec FROM webhooks WHERE id = h;
  ts := r.headers->>'X-Synapse-Timestamp';
  PERFORM tw.check(r.url = 'https://example.com/hook' AND r.body = d.payload, 'it POSTs the payload to the address');
  PERFORM tw.check(r.headers->>'X-Synapse-Event' = 'contact.created' AND r.headers->>'X-Synapse-Delivery' = d.id::text, 'with the event and delivery id in headers');
  PERFORM tw.check(length(sec) >= 32 AND r.headers->>'X-Synapse-Signature' = 't=' || ts || ',v1=' || encode(hmac(ts || '.' || r.body::text, sec, 'sha256'), 'hex'),
    'signed with the webhook''s secret (HMAC-SHA256 of "<time>.<body>")');
  PERFORM tw.check(d.status = 'sending' AND d.attempts = 1, 'marked as sent (try 1)');
  PERFORM tw.answer(200, '{"ok":true}');
  PERFORM webhook_dispatch();
  SELECT * INTO d FROM webhook_deliveries WHERE webhook_id = h;
  PERFORM tw.check(d.status = 'delivered' AND d.response_status = 200 AND d.delivered_at IS NOT NULL, 'a 200 answer: delivered');
EXCEPTION WHEN OTHERS THEN PERFORM tw.crashed('Sending', SQLERRM); END $$;

DO $$ DECLARE h uuid; d webhook_deliveries; i int; BEGIN
  RAISE NOTICE 'Failures: retried with longer gaps, then given up';
  PERFORM tw.reset();
  h := tw.hook(ARRAY['contact.created']);
  PERFORM tw.contact('Cy');
  PERFORM webhook_dispatch(); PERFORM tw.answer(500, 'Server error'); PERFORM webhook_dispatch();
  SELECT * INTO d FROM webhook_deliveries WHERE webhook_id = h;
  PERFORM tw.check(d.status = 'retrying' AND d.response_status = 500 AND d.error = 'The address answered 500'
    AND d.next_attempt_at BETWEEN now() + interval '59 seconds' AND now() + interval '61 seconds', 'a 500 answer: tried again in 1 minute, with the reason');
  FOR i IN 2..6 LOOP
    UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = d.id;
    PERFORM webhook_dispatch(); PERFORM tw.answer(503); PERFORM webhook_dispatch();
  END LOOP;
  SELECT * INTO d FROM webhook_deliveries WHERE webhook_id = h;
  PERFORM tw.check(d.status = 'failed' AND d.attempts = 6, 'after 6 tries it is marked failed');
  PERFORM tw.check((SELECT count(*) FROM net.requests) = 6, 'it was sent exactly 6 times');
  PERFORM set_config('request.jwt.claim.sub', tw.owner()::text, true);
  PERFORM webhook_retry(d.id);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT * INTO d FROM webhook_deliveries WHERE webhook_id = h;
  PERFORM tw.check(d.status = 'sending' AND (SELECT count(*) FROM net.requests) = 7, 'an admin can retry it, and it is sent straight away');
EXCEPTION WHEN OTHERS THEN PERFORM tw.crashed('Failures', SQLERRM); END $$;

DO $$ DECLARE h uuid; d webhook_deliveries; BEGIN
  RAISE NOTICE 'Only https, and only admins test or retry';
  PERFORM tw.reset();
  h := tw.hook(ARRAY['contact.created'], 'http://insecure.example.com');
  PERFORM tw.contact('Di'); PERFORM webhook_dispatch();
  SELECT * INTO d FROM webhook_deliveries WHERE webhook_id = h;
  PERFORM tw.check(d.status = 'failed' AND d.error LIKE '%https://%' AND NOT EXISTS (SELECT 1 FROM net.requests), 'an http:// address is never called');
  UPDATE webhooks SET url = 'https://example.com/hook' WHERE id = h;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', tw.member()::text, true);
    PERFORM webhook_send_test(h);
    PERFORM tw.check(false, 'a User cannot send a test');
  EXCEPTION WHEN OTHERS THEN PERFORM tw.check(SQLERRM LIKE '%Only admins%', 'a User cannot send a test');
  END;
  PERFORM set_config('request.jwt.claim.sub', tw.owner()::text, true);
  PERFORM webhook_send_test(h);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM tw.check(EXISTS (SELECT 1 FROM net.requests WHERE body->>'event' = 'webhook.test'), 'an admin''s test is sent at once');
EXCEPTION WHEN OTHERS THEN PERFORM tw.crashed('Only https', SQLERRM); END $$;

DO $$ DECLARE h uuid; c uuid; f uuid; w uuid; r uuid; BEGIN
  RAISE NOTICE 'Form answers and finished workflows';
  PERFORM tw.reset();
  h := tw.hook(ARRAY['form.submitted', 'workflow.completed']);
  c := tw.contact('Eli');
  INSERT INTO forms(workspace_id, name, type, status, definition) VALUES (tw.ws(), 'Quote request', 'form', 'published',
    to_jsonb('{"elements": {"e1": {"field": {"fieldId": "f1", "label": "Budget"}}}}'::text)) RETURNING id INTO f;
  INSERT INTO form_submissions(workspace_id, form_id, contact_id, answers) VALUES (tw.ws(), f, c, '{"f1": "5000"}');
  PERFORM tw.check((SELECT payload->'data'->'answers'->>'Budget' = '5000' AND payload->'data'->'form'->>'name' = 'Quote request'
    FROM webhook_deliveries WHERE webhook_id = h AND event = 'form.submitted'), 'form.submitted carries each answer under its question');
  INSERT INTO workflows(workspace_id, name, status, trigger_type, definition) VALUES (tw.ws(), 'Onboarding', 'active', 'manual', '{"triggers": [], "start": "", "graph": {}}') RETURNING id INTO w;
  INSERT INTO wf_runs(workflow_id, workspace_id, contact_id) VALUES (w, tw.ws(), c) RETURNING id INTO r;
  UPDATE wf_runs SET status = 'completed', finished_at = now() WHERE id = r;
  PERFORM tw.check((SELECT payload->'data'->'workflow'->>'name' = 'Onboarding' FROM webhook_deliveries WHERE webhook_id = h AND event = 'workflow.completed'),
    'a finished workflow sends workflow.completed');
EXCEPTION WHEN OTHERS THEN PERFORM tw.crashed('Form answers and finished workflows', SQLERRM); END $$;

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM tw.failures; SELECT count(*) INTO p FROM tw.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM tw.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'webhooks: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'webhooks: all % checks passed', p;
END $$;
