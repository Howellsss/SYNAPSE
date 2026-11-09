-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Events update (11 November 2026): signed QR tickets, resending tickets, branded emails when people
-- register, apply, are selected or declined. Run database-updates-8.sql first. Safe to run more than once.
-- Made from supabase/migrations/20261111090000_event_tickets_emails.sql; don't edit here.

/*
  # Event tickets you can trust, and the emails that carry them

  1. Signed tickets. Every ticket's QR holds a link with a signature: /e/ticket/<token>?v=<sig>,
     where sig is an HMAC of the token made with a secret that never leaves the database. The door
     scanner (next phase) checks the signature before looking anything up, so a made-up or altered
     code is refused at once.
  2. Emails, sent from the account's connected Gmail by the mailer that already sends form emails:
       confirmed  an attendee is registered: their ticket
       applied    an application arrived
       selected   an applicant was selected: their ticket
       declined   an applicant wasn't selected, kindly
     Each is branded with the event's colours and logo and can be reworded per event
     (events.email_templates). The QR in the email is a picture served by the `api` function.
  3. event_resend_ticket(event, email): emails the ticket again. It answers the same whether or not
     the email has a ticket, so nobody can use it to find out who registered.
  4. event_set_registration_status(registration, status): for the organiser's review board.
     Selecting issues the ticket and sends it; declining sends the kind note.

  Needs 20261110090000_event_registration_types.sql. Safe to run more than once.
*/

-- 1. Signed tickets ----------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS ev_private;
REVOKE ALL ON SCHEMA ev_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ev_private.settings (key text PRIMARY KEY, value text NOT NULL);
REVOKE ALL ON ev_private.settings FROM PUBLIC;
INSERT INTO ev_private.settings(key, value) VALUES ('ticket_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

-- The signature on a ticket: 16 hex characters of HMAC-SHA256(token, secret).
CREATE OR REPLACE FUNCTION ticket_sig(p_token uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT left(encode(hmac(p_token::text, (SELECT value FROM ev_private.settings WHERE key = 'ticket_secret'), 'sha256'), 'hex'), 16)
$$;
REVOKE ALL ON FUNCTION ticket_sig(uuid) FROM PUBLIC, anon, authenticated;

-- Whether a scanned signature belongs to this token (compared in full, never partly).
CREATE OR REPLACE FUNCTION ticket_sig_ok(p_token uuid, p_sig text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_token IS NOT NULL AND p_sig IS NOT NULL AND lower(p_sig) = ticket_sig(p_token)
$$;
REVOKE ALL ON FUNCTION ticket_sig_ok(uuid, text) FROM PUBLIC, anon, authenticated;

-- What the QR holds: the ticket's link with its signature.
CREATE OR REPLACE FUNCTION ticket_qr_url(p_token uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT wf_app_url() || '/e/ticket/' || p_token || '?v=' || ticket_sig(p_token)
$$;
REVOKE ALL ON FUNCTION ticket_qr_url(uuid) FROM PUBLIC, anon, authenticated;

-- For the `api` function's QR pictures (service role): the QR text, only for a correctly signed ticket.
CREATE OR REPLACE FUNCTION ticket_qr_text(p_token uuid, p_sig text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN ticket_sig_ok(p_token, p_sig) AND EXISTS (SELECT 1 FROM event_registrations WHERE qr_token = p_token) THEN ticket_qr_url(p_token) END
$$;
REVOKE ALL ON FUNCTION ticket_qr_text(uuid, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION ticket_qr_text(uuid, text) TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- 2. Emails --------------------------------------------------------------------------------

ALTER TABLE events ADD COLUMN IF NOT EXISTS email_templates jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS email_account_id uuid REFERENCES email_accounts(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS footer_line text NOT NULL DEFAULT '' CHECK (char_length(footer_line) <= 300);
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS last_email_at timestamptz;

-- The wording each email starts with; the organiser can change any of it per event.
CREATE OR REPLACE FUNCTION event_email_default(p_kind text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'confirmed' THEN jsonb_build_object('subject', 'You''re in: {{event}}',
      'message', E'Hi {{first_name}},\n\nYou''re registered for {{event}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!')
    WHEN 'applied' THEN jsonb_build_object('subject', 'We''ve got your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you for applying ({{type}}) for {{event}}. We read every application and we''ll be in touch once we''ve decided.')
    WHEN 'selected' THEN jsonb_build_object('subject', 'You''ve been selected: {{event}}',
      'message', E'Hi {{first_name}},\n\nGreat news: you''ve been selected for {{event}}! Your ticket is below. Show the QR code at the door, or give your ticket code {{code}}.\n\nWe can''t wait to see you.')
    WHEN 'declined' THEN jsonb_build_object('subject', 'About your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you so much for applying to {{event}}. We had more applications than places this time, so we can''t offer you a spot, but we''d love to see you there, and we hope you''ll apply again.')
  END
$$;

CREATE OR REPLACE FUNCTION html_esc(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- "Sat 6 Dec 2026, 6:00 PM", or "Date to be announced".
CREATE OR REPLACE FUNCTION event_date_text(e events) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN e.starts_at IS NULL THEN 'Date to be announced'
    ELSE trim(to_char(e.starts_at AT TIME ZONE coalesce(nullif(e.timezone, ''), 'UTC'), 'Dy FMDD Mon YYYY, FMHH12:MI AM')) END
$$;

/**
 * Queue one of the event emails for a registration. Returns false (and sends nothing) when there's
 * no connected email account, no email address, or the registration didn't come through a form
 * (the mailer sends the messages linked to a form response).
 */
CREATE OR REPLACE FUNCTION event_email(p_reg uuid, p_kind text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r event_registrations; e events; t event_tickets; acc email_accounts; tpl jsonb; subj text; msg text;
  primary_c text; accent_c text; place text; ticket boolean; link text; qr_img text; base text; html text; txt text; k text; v text;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg;
  IF NOT FOUND OR r.form_submission_id IS NULL OR coalesce(r.email, '') = '' THEN RETURN false; END IF;
  SELECT * INTO e FROM events WHERE id = r.event_id;
  SELECT * INTO t FROM event_tickets WHERE id = r.ticket_id;
  SELECT * INTO acc FROM email_accounts WHERE id = e.email_account_id AND status = 'active';
  IF NOT FOUND THEN SELECT * INTO acc FROM email_accounts WHERE workspace_id = e.workspace_id AND status = 'active' ORDER BY created_at LIMIT 1; END IF;
  IF acc.id IS NULL THEN RETURN false; END IF;

  tpl := event_email_default(p_kind) || coalesce(e.email_templates->p_kind, '{}'::jsonb);
  IF tpl IS NULL THEN RETURN false; END IF;
  ticket := p_kind IN ('confirmed', 'selected') AND event_holds_place(r.status);
  link := CASE WHEN ticket THEN wf_app_url() || '/e/ticket/' || r.qr_token END;
  place := concat_ws(', ', nullif(e.venue_name, ''), nullif(e.city, ''));
  subj := coalesce(nullif(btrim(tpl->>'subject'), ''), event_email_default(p_kind)->>'subject');
  msg := coalesce(nullif(btrim(tpl->>'message'), ''), event_email_default(p_kind)->>'message');
  FOR k, v IN SELECT * FROM (VALUES
    ('first_name', r.first_name), ('name', btrim(r.first_name || ' ' || r.last_name)), ('event', e.title), ('type', coalesce(t.name, '')),
    ('code', coalesce(r.ticket_code, '')), ('date', event_date_text(e)), ('venue', coalesce(nullif(place, ''), 'To be announced')),
    ('ticket_link', coalesce(link, ''))) x(k, v) LOOP
    subj := replace(subj, '{{' || k || '}}', coalesce(v, ''));
    msg := replace(msg, '{{' || k || '}}', coalesce(v, ''));
  END LOOP;

  primary_c := CASE WHEN coalesce(e.brand->>'primary', '') ~ '^#[0-9a-fA-F]{6}$' THEN e.brand->>'primary' ELSE '#0A1628' END;
  accent_c := CASE WHEN coalesce(e.brand->>'accent', '') ~ '^#[0-9a-fA-F]{6}$' THEN e.brand->>'accent' ELSE '#C8A96A' END;
  base := regexp_replace(coalesce((SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), ''), '/send-email$', '');
  qr_img := CASE WHEN ticket AND base <> '' THEN base || '/api/qr/' || r.qr_token || '.png?v=' || ticket_sig(r.qr_token) END;

  txt := msg
    || CASE WHEN ticket THEN E'\n\n' || e.title || E'\n' || event_date_text(e) || CASE WHEN place <> '' THEN E'\n' || place ELSE '' END
         || E'\nTicket: ' || coalesce(t.name, 'Ticket') || ' · ' || coalesce(r.ticket_code, '') || E'\nYour ticket: ' || link ELSE '' END
    || CASE WHEN e.footer_line <> '' THEN E'\n\n' || e.footer_line ELSE '' END;

  html := '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #E6E8EE;border-radius:16px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#1F2937;">'
    || '<tr><td style="height:6px;background:' || primary_c || ';background-image:linear-gradient(90deg,' || primary_c || ',' || accent_c || ');"></td></tr>'
    || '<tr><td style="padding:28px 32px 8px;">'
    || CASE WHEN coalesce(e.organiser_logo_url, '') ~ '^https://' THEN '<img src="' || html_esc(e.organiser_logo_url) || '" alt="" height="40" style="height:40px;margin-bottom:16px;">' ELSE '' END
    || '<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:' || primary_c || ';">' || html_esc(e.title) || '</p>'
    || '<div style="margin-top:14px;font-size:16px;line-height:1.6;">' || replace(html_esc(msg), E'\n', '<br>') || '</div></td></tr>'
    || CASE WHEN ticket THEN
         '<tr><td style="padding:16px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed #CBD2DE;border-radius:14px;"><tr><td align="center" style="padding:22px;">'
         || CASE WHEN qr_img IS NOT NULL THEN '<img src="' || html_esc(qr_img) || '" width="200" height="200" alt="Your ticket QR code" style="display:block;width:200px;height:200px;">' ELSE '' END
         || '<p style="margin:14px 0 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6B7280;">Ticket code</p>'
         || '<p style="margin:2px 0 0;font-size:26px;font-weight:800;letter-spacing:3px;color:#0A1628;">' || html_esc(r.ticket_code) || '</p>'
         || '<p style="margin:12px 0 0;font-size:14px;color:#374151;"><b>' || html_esc(btrim(r.first_name || ' ' || r.last_name)) || '</b> · ' || html_esc(coalesce(t.name, 'Ticket')) || '</p>'
         || '<p style="margin:4px 0 0;font-size:14px;color:#374151;">' || html_esc(event_date_text(e)) || CASE WHEN place <> '' THEN ' · ' || html_esc(place) ELSE '' END || '</p>'
         || '<p style="margin:18px 0 0;"><a href="' || html_esc(link) || '" style="display:inline-block;background:' || primary_c || ';color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">View my ticket</a></p>'
         || '</td></tr></table></td></tr>'
       ELSE '' END
    || '<tr><td style="padding:20px 32px 28px;font-size:12px;color:#6B7280;line-height:1.6;">'
    || CASE WHEN e.footer_line <> '' THEN '<p style="margin:0 0 8px;font-style:italic;color:#374151;">' || html_esc(e.footer_line) || '</p>' ELSE '' END
    || html_esc(coalesce(nullif(e.organiser_name, ''), 'The organiser')) || ' · sent with SYNAPSE Events</td></tr>'
    || '</table></td></tr></table></body></html>';

  INSERT INTO messages (workspace_id, contact_id, channel, direction, subject, body, body_html, status, from_email, from_name, to_address, email_account_id, form_submission_id)
  VALUES (e.workspace_id, r.contact_id, 'email', 'outbound', left(subj, 300), txt, html, 'queued', acc.email,
          coalesce(nullif(e.organiser_name, ''), acc.display_name), r.email, acc.id, r.form_submission_id);
  UPDATE event_registrations SET last_email_at = now() WHERE id = r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION event_email(uuid, text) FROM PUBLIC, anon, authenticated;

-- 3. Registering sends the email; the result says whether it went out, and carries the signed QR.
CREATE OR REPLACE FUNCTION event_register_and_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.form_submission_id IS NOT NULL AND NEW.status IN ('confirmed', 'applied') THEN
    PERFORM event_email(NEW.id, NEW.status);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_registration_email ON event_registrations;
CREATE TRIGGER event_registration_email AFTER INSERT ON event_registrations FOR EACH ROW EXECUTE FUNCTION event_register_and_email();

-- The ticket page also gets the signed QR link and the footer line.
CREATE OR REPLACE FUNCTION public_ticket(p_token uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'qr_token', r.qr_token, 'qr_url', CASE WHEN event_holds_place(r.status) THEN ticket_qr_url(r.qr_token) END,
    'pin', r.pin, 'ticket_code', r.ticket_code, 'first_name', r.first_name, 'last_name', r.last_name,
    'email', r.email, 'status', r.status, 'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'checked_in_at', r.checked_in_at, 'created_at', r.created_at,
    'ticket_name', t.name, 'requires_approval', coalesce(t.requires_approval, false), 'currency', coalesce(t.currency, 'NGN'),
    'online_url', CASE WHEN event_holds_place(r.status) THEN e.online_url ELSE '' END,
    'footer_line', e.footer_line,
    'event', event_public_json(e) - 'questions' - 'tickets'
  )
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  LEFT JOIN event_tickets t ON t.id = r.ticket_id
  WHERE r.qr_token = p_token LIMIT 1;
$$;

-- event_register's answer also carries the signed QR link and whether the email went.
/**
 * Register (or apply) through a registration type's form. The answers are by form field id;
 * name, email and phone come from the fields saved to the contact (or by field type).
 * Returns { status: 'confirmed' | 'applied', qr_token?, ticket_code?, first_name, type_name }
 * or { status: 'duplicate' } when this email (or phone) already holds a live registration
 * of this type. Also: qr_url (the signed link the QR holds) and emailed. Raises closed / full / not_open_yet / consent_required / email_invalid /
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

  -- The email trigger has run by now: say whether it went, and give the signed QR link.
  SELECT * INTO reg FROM event_registrations WHERE id = reg.id;
  RETURN jsonb_build_object('status', reg.status, 'first_name', reg.first_name, 'type_name', t.name,
    'qr_token', CASE WHEN event_holds_place(reg.status) THEN reg.qr_token END, 'ticket_code', reg.ticket_code,
    'qr_url', CASE WHEN event_holds_place(reg.status) THEN ticket_qr_url(reg.qr_token) END,
    'emailed', reg.last_email_at IS NOT NULL);
END $$;

-- 4. Resend my ticket ------------------------------------------------------------------------
/**
 * Email the ticket again to whoever registered for this event with this address. Always answers
 * the same way, so it never reveals who registered. At most once every ten minutes per ticket.
 */
CREATE OR REPLACE FUNCTION event_resend_ticket(p_slug text, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; em text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    FOR r IN SELECT x.* FROM event_registrations x JOIN events e ON e.id = x.event_id
             WHERE e.slug = lower(btrim(coalesce(p_slug, ''))) AND lower(x.email) = em AND event_holds_place(x.status)
               AND (x.last_email_at IS NULL OR x.last_email_at < now() - interval '10 minutes') LOOP
      PERFORM event_email(r.id, CASE WHEN r.status = 'selected' THEN 'selected' ELSE 'confirmed' END);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION event_resend_ticket(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_resend_ticket(text, text) TO anon, authenticated;

-- 5. The organiser moves an application along ------------------------------------------------
/**
 * Change a registration's status (applied → shortlisted → selected / declined → confirmed, or
 * cancelled). Selecting gives a ticket code and emails the ticket; declining sends the kind note.
 * Account members with Events access only. Returns the registration as it now is.
 */
CREATE OR REPLACE FUNCTION event_set_registration_status(p_reg uuid, p_status text, p_notify boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; e events; t event_tickets; taken int;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO e FROM events WHERE id = r.event_id;
  IF NOT (is_workspace_member(e.workspace_id) AND member_can(e.workspace_id, 'events')) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_status NOT IN ('confirmed', 'applied', 'shortlisted', 'selected', 'declined', 'cancelled') THEN RAISE EXCEPTION 'bad_status'; END IF;
  IF r.status = p_status THEN RETURN to_jsonb(r); END IF;

  -- Selecting takes a place: respect the type's capacity.
  IF event_holds_place(p_status) AND NOT event_holds_place(r.status) THEN
    SELECT * INTO t FROM event_tickets WHERE id = r.ticket_id FOR UPDATE;
    IF t.capacity IS NOT NULL THEN
      SELECT count(*) INTO taken FROM event_registrations WHERE ticket_id = t.id AND event_holds_place(status);
      IF taken >= t.capacity THEN RAISE EXCEPTION 'full'; END IF;
    END IF;
  END IF;

  UPDATE event_registrations SET status = p_status, status_changed_at = now(),
    ticket_code = CASE WHEN event_holds_place(p_status) THEN coalesce(ticket_code, event_ticket_code(e.slug)) ELSE ticket_code END
  WHERE id = r.id RETURNING * INTO r;

  IF p_notify AND p_status = 'selected' THEN PERFORM event_email(r.id, 'selected');
  ELSIF p_notify AND p_status = 'declined' THEN PERFORM event_email(r.id, 'declined');
  END IF;
  PERFORM audit_write(e.workspace_id, 'registration_' || p_status, 'event_registration', r.id,
    jsonb_build_object('name', btrim(r.first_name || ' ' || r.last_name), 'event', e.title));
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION event_set_registration_status(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_set_registration_status(uuid, text, boolean) TO authenticated;
