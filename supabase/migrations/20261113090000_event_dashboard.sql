/*
  # Event dashboard: what organisers need beyond the door

    - event_registration_forms(event): each registration type's form questions, so the dashboard
      and the performer review board can show answers with their labels (organisers only, even
      without access to Forms).
    - event_add_registration(...): add someone by hand (a walk-in, a guest, a performer you invited).
      They get a ticket code at once; their ticket is emailed when you ask and an email account is
      connected. A full type is refused unless you say to add them anyway.
    - event_send_ticket(registration): email someone their ticket (or "application received") again.
      At most once a minute per person.
  Organisers are account members with access to Events (event_is_organiser, from the check-in update).
*/

-- 1. Each type's form, for labelling answers -------------------------------------------------

CREATE OR REPLACE FUNCTION event_registration_forms(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('ticket_id', t.id, 'form_id', f.id, 'form_name', f.name, 'definition', form_definition_json(f.definition)) ORDER BY t.sort)
    FROM event_tickets t JOIN forms f ON f.id = t.form_id
    WHERE t.event_id = p_event), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_registration_forms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_registration_forms(uuid) TO authenticated;

-- 2. Adding someone by hand -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_add_registration(
  p_event uuid, p_ticket uuid, p_first text, p_last text, p_email text, p_phone text DEFAULT NULL,
  p_send boolean DEFAULT true, p_over_capacity boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e events; t event_tickets; reg event_registrations;
  first text := left(btrim(coalesce(p_first, '')), 80); last text := left(btrim(coalesce(p_last, '')), 80);
  em text := lower(btrim(coalesce(p_email, ''))); ph text := nullif(left(btrim(coalesce(p_phone, '')), 40), '');
  cid uuid; sid uuid; new_pin text; st text; taken int;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  SELECT * INTO t FROM event_tickets WHERE id = p_ticket AND event_id = p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_not_found'; END IF;
  IF first = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;
  IF EXISTS (SELECT 1 FROM event_registrations r WHERE r.event_id = e.id AND r.ticket_id = t.id AND r.status NOT IN ('cancelled', 'declined') AND lower(r.email) = em) THEN
    RAISE EXCEPTION 'duplicate';
  END IF;
  IF t.capacity IS NOT NULL AND NOT p_over_capacity THEN
    SELECT count(*) INTO taken FROM event_registrations WHERE ticket_id = t.id AND event_holds_place(status);
    IF taken >= t.capacity THEN RAISE EXCEPTION 'full'; END IF;
  END IF;

  -- They join the host's contacts, like anyone who registers.
  SELECT id INTO cid FROM contacts WHERE workspace_id = e.workspace_id AND lower(email) = em ORDER BY created_at LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO contacts (workspace_id, first_name, last_name, email, phone, source)
    VALUES (e.workspace_id, first, last, em, coalesce(ph, ''), 'event') RETURNING id INTO cid;
  END IF;

  -- Emails go through the form-response mailer, so a ticket to send needs a response to hang on.
  IF p_send AND t.form_id IS NOT NULL THEN
    INSERT INTO form_submissions (workspace_id, form_id, contact_id, answers, source, meta)
    VALUES (e.workspace_id, t.form_id, cid, jsonb_build_object('name', btrim(first || ' ' || last), 'email', em, 'phone', coalesce(ph, '')), 'event_manual',
      jsonb_build_object('event_id', e.id, 'event', e.title, 'registration_type', t.name, 'added_by', auth.uid()))
    RETURNING id INTO sid;
  END IF;

  LOOP
    new_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = e.id AND pin = new_pin);
  END LOOP;
  -- Added by the organiser: an approval type means they're already chosen.
  st := CASE WHEN t.requires_approval THEN 'selected' ELSE 'confirmed' END;

  INSERT INTO event_registrations (event_id, ticket_id, contact_id, first_name, last_name, email, phone, answers, pin,
    status, payment_status, amount_minor, ticket_code, form_submission_id, status_changed_at)
  VALUES (e.id, t.id, cid, first, last, em, coalesce(ph, ''), jsonb_build_object('added_by_organiser', true), new_pin,
    st, CASE WHEN t.price_minor > 0 THEN 'unpaid' ELSE 'free' END, t.price_minor, event_ticket_code(e.slug), sid, now())
  RETURNING * INTO reg;
  -- 'selected' isn't emailed by the insert trigger (only confirmed/applied are): send it here.
  IF st = 'selected' AND sid IS NOT NULL THEN PERFORM event_email(reg.id, 'selected'); END IF;

  PERFORM audit_write(e.workspace_id, 'registration_added', 'event_registration', reg.id,
    jsonb_build_object('name', btrim(first || ' ' || last), 'event', e.title, 'type', t.name));
  SELECT * INTO reg FROM event_registrations WHERE id = reg.id;
  RETURN to_jsonb(reg) || jsonb_build_object('emailed', reg.last_email_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION event_add_registration(uuid, uuid, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_add_registration(uuid, uuid, text, text, text, text, boolean, boolean) TO authenticated;

-- 3. Send a ticket again (organiser) --------------------------------------------------------

CREATE OR REPLACE FUNCTION event_send_ticket(p_reg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; e events; kind text; ok boolean; fid uuid; sid uuid;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF auth.uid() IS NULL OR NOT event_is_organiser(r.event_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF r.last_email_at IS NOT NULL AND r.last_email_at > now() - interval '1 minute' THEN RAISE EXCEPTION 'too_soon'; END IF;
  kind := CASE WHEN r.status = 'confirmed' THEN 'confirmed' WHEN r.status = 'selected' THEN 'selected'
               WHEN r.status IN ('applied', 'shortlisted') THEN 'applied' END;
  IF kind IS NULL THEN RAISE EXCEPTION 'no_ticket'; END IF;
  -- Added by hand without an email: give them a form response now so the mailer can send it.
  IF r.form_submission_id IS NULL THEN
    SELECT * INTO e FROM events WHERE id = r.event_id;
    SELECT form_id INTO fid FROM event_tickets WHERE id = r.ticket_id;
    IF fid IS NULL THEN RAISE EXCEPTION 'no_email_route'; END IF;
    INSERT INTO form_submissions (workspace_id, form_id, contact_id, answers, source, meta)
    VALUES (e.workspace_id, fid, r.contact_id, jsonb_build_object('name', btrim(r.first_name || ' ' || r.last_name), 'email', r.email, 'phone', r.phone), 'event_manual',
      jsonb_build_object('event_id', e.id, 'event', e.title))
    RETURNING id INTO sid;
    UPDATE event_registrations SET form_submission_id = sid WHERE id = r.id;
  END IF;
  ok := event_email(r.id, kind);
  IF NOT ok THEN RAISE EXCEPTION 'no_email_account'; END IF;
  RETURN jsonb_build_object('sent', true, 'to', r.email);
END $$;
REVOKE ALL ON FUNCTION event_send_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_send_ticket(uuid) TO authenticated;
