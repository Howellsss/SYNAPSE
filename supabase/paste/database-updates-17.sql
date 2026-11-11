-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Door passes (19 November 2026): volunteers check guests in with their own phone's camera, no account.
-- Run database-updates-16.sql first. Safe to run more than once.
-- Made from supabase/migrations/20261119090000_event_door_passes.sql; don't edit here.

/*
  # Door passes: volunteers check guests in with their own phone, without an account

  An organiser adds a door scanner (name and email) on the event's page. They get an email with a
  door-pass link; opening it once on a phone makes that phone a scanner for that event only. Then
  scanning a ticket's QR with the phone's camera checks the guest in (green), exactly as the
  scanner does: the ticket's signature is checked, it must belong to this event, and every scan is
  logged with the pass's name. Removing the pass stops that phone at once; passes stop working 12
  hours after the event ends.

  - event_door_passes: the passes (reached only through the functions below).
  - event_door_pass_add / _list / _revoke: the organiser's side.
  - event_door_pass_info(token): what the pass page shows (event, name, still valid?).
  - event_door_check_in(token, scan, paid) and event_door_undo(token, registration): the phone's side.
  - The pass email is queued like other emails (messages.event_door_pass_id).

  Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS event_door_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  email text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_event_door_passes_event ON event_door_passes(event_id);
ALTER TABLE event_door_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_door_passes FROM PUBLIC, anon, authenticated;

ALTER TABLE event_checkins ADD COLUMN IF NOT EXISTS door_pass_id uuid REFERENCES event_door_passes(id) ON DELETE SET NULL;
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS checked_in_pass uuid REFERENCES event_door_passes(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS event_door_pass_id uuid REFERENCES event_door_passes(id) ON DELETE SET NULL;

-- "Checked in by" also names a door pass.
CREATE OR REPLACE FUNCTION event_checkin_person(r event_registrations) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'registration_id', r.id, 'name', btrim(r.first_name || ' ' || r.last_name), 'status', r.status,
    'type_name', (SELECT t.name FROM event_tickets t WHERE t.id = r.ticket_id),
    'ticket_code', r.ticket_code, 'checked_in_at', r.checked_in_at,
    'checked_in_by', coalesce(event_person_name(r.checked_in_by), (SELECT p.name FROM event_door_passes p WHERE p.id = r.checked_in_pass)),
    'payment_status', r.payment_status, 'amount_minor', r.amount_minor,
    'currency', (SELECT t.currency FROM event_tickets t WHERE t.id = r.ticket_id))
$$;
REVOKE ALL ON FUNCTION event_checkin_person(event_registrations) FROM PUBLIC, anon, authenticated;

-- A pass that may still be used: not removed, and its event not over by more than 12 hours.
CREATE OR REPLACE FUNCTION event_door_pass_live(p_token uuid) RETURNS event_door_passes LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.* FROM event_door_passes p JOIN events e ON e.id = p.event_id
  WHERE p.token = p_token AND p.revoked_at IS NULL AND e.status <> 'cancelled'
    AND (e.ends_at IS NULL OR e.ends_at > now() - interval '12 hours')
$$;
REVOKE ALL ON FUNCTION event_door_pass_live(uuid) FROM PUBLIC, anon, authenticated;

-- 1. The organiser's side ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION event_door_pass_json(p event_door_passes) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'created_at', p.created_at,
    'activated_at', p.activated_at, 'last_used_at', p.last_used_at, 'revoked_at', p.revoked_at,
    'link', wf_app_url() || '/e/door/' || p.token,
    'scans', (SELECT count(*) FROM event_checkins c WHERE c.door_pass_id = p.id AND c.result = 'success'))
$$;
REVOKE ALL ON FUNCTION event_door_pass_json(event_door_passes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION event_door_pass_list(p_event uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_is_organiser(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((SELECT jsonb_agg(event_door_pass_json(p) ORDER BY p.revoked_at IS NOT NULL, p.created_at)
                   FROM event_door_passes p WHERE p.event_id = p_event), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION event_door_pass_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_door_pass_list(uuid) TO authenticated;

-- Adds a door scanner and emails them their pass (when the account has a connected email).
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

  SELECT * INTO acc FROM email_accounts WHERE id = e.email_account_id AND status = 'active';
  IF NOT FOUND THEN SELECT * INTO acc FROM email_accounts WHERE workspace_id = e.workspace_id AND status = 'active' ORDER BY created_at LIMIT 1; END IF;
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
            coalesce(nullif(e.organiser_name, ''), acc.display_name), em, acc.id, p.id);
    queued := true;
  END IF;
  RETURN event_door_pass_json(p) || jsonb_build_object('emailed', queued);
END $$;
REVOKE ALL ON FUNCTION event_door_pass_add(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_door_pass_add(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION event_door_pass_revoke(p_pass uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev uuid;
BEGIN
  SELECT event_id INTO ev FROM event_door_passes WHERE id = p_pass;
  IF ev IS NULL OR auth.uid() IS NULL OR NOT event_is_organiser(ev) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE event_door_passes SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_pass;
END $$;
REVOKE ALL ON FUNCTION event_door_pass_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION event_door_pass_revoke(uuid) TO authenticated;

-- 2. The phone's side (no sign-in: the pass is the key) -----------------------------------------

CREATE OR REPLACE FUNCTION event_door_pass_info(p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p event_door_passes; e events;
BEGIN
  p := event_door_pass_live(p_token);
  IF p.id IS NULL THEN RETURN jsonb_build_object('valid', false); END IF;
  UPDATE event_door_passes SET activated_at = coalesce(activated_at, now()) WHERE id = p.id;
  SELECT * INTO e FROM events WHERE id = p.event_id;
  RETURN jsonb_build_object('valid', true, 'name', p.name, 'event_id', e.id, 'title', e.title, 'slug', e.slug,
    'date', event_date_text(e), 'cover_url', e.cover_url, 'brand', e.brand,
    'expected', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status)),
    'checked_in', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status) AND r.checked_in_at IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION event_door_pass_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_door_pass_info(uuid) TO anon, authenticated;

-- Same answers as event_check_in: { result, reason?, person? }. A removed or expired pass: not_allowed.
CREATE OR REPLACE FUNCTION event_door_check_in(p_token uuid, p_scan text, p_paid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p event_door_passes; r event_registrations;
  scan text := btrim(coalesce(p_scan, ''));
  tok uuid; sig text; m text[]; res text; reason text;
  via text := CASE WHEN p_scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' OR p_scan ~ '^\s*\d{6}\s*$' THEN 'manual' ELSE 'scan' END;
BEGIN
  p := event_door_pass_live(p_token);
  IF p.id IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF (SELECT count(*) FROM event_checkins WHERE door_pass_id = p.id AND at > now() - interval '1 minute') >= 120 THEN RAISE EXCEPTION 'busy'; END IF;
  UPDATE event_door_passes SET last_used_at = now(), activated_at = coalesce(activated_at, now()) WHERE id = p.id;

  IF scan ~* '^[a-z0-9]+-[a-z0-9]{4}$' THEN
    SELECT * INTO r FROM event_registrations WHERE upper(ticket_code) = upper(scan) AND event_id = p.event_id FOR UPDATE;
  ELSIF scan ~ '^\d{6}$' THEN
    SELECT * INTO r FROM event_registrations WHERE pin = scan AND event_id = p.event_id FOR UPDATE;
  ELSE
    m := regexp_match(scan, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
    IF m IS NOT NULL THEN tok := lower(m[1])::uuid; END IF;
    sig := (regexp_match(scan, '[?&]v=([0-9a-fA-F]{16})'))[1];
    IF tok IS NOT NULL AND ticket_sig_ok(tok, sig) THEN
      SELECT * INTO r FROM event_registrations WHERE qr_token = tok AND event_id = p.event_id FOR UPDATE;
    END IF;
  END IF;

  IF r.id IS NULL THEN
    INSERT INTO event_checkins (event_id, registration_id, user_id, result, via, door_pass_id) VALUES (p.event_id, NULL, NULL, 'invalid', via, p.id);
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
    UPDATE event_registrations SET checked_in_at = now(), checked_in_by = NULL, checked_in_pass = p.id,
      payment_status = CASE WHEN p_paid AND payment_status = 'unpaid' THEN 'paid' ELSE payment_status END
    WHERE id = r.id RETURNING * INTO r;
    res := 'success';
  END IF;
  INSERT INTO event_checkins (event_id, registration_id, user_id, result, via, door_pass_id) VALUES (p.event_id, r.id, NULL, res, via, p.id);
  RETURN jsonb_build_object('result', res, 'reason', reason, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_door_check_in(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_door_check_in(uuid, text, boolean) TO anon, authenticated;

-- A pass can undo only the check-ins it made itself.
CREATE OR REPLACE FUNCTION event_door_undo(p_token uuid, p_registration uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p event_door_passes; r event_registrations;
BEGIN
  p := event_door_pass_live(p_token);
  IF p.id IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO r FROM event_registrations WHERE id = p_registration AND event_id = p.event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.checked_in_at IS NOT NULL THEN
    IF r.checked_in_pass IS DISTINCT FROM p.id THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE event_registrations SET checked_in_at = NULL, checked_in_by = NULL, checked_in_pass = NULL WHERE id = r.id RETURNING * INTO r;
    INSERT INTO event_checkins (event_id, registration_id, user_id, result, via, door_pass_id) VALUES (p.event_id, r.id, NULL, 'undone', 'undo', p.id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'person', event_checkin_person(r));
END $$;
REVOKE ALL ON FUNCTION event_door_undo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION event_door_undo(uuid, uuid) TO anon, authenticated;

-- 3. The log names door passes, and the mailer sends pass emails --------------------------------

CREATE OR REPLACE FUNCTION wf_tick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ev wf_events; r record; n_ev int := 0; n_runs int := 0; n_daily int := 0; queued int;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('synapse_wf_tick')) THEN RETURN jsonb_build_object('skipped', true); END IF;
  FOR ev IN SELECT * FROM wf_events WHERE processed_at IS NULL ORDER BY id LIMIT 500 LOOP
    BEGIN
      PERFORM wf_handle_event(ev);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf event % failed: %', ev.id, SQLERRM;
    END;
    UPDATE wf_events SET processed_at = now() WHERE id = ev.id;
    n_ev := n_ev + 1;
  END LOOP;
  FOR r IN SELECT id FROM wf_runs wr WHERE wr.status = 'waiting' AND wr.resume_at <= now()
             AND (wr.is_test OR EXISTS (SELECT 1 FROM workflows w WHERE w.id = wr.workflow_id AND w.status = 'active') OR NOT EXISTS (SELECT 1 FROM workflows w WHERE w.id = wr.workflow_id))
           ORDER BY wr.resume_at LIMIT 500 LOOP
    BEGIN PERFORM wf_run(r.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf run % failed: %', r.id, SQLERRM; END;
    n_runs := n_runs + 1;
  END LOOP;
  BEGIN n_daily := wf_daily_scan(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf daily scan failed: %', SQLERRM; END;
  -- Housekeeping: keep 30 days of history, like the manual's logs.
  DELETE FROM wf_events WHERE processed_at < now() - interval '30 days';
  DELETE FROM wf_logs WHERE at < now() - interval '30 days';
  -- Ask the mailer to send workflow emails and form emails (team alert, auto-reply).
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND (wf_run_id IS NOT NULL OR form_submission_id IS NOT NULL OR team_invitation_id IS NOT NULL OR event_door_pass_id IS NOT NULL);
  -- Also every 5 minutes while there are recent sent emails, so replies come back even when
  -- nothing is waiting to be sent.
  IF (queued > 0 OR (
        coalesce((SELECT value FROM wf_private.settings WHERE key = 'mailer_last_call')::timestamptz, '-infinity') < now() - interval '5 minutes'
        AND EXISTS (SELECT 1 FROM messages WHERE direction = 'outbound' AND status = 'sent' AND sent_at > now() - interval '30 days')))
     AND to_regnamespace('net') IS NOT NULL THEN
    INSERT INTO wf_private.settings(key, value) VALUES ('mailer_last_call', now()::text)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := ''{"mode":"queue"}''::jsonb, headers := jsonb_strip_nulls(jsonb_build_object(''Content-Type'', ''application/json'', ''x-synapse-mailer'', $2, ''apikey'', $3, ''Authorization'', ''Bearer '' || $3)))'
      USING (SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), wf_mailer_secret(), (SELECT value FROM wf_private.settings WHERE key = 'client_key');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf mailer call failed: %', SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('events', n_ev, 'resumed', n_runs, 'daily', n_daily, 'queued_emails', queued);
END $$;

CREATE OR REPLACE FUNCTION event_checkin_log(p_event uuid, p_limit int DEFAULT 30) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT event_can_check_in(p_event) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'at', c.at, 'result', c.result, 'via', c.via,
      'name', btrim(r.first_name || ' ' || r.last_name), 'registration_id', c.registration_id, 'by', coalesce(event_person_name(c.user_id), (SELECT p.name || ' (door pass)' FROM event_door_passes p WHERE p.id = c.door_pass_id))) ORDER BY c.at DESC, c.id DESC)
    FROM (SELECT * FROM event_checkins WHERE event_id = p_event ORDER BY at DESC, id DESC LIMIT least(greatest(p_limit, 1), 200)) c
    LEFT JOIN event_registrations r ON r.id = c.registration_id), '[]'::jsonb);
END $$;

-- Who checked someone in is either a person or a pass, never a stale mix of the two.
CREATE OR REPLACE FUNCTION event_registration_checkin_by() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.checked_in_at IS NULL OR NEW.checked_in_by IS NOT NULL THEN NEW.checked_in_pass := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_registration_checkin_by ON event_registrations;
CREATE TRIGGER event_registration_checkin_by BEFORE UPDATE OF checked_in_at, checked_in_by, checked_in_pass ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION event_registration_checkin_by();
