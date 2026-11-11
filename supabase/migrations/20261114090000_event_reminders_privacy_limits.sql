/*
  # Events: the 24-hour reminder, private registrations, and limits per visitor

  1. The reminder (the fourth email). About a day before an event starts, everyone who holds a
     place (registered, or a selected applicant) and hasn't been checked in gets one branded email
     with their ticket. Only for events with a date (never while the date is to be announced), only
     once per start time (if the event moves, they're reminded of the new time), not for people
     who registered in the last day (their confirmation is fresh), and only when the account has a
     connected email account. The organiser can reword it, or turn it off for an event
     (events.email_templates.reminder.off). A job runs every 15 minutes (pg_cron); the mailer sends
     what it queues on its next run.
  2. Registrations, registration types and the check-in log follow the Events section: a member
     without Events access no longer sees or changes them (names, emails, answers). The door team
     still checks people in through the scanner's functions, which check their place on the team.
  3. Limits per visitor, on top of the limit per registration type: one address (IP) can register
     at most 20 times in 10 minutes, and ask for its ticket again at most 10 times in 10 minutes
     (it gets the same answer either way). Organisers adding people from the dashboard aren't limited.

  Needs 20261111090000_event_tickets_emails.sql. Safe to run more than once.
*/

-- 1. The reminder ------------------------------------------------------------------------

-- The start time each person was last reminded of (none yet: null).
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS reminder_for timestamptz;

CREATE OR REPLACE FUNCTION event_email_default(p_kind text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'confirmed' THEN jsonb_build_object('subject', 'You''re in: {{event}}',
      'message', E'Hi {{first_name}},\n\nYou''re registered for {{event}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!')
    WHEN 'applied' THEN jsonb_build_object('subject', 'We''ve got your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you for applying ({{type}}) for {{event}}. We read every application and we''ll be in touch once we''ve decided.')
    WHEN 'selected' THEN jsonb_build_object('subject', 'You''ve been selected: {{event}}',
      'message', E'Hi {{first_name}},\n\nGreat news: you''ve been selected for {{event}}! Your ticket is below. Show the QR code at the door, or give your ticket code {{code}}.\n\nWe can''t wait to see you.')
    WHEN 'reminder' THEN jsonb_build_object('subject', 'Tomorrow: {{event}}',
      'message', E'Hi {{first_name}},\n\nA quick reminder: {{event}} is on {{date}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!')
    WHEN 'declined' THEN jsonb_build_object('subject', 'About your application: {{event}}',
      'message', E'Hi {{first_name}},\n\nThank you so much for applying to {{event}}. We had more applications than places this time, so we can''t offer you a spot, but we''d love to see you there, and we hope you''ll apply again.')
  END
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
  ticket := p_kind IN ('confirmed', 'selected', 'reminder') AND event_holds_place(r.status);
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

/** Queue the reminders that are due. Returns how many were queued. */
CREATE OR REPLACE FUNCTION event_send_reminders() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('synapse_event_reminders')) THEN RETURN 0; END IF;
  FOR r IN
    SELECT reg.id, e.starts_at
    FROM event_registrations reg
    JOIN events e ON e.id = reg.event_id
    WHERE e.status = 'published' AND e.starts_at IS NOT NULL
      AND e.starts_at > now() + interval '1 hour' AND e.starts_at <= now() + interval '24 hours'
      AND coalesce(e.email_templates->'reminder'->>'off', 'false') <> 'true'
      AND event_holds_place(reg.status) AND reg.checked_in_at IS NULL
      AND reg.form_submission_id IS NOT NULL AND coalesce(reg.email, '') <> ''
      AND reg.reminder_for IS DISTINCT FROM e.starts_at
      AND reg.created_at < e.starts_at - interval '24 hours'
      AND EXISTS (SELECT 1 FROM email_accounts a WHERE a.workspace_id = e.workspace_id AND a.status = 'active')
    ORDER BY e.starts_at, reg.created_at
    LIMIT 500
  LOOP
    IF event_email(r.id, 'reminder') THEN
      UPDATE event_registrations SET reminder_for = r.starts_at WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  -- Housekeeping for the limits below: a day of history is plenty.
  DELETE FROM ev_private.hits WHERE at < now() - interval '1 day';
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION event_send_reminders() FROM PUBLIC, anon, authenticated;

-- 2. Registrations follow the Events section ----------------------------------------------

/** Whether the person signed in may see this event's people (they have Events access in its account). */
CREATE OR REPLACE FUNCTION event_member_can(p_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event AND member_can(e.workspace_id, 'events'))
$$;
REVOKE ALL ON FUNCTION event_member_can(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_member_can(uuid) TO authenticated;

DROP POLICY IF EXISTS event_registrations_section_access ON event_registrations;
CREATE POLICY event_registrations_section_access ON event_registrations AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_member_can(event_id)) WITH CHECK (event_member_can(event_id));
DROP POLICY IF EXISTS event_tickets_section_access ON event_tickets;
CREATE POLICY event_tickets_section_access ON event_tickets AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_member_can(event_id)) WITH CHECK (event_member_can(event_id));
DROP POLICY IF EXISTS event_checkins_section_access ON event_checkins;
CREATE POLICY event_checkins_section_access ON event_checkins AS RESTRICTIVE FOR ALL TO authenticated
  USING (event_member_can(event_id)) WITH CHECK (event_member_can(event_id));

-- 3. Limits per visitor ----------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS ev_private;
CREATE TABLE IF NOT EXISTS ev_private.hits (ip text NOT NULL, kind text NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ev_hits_ip ON ev_private.hits(ip, kind, at DESC);
REVOKE ALL ON ev_private.hits FROM PUBLIC;
-- Only the database's own functions use it (they bypass row level security as its owner).
ALTER TABLE ev_private.hits ENABLE ROW LEVEL SECURITY;

/** The visitor's address, as the API gateway passes it on (null outside a web request). */
CREATE OR REPLACE FUNCTION event_visitor_ip() RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT nullif(btrim(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
    nullif(current_setting('request.headers', true), '')::json->>'x-real-ip',
    nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1)), '')
$$;
REVOKE ALL ON FUNCTION event_visitor_ip() FROM PUBLIC, anon, authenticated;

/**
 * Note one more go for this visitor; false once they've had `p_max` in the last `p_within`.
 * Always true outside a web request (the database itself, tests, the scheduler).
 */
CREATE OR REPLACE FUNCTION event_visitor_allowed(p_kind text, p_max int, p_within interval) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ip text := event_visitor_ip();
BEGIN
  IF v_ip IS NULL THEN RETURN true; END IF;
  IF (SELECT count(*) FROM ev_private.hits h WHERE h.ip = v_ip AND h.kind = p_kind AND h.at > now() - p_within) >= p_max THEN
    RETURN false;
  END IF;
  INSERT INTO ev_private.hits(ip, kind) VALUES (v_ip, p_kind);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION event_visitor_allowed(text, int, interval) FROM PUBLIC, anon, authenticated;

-- Registering (and applying): at most 20 in 10 minutes from one address. The organiser's own
-- additions from the dashboard don't count.
CREATE OR REPLACE FUNCTION event_registration_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF event_visitor_ip() IS NOT NULL AND NOT event_is_organiser(NEW.event_id)
     AND NOT event_visitor_allowed('register', 20, interval '10 minutes') THEN
    RAISE EXCEPTION 'busy';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_registration_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registration_limit ON event_registrations;
CREATE TRIGGER event_registration_limit BEFORE INSERT ON event_registrations FOR EACH ROW EXECUTE FUNCTION event_registration_limit();

-- "Email me my ticket again": at most 10 asks in 10 minutes from one address, and the answer is
-- the same either way, so it still never reveals who registered.
CREATE OR REPLACE FUNCTION event_resend_ticket(p_slug text, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; em text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND event_visitor_allowed('resend', 10, interval '10 minutes') THEN
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

-- 4. Every 15 minutes ------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'synapse-event-reminders';
    PERFORM cron.schedule('synapse-event-reminders', '*/15 * * * *', 'SELECT public.event_send_reminders()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Could not schedule event reminders: %', SQLERRM;
END $$;
