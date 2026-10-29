-- Incoming contact links: another app POSTs a contact to a secret link; inbound_contact() adds or
-- updates them, tags them, keeps any message as a note, and the usual workflow events fire.

SET client_min_messages = notice;
CREATE SCHEMA IF NOT EXISTS ti;
CREATE TABLE IF NOT EXISTS ti.failures (name text, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS ti.passes (n int);
TRUNCATE ti.failures, ti.passes;

CREATE OR REPLACE FUNCTION ti.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(p_ok, false) THEN INSERT INTO ti.passes VALUES (1); RAISE NOTICE '  ✓ %', p_what;
  ELSE INSERT INTO ti.failures(name) VALUES (p_what); RAISE NOTICE '  ✗ %', p_what; END IF;
END $$;
CREATE OR REPLACE FUNCTION ti.crashed(p_case text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO ti.failures(name) VALUES (p_case || ': crashed: ' || p_err); RAISE NOTICE '  ✗ crashed: %', p_err; END $$;

CREATE OR REPLACE FUNCTION ti.ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'c0000000-0000-4000-8000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION ti.other_ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'c0000000-0000-4000-8000-000000000002'::uuid $$;
CREATE OR REPLACE FUNCTION ti.owner() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'c0000000-0000-4000-8000-0000000000a1'::uuid $$;
INSERT INTO auth.users(id, email) VALUES (ti.owner(), 'incoming-owner@example.com') ON CONFLICT DO NOTHING;
INSERT INTO workspaces(id, name, slug, owner_id) VALUES (ti.ws(), 'Incoming Co', 'incoming-co', ti.owner()), (ti.other_ws(), 'Other Co', 'other-co', ti.owner()) ON CONFLICT DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (ti.ws(), ti.owner(), 'owner') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION ti.reset() RETURNS void LANGUAGE sql AS $$
  DELETE FROM inbound_links WHERE workspace_id IN (ti.ws(), ti.other_ws());
  DELETE FROM contacts WHERE workspace_id IN (ti.ws(), ti.other_ws());
  DELETE FROM wf_events WHERE workspace_id IN (ti.ws(), ti.other_ws());
$$;
CREATE OR REPLACE FUNCTION ti.link(p_tags text[] DEFAULT '{}', p_ws uuid DEFAULT ti.ws()) RETURNS text LANGUAGE sql AS $$
  INSERT INTO inbound_links(workspace_id, name, tags) VALUES (p_ws, 'Website form', p_tags) RETURNING token;
$$;
CREATE OR REPLACE FUNCTION ti.tags(p_contact uuid) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(t.name ORDER BY t.name), '{}') FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = p_contact;
$$;

DO $$ DECLARE tok text; r jsonb; c contacts; BEGIN
  RAISE NOTICE 'A new person is added, with the link''s tags';
  PERFORM ti.reset();
  tok := ti.link(ARRAY['Lead']);
  r := inbound_contact(tok, '{"firstName": "Ada", "last_name": "Lovelace", "Email": "Ada@Example.com", "phone": "+44 7700 900123", "company": "Engines", "job_title": "Analyst", "birthday": "1990-12-10"}');
  SELECT * INTO c FROM contacts WHERE id = (r->>'contact_id')::uuid;
  PERFORM ti.check(r->>'ok' = 'true' AND r->>'status' = '201' AND r->>'created' = 'true', 'answers 201, created');
  PERFORM ti.check(c.workspace_id = ti.ws() AND c.first_name = 'Ada' AND c.last_name = 'Lovelace' AND c.email = 'ada@example.com' AND c.phone = '+44 7700 900123'
    AND c.company = 'Engines' AND c.job_title = 'Analyst' AND c.date_of_birth = '1990-12-10', 'every field is saved, whatever it is called');
  PERFORM ti.check(c.source = 'Website form', 'the source is the link''s name when none is sent');
  PERFORM ti.check(ti.tags(c.id) = ARRAY['Lead'], 'the link''s tag is added');
  PERFORM ti.check(EXISTS (SELECT 1 FROM wf_events WHERE contact_id = c.id AND type = 'contact_created'), 'workflows hear "contact created"');
  PERFORM ti.check(EXISTS (SELECT 1 FROM wf_events WHERE contact_id = c.id AND type = 'contact_tag' AND data->>'tag' = 'Lead'), 'and "tag added"');
  PERFORM ti.check((SELECT ok AND created AND contact_id = c.id FROM inbound_log WHERE link_id = (SELECT id FROM inbound_links WHERE token = tok)), 'the call is logged');
  PERFORM ti.check((SELECT last_used_at IS NOT NULL FROM inbound_links WHERE token = tok), 'the link shows when it was last used');
EXCEPTION WHEN OTHERS THEN PERFORM ti.crashed('A new person', SQLERRM); END $$;

DO $$ DECLARE tok text; r jsonb; cid uuid; c contacts; BEGIN
  RAISE NOTICE 'Someone already there is updated, found by email then phone';
  PERFORM ti.reset();
  tok := ti.link();
  INSERT INTO contacts(workspace_id, first_name, last_name, email, phone, company) VALUES (ti.ws(), 'Ben', 'Old', 'ben@example.com', '(555) 010-2000', 'Keep Ltd') RETURNING id INTO cid;
  r := inbound_contact(tok, '{"email": "BEN@example.com", "last_name": "New"}');
  SELECT * INTO c FROM contacts WHERE id = cid;
  PERFORM ti.check(r->>'status' = '200' AND r->>'created' = 'false' AND r->>'contact_id' = cid::text, 'same email: answers 200, the same person');
  PERFORM ti.check(c.last_name = 'New' AND c.first_name = 'Ben' AND c.company = 'Keep Ltd', 'what was sent changes, what wasn''t stays');
  r := inbound_contact(tok, '{"phone_number": "555-010-2000", "company": "Moved Inc"}');
  PERFORM ti.check(r->>'contact_id' = cid::text AND (SELECT company FROM contacts WHERE id = cid) = 'Moved Inc', 'found by phone, however it is written');
  PERFORM ti.check((SELECT count(*) FROM contacts WHERE workspace_id = ti.ws()) = 1, 'no duplicate is made');
  r := inbound_contact(ti.link(p_ws => ti.other_ws()), '{"email": "ben@example.com"}');
  PERFORM ti.check(r->>'created' = 'true' AND r->>'contact_id' <> cid::text, 'another account''s link never touches this account''s people');
EXCEPTION WHEN OTHERS THEN PERFORM ti.crashed('Someone already there', SQLERRM); END $$;

DO $$ DECLARE tok text; r jsonb; cid uuid; BEGIN
  RAISE NOTICE 'Names, tags, messages and wrapped fields';
  PERFORM ti.reset();
  tok := ti.link(ARRAY['Web']);
  r := inbound_contact(tok, '{"contact": {"name": "Cy de Winter", "email": "cy@example.com"}, "tags": ["VIP", " ", "Newsletter"], "message": "Call me Tuesday"}');
  cid := (r->>'contact_id')::uuid;
  PERFORM ti.check((SELECT first_name = 'Cy' AND last_name = 'de Winter' FROM contacts WHERE id = cid), 'a full name is split into first and last');
  PERFORM ti.check(ti.tags(cid) = ARRAY['Newsletter', 'VIP', 'Web'], 'tags sent as a list are added (blanks ignored)');
  PERFORM ti.check((SELECT content FROM notes WHERE contact_id = cid) = E'From Website form:\nCall me Tuesday', 'a message becomes a note saying where it came from');
  r := inbound_contact(tok, '{"data": {"email": "cy@example.com"}, "tags": "Event, Paid"}');
  PERFORM ti.check(ti.tags(cid) = ARRAY['Event', 'Newsletter', 'Paid', 'VIP', 'Web'], 'tags sent as "a, b" are added too');
EXCEPTION WHEN OTHERS THEN PERFORM ti.crashed('Names, tags, messages', SQLERRM); END $$;

DO $$ DECLARE tok text; r jsonb; i int; big text; BEGIN
  RAISE NOTICE 'Refusals: bad links, nobody to save, too many calls';
  PERFORM ti.reset();
  tok := ti.link();
  r := inbound_contact('not-a-real-token', '{"email": "x@example.com"}');
  PERFORM ti.check(r->>'ok' = 'false' AND r->>'status' = '404', 'an unknown link: 404');
  UPDATE inbound_links SET revoked_at = now() WHERE token = tok;
  r := inbound_contact(tok, '{"email": "x@example.com"}');
  PERFORM ti.check(r->>'status' = '404' AND NOT EXISTS (SELECT 1 FROM contacts WHERE workspace_id = ti.ws()), 'a switched-off link: 404, nothing saved');
  tok := ti.link();
  r := inbound_contact(tok, '{"first_name": "Nobody", "email": "not-an-email"}');
  PERFORM ti.check(r->>'status' = '422' AND r->>'error' LIKE '%email or a phone%', 'no usable email or phone: 422 with the reason');
  PERFORM ti.check((SELECT NOT ok AND payload->>'first_name' = 'Nobody' FROM inbound_log WHERE link_id = (SELECT id FROM inbound_links WHERE token = tok)), 'the refusal is logged with what was sent');
  big := repeat('x', 5000);
  r := inbound_contact(tok, jsonb_build_object('email', 'big@example.com', 'message', big));
  PERFORM ti.check(r->>'status' = '201' AND (SELECT payload ? 'too_large_to_keep' FROM inbound_log WHERE contact_id = (r->>'contact_id')::uuid), 'a large call still works; the log just doesn''t keep it');
  INSERT INTO inbound_log(link_id, workspace_id, ok) SELECT id, workspace_id, true FROM inbound_links, generate_series(1, 120) WHERE token = tok;
  r := inbound_contact(tok, '{"email": "late@example.com"}');
  PERFORM ti.check(r->>'status' = '429' AND NOT EXISTS (SELECT 1 FROM contacts WHERE email = 'late@example.com'), 'over 120 calls a minute: 429');
EXCEPTION WHEN OTHERS THEN PERFORM ti.crashed('Refusals', SQLERRM); END $$;

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM ti.failures; SELECT count(*) INTO p FROM ti.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM ti.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'incoming: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'incoming: all % checks passed', p;
END $$;
