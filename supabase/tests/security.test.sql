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

-- A second account for the checks below: o2 owns it, a2 is an Admin, m2 a User, x is invited.
CREATE OR REPLACE FUNCTION ts.ws2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-000000000002'::uuid $$;
CREATE OR REPLACE FUNCTION ts.o2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-0000000000b1'::uuid $$;
CREATE OR REPLACE FUNCTION ts.a2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-0000000000b2'::uuid $$;
CREATE OR REPLACE FUNCTION ts.m2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-0000000000b3'::uuid $$;
CREATE OR REPLACE FUNCTION ts.x() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'e0000000-0000-4000-8000-0000000000b4'::uuid $$;
CREATE OR REPLACE FUNCTION ts.as_user(p_user uuid, p_email text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_email IS NULL THEN '' ELSE jsonb_build_object('email', p_email)::text END, true);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ts TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;  -- as on Supabase
INSERT INTO auth.users(id, email) VALUES (ts.o2(), 'o2@example.com'), (ts.a2(), 'a2@example.com'), (ts.m2(), 'm2@example.com'), (ts.x(), 'x@example.com') ON CONFLICT DO NOTHING;
INSERT INTO workspaces(id, name, slug, owner_id) VALUES (ts.ws2(), 'Second Co', 'second-co', ts.o2()) ON CONFLICT DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (ts.ws2(), ts.o2(), 'owner'), (ts.ws2(), ts.a2(), 'admin'), (ts.ws2(), ts.m2(), 'member') ON CONFLICT DO NOTHING;
-- m2 is also an Admin of the first account: they must not be able to carry that over.
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (ts.ws(), ts.m2(), 'member') ON CONFLICT DO NOTHING;

DO $$ DECLARE n int; BEGIN
  RAISE NOTICE 'Memberships and the account owner';
  PERFORM ts.as_user(ts.m2());
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE workspace_members SET workspace_id = ts.ws2(), role = 'member' WHERE workspace_id = ts.ws() AND user_id = ts.m2();
    PERFORM ts.check(false, 'a membership can''t be moved to another account');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE '%can''t be moved%', 'a membership can''t be moved to another account');
  END;
  RESET ROLE;
  PERFORM ts.as_user(ts.a2());
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE workspaces SET owner_id = ts.a2() WHERE id = ts.ws2();
    PERFORM ts.check(false, 'an Admin can''t make themselves the account''s owner');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE '%owner%', 'an Admin can''t make themselves the account''s owner');
  END;
  DELETE FROM workspace_members WHERE workspace_id = ts.ws2() AND user_id = ts.o2();
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  PERFORM ts.check(n = 0 AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ts.ws2() AND user_id = ts.o2()), 'an Admin can''t remove the owner');
  PERFORM ts.as_user(NULL);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Memberships', SQLERRM); END $$;

DO $$ DECLARE tok text; n int; BEGIN
  RAISE NOTICE 'Invitations are used once';
  INSERT INTO team_invitations(workspace_id, email, role, invited_by) VALUES (ts.ws2(), 'x@example.com', 'member', ts.o2()) RETURNING token INTO tok;
  PERFORM ts.as_user(ts.x(), 'x@example.com');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO workspace_members(workspace_id, user_id, role, access) VALUES (ts.ws2(), ts.x(), 'member', ARRAY['contacts', 'forms', 'workflows']);
    PERFORM ts.check(false, 'an invited person can''t add themselves with what they choose to see');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLSTATE = '42501', 'an invited person can''t add themselves with what they choose to see');
  END;
  PERFORM ts.check(accept_invitation(tok) = ts.ws2(), 'accepting the invitation joins the account');
  PERFORM ts.check(accept_invitation(tok) = ts.ws2(), 'opening the link again while in the account is fine');
  RESET ROLE;
  PERFORM ts.check((SELECT access IS NULL AND role = 'member' FROM workspace_members WHERE workspace_id = ts.ws2() AND user_id = ts.x()), 'they join with the invited role and the usual access');
  PERFORM ts.as_user(ts.a2());
  SET LOCAL ROLE authenticated;
  DELETE FROM workspace_members WHERE workspace_id = ts.ws2() AND user_id = ts.x();
  RESET ROLE;
  PERFORM ts.check((SELECT status FROM team_invitations WHERE token = tok) = 'revoked', 'removing someone cancels their invitation');
  PERFORM ts.as_user(ts.x(), 'x@example.com');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM accept_invitation(tok);
    PERFORM ts.check(false, 'a removed person can''t use the old link to come back');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE '%cancelled%', 'a removed person can''t use the old link to come back');
  END;
  RESET ROLE;
  UPDATE team_invitations SET status = 'accepted' WHERE token = tok;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM accept_invitation(tok);
    PERFORM ts.check(false, 'a used invitation doesn''t let someone outside the account back in');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE '%already been used%', 'a used invitation doesn''t let someone outside the account back in');
  END;
  RESET ROLE;
  PERFORM ts.check(NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ts.ws2() AND user_id = ts.x()), 'and they stay out');
  PERFORM ts.as_user(NULL);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Invitations', SQLERRM); END $$;

DO $$ DECLARE ch uuid; BEGIN
  RAISE NOTICE 'Chat: members can''t make themselves a channel''s owner';
  INSERT INTO chat_channels(workspace_id, kind, name, created_by) VALUES (ts.ws2(), 'channel', 'general-sec', ts.o2()) RETURNING id INTO ch;
  INSERT INTO chat_members(channel_id, workspace_id, user_id, role) VALUES (ch, ts.ws2(), ts.o2(), 'owner'), (ch, ts.ws2(), ts.m2(), 'member');
  PERFORM ts.as_user(ts.m2());
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE chat_members SET role = 'owner' WHERE channel_id = ch AND user_id = ts.m2();
    PERFORM ts.check(false, 'a member can''t promote themselves');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE '%owner or an admin%', 'a member can''t promote themselves');
  END;
  RESET ROLE;
  PERFORM ts.as_user(ts.o2());
  SET LOCAL ROLE authenticated;
  UPDATE chat_members SET role = 'owner' WHERE channel_id = ch AND user_id = ts.m2();
  RESET ROLE;
  PERFORM ts.check((SELECT role FROM chat_members WHERE channel_id = ch AND user_id = ts.m2()) = 'owner', 'the channel''s owner still can');
  PERFORM ts.as_user(NULL);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Chat roles', SQLERRM); END $$;

DO $$ DECLARE cal uuid; other uuid; n int; c uuid; BEGIN
  RAISE NOTICE 'Booking pages see busy times only';
  INSERT INTO contacts(workspace_id, first_name, email) VALUES (ts.ws2(), 'Ada', 'ada@second.example.com') RETURNING id INTO c;
  PERFORM set_config('ts.contact', c::text, false);
  INSERT INTO calendars(workspace_id, name, slug, owner_id, status) VALUES (ts.ws2(), 'Consults', 'consults-sec', ts.o2(), 'active') RETURNING id INTO cal;
  INSERT INTO calendars(workspace_id, name, slug, owner_id, status) VALUES (ts.ws(), 'Theirs', 'theirs-sec', ts.owner(), 'active') RETURNING id INTO other;
  INSERT INTO appointments(contact_id, workspace_id, calendar_id, title, status, start_time, end_time, notes)
    VALUES (c, ts.ws2(), cal, 'Private: Ada Lovelace', 'confirmed', now() + interval '1 day', now() + interval '1 day 30 minutes', 'secret notes');
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM appointments;
  PERFORM ts.check(n = 0, 'not signed in: whole bookings can''t be read');
  SELECT count(*) INTO n FROM appointment_busy WHERE calendar_id = cal;
  PERFORM ts.check(n = 1, 'not signed in: busy times can');
  INSERT INTO appointments(contact_id, id, workspace_id, calendar_id, title, status, start_time, end_time)
    VALUES (current_setting('ts.contact')::uuid, gen_random_uuid(), ts.ws2(), cal, 'Visitor', 'confirmed', now() + interval '2 days', now() + interval '2 days 30 minutes');
  PERFORM ts.check(true, 'a visitor can still book');
  BEGIN
    INSERT INTO appointments(contact_id, workspace_id, calendar_id, title, status, start_time, end_time)
      VALUES (current_setting('ts.contact')::uuid, ts.ws2(), other, 'Planted', 'confirmed', now() + interval '3 days', now() + interval '3 days 30 minutes');
    PERFORM ts.check(false, 'a booking can''t be put into another account');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLSTATE = '42501', 'a booking can''t be put into another account');
  END;
  BEGIN
    INSERT INTO appointments(contact_id, workspace_id, calendar_id, title, status, start_time, end_time)
      VALUES (current_setting('ts.contact')::uuid, ts.ws2(), cal, 'Done', 'completed', now() - interval '3 days', now() - interval '3 days');
    PERFORM ts.check(false, 'a visitor can only make confirmed or pending bookings');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLSTATE = '42501', 'a visitor can only make confirmed or pending bookings');
  END;
  RESET ROLE;
  PERFORM ts.check(NOT has_table_privilege('anon', 'appointment_busy', 'UPDATE') AND NOT has_table_privilege('authenticated', 'appointment_busy', 'DELETE'), 'busy times are read-only');
  PERFORM ts.as_user(ts.owner());
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM appointments WHERE workspace_id = ts.ws2();
  RESET ROLE;
  PERFORM ts.check(n = 0, 'signed in to another account: its bookings can''t be read either');
  PERFORM ts.as_user(NULL);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Booking pages', SQLERRM); END $$;

DO $$ DECLARE cal uuid; n int; BEGIN
  RAISE NOTICE 'Calendar hosts and recordings';
  SELECT id INTO cal FROM calendars WHERE slug = 'consults-sec';
  PERFORM ts.as_user(ts.m2());
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO calendar_hosts(calendar_id, user_id) VALUES (cal, ts.m2());
    PERFORM ts.check(false, 'a User can''t add themselves to someone else''s calendar');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLSTATE = '42501', 'a User can''t add themselves to someone else''s calendar');
  END;
  RESET ROLE;
  PERFORM ts.as_user(ts.o2());
  SET LOCAL ROLE authenticated;
  INSERT INTO calendar_hosts(calendar_id, user_id) VALUES (cal, ts.m2());
  RESET ROLE;
  PERFORM ts.check(EXISTS (SELECT 1 FROM calendar_hosts WHERE calendar_id = cal AND user_id = ts.m2()), 'the calendar''s owner can add them');

  INSERT INTO storage.objects(bucket_id, name) VALUES ('meeting-recordings', ts.ws2()::text || '/board-meeting.webm');
  PERFORM ts.as_user(ts.m2());
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'meeting-recordings';
  RESET ROLE;
  PERFORM ts.check(n = 0, 'a User without Recordings can''t open recording files');
  PERFORM ts.as_user(ts.a2());
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'meeting-recordings';
  RESET ROLE;
  PERFORM ts.check(n = 1, 'an Admin can');
  PERFORM ts.as_user(NULL);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Hosts and recordings', SQLERRM); END $$;

DO $$ DECLARE ch uuid; sp uuid; n int; ok boolean; BEGIN
  RAISE NOTICE 'Conversations, Workspaces and Meetings follow each person''s sections';
  SELECT id INTO ch FROM chat_channels WHERE name = 'general-sec';
  INSERT INTO chat_messages(channel_id, workspace_id, user_id, body) VALUES (ch, ts.ws2(), ts.o2(), 'Board pay rises');
  INSERT INTO spaces(workspace_id, name, slug, template_key, created_by) VALUES (ts.ws2(), 'HQ', 'hq-sec', 'office', ts.o2()) RETURNING id INTO sp;
  INSERT INTO space_members(space_id, user_id) VALUES (sp, ts.o2());
  INSERT INTO meetings(workspace_id, host_id, title, code) VALUES (ts.ws2(), ts.o2(), 'Standup', 'SECU-101');
  -- m2 keeps only Contacts.
  UPDATE workspace_members SET access = ARRAY['contacts'] WHERE workspace_id = ts.ws2() AND user_id = ts.m2();
  PERFORM ts.as_user(ts.m2());
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_messages WHERE channel_id = ch;
  PERFORM ts.check(n = 0, 'without Conversations: messages can''t be read');
  SELECT count(*) INTO n FROM chat_channels WHERE id = ch;
  PERFORM ts.check(n = 1, 'channel names still can (for picking a channel in a workflow)');
  BEGIN
    INSERT INTO chat_messages(channel_id, workspace_id, user_id, body) VALUES (ch, ts.ws2(), ts.m2(), 'hi');
    ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501';
  END;
  PERFORM ts.check(ok, 'without Conversations: messages can''t be sent');
  SELECT count(*) INTO n FROM spaces WHERE id = sp;
  PERFORM ts.check(n = 0, 'without Workspaces: the office can''t be seen');
  SELECT count(*) INTO n FROM space_members WHERE space_id = sp;
  PERFORM ts.check(n = 0, 'nor who is in it');
  SELECT count(*) INTO n FROM meetings WHERE code = 'SECU-101';
  PERFORM ts.check(n = 1, 'without Meetings: a meeting link still opens');
  BEGIN
    INSERT INTO meetings(workspace_id, host_id, title, code) VALUES (ts.ws2(), ts.m2(), 'Mine', 'SECU-102');
    ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501';
  END;
  PERFORM ts.check(ok, 'without Meetings: meetings can''t be started');
  RESET ROLE;
  PERFORM ts.as_user(NULL);
  UPDATE workspace_members SET access = NULL WHERE workspace_id = ts.ws2() AND user_id = ts.m2();
  PERFORM ts.as_user(ts.m2());
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM chat_messages WHERE channel_id = ch;
  PERFORM ts.check(n = 1, 'with the usual sections, messages are back');
  SELECT count(*) INTO n FROM spaces WHERE id = sp;
  PERFORM ts.check(n = 1, 'and the office');
  RESET ROLE;
  PERFORM ts.as_user(NULL);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Sections for people tools', SQLERRM); END $$;

DO $$ DECLARE tok text; m messages; BEGIN
  RAISE NOTICE 'Invitations are emailed';
  INSERT INTO team_invitations(workspace_id, email, role, invited_by) VALUES (ts.ws2(), 'no-mail@example.com', 'member', ts.o2());
  PERFORM ts.check(NOT EXISTS (SELECT 1 FROM messages WHERE to_address = 'no-mail@example.com'), 'without a connected email account nothing is queued (the link can still be copied)');
  INSERT INTO email_accounts(workspace_id, user_id, email, display_name) VALUES (ts.ws2(), ts.o2(), 'team@second.example.com', 'Second Co');
  INSERT INTO team_invitations(workspace_id, email, role, title, invited_by) VALUES (ts.ws2(), 'newhire@example.com', 'admin', 'Producer', ts.o2()) RETURNING token INTO tok;
  SELECT * INTO m FROM messages WHERE to_address = 'newhire@example.com';
  PERFORM ts.check(m.status = 'queued' AND m.team_invitation_id IS NOT NULL AND m.from_email = 'team@second.example.com', 'with one, the invitation email is queued from it');
  PERFORM ts.check(m.body LIKE '%/invite/' || tok || '%' AND m.subject LIKE '%Second Co%' AND m.body LIKE '%an Admin (Producer)%', 'with the join link, the account and the role');
EXCEPTION WHEN OTHERS THEN PERFORM ts.crashed('Invitation emails', SQLERRM); END $$;

DO $$ DECLARE ch uuid; c uuid; msg uuid; meta jsonb; BEGIN
  RAISE NOTICE 'Claiming a contact from a workflow post';
  SELECT id INTO ch FROM chat_channels WHERE name = 'general-sec';
  INSERT INTO contacts(workspace_id, first_name, last_name, email) VALUES (ts.ws2(), 'Lead', 'Person', 'lead@example.com') RETURNING id INTO c;
  INSERT INTO chat_messages(channel_id, workspace_id, body, source, sender_name, meta)
    VALUES (ch, ts.ws2(), 'Call request', 'system', 'Workflow: Call request', jsonb_build_object('contact_id', c, 'contact_name', 'Lead Person')) RETURNING id INTO msg;
  PERFORM ts.as_user(ts.m2());
  SET LOCAL ROLE authenticated;
  meta := chat_claim_contact(msg);
  RESET ROLE;
  PERFORM ts.check(meta->>'claimed_by' = ts.m2()::text AND (SELECT owner_id FROM contacts WHERE id = c) = ts.m2(), 'the first to press Claim owns the contact');
  PERFORM ts.as_user(ts.a2());
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM chat_claim_contact(msg);
    PERFORM ts.check(false, 'a second claim says who has it');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE 'Already claimed by%', 'a second claim says who has it');
  END;
  RESET ROLE;
  PERFORM ts.check((SELECT owner_id FROM contacts WHERE id = c) = ts.m2(), 'and the owner stays');
  PERFORM ts.as_user(ts.owner());
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM chat_claim_contact(msg);
    PERFORM ts.check(false, 'someone from another account can''t claim');
  EXCEPTION WHEN OTHERS THEN PERFORM ts.check(SQLERRM LIKE '%not found%', 'someone from another account can''t claim');
  END;
  RESET ROLE;
  PERFORM ts.as_user(NULL);
EXCEPTION WHEN OTHERS THEN RESET ROLE; PERFORM ts.crashed('Claim', SQLERRM); END $$;

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM ts.failures; SELECT count(*) INTO p FROM ts.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM ts.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'security: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'security: all % checks passed', p;
END $$;
