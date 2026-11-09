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

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM tev.failures; SELECT count(*) INTO p FROM tev.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM tev.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'events: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'events: all % checks passed', p;
END $$;
