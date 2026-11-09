-- Outside callers: the app's roles (anon = not signed in, authenticated = signed in) can't call the
-- database's internal helpers, while everyday actions done as a signed-in person, under row-level
-- security, still work (their triggers use those helpers from inside the database).

SET client_min_messages = notice;
CREATE SCHEMA IF NOT EXISTS ts;
GRANT USAGE ON SCHEMA ts TO anon, authenticated;
CREATE TABLE IF NOT EXISTS ts.failures (name text, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS ts.passes (n int);
GRANT ALL ON ts.failures, ts.passes TO anon, authenticated;
TRUNCATE ts.failures, ts.passes;

CREATE OR REPLACE FUNCTION ts.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(p_ok, false) THEN INSERT INTO ts.passes VALUES (1); RAISE NOTICE '  ✓ %', p_what;
  ELSE INSERT INTO ts.failures(name) VALUES (p_what); RAISE NOTICE '  ✗ %', p_what; END IF;
END $$;
CREATE OR REPLACE FUNCTION ts.crashed(p_case text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO ts.failures(name) VALUES (p_case || ': crashed: ' || p_err); RAISE NOTICE '  ✗ crashed: %', p_err; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ts TO anon, authenticated;

CREATE OR REPLACE FUNCTION ts.ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION ts.owner() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE OR REPLACE FUNCTION ts.member() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-0000000000a2'::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ts TO anon, authenticated;
INSERT INTO auth.users(id, email) VALUES (ts.owner(), 'sec-owner@example.com'), (ts.member(), 'sec-member@example.com') ON CONFLICT DO NOTHING;
INSERT INTO workspaces(id, name, slug, owner_id) VALUES (ts.ws(), 'Sec Co', 'sec-co', ts.owner()) ON CONFLICT DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (ts.ws(), ts.owner(), 'owner'), (ts.ws(), ts.member(), 'member') ON CONFLICT DO NOTHING;

DO $$ DECLARE f text; bad text[] := '{}'; BEGIN
  RAISE NOTICE 'Internal helpers: refused to the app''s roles, kept for the service role';
  FOREACH f IN ARRAY ARRAY['wf_tag_id(uuid, text)', 'wf_post(uuid, workflows, wf_runs, text)', 'wf_emit(uuid, text, uuid, jsonb)', 'wf_run(uuid)',
    'wf_new_meeting(uuid, uuid, text, integer)', 'wf_handle_event(wf_events)', 'wf_daily_scan()', 'wf_tick()', 'wf_contact_tags(uuid)', 'wf_form_answers(uuid)',
    'webhook_contact(uuid)', 'webhook_form_answers(uuid)', 'webhook_queue(uuid, text, jsonb)', 'webhook_dispatch(uuid)', 'audit_write(uuid, text, text, uuid, jsonb)',
    'audit_person(uuid)', 'ensure_department_channel(uuid)', 'event_public_json(events)', 'event_ticket_list(uuid)', 'api_contact(uuid)', 'api_route(api_keys, text, text[], jsonb, jsonb)',
    'seed_workspace_demo_data_unchecked(uuid, uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN bad := bad || f; END IF;
  END LOOP;
  PERFORM ts.check(cardinality(bad) = 0, 'no internal helper can be called from outside' || CASE WHEN cardinality(bad) > 0 THEN ': ' || array_to_string(bad, ', ') ELSE '' END);
  PERFORM ts.check(has_function_privilege('service_role', 'wf_tag_id(uuid, text)', 'EXECUTE') AND has_function_privilege('service_role', 'webhook_dispatch(uuid)', 'EXECUTE'), 'the service role (edge functions) still can');
  PERFORM ts.check(has_function_privilege('anon', 'public_event(text)', 'EXECUTE') AND has_function_privilege('authenticated', 'is_workspace_member(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'api_key_create(uuid, text, boolean)', 'EXECUTE'), 'functions the app calls stay callable');
EXCEPTION WHEN OTHERS THEN PERFORM ts.crashed('Internal helpers', SQLERRM); END $$;

DO $$ BEGIN
  RAISE NOTICE 'Calling one from outside is refused';
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM wf_tag_id(ts.ws(), 'Sneaky');
    PERFORM ts.check(false, 'not signed in: creating a tag through a helper is refused');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM ts.check(true, 'not signed in: creating a tag through a helper is refused');
  END;
  RESET ROLE;
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Calling from outside', SQLERRM); END $$;

DO $$ BEGIN
  RAISE NOTICE 'Demo data and the scheduler key';
  PERFORM set_config('request.jwt.claim.sub', ts.member()::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM seed_workspace_demo_data(ts.ws(), ts.owner());
    PERFORM ts.check(false, 'someone else can''t fill an account with demo data');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE '%Only the account owner%', 'someone else can''t fill an account with demo data');
  END;
  RESET ROLE;
  DELETE FROM wf_private.settings WHERE key = 'client_key';
  SET LOCAL ROLE authenticated;
  PERFORM wf_set_client_key('first-key-aaaaaaaaaaaaaaaa');
  PERFORM wf_set_client_key('attacker-key-bbbbbbbbbbbbbb');
  RESET ROLE;
  PERFORM ts.check((SELECT value FROM wf_private.settings WHERE key = 'client_key') = 'first-key-aaaaaaaaaaaaaaaa', 'the scheduler key can''t be overwritten by just anyone');
  PERFORM set_config('request.jwt.claim.sub', '', true);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Demo data and key', SQLERRM); END $$;

DO $$ DECLARE cid uuid; did uuid; ok boolean; BEGIN
  RAISE NOTICE 'Everyday actions by a signed-in owner still work (and their automations run)';
  PERFORM set_config('request.jwt.claim.sub', ts.owner()::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO contacts(workspace_id, first_name, email) VALUES (ts.ws(), 'Ada', 'ada@sec.example.com') RETURNING id INTO cid;
  INSERT INTO tags(workspace_id, name) VALUES (ts.ws(), 'VIP');
  INSERT INTO contact_tags(contact_id, tag_id) SELECT cid, id FROM tags WHERE workspace_id = ts.ws() AND name = 'VIP';
  INSERT INTO notes(workspace_id, contact_id, content) VALUES (ts.ws(), cid, 'Called');
  UPDATE contacts SET company = 'Engines' WHERE id = cid;
  INSERT INTO departments(workspace_id, name) VALUES (ts.ws(), 'Sales') RETURNING id INTO did;
  UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ts.ws() AND user_id = ts.member();
  PERFORM api_key_create(ts.ws(), 'Zapier', true);
  DELETE FROM contacts WHERE id = cid;
  RESET ROLE;
  PERFORM ts.check(EXISTS (SELECT 1 FROM wf_events WHERE workspace_id = ts.ws() AND type = 'contact_created') AND EXISTS (SELECT 1 FROM wf_events WHERE workspace_id = ts.ws() AND type = 'contact_tag'),
    'adding a contact and a tag: workflows hear about it');
  PERFORM ts.check(EXISTS (SELECT 1 FROM chat_channels WHERE department_id = did AND is_department), 'a new department gets its channel');
  PERFORM ts.check(EXISTS (SELECT 1 FROM audit_logs WHERE workspace_id = ts.ws() AND action = 'role_changed') AND EXISTS (SELECT 1 FROM audit_logs WHERE workspace_id = ts.ws() AND action = 'contact_deleted'),
    'role changes and deletions are in the audit log');
  PERFORM set_config('request.jwt.claim.sub', '', true);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Everyday actions', SQLERRM); END $$;

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM ts.failures; SELECT count(*) INTO p FROM ts.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM ts.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'security: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'security: all % checks passed', p;
END $$;
