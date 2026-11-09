-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Events update (14 November 2026): reminder emails 24 hours before, deleting someone's data on request,
-- and a fairer limit on resending tickets. Run database-updates-11.sql first. Safe to run more than once.
-- Made from supabase/migrations/20261114090000_event_reminders_privacy.sql; don't edit here.

/*
  # Events: 24-hour reminders, deleting someone's data on request, and fairer limits

  1. Reminders. About 24 hours before a dated event, everyone holding a place (confirmed attendees and
     selected performers) who hasn't checked in gets a reminder with their ticket, once. Events with
     the date to be announced get none. The organiser can switch reminders off per event
     (events.reminders_enabled) and edit the wording like the other emails (kind 'reminder').
     Runs every 15 minutes with pg_cron (already used by workflows), at most 300 emails a run.
     People who registered within the last two hours aren't reminded: their ticket just arrived.
  2. Privacy. event_erase_registration(registration, also_contact) lets an organiser delete a
     registration and the personal data that came with it on request: their form response, the
     emails sent to them for it, and (if asked) their contact record. The audit log records that
     it happened, without the personal details.
  3. Limits. "Email my ticket again" also stops after 30 resends a minute for one event, so nobody
     can use it to flood inboxes.
*/

-- 1. Reminders ------------------------------------------------------------------------------

ALTER TABLE events ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

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
    WHEN 'reminder' THEN jsonb_build_object('subject', 'Tomorrow: {{event}}',
      'message', E'Hi {{first_name}},\n\nA reminder that {{event}} is on {{date}} at {{venue}}. Your ticket is below: show the QR code at the door, or give your ticket code {{code}}.\n\nSee you there!')
  END
$$;

-- The ticket emails, now with the reminder carrying the ticket too (otherwise unchanged).
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

/**
 * Send the reminders that are due. Called by pg_cron every 15 minutes; safe to call any time.
 * Returns how many went out.
 */
CREATE OR REPLACE FUNCTION event_send_reminders(p_limit int DEFAULT 300) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT x.id FROM event_registrations x JOIN events e ON e.id = x.event_id
    WHERE e.status = 'published' AND e.reminders_enabled AND e.starts_at IS NOT NULL
      AND e.starts_at > now() AND e.starts_at <= now() + interval '24 hours'
      AND event_holds_place(x.status) AND x.checked_in_at IS NULL AND x.reminded_at IS NULL
      AND x.created_at < now() - interval '2 hours'
    ORDER BY e.starts_at, x.created_at
    LIMIT greatest(p_limit, 1)
    FOR UPDATE OF x SKIP LOCKED
  LOOP
    -- Marked even when it can't be emailed (no account, added by hand), so it isn't retried forever.
    UPDATE event_registrations SET reminded_at = now() WHERE id = r.id;
    IF event_email(r.id, 'reminder') THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION event_send_reminders(int) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('synapse-event-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'synapse-event-reminders');
    PERFORM cron.schedule('synapse-event-reminders', '*/15 * * * *', 'SELECT public.event_send_reminders()');
  END IF;
END $$;

-- 2. Deleting someone's data on request -----------------------------------------------------

CREATE OR REPLACE FUNCTION event_erase_registration(p_reg uuid, p_also_contact boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; e events; other int;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF auth.uid() IS NULL OR NOT event_is_organiser(r.event_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO e FROM events WHERE id = r.event_id;

  IF r.form_submission_id IS NOT NULL THEN
    DELETE FROM messages WHERE form_submission_id = r.form_submission_id;
    DELETE FROM form_submissions WHERE id = r.form_submission_id;
  END IF;
  DELETE FROM event_registrations WHERE id = r.id;   -- the check-in log keeps the times, not the person

  IF p_also_contact AND r.contact_id IS NOT NULL THEN
    SELECT count(*) INTO other FROM event_registrations WHERE contact_id = r.contact_id;
    DELETE FROM contacts WHERE id = r.contact_id AND workspace_id = e.workspace_id;
  END IF;

  PERFORM audit_write(e.workspace_id, 'registration_erased', 'event', e.id,
    jsonb_build_object('event', e.title, 'contact_deleted', p_also_contact AND r.contact_id IS NOT NULL));
  RETURN jsonb_build_object('ok', true, 'contact_deleted', p_also_contact AND r.contact_id IS NOT NULL, 'other_registrations', coalesce(other, 0));
END $$;
REVOKE ALL ON FUNCTION event_erase_registration(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_erase_registration(uuid, boolean) TO authenticated;

-- 3. Resend: at most 30 a minute per event, on top of once every 10 minutes per ticket -------

CREATE OR REPLACE FUNCTION event_resend_ticket(p_slug text, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r event_registrations; em text := lower(btrim(coalesce(p_email, ''))); ev events;
BEGIN
  SELECT * INTO ev FROM events WHERE slug = lower(btrim(coalesce(p_slug, '')));
  IF ev.id IS NOT NULL AND em ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     AND (SELECT count(*) FROM event_registrations WHERE event_id = ev.id AND last_email_at > now() - interval '1 minute') < 30 THEN
    FOR r IN SELECT x.* FROM event_registrations x
             WHERE x.event_id = ev.id AND lower(x.email) = em AND event_holds_place(x.status)
               AND (x.last_email_at IS NULL OR x.last_email_at < now() - interval '10 minutes') LOOP
      PERFORM event_email(r.id, CASE WHEN r.status = 'selected' THEN 'selected' ELSE 'confirmed' END);
    END LOOP;
  END IF;
  -- Always the same answer, so it never reveals who registered.
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION event_resend_ticket(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_resend_ticket(text, text) TO anon, authenticated;
