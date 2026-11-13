-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Email sender (20 November 2026): the organiser's Gmail, else a SYNAPSE-wide Gmail; and a check that says
-- why an email didn't go: SELECT * FROM email_setup_check();
-- Run database-updates-17.sql first. Safe to run more than once.
-- Made from supabase/migrations/20261120090000_email_sender_fallback.sql; don't edit here.

/*
  # Who sends emails, and a check that says why one didn't go

  Every email SYNAPSE sends (tickets, approvals, reminders, invitations, door passes) goes out
  through a connected Gmail account. Until now that had to be the organiser's own account
  (Settings → Email); with none connected, nothing was sent. Now the sender is, in order:
    1. the Gmail chosen on the event (events.email_account_id),
    2. the organiser account's first connected Gmail,
    3. the SYNAPSE-wide Gmail, set once by the platform owner:
         SELECT platform_sender_set('your-synapse-address@gmail.com');
       (that address must first be connected in some account's Settings → Email).
  The From name stays the organiser's (e.g. "Deraspeaks · Ample Room").

  SELECT * FROM email_setup_check(); lists, in plain words, everything emails need and what's
  missing. Both run in the SQL Editor only (not from the app).

  Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION email_sender_for(p_workspace uuid, p_preferred uuid) RETURNS email_accounts
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE acc email_accounts;
BEGIN
  IF p_preferred IS NOT NULL THEN
    SELECT * INTO acc FROM email_accounts WHERE id = p_preferred AND status = 'active';
    IF FOUND THEN RETURN acc; END IF;
  END IF;
  SELECT * INTO acc FROM email_accounts WHERE workspace_id = p_workspace AND status = 'active' ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN acc; END IF;
  SELECT * INTO acc FROM email_accounts
    WHERE id::text = (SELECT value FROM wf_private.settings WHERE key = 'platform_email_account') AND status = 'active';
  RETURN acc;
END $$;
REVOKE ALL ON FUNCTION email_sender_for(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The SYNAPSE-wide sender. SQL Editor only.
CREATE OR REPLACE FUNCTION platform_sender_set(p_email text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acc email_accounts;
BEGIN
  SELECT * INTO acc FROM email_accounts WHERE lower(email) = lower(btrim(p_email)) AND status = 'active' ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% isn''t connected yet. In SYNAPSE, open Settings → Email, connect that Gmail, then run this again.', p_email;
  END IF;
  INSERT INTO wf_private.settings(key, value) VALUES ('platform_email_account', acc.id::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  RETURN 'SYNAPSE emails now go out from ' || acc.email || ' whenever an organiser has no Gmail of their own connected.';
END $$;
REVOKE ALL ON FUNCTION platform_sender_set(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION email_setup_check()
RETURNS TABLE (step int, what text, ok boolean, detail text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int; t text; has_cron boolean := to_regclass('cron.job') IS NOT NULL;
BEGIN
  step := 1; what := 'Scheduler (pg_cron) runs SYNAPSE every minute';
  IF has_cron THEN
    BEGIN
      EXECUTE 'SELECT count(*) FROM cron.job WHERE jobname = ''synapse-workflows'' AND active' INTO n;
    EXCEPTION WHEN undefined_column THEN
      EXECUTE 'SELECT count(*) FROM cron.job WHERE jobname = ''synapse-workflows''' INTO n;
    END;
    ok := n > 0; detail := CASE WHEN ok THEN 'On.' ELSE 'The job synapse-workflows is missing. Run database-updates-12.sql or later again.' END;
  ELSE ok := false; detail := 'Turn on pg_cron: Supabase → Database → Extensions → pg_cron. Then run the newest database update again.'; END IF;
  RETURN NEXT;

  step := 2; what := 'Calls out to the mailer (pg_net)';
  ok := to_regnamespace('net') IS NOT NULL;
  detail := CASE WHEN ok THEN 'On.' ELSE 'Turn on pg_net: Supabase → Database → Extensions → pg_net.' END;
  RETURN NEXT;

  step := 3; what := 'Mailer address and key are saved';
  ok := EXISTS (SELECT 1 FROM wf_private.settings WHERE key = 'mailer_url' AND value LIKE 'https://%')
    AND EXISTS (SELECT 1 FROM wf_private.settings WHERE key = 'client_key' AND length(value) > 20);
  detail := CASE WHEN ok THEN 'Saved.' ELSE 'Open SYNAPSE once while signed in as the owner (it saves the key), and check the send-email function is deployed.' END;
  RETURN NEXT;

  step := 4; what := 'SYNAPSE-wide sender (used when an organiser has no Gmail)';
  SELECT a.email INTO t FROM email_accounts a WHERE a.id::text = (SELECT value FROM wf_private.settings WHERE key = 'platform_email_account') AND a.status = 'active';
  ok := t IS NOT NULL;
  detail := CASE WHEN ok THEN 'Sends from ' || t || '.' ELSE 'Not set. Connect the SYNAPSE Gmail in Settings → Email, then run: SELECT platform_sender_set(''that@gmail.com'');' END;
  RETURN NEXT;

  step := 5; what := 'Every account with events can send';
  SELECT count(*), string_agg(DISTINCT w.name, ', ') INTO n, t FROM events e JOIN workspaces w ON w.id = e.workspace_id
    WHERE (email_sender_for(e.workspace_id, e.email_account_id)).id IS NULL;
  ok := n = 0;
  detail := CASE WHEN ok THEN 'Yes.' ELSE 'No sender for: ' || t || '. Connect a Gmail there, or set the SYNAPSE-wide sender (step 4).' END;
  RETURN NEXT;

  step := 6; what := 'Nothing stuck waiting to send';
  SELECT count(*) INTO n FROM messages WHERE status = 'queued' AND created_at < now() - interval '5 minutes';
  ok := n = 0;
  detail := CASE WHEN ok THEN 'Nothing stuck.' ELSE n || ' email(s) waiting over 5 minutes: steps 1–3 above, or the send-email function isn''t deployed.' END;
  RETURN NEXT;

  step := 7; what := 'No emails failed in the last 7 days';
  SELECT count(*), max(error) INTO n, t FROM messages WHERE status = 'failed' AND created_at > now() - interval '7 days';
  ok := n = 0;
  detail := CASE WHEN ok THEN 'None failed.' ELSE n || ' failed. Latest reason: ' || coalesce(t, 'unknown') || ' (reconnect that Gmail in Settings → Email if it says so).' END;
  RETURN NEXT;

  step := 8; what := 'Every registration in the last 7 days got its email';
  SELECT count(*) INTO n FROM event_registrations r WHERE r.created_at > now() - interval '7 days' AND r.last_email_at IS NULL AND r.form_submission_id IS NOT NULL;
  ok := n = 0;
  detail := CASE WHEN ok THEN 'Yes.' ELSE n || ' without an email. Once the steps above are fixed, they can use "Lost your ticket?" on the event page, or resend from Registrations.' END;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION email_setup_check() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION event_email(p_reg uuid, p_kind text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r event_registrations; e events; t event_tickets; acc email_accounts; tpl jsonb; subj text; msg text;
  primary_c text; accent_c text; place text; ticket boolean; link text; qr_img text; base text; html text; txt text; k text; v text;
BEGIN
  SELECT * INTO r FROM event_registrations WHERE id = p_reg;
  IF NOT FOUND OR r.form_submission_id IS NULL OR coalesce(r.email, '') = '' THEN RETURN false; END IF;
  SELECT * INTO e FROM events WHERE id = r.event_id;
  SELECT * INTO t FROM event_tickets WHERE id = r.ticket_id;
  acc := email_sender_for(e.workspace_id, e.email_account_id);
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
          coalesce(nullif(e.organiser_name, ''), CASE WHEN acc.workspace_id = e.workspace_id THEN nullif(acc.display_name, '') END, (SELECT w.name FROM workspaces w WHERE w.id = e.workspace_id)), r.email, acc.id, r.form_submission_id);
  UPDATE event_registrations SET last_email_at = now() WHERE id = r.id;
  RETURN true;
END $$;

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
      AND (email_sender_for(e.workspace_id, e.email_account_id)).id IS NOT NULL
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

CREATE OR REPLACE FUNCTION team_invitation_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  acc email_accounts; ws_name text; inviter text; link text; role_label text; subj text; txt text; html text;
BEGIN
  IF NEW.status <> 'pending' OR coalesce(NEW.email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN NEW; END IF;
  acc := email_sender_for(NEW.workspace_id, NULL);
  IF acc.id IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO ws_name FROM workspaces WHERE id = NEW.workspace_id;
  SELECT nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') INTO inviter FROM profiles p WHERE p.user_id = NEW.invited_by;
  link := wf_app_url() || '/invite/' || NEW.token;
  role_label := CASE NEW.role WHEN 'admin' THEN 'an Admin' WHEN 'supervisor' THEN 'a Supervisor' ELSE 'a member of the team' END;
  subj := 'You''re invited to join ' || coalesce(ws_name, 'the team') || ' on SYNAPSE';
  txt := 'Hello,' || E'\n\n' || coalesce(inviter, 'Your team') || ' has invited you to join ' || coalesce(ws_name, 'their account')
    || ' on SYNAPSE as ' || role_label || CASE WHEN coalesce(NEW.title, '') <> '' THEN ' (' || NEW.title || ')' ELSE '' END || '.'
    || E'\n\nJoin here: ' || link
    || E'\n\nSign up or sign in with this email address (' || NEW.email || '). The link works for 7 days.';
  html := '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #E6E8EE;border-radius:16px;font-family:Helvetica,Arial,sans-serif;color:#1F2937;">'
    || '<tr><td style="height:6px;background:#0A1628;background-image:linear-gradient(90deg,#0A1628,#C8A96A);border-radius:16px 16px 0 0;"></td></tr>'
    || '<tr><td style="padding:28px 32px;font-size:16px;line-height:1.6;">'
    || '<p style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0A1628;">Join ' || html_esc(coalesce(ws_name, 'your team')) || ' on SYNAPSE</p>'
    || '<p style="margin:0 0 20px;">' || html_esc(coalesce(inviter, 'Your team')) || ' has invited you as ' || html_esc(role_label)
    || CASE WHEN coalesce(NEW.title, '') <> '' THEN ' (' || html_esc(NEW.title) || ')' ELSE '' END || '.</p>'
    || '<p style="margin:0 0 20px;"><a href="' || html_esc(link) || '" style="display:inline-block;background:#0A1628;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">Accept the invitation</a></p>'
    || '<p style="margin:0;font-size:13px;color:#6B7280;">Sign up or sign in with ' || html_esc(NEW.email) || '. The link works for 7 days.</p>'
    || '</td></tr></table></td></tr></table></body></html>';
  INSERT INTO messages (workspace_id, channel, direction, subject, body, body_html, status, from_email, from_name, to_address, email_account_id, team_invitation_id)
  VALUES (NEW.workspace_id, 'email', 'outbound', left(subj, 300), txt, html, 'queued', acc.email,
          coalesce(CASE WHEN acc.workspace_id = NEW.workspace_id THEN nullif(acc.display_name, '') END, ws_name), NEW.email, acc.id, NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invitation email not queued: %', SQLERRM;  -- the invitation itself still goes in
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION event_door_pass_add(p_event uuid, p_name text, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e events; p event_door_passes; acc email_accounts; em text := lower(btrim(coalesce(p_email, ''))); link text; nm text := btrim(coalesce(p_name, ''));
  txt text; html text; queued boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF nm = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalid'; END IF;
  IF (SELECT count(*) FROM event_door_passes WHERE event_id = p_event AND revoked_at IS NULL) >= 50 THEN RAISE EXCEPTION 'too_many'; END IF;
  IF EXISTS (SELECT 1 FROM event_door_passes WHERE event_id = p_event AND lower(email) = em AND revoked_at IS NULL) THEN RAISE EXCEPTION 'already_added'; END IF;
  SELECT * INTO e FROM events WHERE id = p_event;
  INSERT INTO event_door_passes (event_id, name, email, created_by) VALUES (p_event, left(nm, 80), em, auth.uid()) RETURNING * INTO p;
  link := wf_app_url() || '/e/door/' || p.token;

  acc := email_sender_for(e.workspace_id, e.email_account_id);
  IF acc.id IS NOT NULL THEN
    txt := 'Hi ' || split_part(p.name, ' ', 1) || ',' || E'\n\n'
      || 'You''re on the door for ' || e.title || ' (' || event_date_text(e) || ').' || E'\n\n'
      || 'Open this link on the phone you''ll use at the door, in Safari (iPhone) or Chrome (Android): ' || link || E'\n\n'
      || 'That makes your phone a scanner for this event. Then point your camera at a guest''s ticket QR code and tap the link: green means they''re in.'
      || E'\n\nKeep this link to yourself; it works until the organiser removes it, and stops after the event.';
    html := '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid #E6E8EE;border-radius:16px;font-family:Helvetica,Arial,sans-serif;color:#1F2937;">'
      || '<tr><td style="padding:28px 32px;font-size:16px;line-height:1.6;">'
      || '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6B7280;">Door pass</p>'
      || '<p style="margin:0 0 14px;font-size:22px;font-weight:700;color:#0A1628;">' || html_esc(e.title) || '</p>'
      || '<p style="margin:0 0 18px;">Hi ' || html_esc(split_part(p.name, ' ', 1)) || ', you''re on the door. Open this on the phone you''ll use at the door, in Safari (iPhone) or Chrome (Android):</p>'
      || '<p style="margin:0 0 20px;"><a href="' || html_esc(link) || '" style="display:inline-block;background:#0A1628;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">Make this phone a scanner</a></p>'
      || '<p style="margin:0 0 8px;">Then point your camera at a guest''s ticket QR code and tap the link. <b>Green</b> means they''re in.</p>'
      || '<p style="margin:0;font-size:13px;color:#6B7280;">Keep this link to yourself. It works until the organiser removes it, and stops after the event.</p>'
      || '</td></tr></table></td></tr></table></body></html>';
    INSERT INTO messages (workspace_id, channel, direction, subject, body, body_html, status, from_email, from_name, to_address, email_account_id, event_door_pass_id)
    VALUES (e.workspace_id, 'email', 'outbound', left('Your door pass for ' || e.title, 300), txt, html, 'queued', acc.email,
            coalesce(nullif(e.organiser_name, ''), CASE WHEN acc.workspace_id = e.workspace_id THEN nullif(acc.display_name, '') END, (SELECT w.name FROM workspaces w WHERE w.id = e.workspace_id)), em, acc.id, p.id);
    queued := true;
  END IF;
  RETURN event_door_pass_json(p) || jsonb_build_object('emailed', queued);
END $$;
