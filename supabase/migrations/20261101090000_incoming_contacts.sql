/*
  # Incoming contact links: other apps add or update contacts in SYNAPSE

  An Admin makes an "incoming link" in Settings → API: a secret address another app (Zapier,
  Make, a website form, a live chat) POSTs a contact to. The `api` edge function hands the
  request to inbound_contact() below, which:
    - finds the contact by email (then phone) in the account, or adds them;
    - fills in the fields it was sent (first/last or full name, email, phone, company, job title,
      date of birth, source), adds the link's tags and any tags sent, and writes a message as a
      note;
    - so workflows start exactly as if someone had typed it in (contact created, tag added…);
    - logs every call (kept 30 days) and allows at most 120 a minute per link.
  Field names are forgiving: first_name / firstName / first, name / full_name, phone / phone_number,
  tags as a list or "a, b", and so on.

  Needs 20261010090000_workflow_engine.sql. Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS inbound_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  tags text[] NOT NULL DEFAULT '{}',
  source text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_inbound_links_workspace ON inbound_links(workspace_id);
ALTER TABLE inbound_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_links_admins" ON inbound_links;
CREATE POLICY "inbound_links_admins" ON inbound_links FOR ALL TO authenticated
  USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));

CREATE TABLE IF NOT EXISTS inbound_log (
  id bigserial PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES inbound_links(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  ok boolean NOT NULL,
  created boolean,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  error text,
  payload jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbound_log_link ON inbound_log(link_id, at DESC);
ALTER TABLE inbound_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_log_admins" ON inbound_log;
CREATE POLICY "inbound_log_admins" ON inbound_log FOR SELECT TO authenticated USING (is_workspace_admin(workspace_id));

-- First non-empty value among these keys (checked as sent and lower-case).
CREATE OR REPLACE FUNCTION inbound_pick(p jsonb, VARIADIC keys text[]) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v text;
BEGIN
  FOREACH k IN ARRAY keys LOOP
    v := nullif(btrim(coalesce(p->>k, p->>lower(k), '')), '');
    IF v IS NOT NULL THEN RETURN v; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- What gets kept in the log: the payload as sent, unless it's large.
CREATE OR REPLACE FUNCTION inbound_trim(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR length(p::text) <= 4000 THEN p ELSE jsonb_build_object('too_large_to_keep', true) END
$$;

/**
 * Add or update a contact from another app. Called by the `api` edge function (service role)
 * with the link's token and what was sent. Returns { ok, contact_id, created } or { ok:false, error }.
 */
CREATE OR REPLACE FUNCTION inbound_contact(p_token text, p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l inbound_links; p jsonb := coalesce(p_payload, '{}'::jsonb);
  em text; ph text; fn text; ln text; full_name text; co text; jt text; src text; dob date; msg text;
  tags text[]; t text; cid uuid; is_new boolean := false; err text;
BEGIN
  SELECT * INTO l FROM inbound_links WHERE token = btrim(coalesce(p_token, ''));
  IF NOT FOUND OR l.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', 'This link is not valid or was switched off.');
  END IF;
  IF (SELECT count(*) FROM inbound_log WHERE link_id = l.id AND at > now() - interval '1 minute') >= 120 THEN
    RETURN jsonb_build_object('ok', false, 'status', 429, 'error', 'Too many requests: at most 120 a minute. Try again shortly.');
  END IF;

  -- Some apps wrap the fields: { "contact": {...} } or { "data": {...} }.
  IF jsonb_typeof(p->'contact') = 'object' THEN p := p || (p->'contact'); END IF;
  IF jsonb_typeof(p->'data') = 'object' THEN p := p || (p->'data'); END IF;

  em := lower(inbound_pick(p, 'email', 'email_address', 'emailAddress', 'Email'));
  IF em IS NOT NULL AND em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN em := NULL; END IF;
  ph := left(inbound_pick(p, 'phone', 'phone_number', 'phoneNumber', 'mobile', 'Phone'), 40);
  fn := left(inbound_pick(p, 'first_name', 'firstName', 'first', 'given_name', 'First Name'), 100);
  ln := left(inbound_pick(p, 'last_name', 'lastName', 'last', 'family_name', 'surname', 'Last Name'), 100);
  full_name := inbound_pick(p, 'name', 'full_name', 'fullName', 'Name');
  IF fn IS NULL AND full_name IS NOT NULL THEN
    fn := left(split_part(full_name, ' ', 1), 100);
    ln := coalesce(ln, nullif(left(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), 100), ''));
  END IF;
  co := left(inbound_pick(p, 'company', 'company_name', 'companyName', 'organization', 'organisation'), 200);
  jt := left(inbound_pick(p, 'job_title', 'jobTitle', 'title', 'position'), 200);
  src := left(coalesce(inbound_pick(p, 'source', 'utm_source'), l.source, l.name), 60);
  BEGIN dob := inbound_pick(p, 'date_of_birth', 'dateOfBirth', 'birthday', 'dob')::date; EXCEPTION WHEN OTHERS THEN dob := NULL; END;
  msg := left(inbound_pick(p, 'message', 'note', 'notes', 'comment', 'comments'), 5000);

  IF em IS NULL AND ph IS NULL THEN
    err := 'Send an email or a phone number so SYNAPSE knows who it is.';
    INSERT INTO inbound_log(link_id, workspace_id, ok, error, payload) VALUES (l.id, l.workspace_id, false, err, inbound_trim(p_payload));
    RETURN jsonb_build_object('ok', false, 'status', 422, 'error', err);
  END IF;

  IF em IS NOT NULL THEN SELECT id INTO cid FROM contacts WHERE workspace_id = l.workspace_id AND lower(email) = em ORDER BY created_at LIMIT 1; END IF;
  IF cid IS NULL AND ph IS NOT NULL THEN
    SELECT id INTO cid FROM contacts WHERE workspace_id = l.workspace_id AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(ph, '\D', '', 'g') ORDER BY created_at LIMIT 1;
  END IF;

  IF cid IS NULL THEN
    INSERT INTO contacts(workspace_id, first_name, last_name, email, phone, company, job_title, date_of_birth, source)
    VALUES (l.workspace_id, fn, ln, em, ph, co, jt, dob, src) RETURNING id INTO cid;
    is_new := true;
  ELSE
    -- What was sent replaces what's there; what wasn't sent stays.
    UPDATE contacts SET
      first_name = coalesce(fn, first_name), last_name = coalesce(ln, last_name), email = coalesce(em, email), phone = coalesce(ph, phone),
      company = coalesce(co, company), job_title = coalesce(jt, job_title), date_of_birth = coalesce(dob, date_of_birth),
      last_activity_at = now(), updated_at = now()
    WHERE id = cid;
  END IF;

  tags := l.tags;
  IF jsonb_typeof(p->'tags') = 'array' THEN
    tags := tags || ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(p->'tags') x WHERE btrim(x) <> '');
  ELSIF coalesce(p->>'tags', p->>'tag', '') <> '' THEN
    tags := tags || ARRAY(SELECT btrim(x) FROM unnest(string_to_array(coalesce(p->>'tags', p->>'tag'), ',')) x WHERE btrim(x) <> '');
  END IF;
  FOREACH t IN ARRAY tags LOOP
    INSERT INTO contact_tags(contact_id, tag_id) VALUES (cid, wf_tag_id(l.workspace_id, left(t, 60))) ON CONFLICT DO NOTHING;
  END LOOP;
  IF msg IS NOT NULL THEN
    INSERT INTO notes(workspace_id, contact_id, content) VALUES (l.workspace_id, cid, 'From ' || l.name || E':\n' || msg);
  END IF;

  UPDATE inbound_links SET last_used_at = now() WHERE id = l.id;
  INSERT INTO inbound_log(link_id, workspace_id, ok, created, contact_id, payload) VALUES (l.id, l.workspace_id, true, is_new, cid, inbound_trim(p_payload));
  DELETE FROM inbound_log WHERE link_id = l.id AND at < now() - interval '30 days';
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN is_new THEN 201 ELSE 200 END, 'contact_id', cid, 'created', is_new);
EXCEPTION WHEN OTHERS THEN
  err := 'Could not save the contact: ' || SQLERRM;
  IF l.id IS NOT NULL THEN
    INSERT INTO inbound_log(link_id, workspace_id, ok, error) VALUES (l.id, l.workspace_id, false, err);
  END IF;
  RETURN jsonb_build_object('ok', false, 'status', 400, 'error', err);
END $$;
REVOKE ALL ON FUNCTION inbound_contact(text, jsonb) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION inbound_contact(text, jsonb) TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;
