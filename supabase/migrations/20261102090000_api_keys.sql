/*
  # API keys: other apps read and change contacts with a key

  An Admin makes a key in Settings → API (read only, or read and write). It is shown once; only
  its SHA-256 is kept. Apps send it as "Authorization: Bearer syn_…" to the `api` edge function,
  which hands each request to api_request() below:

    GET    /v1/me                          the account and key
    GET    /v1/contacts                    newest first; ?email= ?phone= ?tag= ?q= ?created_after=
                                           ?updated_after= ?limit= (1-100, 25) ?offset=
    POST   /v1/contacts                    add, or update the one with that email/phone
    GET    /v1/contacts/{id}
    PATCH  /v1/contacts/{id}               change the fields sent
    DELETE /v1/contacts/{id}
    POST   /v1/contacts/{id}/tags          { "tags": ["VIP"] }
    DELETE /v1/contacts/{id}/tags/{tag}
    GET    /v1/contacts/{id}/notes
    POST   /v1/contacts/{id}/notes         { "content": "…" }
    GET    /v1/tags

  Contacts come back in the same shape outgoing webhooks send. Changes start workflows as usual.
  Every request is logged (kept 7 days); at most 300 a minute per key.

  Needs 20261031090000_outgoing_webhooks.sql and 20261101090000_incoming_contacts.sql.
  Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  can_write boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
-- Admins see their keys (never the hash) and can delete revoked ones; making and revoking go through the functions below.
DROP POLICY IF EXISTS "api_keys_admins_read" ON api_keys;
CREATE POLICY "api_keys_admins_read" ON api_keys FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "api_keys_admins_delete_revoked" ON api_keys;
CREATE POLICY "api_keys_admins_delete_revoked" ON api_keys FOR DELETE TO authenticated USING (is_workspace_admin(workspace_id) AND revoked_at IS NOT NULL);
REVOKE ALL ON api_keys FROM anon, authenticated;
GRANT SELECT (id, workspace_id, name, prefix, can_write, created_by, created_at, last_used_at, revoked_at) ON api_keys TO authenticated;
GRANT DELETE ON api_keys TO authenticated;

CREATE TABLE IF NOT EXISTS api_log (
  id bigserial PRIMARY KEY,
  key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status int NOT NULL,
  error text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_log_key ON api_log(key_id, at DESC);
ALTER TABLE api_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_log_admins" ON api_log;
CREATE POLICY "api_log_admins" ON api_log FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));

/** Make a key. Returns { id, key }: the only time the key itself is shown. Admins only. */
CREATE OR REPLACE FUNCTION api_key_create(p_workspace uuid, p_name text, p_can_write boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE k text; v_id uuid;
BEGIN
  IF NOT is_workspace_admin(p_workspace) THEN RAISE EXCEPTION 'Only admins can make API keys.'; END IF;
  k := 'syn_' || encode(gen_random_bytes(24), 'hex');
  INSERT INTO api_keys(workspace_id, name, prefix, key_hash, can_write, created_by)
  VALUES (p_workspace, btrim(coalesce(p_name, '')), left(k, 12), encode(digest(k, 'sha256'), 'hex'), coalesce(p_can_write, true), auth.uid())
  RETURNING id INTO v_id;
  PERFORM audit_write(p_workspace, 'api_key_created', 'api_key', v_id, jsonb_build_object('name', btrim(p_name), 'access', CASE WHEN coalesce(p_can_write, true) THEN 'read and write' ELSE 'read only' END));
  RETURN jsonb_build_object('id', v_id, 'key', k);
END $$;
REVOKE ALL ON FUNCTION api_key_create(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_create(uuid, text, boolean) TO authenticated;

/** Revoke a key: it stops working at once. Admins only. */
CREATE OR REPLACE FUNCTION api_key_revoke(p_key uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k api_keys;
BEGIN
  SELECT * INTO k FROM api_keys WHERE id = p_key;
  IF NOT FOUND OR NOT is_workspace_admin(k.workspace_id) THEN RAISE EXCEPTION 'Only admins can revoke API keys.'; END IF;
  IF k.revoked_at IS NULL THEN
    UPDATE api_keys SET revoked_at = now() WHERE id = p_key;
    PERFORM audit_write(k.workspace_id, 'api_key_revoked', 'api_key', k.id, jsonb_build_object('name', k.name));
  END IF;
END $$;
REVOKE ALL ON FUNCTION api_key_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_key_revoke(uuid) TO authenticated;

-- ---------- helpers ----------

CREATE OR REPLACE FUNCTION api_out(p_status int, p_body jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('status', p_status, 'body', p_body)
$$;
CREATE OR REPLACE FUNCTION api_err(p_status int, p_message text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('status', p_status, 'body', jsonb_build_object('error', p_message))
$$;

-- A refusal the caller can fix (answered 422 with this message).
CREATE OR REPLACE FUNCTION api_invalid(p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = 'SY422', MESSAGE = p_message; END $$;

/** A contact as the API returns it: the webhook shape with tags as written, plus birthday and last change. */
CREATE OR REPLACE FUNCTION api_contact(p_contact uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT webhook_contact(c.id) || jsonb_build_object('date_of_birth', c.date_of_birth, 'updated_at', c.updated_at,
    'tags', (SELECT coalesce(jsonb_agg(t.name ORDER BY lower(t.name)), '[]'::jsonb) FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id))
  FROM contacts c WHERE c.id = p_contact;
$$;
REVOKE ALL ON FUNCTION api_contact(uuid) FROM PUBLIC, anon, authenticated;

/** The contact fields sent, under their proper names (same forgiving names as incoming links). */
CREATE OR REPLACE FUNCTION api_fields(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o jsonb := '{}'::jsonb; v text; full_name text;
BEGIN
  IF jsonb_typeof(p->'contact') = 'object' THEN p := p || (p->'contact'); END IF;
  v := lower(inbound_pick(p, 'email', 'email_address', 'emailAddress'));
  IF v IS NOT NULL THEN
    IF v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN PERFORM api_invalid('"email" isn''t a valid email address.'); END IF;
    o := o || jsonb_build_object('email', v);
  END IF;
  v := left(inbound_pick(p, 'phone', 'phone_number', 'phoneNumber', 'mobile'), 40);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('phone', v); END IF;
  v := left(inbound_pick(p, 'first_name', 'firstName', 'first', 'given_name'), 100);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('first_name', v); END IF;
  v := left(inbound_pick(p, 'last_name', 'lastName', 'last', 'family_name', 'surname'), 100);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('last_name', v); END IF;
  full_name := inbound_pick(p, 'name', 'full_name', 'fullName');
  IF full_name IS NOT NULL AND NOT o ? 'first_name' THEN
    o := o || jsonb_build_object('first_name', left(split_part(full_name, ' ', 1), 100));
    v := nullif(left(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), 100), '');
    IF v IS NOT NULL AND NOT o ? 'last_name' THEN o := o || jsonb_build_object('last_name', v); END IF;
  END IF;
  v := left(inbound_pick(p, 'company', 'company_name', 'companyName', 'organization', 'organisation'), 200);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('company', v); END IF;
  v := left(inbound_pick(p, 'job_title', 'jobTitle', 'title', 'position'), 200);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('job_title', v); END IF;
  v := left(inbound_pick(p, 'source', 'utm_source'), 60);
  IF v IS NOT NULL THEN o := o || jsonb_build_object('source', v); END IF;
  v := inbound_pick(p, 'date_of_birth', 'dateOfBirth', 'birthday', 'dob');
  IF v IS NOT NULL THEN
    BEGIN o := o || jsonb_build_object('date_of_birth', v::date);
    EXCEPTION WHEN OTHERS THEN PERFORM api_invalid('"date_of_birth" must be a date like 1990-12-31.'); END;
  END IF;
  RETURN o;
END $$;

/** Tags sent as a list or as "a, b". */
CREATE OR REPLACE FUNCTION api_tag_list(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p->'tags') = 'array' THEN ARRAY(SELECT left(btrim(x), 60) FROM jsonb_array_elements_text(p->'tags') x WHERE btrim(x) <> '')
    WHEN coalesce(p->>'tags', p->>'tag', '') <> '' THEN ARRAY(SELECT left(btrim(x), 60) FROM unnest(string_to_array(coalesce(p->>'tags', p->>'tag'), ',')) x WHERE btrim(x) <> '')
    ELSE '{}'::text[] END
$$;

CREATE OR REPLACE FUNCTION api_add_tags(p_workspace uuid, p_contact uuid, p_tags text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY coalesce(p_tags, '{}') LOOP
    INSERT INTO contact_tags(contact_id, tag_id) VALUES (p_contact, wf_tag_id(p_workspace, t)) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION api_set_fields(p_contact uuid, f jsonb) RETURNS void LANGUAGE sql AS $$
  UPDATE contacts SET
    first_name = coalesce(f->>'first_name', first_name), last_name = coalesce(f->>'last_name', last_name),
    email = coalesce(f->>'email', email), phone = coalesce(f->>'phone', phone),
    company = coalesce(f->>'company', company), job_title = coalesce(f->>'job_title', job_title),
    source = coalesce(f->>'source', source), date_of_birth = coalesce((f->>'date_of_birth')::date, date_of_birth),
    last_activity_at = now(), updated_at = now()
  WHERE id = p_contact;
$$;

CREATE OR REPLACE FUNCTION api_q_int(q jsonb, k text, p_default int, p_min int, p_max int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF coalesce(q->>k, '') = '' THEN RETURN p_default; END IF;
  BEGIN n := (q->>k)::int; EXCEPTION WHEN OTHERS THEN PERFORM api_invalid('"' || k || '" must be a whole number.'); END;
  RETURN least(greatest(n, p_min), p_max);
END $$;

CREATE OR REPLACE FUNCTION api_q_time(q jsonb, k text) RETURNS timestamptz LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(q->>k, '') = '' THEN RETURN NULL; END IF;
  RETURN (q->>k)::timestamptz;
EXCEPTION WHEN OTHERS THEN PERFORM api_invalid('"' || k || '" must be a date and time like 2026-11-01T09:00:00Z.'); RETURN NULL;
END $$;

-- ---------- the routes ----------

CREATE OR REPLACE FUNCTION api_route(k api_keys, m text, seg text[], q jsonb, b jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws uuid := k.workspace_id; n int := coalesce(array_length(seg, 1), 0);
  cid uuid; f jsonb; tags text[]; is_new boolean := false; lim int; off int; ids uuid[]; more boolean; v_note notes; content text;
BEGIN
  IF m NOT IN ('GET', 'POST', 'PATCH', 'DELETE') THEN RETURN api_err(405, 'Use GET, POST, PATCH or DELETE.'); END IF;
  IF m <> 'GET' AND NOT k.can_write THEN RETURN api_err(403, 'This key can only read. Make a key with write access to change things.'); END IF;

  IF n = 1 AND seg[1] = 'me' THEN
    IF m <> 'GET' THEN RETURN api_err(405, 'Use GET.'); END IF;
    RETURN api_out(200, jsonb_build_object(
      'workspace', (SELECT jsonb_build_object('id', w.id, 'name', w.name) FROM workspaces w WHERE w.id = ws),
      'key', jsonb_build_object('name', k.name, 'access', CASE WHEN k.can_write THEN 'read_write' ELSE 'read' END)));
  END IF;

  IF n = 1 AND seg[1] = 'tags' THEN
    IF m <> 'GET' THEN RETURN api_err(405, 'Use GET.'); END IF;
    RETURN api_out(200, jsonb_build_object('data', coalesce((SELECT jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color) ORDER BY lower(t.name)) FROM tags t WHERE t.workspace_id = ws), '[]'::jsonb)));
  END IF;

  IF n = 0 OR seg[1] <> 'contacts' OR n > 4 THEN
    RETURN api_err(404, 'Unknown address. See Settings → API for what you can call.');
  END IF;

  IF n = 1 THEN
    IF m = 'GET' THEN
      lim := api_q_int(q, 'limit', 25, 1, 100);
      off := api_q_int(q, 'offset', 0, 0, 1000000);
      SELECT array_agg(id ORDER BY created_at DESC, id) INTO ids FROM (
        SELECT c.id, c.created_at FROM contacts c
        WHERE c.workspace_id = ws
          AND (coalesce(q->>'email', '') = '' OR lower(c.email) = lower(btrim(q->>'email')))
          AND (coalesce(q->>'phone', '') = '' OR regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(q->>'phone', '\D', '', 'g'))
          AND (coalesce(q->>'tag', '') = '' OR EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id AND lower(t.name) = lower(btrim(q->>'tag'))))
          AND (coalesce(q->>'q', '') = '' OR concat_ws(' ', c.first_name, c.last_name, c.email, c.phone, c.company) ILIKE '%' || btrim(q->>'q') || '%')
          AND (api_q_time(q, 'created_after') IS NULL OR c.created_at > api_q_time(q, 'created_after'))
          AND (api_q_time(q, 'updated_after') IS NULL OR c.updated_at > api_q_time(q, 'updated_after'))
        ORDER BY c.created_at DESC, c.id LIMIT lim + 1 OFFSET off) s;
      more := coalesce(array_length(ids, 1), 0) > lim;
      ids := coalesce(ids[1:lim], '{}');
      RETURN api_out(200, jsonb_build_object(
        'data', coalesce((SELECT jsonb_agg(api_contact(x) ORDER BY o) FROM unnest(ids) WITH ORDINALITY u(x, o)), '[]'::jsonb),
        'has_more', more, 'next_offset', CASE WHEN more THEN off + lim END));
    ELSIF m = 'POST' THEN
      f := api_fields(b);
      IF NOT (f ? 'email' OR f ? 'phone') THEN PERFORM api_invalid('Send an "email" or a "phone".'); END IF;
      IF f ? 'email' THEN SELECT id INTO cid FROM contacts WHERE workspace_id = ws AND lower(email) = f->>'email' ORDER BY created_at LIMIT 1; END IF;
      IF cid IS NULL AND f ? 'phone' THEN
        SELECT id INTO cid FROM contacts WHERE workspace_id = ws AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = regexp_replace(f->>'phone', '\D', '', 'g')
          AND regexp_replace(f->>'phone', '\D', '', 'g') <> '' ORDER BY created_at LIMIT 1;
      END IF;
      IF cid IS NULL THEN
        INSERT INTO contacts(workspace_id, first_name, last_name, email, phone, company, job_title, date_of_birth, source)
        VALUES (ws, f->>'first_name', f->>'last_name', f->>'email', f->>'phone', f->>'company', f->>'job_title', (f->>'date_of_birth')::date, coalesce(f->>'source', 'API'))
        RETURNING id INTO cid;
        is_new := true;
      ELSE
        PERFORM api_set_fields(cid, f - 'source');
      END IF;
      PERFORM api_add_tags(ws, cid, api_tag_list(b));
      content := left(inbound_pick(b, 'note', 'message'), 10000);
      IF content IS NOT NULL THEN INSERT INTO notes(workspace_id, contact_id, content) VALUES (ws, cid, 'From ' || k.name || E' (API):\n' || content); END IF;
      RETURN api_out(CASE WHEN is_new THEN 201 ELSE 200 END, jsonb_build_object('data', api_contact(cid), 'created', is_new));
    END IF;
    RETURN api_err(405, 'Use GET or POST.');
  END IF;

  -- /contacts/{id}…
  BEGIN cid := seg[2]::uuid; EXCEPTION WHEN OTHERS THEN cid := NULL; END;
  IF cid IS NULL OR NOT EXISTS (SELECT 1 FROM contacts WHERE id = cid AND workspace_id = ws) THEN
    RETURN api_err(404, 'No contact with that id.');
  END IF;

  IF n = 2 THEN
    IF m = 'GET' THEN RETURN api_out(200, jsonb_build_object('data', api_contact(cid))); END IF;
    IF m = 'PATCH' THEN
      f := api_fields(b); tags := api_tag_list(b);
      IF f = '{}'::jsonb AND cardinality(tags) = 0 THEN PERFORM api_invalid('Nothing to change: send the fields to change, like { "company": "Acme" }.'); END IF;
      IF f <> '{}'::jsonb THEN PERFORM api_set_fields(cid, f); END IF;
      PERFORM api_add_tags(ws, cid, tags);
      RETURN api_out(200, jsonb_build_object('data', api_contact(cid)));
    END IF;
    IF m = 'DELETE' THEN
      DELETE FROM contacts WHERE id = cid;
      RETURN api_out(200, jsonb_build_object('deleted', true, 'id', cid));
    END IF;
    RETURN api_err(405, 'Use GET, PATCH or DELETE.');
  END IF;

  IF seg[3] = 'tags' THEN
    IF n = 3 AND m = 'POST' THEN
      tags := api_tag_list(b);
      IF cardinality(tags) = 0 THEN PERFORM api_invalid('Send { "tags": ["VIP"] }.'); END IF;
      PERFORM api_add_tags(ws, cid, tags);
      RETURN api_out(200, jsonb_build_object('data', api_contact(cid)));
    END IF;
    IF n = 4 AND m = 'DELETE' THEN
      DELETE FROM contact_tags ct USING tags t WHERE ct.contact_id = cid AND t.id = ct.tag_id AND t.workspace_id = ws AND lower(t.name) = lower(btrim(seg[4]));
      RETURN api_out(200, jsonb_build_object('data', api_contact(cid)));
    END IF;
    RETURN api_err(405, 'Add tags with POST /contacts/{id}/tags; remove one with DELETE /contacts/{id}/tags/{tag}.');
  END IF;

  IF seg[3] = 'notes' AND n = 3 THEN
    IF m = 'GET' THEN
      RETURN api_out(200, jsonb_build_object('data', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'content', x.content, 'created_at', x.created_at) ORDER BY x.created_at DESC)
        FROM (SELECT * FROM notes WHERE contact_id = cid ORDER BY created_at DESC LIMIT 50) x), '[]'::jsonb)));
    END IF;
    IF m = 'POST' THEN
      content := left(inbound_pick(b, 'content', 'note', 'text', 'body'), 10000);
      IF content IS NULL THEN PERFORM api_invalid('Send { "content": "…" }.'); END IF;
      INSERT INTO notes(workspace_id, contact_id, content) VALUES (ws, cid, content) RETURNING * INTO v_note;
      RETURN api_out(201, jsonb_build_object('data', jsonb_build_object('id', v_note.id, 'content', v_note.content, 'created_at', v_note.created_at)));
    END IF;
    RETURN api_err(405, 'Use GET or POST.');
  END IF;

  RETURN api_err(404, 'Unknown address. See Settings → API for what you can call.');
END $$;
REVOKE ALL ON FUNCTION api_route(api_keys, text, text[], jsonb, jsonb) FROM PUBLIC, anon, authenticated;

/**
 * One API request, from the `api` edge function (service role). p_path is what follows /v1/,
 * e.g. "contacts/<id>/tags". Returns { status, body }.
 */
CREATE OR REPLACE FUNCTION api_request(p_key text, p_method text, p_path text, p_query jsonb DEFAULT '{}'::jsonb, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE k api_keys; m text := upper(coalesce(p_method, 'GET')); res jsonb; seg text[];
BEGIN
  SELECT * INTO k FROM api_keys WHERE key_hash = encode(digest(btrim(coalesce(p_key, '')), 'sha256'), 'hex');
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN RETURN api_err(401, 'This API key is not valid or was revoked.'); END IF;
  IF (SELECT count(*) FROM api_log WHERE key_id = k.id AND at > now() - interval '1 minute') >= 300 THEN
    RETURN api_err(429, 'Too many requests: at most 300 a minute per key. Try again shortly.');
  END IF;

  seg := ARRAY(SELECT s FROM unnest(string_to_array(btrim(coalesce(p_path, ''), '/'), '/')) s WHERE s <> '');
  BEGIN
    res := api_route(k, m, seg, coalesce(p_query, '{}'::jsonb), CASE WHEN jsonb_typeof(p_body) = 'object' THEN p_body ELSE '{}'::jsonb END);
  EXCEPTION
    WHEN SQLSTATE 'SY422' THEN res := api_err(422, SQLERRM);
    WHEN OTHERS THEN res := api_err(400, 'Could not do that: ' || SQLERRM);
  END;

  INSERT INTO api_log(key_id, workspace_id, method, path, status, error)
  VALUES (k.id, k.workspace_id, m, left('/' || array_to_string(seg, '/'), 300), (res->>'status')::int, res->'body'->>'error');
  UPDATE api_keys SET last_used_at = now() WHERE id = k.id;
  DELETE FROM api_log WHERE key_id = k.id AND at < now() - interval '7 days';
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION api_request(text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION api_request(text, text, text, jsonb, jsonb) TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;
