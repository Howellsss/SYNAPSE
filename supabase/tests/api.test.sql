-- API keys: an Admin makes a key (shown once, only its hash kept); apps call api_request() with it
-- to list, find, add, change and delete contacts, their tags and notes. Read-only keys can't change
-- anything, revoked keys stop at once, one account's key never reaches another's contacts.

SET client_min_messages = notice;
CREATE SCHEMA IF NOT EXISTS ta;
CREATE TABLE IF NOT EXISTS ta.failures (name text, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS ta.passes (n int);
TRUNCATE ta.failures, ta.passes;

CREATE OR REPLACE FUNCTION ta.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(p_ok, false) THEN INSERT INTO ta.passes VALUES (1); RAISE NOTICE '  ✓ %', p_what;
  ELSE INSERT INTO ta.failures(name) VALUES (p_what); RAISE NOTICE '  ✗ %', p_what; END IF;
END $$;
CREATE OR REPLACE FUNCTION ta.crashed(p_case text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO ta.failures(name) VALUES (p_case || ': crashed: ' || p_err); RAISE NOTICE '  ✗ crashed: %', p_err; END $$;

CREATE OR REPLACE FUNCTION ta.ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'd0000000-0000-4000-8000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION ta.other_ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'd0000000-0000-4000-8000-000000000002'::uuid $$;
CREATE OR REPLACE FUNCTION ta.owner() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'd0000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE OR REPLACE FUNCTION ta.member() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'd0000000-0000-4000-8000-0000000000a2'::uuid $$;
INSERT INTO auth.users(id, email) VALUES (ta.owner(), 'api-owner@example.com'), (ta.member(), 'api-member@example.com') ON CONFLICT DO NOTHING;
INSERT INTO workspaces(id, name, slug, owner_id) VALUES (ta.ws(), 'Api Co', 'api-co', ta.owner()), (ta.other_ws(), 'Api Other', 'api-other', ta.owner()) ON CONFLICT DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (ta.ws(), ta.owner(), 'owner'), (ta.ws(), ta.member(), 'member'), (ta.other_ws(), ta.owner(), 'owner') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION ta.reset() RETURNS void LANGUAGE sql AS $$
  DELETE FROM api_keys WHERE workspace_id IN (ta.ws(), ta.other_ws());
  DELETE FROM contacts WHERE workspace_id IN (ta.ws(), ta.other_ws());
  DELETE FROM tags WHERE workspace_id IN (ta.ws(), ta.other_ws());
  DELETE FROM wf_events WHERE workspace_id IN (ta.ws(), ta.other_ws());
$$;
-- Make a key as the owner; returns the key itself.
CREATE OR REPLACE FUNCTION ta.key(p_write boolean DEFAULT true, p_ws uuid DEFAULT ta.ws()) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', ta.owner()::text, true);
  r := api_key_create(p_ws, 'Zapier', p_write);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r->>'key';
END $$;
CREATE OR REPLACE FUNCTION ta.call(p_key text, p_method text, p_path text, p_body jsonb DEFAULT '{}', p_query jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT api_request(p_key, p_method, p_path, p_query, p_body);
$$;

DO $$ DECLARE k text; r jsonb; row api_keys; BEGIN
  RAISE NOTICE 'Keys: made by admins, shown once, kept only as a hash';
  PERFORM ta.reset();
  k := ta.key();
  SELECT * INTO row FROM api_keys WHERE workspace_id = ta.ws();
  PERFORM ta.check(k ~ '^syn_[0-9a-f]{48}$', 'a key looks like syn_ and 48 hex characters');
  PERFORM ta.check(row.prefix = left(k, 12) AND row.key_hash = encode(digest(k, 'sha256'), 'hex') AND position(k IN row::text) = 0, 'only its start and its hash are stored');
  PERFORM ta.check(EXISTS (SELECT 1 FROM audit_logs WHERE workspace_id = ta.ws() AND action = 'api_key_created' AND details->>'name' = 'Zapier'), 'making a key is in the audit log');
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', ta.member()::text, true);
    PERFORM api_key_create(ta.ws(), 'Sneaky', true);
    PERFORM ta.check(false, 'a User cannot make a key');
  EXCEPTION WHEN OTHERS THEN PERFORM ta.check(SQLERRM LIKE '%Only admins%', 'a User cannot make a key');
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  r := ta.call(k, 'GET', 'me');
  PERFORM ta.check(r->>'status' = '200' AND r->'body'->'workspace'->>'name' = 'Api Co' AND r->'body'->'key'->>'access' = 'read_write', 'GET /me: the account and the key');
  PERFORM ta.check((SELECT last_used_at IS NOT NULL FROM api_keys WHERE id = row.id) AND EXISTS (SELECT 1 FROM api_log WHERE key_id = row.id AND path = '/me' AND status = 200), 'calls are logged and the key shows when it was last used');
  PERFORM ta.check(ta.call('syn_wrong', 'GET', 'me')->>'status' = '401', 'a wrong key: 401');
  PERFORM set_config('request.jwt.claim.sub', ta.owner()::text, true);
  PERFORM api_key_revoke(row.id);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM ta.check(ta.call(k, 'GET', 'me')->>'status' = '401', 'a revoked key stops working at once');
EXCEPTION WHEN OTHERS THEN PERFORM ta.crashed('Keys', SQLERRM); END $$;

DO $$ DECLARE k text; r jsonb; cid text; BEGIN
  RAISE NOTICE 'Contacts: add, find, change, delete';
  PERFORM ta.reset();
  k := ta.key();
  r := ta.call(k, 'POST', 'contacts', '{"first_name": "Ada", "last_name": "Lovelace", "email": "ADA@example.com", "tags": ["VIP"], "note": "Met at the expo"}');
  cid := r->'body'->'data'->>'id';
  PERFORM ta.check(r->>'status' = '201' AND r->'body'->>'created' = 'true' AND r->'body'->'data'->>'email' = 'ada@example.com'
    AND r->'body'->'data'->'tags' ? 'VIP' AND r->'body'->'data'->>'source' = 'API', 'POST /contacts adds a contact, with tags; source API');
  PERFORM ta.check((SELECT content FROM notes WHERE contact_id = cid::uuid) = E'From Zapier (API):\nMet at the expo', 'a note sent with it is kept');
  PERFORM ta.check(EXISTS (SELECT 1 FROM wf_events WHERE contact_id = cid::uuid AND type = 'contact_created'), 'workflows hear "contact created"');
  r := ta.call(k, 'POST', 'contacts', '{"email": "ada@example.com", "company": "Engines"}');
  PERFORM ta.check(r->>'status' = '200' AND r->'body'->'data'->>'id' = cid AND r->'body'->'data'->>'company' = 'Engines' AND r->'body'->'data'->>'first_name' = 'Ada', 'POST again with the same email updates, no duplicate');
  r := ta.call(k, 'GET', 'contacts/' || cid);
  PERFORM ta.check(r->>'status' = '200' AND r->'body'->'data'->>'last_name' = 'Lovelace', 'GET /contacts/{id}');
  r := ta.call(k, 'PATCH', 'contacts/' || cid, '{"job_title": "Analyst", "date_of_birth": "1815-12-10"}');
  PERFORM ta.check(r->>'status' = '200' AND r->'body'->'data'->>'job_title' = 'Analyst' AND r->'body'->'data'->>'date_of_birth' = '1815-12-10' AND r->'body'->'data'->>'company' = 'Engines',
    'PATCH changes only what was sent');
  PERFORM ta.check(ta.call(k, 'PATCH', 'contacts/' || cid, '{"email": "not-an-email"}')->>'status' = '422', 'a bad email: 422');
  PERFORM ta.check(ta.call(k, 'PATCH', 'contacts/' || cid, '{}')->>'status' = '422', 'nothing to change: 422');
  PERFORM ta.check(ta.call(k, 'POST', 'contacts', '{"first_name": "Nobody"}')->'body'->>'error' LIKE '%"email" or a "phone"%', 'adding with no email or phone: 422 with the reason');
  PERFORM ta.check(ta.call(k, 'GET', 'contacts/not-a-uuid')->>'status' = '404' AND ta.call(k, 'GET', 'contacts/' || gen_random_uuid())->>'status' = '404', 'an unknown id: 404');
  r := ta.call(k, 'DELETE', 'contacts/' || cid);
  PERFORM ta.check(r->>'status' = '200' AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = cid::uuid), 'DELETE /contacts/{id}');
EXCEPTION WHEN OTHERS THEN PERFORM ta.crashed('Contacts', SQLERRM); END $$;

DO $$ DECLARE k text; r jsonb; i int; BEGIN
  RAISE NOTICE 'Listing and searching';
  PERFORM ta.reset();
  k := ta.key();
  FOR i IN 1..5 LOOP
    INSERT INTO contacts(workspace_id, first_name, email, phone, created_at) VALUES (ta.ws(), 'P' || i, 'p' || i || '@example.com', '+1 555 000 000' || i, now() - (i || ' hours')::interval);
  END LOOP;
  INSERT INTO contact_tags(contact_id, tag_id) SELECT id, wf_tag_id(ta.ws(), 'Lead') FROM contacts WHERE email IN ('p2@example.com', 'p4@example.com');
  r := ta.call(k, 'GET', 'contacts', '{}', '{"limit": "2"}');
  PERFORM ta.check(jsonb_array_length(r->'body'->'data') = 2 AND r->'body'->'data'->0->>'first_name' = 'P1' AND r->'body'->>'has_more' = 'true' AND r->'body'->>'next_offset' = '2', 'newest first, a page at a time');
  r := ta.call(k, 'GET', 'contacts', '{}', '{"limit": "2", "offset": "4"}');
  PERFORM ta.check(jsonb_array_length(r->'body'->'data') = 1 AND r->'body'->>'has_more' = 'false' AND r->'body'->'next_offset' = 'null', 'the last page says there''s no more');
  PERFORM ta.check(ta.call(k, 'GET', 'contacts', '{}', '{"email": "P3@EXAMPLE.com"}')->'body'->'data'->0->>'first_name' = 'P3', 'find by email');
  PERFORM ta.check(ta.call(k, 'GET', 'contacts', '{}', '{"phone": "15550000005"}')->'body'->'data'->0->>'first_name' = 'P5', 'find by phone, however it is written');
  PERFORM ta.check(jsonb_array_length(ta.call(k, 'GET', 'contacts', '{}', '{"tag": "lead"}')->'body'->'data') = 2, 'filter by tag');
  PERFORM ta.check(jsonb_array_length(ta.call(k, 'GET', 'contacts', '{}', jsonb_build_object('created_after', (now() - interval '150 minutes')::text))->'body'->'data') = 2, 'only those added after a time');
  PERFORM ta.check(ta.call(k, 'GET', 'contacts', '{}', '{"limit": "lots"}')->>'status' = '422', 'a bad number: 422');
  PERFORM ta.check(jsonb_array_length(ta.call(k, 'GET', 'tags')->'body'->'data') = 1, 'GET /tags');
EXCEPTION WHEN OTHERS THEN PERFORM ta.crashed('Listing', SQLERRM); END $$;

DO $$ DECLARE k text; r jsonb; cid text; BEGIN
  RAISE NOTICE 'Tags and notes';
  PERFORM ta.reset();
  k := ta.key();
  cid := ta.call(k, 'POST', 'contacts', '{"email": "tag@example.com"}')->'body'->'data'->>'id';
  r := ta.call(k, 'POST', 'contacts/' || cid || '/tags', '{"tags": "VIP, Paid"}');
  PERFORM ta.check(r->>'status' = '200' AND r->'body'->'data'->'tags' ? 'VIP' AND r->'body'->'data'->'tags' ? 'Paid', 'add tags');
  PERFORM ta.check(EXISTS (SELECT 1 FROM wf_events WHERE contact_id = cid::uuid AND type = 'contact_tag' AND data->>'tag' = 'VIP'), 'workflows hear "tag added"');
  r := ta.call(k, 'DELETE', 'contacts/' || cid || '/tags/vip');
  PERFORM ta.check(NOT (r->'body'->'data'->'tags' ? 'VIP') AND r->'body'->'data'->'tags' ? 'Paid', 'remove a tag by name');
  r := ta.call(k, 'POST', 'contacts/' || cid || '/notes', '{"content": "Called, will buy"}');
  PERFORM ta.check(r->>'status' = '201' AND r->'body'->'data'->>'content' = 'Called, will buy', 'add a note');
  PERFORM ta.check(ta.call(k, 'GET', 'contacts/' || cid || '/notes')->'body'->'data'->0->>'content' = 'Called, will buy', 'list notes');
EXCEPTION WHEN OTHERS THEN PERFORM ta.crashed('Tags and notes', SQLERRM); END $$;

DO $$ DECLARE k text; ro text; other text; cid text; BEGIN
  RAISE NOTICE 'Limits: read-only keys, other accounts, rate, unknown addresses';
  PERFORM ta.reset();
  k := ta.key();
  ro := ta.key(false);
  other := ta.key(true, ta.other_ws());
  cid := ta.call(k, 'POST', 'contacts', '{"email": "mine@example.com"}')->'body'->'data'->>'id';
  PERFORM ta.check(ta.call(ro, 'GET', 'contacts/' || cid)->>'status' = '200', 'a read-only key can read');
  PERFORM ta.check(ta.call(ro, 'PATCH', 'contacts/' || cid, '{"company": "X"}')->>'status' = '403' AND ta.call(ro, 'DELETE', 'contacts/' || cid)->>'status' = '403'
    AND EXISTS (SELECT 1 FROM contacts WHERE id = cid::uuid AND company IS NULL), 'but cannot change or delete (403)');
  PERFORM ta.check(ta.call(other, 'GET', 'contacts/' || cid)->>'status' = '404' AND ta.call(other, 'DELETE', 'contacts/' || cid)->>'status' = '404'
    AND jsonb_array_length(ta.call(other, 'GET', 'contacts')->'body'->'data') = 0, 'another account''s key can''t see or touch these contacts');
  PERFORM ta.check(ta.call(k, 'GET', 'invoices')->>'status' = '404' AND ta.call(k, 'PUT', 'contacts')->>'status' = '405', 'unknown address: 404; wrong method: 405');
  INSERT INTO api_log(key_id, workspace_id, method, path, status) SELECT id, workspace_id, 'GET', '/me', 200 FROM api_keys, generate_series(1, 300) WHERE key_hash = encode(digest(k, 'sha256'), 'hex');
  PERFORM ta.check(ta.call(k, 'GET', 'me')->>'status' = '429', 'over 300 calls a minute: 429');
EXCEPTION WHEN OTHERS THEN PERFORM ta.crashed('Limits', SQLERRM); END $$;

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM ta.failures; SELECT count(*) INTO p FROM ta.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM ta.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'api: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'api: all % checks passed', p;
END $$;
