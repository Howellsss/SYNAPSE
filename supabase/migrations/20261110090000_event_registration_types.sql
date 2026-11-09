/*
  # Event registration: types with their own form, approval, dates to be announced

  An event's tickets become registration types. Each can now have:
    - a web address of its own (/e/<event>/<slug>, e.g. /register or /apply),
    - a form from Forms that people fill in to register,
    - approval: people apply and wait to be selected (no ticket until then),
    - opening and closing times, and a status (draft, open, closed).
  Tickets made before this keep working exactly as they did.

  Also:
    - events may have no date yet ("to be announced"): starts_at and ends_at are both empty;
    - events gain a tagline, programme tags, the organiser's logo, brand colours and a privacy notice;
    - registrations gain the new statuses (applied → shortlisted → selected / declined → confirmed),
      a short ticket code (e.g. UNS-7K4Q), when consent was given, who checked them in, and the form
      answers they came from;
    - check-in staff per event, and a log of every check-in attempt (used by the scanner);
    - public_event_registration(slug, type): what the registration page shows;
    - event_register(slug, type, answers): registers or applies, through the type's form.

  Nothing is deleted. Safe to run more than once.
*/

-- 1. Events ------------------------------------------------------------------------------
ALTER TABLE events ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE events ALTER COLUMN ends_at DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_dates_together CHECK ((starts_at IS NULL) = (ends_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE events ADD COLUMN IF NOT EXISTS tagline text NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 140);
ALTER TABLE events ADD COLUMN IF NOT EXISTS programme text[] NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organiser_logo_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS brand jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS privacy_notice text NOT NULL DEFAULT '' CHECK (char_length(privacy_notice) <= 8000);

-- 2. Tickets become registration types ---------------------------------------------------
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS slug text CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$');
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS form_id uuid REFERENCES forms(id) ON DELETE SET NULL;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS opens_at timestamptz;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS closes_at timestamptz;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed'));
CREATE UNIQUE INDEX IF NOT EXISTS event_tickets_slug_key ON event_tickets(event_id, slug) WHERE slug IS NOT NULL;

-- 3. Registrations -----------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'event_registrations'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%confirmed%cancelled%'
    AND pg_get_constraintdef(oid) NOT LIKE '%applied%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE event_registrations DROP CONSTRAINT %I', c); END IF;
  ALTER TABLE event_registrations ADD CONSTRAINT event_registrations_status_types
    CHECK (status IN ('confirmed', 'applied', 'shortlisted', 'selected', 'declined', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS ticket_code text;
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_code_key ON event_registrations(ticket_code) WHERE ticket_code IS NOT NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
-- One live registration per person per registration type (they may hold one of each type).
DROP INDEX IF EXISTS event_registrations_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_email_type_key
  ON event_registrations(event_id, coalesce(ticket_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email))
  WHERE status NOT IN ('cancelled', 'declined');

-- 4. Check-in staff and the check-in log --------------------------------------------------
CREATE TABLE IF NOT EXISTS event_staff (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'checkin' CHECK (role IN ('checkin')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE event_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_staff_read" ON event_staff;
CREATE POLICY "event_staff_read" ON event_staff FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "event_staff_manage" ON event_staff;
CREATE POLICY "event_staff_manage" ON event_staff FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND (e.created_by = auth.uid() OR is_workspace_admin(e.workspace_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND (e.created_by = auth.uid() OR is_workspace_admin(e.workspace_id))));

CREATE TABLE IF NOT EXISTS event_checkins (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id uuid REFERENCES event_registrations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  result text NOT NULL CHECK (result IN ('success', 'already_checked_in', 'invalid', 'not_eligible', 'undone')),
  via text NOT NULL DEFAULT 'scan' CHECK (via IN ('scan', 'manual', 'undo')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_checkins_event ON event_checkins(event_id, at DESC);
ALTER TABLE event_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_checkins_read" ON event_checkins;
CREATE POLICY "event_checkins_read" ON event_checkins FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));

-- 5. Helpers -----------------------------------------------------------------------------

-- Statuses that hold a place (count against capacity) and carry a ticket.
CREATE OR REPLACE FUNCTION event_holds_place(p_status text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('confirmed', 'selected')
$$;

-- A short, readable ticket code: the event's first letters and four characters people can't
-- misread (no 0/O, 1/I/L), e.g. UNS-7K4Q. Unique across all events.
CREATE OR REPLACE FUNCTION event_ticket_code(p_slug text) RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  prefix text := upper(left(regexp_replace(coalesce(p_slug, ''), '[^a-zA-Z0-9]', '', 'g'), 3));
  code text;
BEGIN
  IF char_length(prefix) < 2 THEN prefix := 'TKT'; END IF;
  LOOP
    code := prefix || '-' || (SELECT string_agg(substr(abc, 1 + floor(random() * length(abc))::int, 1), '') FROM generate_series(1, 4));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE ticket_code = code);
  END LOOP;
  RETURN code;
END $$;

-- A form's definition as JSON (it is kept as a JSON string inside the column).
CREATE OR REPLACE FUNCTION form_definition_json(p_def jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_def) = 'string' THEN (p_def #>> '{}')::jsonb ELSE coalesce(p_def, '{}'::jsonb) END
$$;

-- Whether a registration type takes people now, and if not why.
CREATE OR REPLACE FUNCTION event_type_state(e events, t event_tickets) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN e.status = 'cancelled' THEN 'cancelled'
    WHEN e.status <> 'published' OR t.status = 'draft' THEN 'unavailable'
    WHEN e.ends_at IS NOT NULL AND e.ends_at < now() THEN 'ended'
    WHEN t.status = 'closed' OR (t.closes_at IS NOT NULL AND t.closes_at <= now()) THEN 'closed'
    WHEN t.opens_at IS NOT NULL AND t.opens_at > now() THEN 'not_open_yet'
    WHEN NOT t.requires_approval AND t.capacity IS NOT NULL
      AND (SELECT count(*) FROM event_registrations r WHERE r.ticket_id = t.id AND event_holds_place(r.status)) >= t.capacity THEN 'full'
    ELSE 'open' END
$$;
REVOKE ALL ON FUNCTION event_type_state(events, event_tickets) FROM PUBLIC, anon, authenticated;

-- 6. What the public sees (same functions as before, now with types, TBA dates and branding) --

CREATE OR REPLACE FUNCTION event_ticket_list(p_event uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'description', t.description,
    'price_minor', t.price_minor, 'currency', t.currency, 'capacity', t.capacity,
    'remaining', CASE WHEN t.capacity IS NULL THEN NULL ELSE greatest(t.capacity - (
      SELECT count(*) FROM event_registrations r WHERE r.ticket_id = t.id AND event_holds_place(r.status)), 0) END,
    'slug', t.slug, 'requires_approval', t.requires_approval, 'has_form', t.form_id IS NOT NULL,
    'opens_at', t.opens_at, 'closes_at', t.closes_at,
    'state', (SELECT event_type_state(e, t) FROM events e WHERE e.id = t.event_id)
  ) ORDER BY t.sort, t.created_at), '[]'::jsonb)
  FROM event_tickets t WHERE t.event_id = p_event AND t.status <> 'draft';
$$;

CREATE OR REPLACE FUNCTION event_public_json(e events)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'organiser_id', e.workspace_id, 'slug', e.slug, 'title', e.title,
    'summary', e.summary, 'description', e.description, 'category', e.category,
    'cover_url', e.cover_url, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
    'timezone', e.timezone, 'mode', e.mode, 'venue_name', e.venue_name,
    'address', e.address, 'city', e.city, 'status', e.status, 'visibility', e.visibility,
    'organiser_name', coalesce(nullif(e.organiser_name, ''), (SELECT w.name FROM workspaces w WHERE w.id = e.workspace_id), ''),
    'organiser_logo_url', e.organiser_logo_url, 'tagline', e.tagline, 'programme', to_jsonb(e.programme), 'brand', e.brand,
    'questions', e.questions,
    'registered', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status)),
    'tickets', event_ticket_list(e.id)
  );
$$;

-- Upcoming events; ones with a date to be announced come last.
CREATE OR REPLACE FUNCTION public_events()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(event_public_json(e) - 'description' - 'questions' ORDER BY e.starts_at NULLS LAST, e.created_at), '[]'::jsonb)
  FROM (SELECT * FROM events
        WHERE status = 'published' AND visibility = 'public' AND (ends_at IS NULL OR ends_at > now())
        ORDER BY starts_at NULLS LAST LIMIT 200) e;
$$;

CREATE OR REPLACE FUNCTION public_event_stats()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'upcoming', (SELECT count(*) FROM events WHERE status = 'published' AND visibility = 'public' AND (ends_at IS NULL OR ends_at > now())),
    'registrations', (SELECT count(*) FROM event_registrations r JOIN events e ON e.id = r.event_id
                      WHERE event_holds_place(r.status) AND e.status = 'published' AND e.visibility = 'public'),
    'cities', (SELECT count(DISTINCT lower(city)) FROM events WHERE status = 'published' AND visibility = 'public' AND city <> ''),
    'organisers', (SELECT count(DISTINCT workspace_id) FROM events WHERE status = 'published' AND visibility = 'public')
  );
$$;

-- The ticket page also shows the registration type and the short code.
CREATE OR REPLACE FUNCTION public_ticket(p_token uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'qr_token', r.qr_token, 'pin', r.pin, 'ticket_code', r.ticket_code, 'first_name', r.first_name, 'last_name', r.last_name,
    'email', r.email, 'status', r.status, 'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'checked_in_at', r.checked_in_at, 'created_at', r.created_at,
    'ticket_name', t.name, 'requires_approval', coalesce(t.requires_approval, false), 'currency', coalesce(t.currency, 'NGN'),
    'online_url', CASE WHEN event_holds_place(r.status) THEN e.online_url ELSE '' END,
    'event', event_public_json(e) - 'questions' - 'tickets'
  )
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN event_tickets t ON t.id = r.ticket_id
  WHERE r.qr_token = p_token LIMIT 1;
$$;

/** The registration page: the event, the type and whether it's open, and the form to fill in. */
CREATE OR REPLACE FUNCTION public_event_registration(p_slug text, p_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE e events; t event_tickets; f forms;
BEGIN
  SELECT * INTO e FROM events WHERE slug = lower(btrim(p_slug)) AND status IN ('published', 'cancelled');
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO t FROM event_tickets WHERE event_id = e.id AND slug = lower(btrim(p_type)) AND status <> 'draft';
  IF NOT FOUND OR t.form_id IS NULL THEN RETURN jsonb_build_object('event', event_public_json(e) - 'questions', 'type', NULL); END IF;
  SELECT * INTO f FROM forms WHERE id = t.form_id;
  RETURN jsonb_build_object(
    'event', event_public_json(e) - 'questions',
    'privacy_notice', e.privacy_notice,
    'type', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'description', t.description,
      'requires_approval', t.requires_approval, 'price_minor', t.price_minor, 'currency', t.currency,
      'opens_at', t.opens_at, 'closes_at', t.closes_at, 'state', event_type_state(e, t)),
    'form', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object('id', f.id, 'name', f.name, 'description', f.description,
      'definition', form_definition_json(f.definition)) END
  );
END $$;
REVOKE ALL ON FUNCTION public_event_registration(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_event_registration(text, text) TO anon, authenticated;

/**
 * Register (or apply) through a registration type's form. The answers are by form field id;
 * name, email and phone come from the fields saved to the contact (or by field type).
 * Returns { status: 'confirmed' | 'applied', qr_token?, ticket_code?, first_name, type_name }
 * or { status: 'duplicate' } when this email (or phone) already holds a live registration
 * of this type. Raises closed / full / not_open_yet / consent_required / email_invalid /
 * name_required / busy / not_found.
 */
CREATE OR REPLACE FUNCTION event_register(p_slug text, p_type text, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e events; t event_tickets; f forms; def jsonb; el jsonb; a jsonb := coalesce(p_answers, '{}'::jsonb);
  k text; v text; first text; last text; full_name text; em text; ph text;
  consent_needed boolean := false; consent_given boolean := false;
  state text; cid uuid; sid uuid; reg event_registrations; new_pin text; st text;
BEGIN
  SELECT * INTO e FROM events WHERE slug = lower(btrim(coalesce(p_slug, ''))) AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  -- Lock the type so two people can't take the last place at once.
  SELECT * INTO t FROM event_tickets WHERE event_id = e.id AND slug = lower(btrim(coalesce(p_type, ''))) FOR UPDATE;
  IF NOT FOUND OR t.form_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  state := event_type_state(e, t);
  IF state <> 'open' THEN RAISE EXCEPTION '%', CASE WHEN state IN ('full', 'not_open_yet') THEN state ELSE 'closed' END; END IF;
  IF (SELECT count(*) FROM event_registrations WHERE ticket_id = t.id AND created_at > now() - interval '1 minute') >= 60 THEN
    RAISE EXCEPTION 'busy';
  END IF;

  SELECT * INTO f FROM forms WHERE id = t.form_id;
  def := form_definition_json(f.definition);
  FOR el IN SELECT value FROM jsonb_each(coalesce(def->'elements', '{}'::jsonb)) LOOP
    CONTINUE WHEN el->'field' IS NULL;
    k := coalesce(el->'field'->>'mappedContactField', el->>'type');
    v := btrim(coalesce(a->>(el->'field'->>'fieldId'), ''));
    IF el->>'type' = 'consent' THEN
      IF coalesce((el->'field'->>'required')::boolean, false) AND v <> 'true' THEN consent_needed := true; END IF;
      IF v = 'true' THEN consent_given := true; END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN v = '';
    IF k = 'first_name' AND first IS NULL THEN first := v;
    ELSIF k = 'last_name' AND last IS NULL THEN last := v;
    ELSIF k = 'full_name' AND full_name IS NULL THEN full_name := v;
    ELSIF k = 'email' AND em IS NULL THEN em := lower(v);
    ELSIF k = 'phone' AND ph IS NULL THEN ph := v;
    END IF;
  END LOOP;
  IF consent_needed THEN RAISE EXCEPTION 'consent_required'; END IF;
  IF first IS NULL AND full_name IS NOT NULL THEN
    first := split_part(full_name, ' ', 1);
    last := coalesce(last, nullif(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), ''));
  END IF;
  IF coalesce(first, '') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF coalesce(em, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;

  -- Already registered for this type (by email, or by phone when given)? Nothing new is made.
  IF EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_id = e.id AND r.ticket_id = t.id AND r.status NOT IN ('cancelled', 'declined')
             AND (lower(r.email) = em OR (ph IS NOT NULL AND length(regexp_replace(ph, '\D', '', 'g')) >= 9
                  -- The same number with or without its country code: the last nine digits match.
                  AND right(regexp_replace(r.phone, '\D', '', 'g'), 9) = right(regexp_replace(ph, '\D', '', 'g'), 9)))) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'type_name', t.name);
  END IF;

  -- Every registrant becomes (or updates) a contact in the host's CRM.
  SELECT id INTO cid FROM contacts WHERE workspace_id = e.workspace_id AND lower(email) = em ORDER BY created_at LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, source)
    VALUES (e.workspace_id, left(first, 80), left(coalesce(last, ''), 80), em, left(coalesce(ph, ''), 40), 'event')
    RETURNING id INTO cid;
  ELSE
    UPDATE contacts SET phone = coalesce(nullif(phone, ''), left(ph, 40)), last_activity_at = now() WHERE id = cid;
  END IF;

  -- The answers also land in the form's responses (and start "form submitted" workflows).
  INSERT INTO form_submissions (workspace_id, form_id, contact_id, answers, source, meta)
  VALUES (e.workspace_id, f.id, cid, a, 'event', jsonb_build_object('event_id', e.id, 'event', e.title, 'registration_type', t.name))
  RETURNING id INTO sid;

  LOOP
    new_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = e.id AND pin = new_pin);
  END LOOP;
  st := CASE WHEN t.requires_approval THEN 'applied' ELSE 'confirmed' END;

  INSERT INTO event_registrations (event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin,
    status, payment_status, amount_minor, ticket_code, consent_at, form_submission_id, status_changed_at)
  VALUES (e.id, t.id, cid, left(first, 80), left(coalesce(last, ''), 80), em, left(coalesce(ph, ''), 40), a, new_pin,
    st, CASE WHEN t.price_minor > 0 THEN 'unpaid' ELSE 'free' END, t.price_minor,
    CASE WHEN st = 'confirmed' THEN event_ticket_code(e.slug) END,
    CASE WHEN consent_given THEN now() END, sid, now())
  RETURNING * INTO reg;

  RETURN jsonb_build_object('status', reg.status, 'first_name', reg.first_name, 'type_name', t.name,
    'qr_token', CASE WHEN event_holds_place(reg.status) THEN reg.qr_token END, 'ticket_code', reg.ticket_code);
END $$;
REVOKE ALL ON FUNCTION event_register(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_register(text, text, jsonb) TO anon, authenticated;

-- Older registrations made before ticket codes: give the ones holding a place a code.
UPDATE event_registrations r SET ticket_code = event_ticket_code(e.slug)
FROM events e WHERE e.id = r.event_id AND r.ticket_code IS NULL AND event_holds_place(r.status);
