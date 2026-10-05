/*
  # Events: public event pages, tickets, registration with QR + PIN, check-in

  Safe to run more than once.

  1. events            an event an account hosts; public at /e/<slug> once published
  2. event_tickets     ticket types (Free, VIP…) with optional price and capacity
  3. event_registrations
                       one person's registration: their answers, a 6-digit PIN and a QR token.
                       Paid tickets are reserved and paid at the venue (payment_status 'unpaid')
                       until online payment is connected.
  4. Public access goes only through SECURITY DEFINER functions:
       public_events()               published, public, not yet ended
       public_event(slug)            one published event with its tickets and spaces left
       public_event_stats()          real totals for the events home page
       register_for_event(...)       registers someone, respecting capacity; adds them to Contacts
       public_ticket(token)          the attendee's ticket page
  5. Storage bucket event-covers (public read) for posters.
*/

-- 1. events ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 280),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  category text NOT NULL DEFAULT 'community',
  cover_url text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  mode text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'online', 'hybrid')),
  venue_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  online_url text NOT NULL DEFAULT '',
  organiser_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted')),
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS events_slug_key ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_workspace_start ON events(workspace_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_public ON events(status, visibility, ends_at);

-- 2. tickets -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 400),
  price_minor integer NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_tickets_event ON event_tickets(event_id, sort);

-- 3. registrations -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES event_tickets(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 80),
  last_name text NOT NULL DEFAULT '' CHECK (char_length(last_name) <= 80),
  email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(email) <= 200),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  pin text NOT NULL CHECK (pin ~ '^[0-9]{6}$'),
  qr_token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  payment_status text NOT NULL DEFAULT 'free' CHECK (payment_status IN ('free', 'unpaid', 'paid')),
  amount_minor integer NOT NULL DEFAULT 0,
  checked_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_qr_key ON event_registrations(qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_pin_key ON event_registrations(event_id, pin);
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_email_key ON event_registrations(event_id, lower(email)) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_event_registrations_event ON event_registrations(event_id, created_at DESC);

-- RLS: account members manage their own events; the public uses the functions below.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select" ON events;
CREATE POLICY "events_select" ON events FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "events_insert" ON events;
CREATE POLICY "events_insert" ON events FOR INSERT TO authenticated WITH CHECK (is_workspace_member(workspace_id) AND created_by = auth.uid());
DROP POLICY IF EXISTS "events_update" ON events;
CREATE POLICY "events_update" ON events FOR UPDATE TO authenticated USING (is_workspace_member(workspace_id)) WITH CHECK (is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "events_delete" ON events;
CREATE POLICY "events_delete" ON events FOR DELETE TO authenticated USING (created_by = auth.uid() OR is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "event_tickets_all" ON event_tickets;
CREATE POLICY "event_tickets_all" ON event_tickets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));

DROP POLICY IF EXISTS "event_registrations_select" ON event_registrations;
CREATE POLICY "event_registrations_select" ON event_registrations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "event_registrations_update" ON event_registrations;
CREATE POLICY "event_registrations_update" ON event_registrations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "event_registrations_delete" ON event_registrations;
CREATE POLICY "event_registrations_delete" ON event_registrations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND is_workspace_admin(e.workspace_id)));

-- 4. Public functions --------------------------------------------------------------------

-- Tickets of one event with how many places are left (null = unlimited).
CREATE OR REPLACE FUNCTION event_ticket_list(p_event uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'description', t.description,
    'price_minor', t.price_minor, 'currency', t.currency, 'capacity', t.capacity,
    'remaining', CASE WHEN t.capacity IS NULL THEN NULL ELSE greatest(t.capacity - (
      SELECT count(*) FROM event_registrations r WHERE r.ticket_id = t.id AND r.status = 'confirmed'), 0) END
  ) ORDER BY t.sort, t.created_at), '[]'::jsonb)
  FROM event_tickets t WHERE t.event_id = p_event;
$$;
REVOKE ALL ON FUNCTION event_ticket_list(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION event_public_json(e events)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'organiser_id', e.workspace_id, 'slug', e.slug, 'title', e.title,
    'summary', e.summary, 'description', e.description, 'category', e.category,
    'cover_url', e.cover_url, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
    'timezone', e.timezone, 'mode', e.mode, 'venue_name', e.venue_name,
    'address', e.address, 'city', e.city, 'status', e.status, 'visibility', e.visibility,
    'organiser_name', coalesce(nullif(e.organiser_name, ''), (SELECT w.name FROM workspaces w WHERE w.id = e.workspace_id), ''),
    'questions', e.questions,
    'registered', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND r.status = 'confirmed'),
    'tickets', event_ticket_list(e.id)
  );
$$;
REVOKE ALL ON FUNCTION event_public_json(events) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public_events()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(event_public_json(e) - 'description' - 'questions' ORDER BY e.starts_at), '[]'::jsonb)
  FROM (SELECT * FROM events
        WHERE status = 'published' AND visibility = 'public' AND ends_at > now()
        ORDER BY starts_at LIMIT 200) e;
$$;
REVOKE ALL ON FUNCTION public_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_events() TO anon, authenticated;

-- The online link is only given to registered attendees (public_ticket), never on the open page.
CREATE OR REPLACE FUNCTION public_event(p_slug text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT event_public_json(e) FROM events e
  WHERE e.slug = lower(btrim(p_slug)) AND e.status IN ('published', 'cancelled') LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_event(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_event(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public_event_stats()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'upcoming', (SELECT count(*) FROM events WHERE status = 'published' AND visibility = 'public' AND ends_at > now()),
    'registrations', (SELECT count(*) FROM event_registrations r JOIN events e ON e.id = r.event_id
                      WHERE r.status = 'confirmed' AND e.status = 'published' AND e.visibility = 'public'),
    'cities', (SELECT count(DISTINCT lower(city)) FROM events WHERE status = 'published' AND visibility = 'public' AND city <> ''),
    'organisers', (SELECT count(DISTINCT workspace_id) FROM events WHERE status = 'published' AND visibility = 'public')
  );
$$;
REVOKE ALL ON FUNCTION public_event_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_event_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION register_for_event(
  p_slug text, p_ticket uuid, p_first text, p_last text, p_email text, p_phone text, p_answers jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev events;
  tk event_tickets;
  taken integer;
  new_pin text;
  reg event_registrations;
  cid uuid;
  q jsonb;
  em text := lower(btrim(coalesce(p_email, '')));
BEGIN
  SELECT * INTO ev FROM events WHERE slug = lower(btrim(p_slug)) AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF ev.ends_at < now() THEN RAISE EXCEPTION 'event_over'; END IF;
  IF coalesce(btrim(p_first), '') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;

  -- Lock the ticket row so two people can't take the last place at once.
  SELECT * INTO tk FROM event_tickets WHERE id = p_ticket AND event_id = ev.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found'; END IF;
  IF tk.capacity IS NOT NULL THEN
    SELECT count(*) INTO taken FROM event_registrations WHERE ticket_id = tk.id AND status = 'confirmed';
    IF taken >= tk.capacity THEN RAISE EXCEPTION 'sold_out'; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM event_registrations WHERE event_id = ev.id AND lower(email) = em AND status = 'confirmed') THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  -- Required questions must be answered.
  FOR q IN SELECT * FROM jsonb_array_elements(ev.questions) LOOP
    IF coalesce((q->>'required')::boolean, false)
       AND coalesce(btrim(coalesce(p_answers, '{}'::jsonb)->>(q->>'id')), '') IN ('', 'false') THEN
      RAISE EXCEPTION 'answer_required';
    END IF;
  END LOOP;

  LOOP
    new_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = ev.id AND pin = new_pin);
  END LOOP;

  -- Every registrant becomes (or updates) a contact in the host's CRM.
  SELECT id INTO cid FROM contacts WHERE workspace_id = ev.workspace_id AND lower(email) = em LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, source)
    VALUES (ev.workspace_id, btrim(p_first), btrim(coalesce(p_last, '')), em, btrim(coalesce(p_phone, '')), 'event')
    RETURNING id INTO cid;
  ELSE
    UPDATE contacts SET last_activity_at = now() WHERE id = cid;
  END IF;

  INSERT INTO event_registrations (event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin,
                                   payment_status, amount_minor)
  VALUES (ev.id, tk.id, cid, left(btrim(p_first), 80), left(btrim(coalesce(p_last, '')), 80), em,
          left(btrim(coalesce(p_phone, '')), 40), coalesce(p_answers, '{}'::jsonb), new_pin,
          CASE WHEN tk.price_minor > 0 THEN 'unpaid' ELSE 'free' END, tk.price_minor)
  RETURNING * INTO reg;

  RETURN jsonb_build_object('qr_token', reg.qr_token, 'pin', reg.pin);
END;
$$;
REVOKE ALL ON FUNCTION register_for_event(text, uuid, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_for_event(text, uuid, text, text, text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public_ticket(p_token uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'qr_token', r.qr_token, 'pin', r.pin, 'first_name', r.first_name, 'last_name', r.last_name,
    'email', r.email, 'status', r.status, 'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'checked_in_at', r.checked_in_at, 'created_at', r.created_at,
    'ticket_name', t.name, 'currency', coalesce(t.currency, 'NGN'),
    'online_url', e.online_url,
    'event', event_public_json(e) - 'questions' - 'tickets'
  )
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN event_tickets t ON t.id = r.ticket_id
  WHERE r.qr_token = p_token LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_ticket(uuid) TO anon, authenticated;

-- 5. Posters ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "event_covers_public_read" ON storage.objects;
CREATE POLICY "event_covers_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'event-covers');
DROP POLICY IF EXISTS "event_covers_authed_upload" ON storage.objects;
CREATE POLICY "event_covers_authed_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-covers');
DROP POLICY IF EXISTS "event_covers_authed_update" ON storage.objects;
CREATE POLICY "event_covers_authed_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'event-covers') WITH CHECK (bucket_id = 'event-covers');
