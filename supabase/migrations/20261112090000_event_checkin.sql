/*
  # Event check-in at the door

  Everything the door scanner needs, done on the server so a phone can never show a false green:
    - event_can_check_in(event): the event's organisers (account members with Events access) and the
      people on its check-in team (event_staff, members of the account) may check guests in.
    - event_checkin_state(event): title, colours and the live count (checked in / expected).
    - event_check_in(event, scan, registration, paid): checks someone in from a scanned QR (its
      signature is verified and it must belong to THIS event), a ticket code, or a person picked from
      search. Every attempt is written to event_checkins: success, already_checked_in, invalid, not_eligible.
    - event_undo_check_in(event, registration): undoes a check-in; logged and audited.
    - event_checkin_search(event, query): name, email, phone, ticket code or 6-digit PIN.
    - event_checkin_log(event): the latest attempts, with who scanned.
    - event_staff_list / event_staff_set: the check-in team, managed by the event's organisers.
  At most 120 check-in calls a minute per person.
*/

-- 1. Who may check people in ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_is_organiser(p_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event AND is_workspace_member(e.workspace_id) AND member_can(e.workspace_id, 'events'))
$$;
REVOKE ALL ON FUNCTION event_is_organiser(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION event_can_check_in(p_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT event_is_organiser(p_event) OR EXISTS (
    SELECT 1 FROM event_staff s JOIN events e ON e.id = s.event_id
    WHERE s.event_id = p_event AND s.user_id = auth.uid() AND is_workspace_member(e.workspace_id))
$$;
REVOKE ALL ON FUNCTION event_can_check_in(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_can_check_in(uuid) TO authenticated;

-- A person's name for "checked in by".
CREATE OR REPLACE FUNCTION event_person_name(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') FROM profiles p WHERE p.user_id = p_user
$$;
REVOKE ALL ON FUNCTION event_person_name(uuid) FROM PUBLIC, anon, authenticated;

-- 2. The scanner's header ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_checkin_state(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RETURN jsonb_build_object('allowed', false); END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  RETURN jsonb_build_object(
    'allowed', true,
    'organiser', event_is_organiser(p_event),
    'id', e.id, 'title', e.title, 'slug', e.slug, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone,
    'cover_url', e.cover_url, 'brand', e.brand,
    'expected', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status)),
    'checked_in', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status) AND r.checked_in_at IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION event_checkin_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_checkin_state(uuid) TO authenticated;

-- 3. Checking someone in -----------------------------------------------------------------------

-- What the scanner shows about a registration.
CREATE OR REPLACE FUNCTION event_checkin_person(r event_registrations) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'registration_id', r.id, 'name', btrim(r.first_name || ' ' || r.last_name), 'status', r.status,
    'type_name', (SELECT t.name FROM event_tickets t WHERE t.id = r.ticket_id),
    'ticket_code', r.ticket_code, 'checked_in_at', r.checked_in_at, 'checked_in_by', event_person_name(r.checked_in_by),
    'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'currency', (SELECT t.currency FROM event_tickets t WHERE t.id = r.ticket_id))
$$;
REVOKE ALL ON FUNCTION event_checkin_person(event_registrations) FROM PUBLIC, anon, authenticated;

/*
  p_scan: what the camera read (the ticket link with its signature) or a typed ticket code / PIN.
  p_registration: someone picked from search. p_paid: the door collected an unpaid ticket's price.
  Returns { result, reason?, person? }:
    success            green: checked in now
    already_checked_in amber: with when and by whom
    invalid            red: unrecognised, forged or another event's code
    not_eligible       red: cancelled, declined, an application not selected, or (reason 'unpaid') to pay first
*/
CREATE OR REPLACE FUNCTION event_check_in(p_event uuid, p_scan text DEFAULT NULL, p_registration uuid DEFAULT NULL, p_paid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r event_registrations; e events;
  scan text := btrim(coalesce(p_scan, ''));
  tok uuid; sig text; m text[];
  via text := CASE WHEN p_registration IS NOT NULL THEN 'manual' WHEN p_scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' OR p_scan ~ '^\s*\d{6}\s*$' THEN 'manual' ELSE 'scan' END;
  res text; reason text;
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF (SELECT count(*) FROM event_checkins WHERE user_id = auth.uid() AND at > now() - interval '1 minute') >= 120 THEN RAISE EXCEPTION 'busy'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;

  -- Find the registration, only ever inside this event.
  IF p_registration IS NOT NULL THEN
    SELECT * INTO r FROM event_registrations WHERE id = p_registration AND event_id = p_event FOR UPDATE;
  ELSIF scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' THEN
    SELECT * INTO r FROM event_registrations WHERE upper(ticket_code) = upper(scan) AND event_id = p_event FOR UPDATE;
  ELSIF scan ~ '^\d{6}$' THEN
    SELECT * INTO r FROM event_registrations WHERE pin = scan AND event_id = p_event FOR UPDATE;
  ELSE
    -- A ticket link: /e/ticket/<token>?v=<signature>. Without a valid signature it is refused.
    m := regexp_match(scan, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
    IF m IS NOT NULL THEN tok := lower(m[1])::uuid; END IF;
    sig := (regexp_match(scan, '[?&]v=([0-9a-fA-F]{16})'))[1];
    IF tok IS NOT NULL AND ticket_sig_ok(tok, sig) THEN
      SELECT * INTO r FROM event_registrations WHERE qr_token = tok AND event_id = p_event FOR UPDATE;
    END IF;
  END IF;

  IF r.id IS NULL THEN
    INSERT INTO event_checkins (event_id, registration_id, user_id, result, via) VALUES (p_event, NULL, auth.uid(), 'invalid', via);
    RETURN jsonb_build_object('result', 'invalid', 'reason',
      CASE WHEN tok IS NOT NULL AND ticket_sig_ok(tok, sig) THEN 'other_event' WHEN tok IS NOT NULL THEN 'unsigned' ELSE 'unknown' END);
  END IF;

  IF NOT event_holds_place(r.status) THEN
    res := 'not_eligible'; reason := r.status;
  ELSIF r.checked_in_at IS NOT NULL THEN
    res := 'already_checked_in';
  ELSIF r.payment_status = 'unpaid' AND NOT p_paid THEN
    res := 'not_eligible'; reason := 'unpaid';
  ELSE
    UPDATE event_registrations SET checked_in_at = now(), checked_in_by = auth.uid(),
      payment_status = CASE WHEN p_paid AND payment_status = 'unpaid' THEN 'paid' ELSE payment_status END
    WHERE id = r.id RETURNING * INTO r;
    res := 'success';
  END IF;

  INSERT INTO event_checkins (event_id, registration_id, user_id, result, via) VALUES (p_event, r.id, auth.uid(), res, via);
  RETURN jsonb_build_object('result', res, 'reason', reason, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_check_in(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_check_in(uuid, text, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION event_undo_check_in(p_event uuid, p_registration uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO r FROM event_registrations WHERE id = p_registration AND event_id = p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.checked_in_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'person', event_checkin_person(r)); END IF;
  UPDATE event_registrations SET checked_in_at = NULL, checked_in_by = NULL WHERE id = r.id RETURNING * INTO r;
  INSERT INTO event_checkins (event_id, registration_id, user_id, result, via) VALUES (p_event, r.id, auth.uid(), 'undone', 'undo');
  SELECT * INTO e FROM events WHERE id = p_event;
  PERFORM audit_write(e.workspace_id, 'checkin_undone', 'event_registration', r.id,
    jsonb_build_object('name', btrim(r.first_name || ' ' || r.last_name), 'event', e.title));
  RETURN jsonb_build_object('ok', true, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_undo_check_in(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_undo_check_in(uuid, uuid) TO authenticated;

-- 4. Looking someone up -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_checkin_search(p_event uuid, p_query text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q text := lower(btrim(coalesce(p_query, ''))); digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF length(q) < 2 THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(event_checkin_person(x) ORDER BY x.first_name, x.last_name)
    FROM (
      SELECT r.* FROM event_registrations r
      WHERE r.event_id = p_event AND r.status NOT IN ('declined')
        AND (lower(r.first_name || ' ' || r.last_name) LIKE '%' || q || '%'
          OR lower(r.email) LIKE '%' || q || '%'
          OR lower(coalesce(r.ticket_code, '')) = q
          OR (length(digits) = 6 AND r.pin = digits)
          OR (length(digits) >= 7 AND right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 9) = right(digits, 9)))
      ORDER BY r.first_name, r.last_name LIMIT 25
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_checkin_search(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_checkin_search(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION event_checkin_log(p_event uuid, p_limit int DEFAULT 30) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'at', c.at, 'result', c.result, 'via', c.via,
      'name', btrim(r.first_name || ' ' || r.last_name), 'registration_id', c.registration_id, 'by', event_person_name(c.user_id)) ORDER BY c.at DESC, c.id DESC)
    FROM (SELECT * FROM event_checkins WHERE event_id = p_event ORDER BY at DESC, id DESC LIMIT least(greatest(p_limit, 1), 200)) c
    LEFT JOIN event_registrations r ON r.id = c.registration_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_checkin_log(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_checkin_log(uuid, int) TO authenticated;

-- 5. The check-in team ------------------------------------------------------------------------

-- The account's members, each marked if they're on this event's check-in team.
CREATE OR REPLACE FUNCTION event_staff_list(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(event_person_name(m.user_id), u.email), 'email', u.email,
      'on_team', s.user_id IS NOT NULL, 'organiser', m.role IN ('owner', 'admin') OR 'events' = ANY(coalesce(m.access, default_member_access()))) ORDER BY coalesce(event_person_name(m.user_id), u.email))
    FROM workspace_members m JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN event_staff s ON s.event_id = p_event AND s.user_id = m.user_id
    WHERE m.workspace_id = e.workspace_id AND coalesce(m.status, 'active') = 'active'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_staff_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_staff_list(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION event_staff_set(p_event uuid, p_user uuid, p_on boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e events;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  IF p_on THEN
    IF NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = e.workspace_id AND user_id = p_user) THEN RAISE EXCEPTION 'not_member'; END IF;
    INSERT INTO event_staff (event_id, user_id, added_by) VALUES (p_event, p_user, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM event_staff WHERE event_id = p_event AND user_id = p_user;
  END IF;
  PERFORM audit_write(e.workspace_id, CASE WHEN p_on THEN 'checkin_staff_added' ELSE 'checkin_staff_removed' END, 'event', e.id,
    jsonb_build_object('event', e.title, 'person', event_person_name(p_user)));
END $$;
REVOKE ALL ON FUNCTION event_staff_set(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_staff_set(uuid, uuid, boolean) TO authenticated;
