-- Event registration through registration types: an attendee type that confirms at once, a
-- performer type that takes applications, each with its own form; dates to be announced.

SET client_min_messages = notice;
CREATE SCHEMA IF NOT EXISTS tev;
CREATE TABLE IF NOT EXISTS tev.failures (name text, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS tev.passes (n int);
TRUNCATE tev.failures, tev.passes;

CREATE OR REPLACE FUNCTION tev.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(p_ok, false) THEN INSERT INTO tev.passes VALUES (1); RAISE NOTICE '  ✓ %', p_what;
  ELSE INSERT INTO tev.failures(name) VALUES (p_what); RAISE NOTICE '  ✗ %', p_what; END IF;
END $$;
CREATE OR REPLACE FUNCTION tev.crashed(p_case text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO tev.failures(name) VALUES (p_case || ': crashed: ' || p_err); RAISE NOTICE '  ✗ crashed: %', p_err; END $$;
-- The error a call raises, or 'ok'.
CREATE OR REPLACE FUNCTION tev.raises(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE OR REPLACE FUNCTION tev.ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'f0000000-0000-4000-8000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION tev.owner() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'f0000000-0000-4000-8000-0000000000a1'::uuid $$;
INSERT INTO auth.users(id, email) VALUES (tev.owner(), 'events-owner@example.com') ON CONFLICT DO NOTHING;
INSERT INTO workspaces(id, name, slug, owner_id) VALUES (tev.ws(), 'Dera Speaks', 'dera-speaks', tev.owner()) ON CONFLICT DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (tev.ws(), tev.owner(), 'owner') ON CONFLICT DO NOTHING;

-- A form: full name, email, phone (all saved to the contact) and a required consent box.
CREATE OR REPLACE FUNCTION tev.form(p_name text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO forms(workspace_id, name, type, status, definition) VALUES (tev.ws(), p_name, 'form', 'draft', to_jsonb(jsonb_build_object(
    'pages', '[]'::jsonb, 'sections', '{}'::jsonb,
    'elements', jsonb_build_object(
      'e1', jsonb_build_object('type', 'full_name', 'field', jsonb_build_object('fieldId', 'name', 'label', 'Full name', 'required', true, 'mappedContactField', 'full_name')),
      'e2', jsonb_build_object('type', 'email', 'field', jsonb_build_object('fieldId', 'email', 'label', 'Email', 'required', true, 'mappedContactField', 'email')),
      'e3', jsonb_build_object('type', 'phone', 'field', jsonb_build_object('fieldId', 'phone', 'label', 'Phone', 'required', true, 'mappedContactField', 'phone', 'phoneCountry', 'NG')),
      'e4', jsonb_build_object('type', 'consent', 'field', jsonb_build_object('fieldId', 'ok', 'label', 'Consent', 'required', true))
    ))::text)) RETURNING id;
$$;
CREATE OR REPLACE FUNCTION tev.answers(p_name text, p_email text, p_phone text DEFAULT '+234 803 123 4567', p_ok text DEFAULT 'true') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('name', p_name, 'email', p_email, 'phone', p_phone, 'ok', p_ok)
$$;

CREATE OR REPLACE FUNCTION tev.reset() RETURNS void LANGUAGE plpgsql AS $$
DECLARE ev uuid;
BEGIN
  DELETE FROM events WHERE workspace_id = tev.ws();
  DELETE FROM forms WHERE workspace_id = tev.ws();
  DELETE FROM messages WHERE workspace_id = tev.ws();
  DELETE FROM contacts WHERE workspace_id = tev.ws();
  INSERT INTO events(workspace_id, created_by, slug, title, starts_at, ends_at, status, venue_name, city, tagline, programme)
  VALUES (tev.ws(), tev.owner(), 'unscathed', 'UNSCATHED', NULL, NULL, 'published', 'Light Nation', 'Port Harcourt', 'Words. Sound. Style.', ARRAY['Spoken Word', 'Music'])
  RETURNING id INTO ev;
  INSERT INTO event_tickets(event_id, name, slug, form_id, requires_approval, sort) VALUES
    (ev, 'Attendee', 'register', tev.form('Attendee form'), false, 0),
    (ev, 'Performer application', 'apply', tev.form('Performer form'), true, 1);
END $$;

DO $$ DECLARE r jsonb; reg event_registrations; BEGIN
  RAISE NOTICE 'An event with no date yet, and its registration page';
  PERFORM tev.reset();
  PERFORM tev.check((SELECT starts_at IS NULL FROM events WHERE slug = 'unscathed'), 'an event can be saved with its date to be announced');
  PERFORM tev.check(tev.raises($q$INSERT INTO events(workspace_id, slug, title, starts_at, status) VALUES (tev.ws(), 'half-date', 'Half', now(), 'draft')$q$) LIKE '%events_dates_together%',
    'but not with a start and no end');
  PERFORM tev.check(EXISTS (SELECT 1 FROM jsonb_array_elements(public_events()) x WHERE x->>'slug' = 'unscathed' AND x->'starts_at' = 'null'),
    'it is listed on the public events page');
  r := public_event_registration('unscathed', 'register');
  PERFORM tev.check(r->'type'->>'state' = 'open' AND r->'type'->>'name' = 'Attendee' AND r->'event'->>'tagline' = 'Words. Sound. Style.'
    AND r->'form'->'definition'->'elements'->'e2'->>'type' = 'email', 'the page gets the event, the type (open) and its form');
  PERFORM tev.check(public_event_registration('unscathed', 'nope')->'type' = 'null', 'an unknown type: no form');
  PERFORM tev.check((SELECT bool_and(x ? 'slug' AND x ? 'requires_approval') FROM jsonb_array_elements(public_event('unscathed')->'tickets') x), 'the event lists its registration types');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('No date yet', SQLERRM); END $$;

DO $$ DECLARE r jsonb; reg event_registrations; sub form_submissions; BEGIN
  RAISE NOTICE 'Attendees are confirmed at once, with a ticket code';
  PERFORM tev.reset();
  r := event_register('unscathed', 'register', tev.answers('Ada Obi', 'Ada@Example.com'));
  SELECT * INTO reg FROM event_registrations WHERE email = 'ada@example.com';
  PERFORM tev.check(r->>'status' = 'confirmed' AND r->>'qr_token' IS NOT NULL AND r->>'ticket_code' ~ '^UNS-[A-HJ-NP-Z2-9]{4}$', 'confirmed, with a QR token and a code like UNS-7K4Q');
  PERFORM tev.check(reg.first_name = 'Ada' AND reg.last_name = 'Obi' AND reg.phone = '+234 803 123 4567' AND reg.consent_at IS NOT NULL,
    'name split from the full name, phone kept, consent time saved');
  SELECT * INTO sub FROM form_submissions WHERE id = reg.form_submission_id;
  PERFORM tev.check(sub.answers->>'email' = 'Ada@Example.com' AND sub.source = 'event' AND sub.meta->>'registration_type' = 'Attendee', 'the answers are in the form''s responses');
  PERFORM tev.check(EXISTS (SELECT 1 FROM contacts WHERE id = reg.contact_id AND email = 'ada@example.com' AND source = 'event'), 'and the person is a contact');
  r := event_register('unscathed', 'register', tev.answers('Ada Again', 'ada@example.com'));
  PERFORM tev.check(r->>'status' = 'duplicate' AND (SELECT count(*) FROM event_registrations WHERE lower(email) = 'ada@example.com') = 1, 'the same email again: no duplicate');
  r := event_register('unscathed', 'register', tev.answers('Ada Phone', 'other@example.com', '0803 123 4567'));
  PERFORM tev.check(r->>'status' = 'duplicate', 'the same phone again: no duplicate either');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('Attendees', SQLERRM); END $$;

DO $$ DECLARE r jsonb; BEGIN
  RAISE NOTICE 'Performers apply, and get no ticket until selected';
  PERFORM tev.reset();
  PERFORM event_register('unscathed', 'register', tev.answers('Bo Eze', 'bo@example.com'));
  r := event_register('unscathed', 'apply', tev.answers('Bo Eze', 'bo@example.com'));
  PERFORM tev.check(r->>'status' = 'applied' AND r->'qr_token' = 'null' AND r->'ticket_code' = 'null', 'an application: no ticket, no code');
  PERFORM tev.check((SELECT count(*) FROM event_registrations WHERE email = 'bo@example.com') = 2, 'the same person can attend and apply');
  PERFORM tev.check((public_event('unscathed')->>'registered')::int = 1, 'applications don''t count as places taken');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('Performers', SQLERRM); END $$;

DO $$ BEGIN
  RAISE NOTICE 'Refusals';
  PERFORM tev.reset();
  PERFORM tev.check(tev.raises($q$SELECT event_register('unscathed', 'register', tev.answers('Cy', 'cy@example.com', '+234 803 555 0000', ''))$q$) = 'consent_required', 'no consent: refused');
  PERFORM tev.check(tev.raises($q$SELECT event_register('unscathed', 'register', tev.answers('Cy', 'not-an-email'))$q$) = 'email_invalid', 'a bad email: refused');
  PERFORM tev.check(tev.raises($q$SELECT event_register('unscathed', 'register', tev.answers('', 'cy@example.com'))$q$) = 'name_required', 'no name: refused');
  UPDATE event_tickets SET opens_at = now() + interval '1 day' WHERE slug = 'register';
  PERFORM tev.check(tev.raises($q$SELECT event_register('unscathed', 'register', tev.answers('Cy', 'cy@example.com'))$q$) = 'not_open_yet'
    AND public_event_registration('unscathed', 'register')->'type'->>'state' = 'not_open_yet', 'before it opens: not yet');
  UPDATE event_tickets SET opens_at = NULL, closes_at = now() - interval '1 minute' WHERE slug = 'register';
  PERFORM tev.check(tev.raises($q$SELECT event_register('unscathed', 'register', tev.answers('Cy', 'cy@example.com'))$q$) = 'closed', 'after it closes: closed');
  UPDATE event_tickets SET closes_at = NULL, capacity = 1 WHERE slug = 'register';
  PERFORM event_register('unscathed', 'register', tev.answers('Di', 'di@example.com', '+234 803 111 1111'));
  PERFORM tev.check(tev.raises($q$SELECT event_register('unscathed', 'register', tev.answers('Ed', 'ed@example.com', '+234 803 222 2222'))$q$) = 'full'
    AND public_event_registration('unscathed', 'register')->'type'->>'state' = 'full', 'when every place is taken: full');
  UPDATE event_tickets SET capacity = NULL, status = 'draft' WHERE slug = 'register';
  PERFORM tev.check(public_event_registration('unscathed', 'register')->'type' = 'null', 'a draft type isn''t shown');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('Refusals', SQLERRM); END $$;

DO $$ DECLARE ev uuid; tk uuid; r jsonb; BEGIN
  RAISE NOTICE 'Events made before still work';
  PERFORM tev.reset();
  INSERT INTO events(workspace_id, slug, title, starts_at, ends_at, status) VALUES (tev.ws(), 'old-style', 'Old style', now() + interval '1 day', now() + interval '1 day 2 hours', 'published') RETURNING id INTO ev;
  INSERT INTO event_tickets(event_id, name) VALUES (ev, 'General') RETURNING id INTO tk;
  r := register_for_event('old-style', tk, 'Fe', 'Lix', 'fe@example.com', '', '{}');
  PERFORM tev.check(r->>'pin' ~ '^\d{6}$' AND EXISTS (SELECT 1 FROM event_registrations WHERE email = 'fe@example.com' AND status = 'confirmed'), 'the old registration (PIN and QR) still works');
  PERFORM tev.check(public_ticket((r->>'qr_token')::uuid)->>'ticket_name' = 'General', 'and its ticket page');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('Events made before', SQLERRM); END $$;

DO $$ DECLARE r jsonb; reg event_registrations; m messages; sig text; BEGIN
  RAISE NOTICE 'Signed tickets and the confirmation email';
  PERFORM tev.reset();
  DELETE FROM email_accounts WHERE workspace_id = tev.ws();
  r := event_register('unscathed', 'register', tev.answers('Ada Obi', 'ada@example.com'));
  PERFORM tev.check(r->>'emailed' = 'false' AND NOT EXISTS (SELECT 1 FROM messages WHERE to_address = 'ada@example.com'), 'no email account connected: registered, nothing emailed (and it says so)');
  INSERT INTO email_accounts(workspace_id, user_id, email, display_name) VALUES (tev.ws(), tev.owner(), 'hello@derasperks.example', 'Dera Speaks');
  UPDATE events SET brand = '{"primary": "#E9472B"}', footer_line = 'Where the Spirit of the Lord is, there is freedom — 2 Corinthians 3:17',
    email_templates = '{"confirmed": {"subject": "See you at {{event}}, {{first_name}}"}}' WHERE slug = 'unscathed';
  r := event_register('unscathed', 'register', tev.answers('Bo Eze', 'bo@example.com', '+234 803 222 3333'));
  SELECT * INTO reg FROM event_registrations WHERE email = 'bo@example.com';
  SELECT * INTO m FROM messages WHERE to_address = 'bo@example.com';
  PERFORM tev.check(r->>'emailed' = 'true' AND m.status = 'queued' AND m.form_submission_id = reg.form_submission_id AND m.email_account_id IS NOT NULL,
    'with one: the ticket email is queued for the mailer');
  PERFORM tev.check(m.subject = 'See you at UNSCATHED, Bo' AND m.body LIKE 'Hi Bo,%' AND m.body LIKE '%' || reg.ticket_code || '%', 'the organiser''s wording, with the name and the code filled in');
  PERFORM tev.check(m.body_html LIKE '%#E9472B%' AND m.body_html LIKE '%2 Corinthians 3:17%' AND m.body_html LIKE '%/api/qr/' || reg.qr_token || '.png?v=%',
    'branded, with the footer line and the QR picture');
  sig := split_part(r->>'qr_url', '?v=', 2);
  PERFORM tev.check(r->>'qr_url' LIKE '%/e/ticket/' || reg.qr_token || '?v=%' AND length(sig) = 16, 'the QR holds the ticket link and a signature');
  PERFORM tev.check(ticket_sig_ok(reg.qr_token, sig) AND NOT ticket_sig_ok(reg.qr_token, '0000000000000000') AND NOT ticket_sig_ok(gen_random_uuid(), sig),
    'the signature checks out, and a changed one or another ticket doesn''t');
  PERFORM tev.check(ticket_qr_text(reg.qr_token, sig) = r->>'qr_url' AND ticket_qr_text(reg.qr_token, 'nope') IS NULL, 'the QR picture is only made for a signed ticket');
  PERFORM tev.check((public_ticket(reg.qr_token)->>'qr_url') = r->>'qr_url' AND public_ticket(reg.qr_token)->>'footer_line' LIKE 'Where the Spirit%', 'the ticket page gets the signed link and the footer');
  PERFORM tev.check(NOT has_function_privilege('anon', 'ticket_sig(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'event_email(uuid, text)', 'EXECUTE'),
    'nobody outside can sign tickets or send emails');
  r := event_register('unscathed', 'apply', tev.answers('Bo Eze', 'bo@example.com', '+234 803 222 3333'));
  PERFORM tev.check(EXISTS (SELECT 1 FROM messages WHERE to_address = 'bo@example.com' AND subject = 'We''ve got your application: UNSCATHED' AND body_html NOT LIKE '%/api/qr/%'),
    'an application gets the "received" email, without a ticket');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('Signed tickets and email', SQLERRM); END $$;

DO $$ DECLARE r jsonb; n int; BEGIN
  RAISE NOTICE 'Resend my ticket';
  PERFORM tev.reset();
  DELETE FROM email_accounts WHERE workspace_id = tev.ws();
  INSERT INTO email_accounts(workspace_id, user_id, email) VALUES (tev.ws(), tev.owner(), 'hello@derasperks.example');
  PERFORM event_register('unscathed', 'register', tev.answers('Cy Ola', 'cy@example.com'));
  SELECT count(*) INTO n FROM messages WHERE to_address = 'cy@example.com';
  r := event_resend_ticket('unscathed', 'CY@example.com');
  PERFORM tev.check(r->>'ok' = 'true' AND (SELECT count(*) FROM messages WHERE to_address = 'cy@example.com') = n, 'asking again within ten minutes sends nothing more');
  UPDATE event_registrations SET last_email_at = now() - interval '11 minutes' WHERE email = 'cy@example.com';
  PERFORM event_resend_ticket('unscathed', 'cy@example.com');
  PERFORM tev.check((SELECT count(*) FROM messages WHERE to_address = 'cy@example.com') = n + 1, 'later, the ticket is sent again');
  r := event_resend_ticket('unscathed', 'nobody@example.com');
  PERFORM tev.check(r = '{"ok": true}'::jsonb AND NOT EXISTS (SELECT 1 FROM messages WHERE to_address = 'nobody@example.com'), 'an unknown email gets the same answer, and nothing is sent');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('Resend', SQLERRM); END $$;

DO $$ DECLARE rid uuid; r jsonb; reg event_registrations; BEGIN
  RAISE NOTICE 'Selecting and declining applicants';
  PERFORM tev.reset();
  DELETE FROM email_accounts WHERE workspace_id = tev.ws();
  INSERT INTO email_accounts(workspace_id, user_id, email) VALUES (tev.ws(), tev.owner(), 'hello@derasperks.example');
  PERFORM event_register('unscathed', 'apply', tev.answers('Di Eke', 'di@example.com', '+234 803 444 5555'));
  PERFORM event_register('unscathed', 'apply', tev.answers('Ed Uche', 'ed@example.com', '+234 803 666 7777'));
  SELECT id INTO rid FROM event_registrations WHERE email = 'di@example.com';
  BEGIN
    PERFORM event_set_registration_status(rid, 'selected');
    PERFORM tev.check(false, 'someone signed out can''t select');
  EXCEPTION WHEN OTHERS THEN PERFORM tev.check(SQLERRM = 'not_allowed', 'someone signed out can''t select');
  END;
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  PERFORM event_set_registration_status(rid, 'shortlisted');
  r := event_set_registration_status(rid, 'selected');
  SELECT * INTO reg FROM event_registrations WHERE id = rid;
  PERFORM tev.check(reg.status = 'selected' AND reg.ticket_code ~ '^UNS-' AND public_ticket(reg.qr_token)->>'qr_url' IS NOT NULL, 'selected: they get a ticket code and a signed ticket');
  PERFORM tev.check(EXISTS (SELECT 1 FROM messages WHERE to_address = 'di@example.com' AND subject = 'You''ve been selected: UNSCATHED' AND body_html LIKE '%' || reg.ticket_code || '%'),
    'and the "selected" email with their ticket');
  PERFORM event_set_registration_status((SELECT id FROM event_registrations WHERE email = 'ed@example.com'), 'declined');
  PERFORM tev.check(EXISTS (SELECT 1 FROM messages WHERE to_address = 'ed@example.com' AND subject = 'About your application: UNSCATHED')
    AND (SELECT ticket_code IS NULL FROM event_registrations WHERE email = 'ed@example.com'), 'declined: the kind note, and no ticket');
  UPDATE event_tickets SET capacity = 1 WHERE slug = 'apply';
  PERFORM event_set_registration_status((SELECT id FROM event_registrations WHERE email = 'ed@example.com'), 'shortlisted');
  PERFORM tev.check(tev.raises($q$SELECT event_set_registration_status((SELECT id FROM event_registrations WHERE email = 'ed@example.com'), 'selected')$q$) = 'full',
    'selecting past the capacity is refused');
  PERFORM set_config('request.jwt.claim.sub', '', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM tev.crashed('Selecting', SQLERRM); END $$;

DO $$ DECLARE r jsonb; ada event_registrations; bo event_registrations; other uuid; staff uuid := 'f0000000-0000-4000-8000-0000000000b2'; outsider uuid := 'f0000000-0000-4000-8000-0000000000b3'; BEGIN
  RAISE NOTICE 'Checking guests in at the door';
  PERFORM tev.reset();
  INSERT INTO auth.users(id, email) VALUES (staff, 'door@example.com'), (outsider, 'outsider@example.com') ON CONFLICT DO NOTHING;
  INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (tev.ws(), staff, 'member'), (tev.ws(), outsider, 'member') ON CONFLICT DO NOTHING;
  PERFORM event_register('unscathed', 'register', tev.answers('Ada Obi', 'ada@example.com'));
  PERFORM event_register('unscathed', 'apply', tev.answers('Bo Eze', 'bo@example.com', '+234 803 222 3333'));
  SELECT * INTO ada FROM event_registrations WHERE email = 'ada@example.com';
  SELECT * INTO bo FROM event_registrations WHERE email = 'bo@example.com';
  INSERT INTO events(workspace_id, created_by, slug, title, status) VALUES (tev.ws(), tev.owner(), 'other-night', 'Other night', 'published') RETURNING id INTO other;

  -- Staff only.
  PERFORM tev.check(tev.raises(format('SELECT event_check_in(%L, %L)', ada.event_id, ticket_qr_url(ada.qr_token))) = 'not_allowed', 'signed out: the scanner refuses');
  PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
  PERFORM tev.check(event_checkin_state(ada.event_id) = '{"allowed": false}'::jsonb
    AND tev.raises(format('SELECT event_check_in(%L, %L)', ada.event_id, ticket_qr_url(ada.qr_token))) = 'not_allowed', 'a member who isn''t on the check-in team can''t open it or check anyone in');
  PERFORM tev.check(tev.raises(format('SELECT event_staff_set(%L, %L, true)', ada.event_id, outsider)) = 'not_allowed', 'nor add themselves to the team');
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  PERFORM event_staff_set(ada.event_id, staff, true);
  PERFORM tev.check(EXISTS (SELECT 1 FROM jsonb_array_elements(event_staff_list(ada.event_id)) x WHERE x->>'email' = 'door@example.com' AND (x->>'on_team')::boolean),
    'the organiser adds someone to the check-in team');

  PERFORM set_config('request.jwt.claim.sub', staff::text, true);
  r := event_checkin_state(ada.event_id);
  PERFORM tev.check((r->>'allowed')::boolean AND NOT (r->>'organiser')::boolean AND (r->>'expected')::int = 1 AND (r->>'checked_in')::int = 0, 'the team member opens the scanner: 0 of 1 in');
  r := event_check_in(ada.event_id, ticket_qr_url(ada.qr_token));
  PERFORM tev.check(r->>'result' = 'success' AND r->'person'->>'name' = 'Ada Obi' AND r->'person'->>'type_name' = 'Attendee' AND r->'person'->>'ticket_code' = ada.ticket_code,
    'scan the attendee: green, with name, type and code');
  r := event_check_in(ada.event_id, ticket_qr_url(ada.qr_token));
  PERFORM tev.check(r->>'result' = 'already_checked_in' AND r->'person'->>'checked_in_at' IS NOT NULL, 'scan again: amber, with the first check-in time');
  PERFORM tev.check(event_check_in(bo.event_id, ticket_qr_url(bo.qr_token))->>'result' = 'not_eligible', 'an application not selected: red');
  -- A real ticket for another event, scanned at this door.
  INSERT INTO event_registrations(event_id, first_name, last_name, email, status, pin) VALUES (other, 'Cy', 'Ola', 'cy@example.com', 'confirmed', '999999') RETURNING * INTO bo;
  r := event_check_in(ada.event_id, ticket_qr_url(bo.qr_token));
  PERFORM tev.check(r->>'result' = 'invalid' AND r->>'reason' = 'other_event' AND r->'person' IS NULL, 'another event''s ticket: red, and nothing about the person');
  PERFORM tev.check(event_check_in(ada.event_id, replace(ticket_qr_url(ada.qr_token), '?v=', '?v=0'))->>'result' = 'invalid'
    AND event_check_in(ada.event_id, wf_app_url() || '/e/ticket/' || ada.qr_token)->>'result' = 'invalid', 'a tampered or unsigned code: red');
  PERFORM tev.check(event_check_in(ada.event_id, 'hello')->>'result' = 'invalid', 'any other text: red');

  -- Manual search, check-in by person or code, and undo.
  PERFORM tev.check(jsonb_array_length(event_checkin_search(ada.event_id, 'ada')) = 1 AND jsonb_array_length(event_checkin_search(ada.event_id, lower(ada.ticket_code))) = 1
    AND jsonb_array_length(event_checkin_search(ada.event_id, '08031234567')) = 1 AND jsonb_array_length(event_checkin_search(ada.event_id, 'cy')) = 0,
    'search finds by name, ticket code and local phone number, only in this event');
  r := event_undo_check_in(ada.event_id, ada.id);
  PERFORM tev.check((r->>'ok')::boolean AND (SELECT checked_in_at IS NULL FROM event_registrations WHERE id = ada.id)
    AND EXISTS (SELECT 1 FROM event_checkins WHERE registration_id = ada.id AND result = 'undone' AND user_id = staff), 'undo clears the check-in and is logged');
  PERFORM tev.check(event_check_in(ada.event_id, ada.ticket_code)->>'result' = 'success', 'checked in again by typing the ticket code');
  PERFORM event_undo_check_in(ada.event_id, ada.id);
  r := event_check_in(ada.event_id, NULL, ada.id);
  PERFORM tev.check(r->>'result' = 'success' AND (SELECT checked_in_by = staff FROM event_registrations WHERE id = ada.id),
    'and from search with one tap, recording who');
  UPDATE event_registrations SET payment_status = 'unpaid', checked_in_at = NULL WHERE id = ada.id;
  r := event_check_in(ada.event_id, NULL, ada.id);
  PERFORM tev.check(r->>'result' = 'not_eligible' AND r->>'reason' = 'unpaid', 'an unpaid ticket: collect the money first');
  r := event_check_in(ada.event_id, NULL, ada.id, true);
  PERFORM tev.check(r->>'result' = 'success' AND (SELECT payment_status = 'paid' FROM event_registrations WHERE id = ada.id),
    'paid at the door: checked in and marked paid');
  PERFORM tev.check((SELECT array_agg(DISTINCT result ORDER BY result) FROM event_checkins WHERE event_id = ada.event_id) = ARRAY['already_checked_in', 'invalid', 'not_eligible', 'success', 'undone'],
    'every attempt is in the check-in log');
  PERFORM tev.check((SELECT bool_and(x->>'by' IS NOT NULL OR x->>'by' IS NULL) FROM jsonb_array_elements(event_checkin_log(ada.event_id)) x) AND jsonb_array_length(event_checkin_log(ada.event_id)) > 5,
    'the team can read the log');
  PERFORM tev.check(NOT has_function_privilege('anon', 'event_check_in(uuid, text, uuid, boolean)', 'EXECUTE'), 'the check-in function is closed to visitors');
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  PERFORM event_staff_set(ada.event_id, staff, false);
  PERFORM set_config('request.jwt.claim.sub', staff::text, true);
  PERFORM tev.check(tev.raises(format('SELECT event_checkin_search(%L, %L)', ada.event_id, 'ada')) = 'not_allowed', 'taken off the team: no more access');
  PERFORM set_config('request.jwt.claim.sub', '', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM tev.crashed('Check-in', SQLERRM); END $$;

DO $$ DECLARE r jsonb; ev uuid; att uuid; perf uuid; reg event_registrations; outsider uuid := 'f0000000-0000-4000-8000-0000000000b3'; BEGIN
  RAISE NOTICE 'The organiser''s dashboard: forms, adding by hand, sending tickets';
  PERFORM tev.reset();
  DELETE FROM email_accounts WHERE workspace_id = tev.ws();
  INSERT INTO email_accounts(workspace_id, user_id, email) VALUES (tev.ws(), tev.owner(), 'hello@derasperks.example');
  INSERT INTO auth.users(id, email) VALUES (outsider, 'outsider@example.com') ON CONFLICT DO NOTHING;
  INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (tev.ws(), outsider, 'member') ON CONFLICT DO NOTHING;
  SELECT id INTO ev FROM events WHERE slug = 'unscathed';
  SELECT id INTO att FROM event_tickets WHERE event_id = ev AND slug = 'register';
  SELECT id INTO perf FROM event_tickets WHERE event_id = ev AND slug = 'apply';

  PERFORM tev.check(tev.raises(format('SELECT event_registration_forms(%L)', ev)) = 'not_allowed', 'signed out: no forms');
  PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
  PERFORM tev.check(tev.raises(format('SELECT event_add_registration(%L, %L, %L, %L, %L)', ev, att, 'Gate', 'Crasher', 'gate@example.com')) = 'not_allowed',
    'a member without Events can''t add people');
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  r := event_registration_forms(ev);
  PERFORM tev.check(jsonb_array_length(r) = 2 AND r->0->'definition'->'elements'->'e2'->'field'->>'label' = 'Email', 'the organiser gets each type''s questions');

  r := event_add_registration(ev, att, 'Wale', 'Adeyemi', 'Wale@Example.com', '0803 999 0000');
  SELECT * INTO reg FROM event_registrations WHERE id = (r->>'id')::uuid;
  PERFORM tev.check(reg.status = 'confirmed' AND reg.ticket_code ~ '^UNS-' AND reg.email = 'wale@example.com' AND reg.contact_id IS NOT NULL, 'a walk-in: confirmed, with a ticket code and a contact');
  PERFORM tev.check((r->>'emailed')::boolean AND EXISTS (SELECT 1 FROM messages WHERE to_address = 'wale@example.com' AND subject LIKE 'You''re in%'), 'and their ticket is emailed');
  PERFORM tev.check(tev.raises(format('SELECT event_add_registration(%L, %L, %L, %L, %L)', ev, att, 'Wale', 'A', 'wale@example.com')) = 'duplicate', 'the same email twice is refused');
  r := event_add_registration(ev, perf, 'Ife', 'Okon', 'ife@example.com', NULL, false);
  SELECT * INTO reg FROM event_registrations WHERE id = (r->>'id')::uuid;
  PERFORM tev.check(reg.status = 'selected' AND reg.ticket_code IS NOT NULL AND NOT (r->>'emailed')::boolean AND NOT EXISTS (SELECT 1 FROM messages WHERE to_address = 'ife@example.com'),
    'an invited performer is selected straight away; nothing sent when not asked');
  r := event_send_ticket(reg.id);
  PERFORM tev.check((r->>'sent')::boolean AND EXISTS (SELECT 1 FROM messages WHERE to_address = 'ife@example.com' AND subject = 'You''ve been selected: UNSCATHED'), 'sending the ticket later works');
  PERFORM tev.check(tev.raises(format('SELECT event_send_ticket(%L)', reg.id)) = 'too_soon', 'but not twice in a minute');
  UPDATE event_tickets SET capacity = 2 WHERE id = att;
  PERFORM event_add_registration(ev, att, 'Two', 'Seats', 'two@example.com', NULL, false);
  PERFORM tev.check(tev.raises(format('SELECT event_add_registration(%L, %L, %L, %L, %L)', ev, att, 'Three', 'Seats', 'three@example.com')) = 'full', 'a full type is refused');
  PERFORM tev.check((event_add_registration(ev, att, 'Three', 'Seats', 'three@example.com', NULL, false, true)->>'status') = 'confirmed', 'unless the organiser adds them anyway');
  PERFORM tev.check(EXISTS (SELECT 1 FROM audit_logs WHERE action = 'registration_added'), 'adding is in the audit log');
  PERFORM set_config('request.jwt.claim.sub', '', true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM tev.crashed('Dashboard', SQLERRM); END $$;

DO $$ DECLARE ada event_registrations; n int; ev uuid; BEGIN
  RAISE NOTICE 'The 24-hour reminder';
  PERFORM tev.reset();
  DELETE FROM email_accounts WHERE workspace_id = tev.ws();
  INSERT INTO email_accounts(workspace_id, user_id, email, display_name) VALUES (tev.ws(), tev.owner(), 'hello@derasperks.example', 'Dera Speaks');
  PERFORM event_register('unscathed', 'register', tev.answers('Ada Obi', 'ada@example.com'));
  PERFORM event_register('unscathed', 'apply', tev.answers('Bo Eze', 'bo@example.com', '+234 803 222 3333'));
  -- They registered a few days ago.
  UPDATE event_registrations SET created_at = now() - interval '3 days';
  DELETE FROM messages WHERE workspace_id = tev.ws();
  SELECT id INTO ev FROM events WHERE slug = 'unscathed';

  PERFORM tev.check(event_send_reminders() = 0, 'date to be announced: no reminder');
  UPDATE events SET starts_at = now() + interval '3 days', ends_at = now() + interval '3 days 4 hours' WHERE id = ev;
  PERFORM tev.check(event_send_reminders() = 0, 'three days away: not yet');
  UPDATE events SET starts_at = now() + interval '20 hours', ends_at = now() + interval '24 hours' WHERE id = ev;
  n := event_send_reminders();
  SELECT * INTO ada FROM event_registrations WHERE email = 'ada@example.com';
  PERFORM tev.check(n = 1 AND EXISTS (SELECT 1 FROM messages WHERE to_address = 'ada@example.com' AND subject = 'Tomorrow: UNSCATHED'
      AND body LIKE '%' || ada.ticket_code || '%' AND body_html LIKE '%/api/qr/' || ada.qr_token || '.png?v=%' AND status = 'queued'),
    'the day before: one reminder, with the ticket and its QR');
  PERFORM tev.check(NOT EXISTS (SELECT 1 FROM messages WHERE to_address = 'bo@example.com'), 'an applicant who isn''t selected gets no reminder');
  PERFORM tev.check(event_send_reminders() = 0 AND (SELECT count(*) FROM messages WHERE to_address = 'ada@example.com') = 1, 'only once');
  UPDATE events SET starts_at = now() + interval '22 hours', ends_at = now() + interval '26 hours' WHERE id = ev;
  PERFORM tev.check(event_send_reminders() = 1, 'the event moved: reminded of the new time');

  PERFORM event_register('unscathed', 'register', tev.answers('Cy Late', 'cy@example.com', '+234 803 444 4444'));
  PERFORM event_register('unscathed', 'register', tev.answers('Di Door', 'di@example.com', '+234 803 555 5555'));
  UPDATE event_registrations SET created_at = now() - interval '3 days', checked_in_at = now() WHERE email = 'di@example.com';
  UPDATE events SET starts_at = now() + interval '23 hours' WHERE id = ev;
  DELETE FROM messages WHERE workspace_id = tev.ws();
  n := event_send_reminders();
  PERFORM tev.check(n = 1 AND EXISTS (SELECT 1 FROM messages WHERE to_address = 'ada@example.com')
      AND NOT EXISTS (SELECT 1 FROM messages WHERE to_address IN ('cy@example.com', 'di@example.com')),
    'not for someone who registered in the last day, nor someone already checked in');

  UPDATE events SET starts_at = now() + interval '21 hours', email_templates = '{"reminder": {"off": true}}' WHERE id = ev;
  PERFORM tev.check(event_send_reminders() = 0, 'the organiser turned the reminder off: nothing');
  UPDATE events SET email_templates = '{"reminder": {"subject": "See you tomorrow, {{first_name}}"}}' WHERE id = ev;
  DELETE FROM messages WHERE workspace_id = tev.ws();
  PERFORM event_send_reminders();
  PERFORM tev.check(EXISTS (SELECT 1 FROM messages WHERE to_address = 'ada@example.com' AND subject = 'See you tomorrow, Ada'), 'in the organiser''s words');
  DELETE FROM email_accounts WHERE workspace_id = tev.ws();
  UPDATE events SET starts_at = now() + interval '19 hours' WHERE id = ev;
  PERFORM tev.check(event_send_reminders() = 0 AND (SELECT reminder_for FROM event_registrations WHERE email = 'ada@example.com') <> now() + interval '19 hours',
    'no email account: nothing sent, and it isn''t marked as sent');
  PERFORM tev.check(NOT has_function_privilege('anon', 'event_send_reminders()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'event_send_reminders()', 'EXECUTE'),
    'only the scheduler runs it');
EXCEPTION WHEN OTHERS THEN PERFORM tev.crashed('Reminder', SQLERRM); END $$;

DO $$ DECLARE member uuid := 'f0000000-0000-4000-8000-0000000000c1'; n_member int; n_owner int; n_upd int; ev uuid; BEGIN
  RAISE NOTICE 'Registrations follow the Events section';
  PERFORM tev.reset();
  PERFORM event_register('unscathed', 'register', tev.answers('Ada Obi', 'ada@example.com'));
  SELECT id INTO ev FROM events WHERE slug = 'unscathed';
  INSERT INTO auth.users(id, email) VALUES (member, 'no-events@example.com') ON CONFLICT DO NOTHING;
  INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (tev.ws(), member, 'member') ON CONFLICT DO NOTHING;
  UPDATE workspace_members SET access = ARRAY['conversations'] WHERE workspace_id = tev.ws() AND user_id = member;

  PERFORM set_config('request.jwt.claim.sub', member::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_member FROM event_registrations;
  UPDATE event_registrations SET first_name = 'Changed' WHERE event_id = ev;
  GET DIAGNOSTICS n_upd = ROW_COUNT;
  RESET ROLE;
  PERFORM tev.check(n_member = 0 AND n_upd = 0 AND NOT EXISTS (SELECT 1 FROM event_registrations WHERE first_name = 'Changed'),
    'a member without Events can''t see or change who registered');
  PERFORM set_config('request.jwt.claim.sub', member::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_member FROM event_tickets;
  RESET ROLE;
  PERFORM tev.check(n_member = 0, 'nor the registration types');

  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_owner FROM event_registrations;
  RESET ROLE;
  PERFORM tev.check(n_owner = 1, 'the organiser still sees them');
  UPDATE workspace_members SET access = ARRAY['conversations', 'events'] WHERE workspace_id = tev.ws() AND user_id = member;
  PERFORM set_config('request.jwt.claim.sub', member::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n_member FROM event_registrations;
  RESET ROLE;
  PERFORM tev.check(n_member = 1, 'and so does a member once Events is switched on for them');
  PERFORM set_config('request.jwt.claim.sub', '', true);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM tev.crashed('Registration privacy', SQLERRM); END $$;

DO $$ DECLARE i int; r jsonb; n int; ev uuid; att uuid; BEGIN
  RAISE NOTICE 'Limits per visitor';
  PERFORM tev.reset();
  DELETE FROM ev_private.hits;
  INSERT INTO email_accounts(workspace_id, user_id, email, display_name) SELECT tev.ws(), tev.owner(), 'hello@derasperks.example', 'Dera Speaks'
    WHERE NOT EXISTS (SELECT 1 FROM email_accounts WHERE workspace_id = tev.ws());
  PERFORM set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', true);
  FOR i IN 1..20 LOOP
    PERFORM event_register('unscathed', 'register', tev.answers('Guest ' || i, 'guest' || i || '@example.com', '+234 803 100 ' || lpad(i::text, 4, '0')));
  END LOOP;
  PERFORM tev.check((SELECT count(*) FROM event_registrations WHERE email LIKE 'guest%') = 20, 'one address can register 20 times in ten minutes');
  PERFORM tev.check(tev.raises($q$SELECT event_register('unscathed', 'register', tev.answers('Guest 21', 'guest21@example.com', '+234 803 100 0021'))$q$) = 'busy',
    'the 21st is asked to wait');
  PERFORM set_config('request.headers', '{"x-forwarded-for": "198.51.100.7"}', true);
  r := event_register('unscathed', 'register', tev.answers('Guest 21', 'guest21@example.com', '+234 803 100 0021'));
  PERFORM tev.check(r->>'status' = 'confirmed', 'someone at another address isn''t held up');

  PERFORM set_config('request.headers', '{"x-forwarded-for": "203.0.113.9"}', true);
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  SELECT id INTO ev FROM events WHERE slug = 'unscathed';
  SELECT id INTO att FROM event_tickets WHERE event_id = ev AND slug = 'register';
  r := event_add_registration(ev, att, 'Walk', 'In', 'walkin@example.com', NULL, false);
  PERFORM tev.check(r->>'status' = 'confirmed', 'the organiser adding people isn''t limited');
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE event_registrations SET last_email_at = NULL;
  DELETE FROM messages WHERE workspace_id = tev.ws();
  PERFORM set_config('request.headers', '{"x-forwarded-for": "192.0.2.50"}', true);
  FOR i IN 1..10 LOOP PERFORM event_resend_ticket('unscathed', 'nobody' || i || '@example.com'); END LOOP;
  r := event_resend_ticket('unscathed', 'guest1@example.com');
  n := (SELECT count(*) FROM messages WHERE to_address = 'guest1@example.com');
  PERFORM tev.check(r = '{"ok": true}'::jsonb AND n = 0, 'after 10 asks from one address: the same answer, but nothing is sent');
  PERFORM set_config('request.headers', '{"x-forwarded-for": "192.0.2.51"}', true);
  r := event_resend_ticket('unscathed', 'guest1@example.com');
  PERFORM tev.check((SELECT count(*) FROM messages WHERE to_address = 'guest1@example.com') = 1, 'from another address the ticket is sent');
  PERFORM set_config('request.headers', '', true);
  PERFORM tev.check(NOT has_table_privilege('anon', 'ev_private.hits', 'SELECT') AND NOT has_function_privilege('anon', 'event_visitor_allowed(text, int, interval)', 'EXECUTE'),
    'the counts are private');
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.headers', '', true); PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM tev.crashed('Limits', SQLERRM); END $$;

DO $$ DECLARE r jsonb; ada event_registrations; bo event_registrations; pass jsonb; tok uuid; other uuid; other_reg event_registrations; outsider uuid := 'f0000000-0000-4000-8000-0000000000b3'; BEGIN
  RAISE NOTICE 'Door passes: volunteers check guests in with their phone camera, no account';
  PERFORM tev.reset();
  INSERT INTO auth.users(id, email) VALUES (outsider, 'outsider@example.com') ON CONFLICT DO NOTHING;
  INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (tev.ws(), outsider, 'member') ON CONFLICT DO NOTHING;
  PERFORM event_register('unscathed', 'register', tev.answers('Ada Obi', 'ada@example.com'));
  PERFORM event_register('unscathed', 'apply', tev.answers('Bo Eze', 'bo@example.com', '+234 803 222 3333'));
  SELECT * INTO ada FROM event_registrations WHERE email = 'ada@example.com';
  SELECT * INTO bo FROM event_registrations WHERE email = 'bo@example.com';
  INSERT INTO email_accounts(workspace_id, user_id, email) VALUES (tev.ws(), tev.owner(), 'hello@derasperks.example') ON CONFLICT DO NOTHING;

  -- Only organisers add passes.
  PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
  PERFORM tev.check(tev.raises(format('SELECT event_door_pass_add(%L, %L, %L)', ada.event_id, 'Me', 'me@example.com')) = 'not_allowed', 'a member without Events can''t add a door scanner');
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  pass := event_door_pass_add(ada.event_id, 'Chidi Okafor', 'Chidi@Example.com');
  tok := (regexp_match(pass->>'link', '/door/([0-9a-f-]{36})$'))[1]::uuid;
  PERFORM tev.check(tok IS NOT NULL AND (pass->>'emailed')::boolean, 'the organiser adds a door scanner: a pass link, emailed');
  PERFORM tev.check(EXISTS (SELECT 1 FROM messages WHERE to_address = 'chidi@example.com' AND event_door_pass_id IS NOT NULL AND status = 'queued' AND body LIKE '%/door/' || tok || '%'),
    'the email carries the pass link');
  PERFORM tev.check(tev.raises(format('SELECT event_door_pass_add(%L, %L, %L)', ada.event_id, 'Chidi', 'chidi@example.com')) = 'already_added', 'the same email can''t be added twice');
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- The phone, signed out.
  r := event_door_pass_info(tok);
  PERFORM tev.check((r->>'valid')::boolean AND r->>'title' = 'UNSCATHED' AND r->>'name' = 'Chidi Okafor', 'opening the pass shows the event and their name');
  PERFORM tev.check((event_door_pass_info(gen_random_uuid())->>'valid')::boolean = false, 'a made-up pass is not valid');
  r := event_door_check_in(tok, ticket_qr_url(ada.qr_token));
  PERFORM tev.check(r->>'result' = 'success' AND r->'person'->>'name' = 'Ada Obi' AND r->'person'->>'checked_in_by' = 'Chidi Okafor', 'scanning a ticket with the pass: green, checked in by Chidi');
  PERFORM tev.check(event_door_check_in(tok, ticket_qr_url(ada.qr_token))->>'result' = 'already_checked_in', 'again: amber');
  PERFORM tev.check(event_door_check_in(tok, ticket_qr_url(bo.qr_token))->>'result' = 'not_eligible', 'an application not selected: red');
  PERFORM tev.check(event_door_check_in(tok, '/e/ticket/' || ada.qr_token)->>'reason' = 'unsigned', 'a ticket link without its signature: red');
  -- Another event's real ticket.
  INSERT INTO events(workspace_id, created_by, slug, title, status) VALUES (tev.ws(), tev.owner(), 'other-door', 'Other', 'published') RETURNING id INTO other;
  INSERT INTO event_registrations(event_id, first_name, last_name, email, status, pin) VALUES (other, 'Zee', 'Ola', 'zee@example.com', 'confirmed', '424242') RETURNING * INTO other_reg;
  PERFORM tev.check(event_door_check_in(tok, ticket_qr_url(other_reg.qr_token))->>'reason' = 'other_event', 'another event''s ticket: red');
  PERFORM tev.check((SELECT count(*) FROM event_checkins WHERE door_pass_id = (pass->>'id')::uuid) = 5, 'every scan is logged against the pass');
  r := event_door_undo(tok, ada.id);
  PERFORM tev.check((SELECT checked_in_at IS NULL AND checked_in_pass IS NULL FROM event_registrations WHERE id = ada.id), 'the pass can undo its own check-in');

  -- Removed: the phone stops at once.
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  PERFORM event_door_pass_revoke((pass->>'id')::uuid);
  PERFORM tev.check(jsonb_array_length(event_door_pass_list(ada.event_id)) = 1 AND (event_door_pass_list(ada.event_id)->0->>'revoked_at') IS NOT NULL, 'the organiser sees it removed');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM tev.check(tev.raises(format('SELECT event_door_check_in(%L, %L)', tok, ticket_qr_url(ada.qr_token))) = 'not_allowed', 'a removed pass can''t check anyone in');
  PERFORM tev.check((event_door_pass_info(tok)->>'valid')::boolean = false, 'and its page says so');
  -- After the event: passes stop.
  PERFORM set_config('request.jwt.claim.sub', tev.owner()::text, true);
  pass := event_door_pass_add(ada.event_id, 'Late', 'late@example.com');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE id = ada.event_id;
  PERFORM tev.check((event_door_pass_info((regexp_match(pass->>'link', '/door/([0-9a-f-]{36})$'))[1]::uuid)->>'valid')::boolean = false, 'a pass stops 12 hours after the event ends');
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub', '', true); PERFORM tev.crashed('Door passes', SQLERRM); END $$;

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM tev.failures; SELECT count(*) INTO p FROM tev.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM tev.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'events: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'events: all % checks passed', p;
END $$;
