-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Update of 17 November 2026: invitation emails, workflow fixes, chat cards (Join meeting, Claim) and a live
-- bell, and invite-only offices. Run database-updates-14.sql first. Safe to run more than once.
-- Made from supabase/migrations/20261117*.sql; don't edit here.

-- ===== 20261117080000_team_invite_emails.sql
/*
  # Invitations are emailed

  Inviting someone (Settings → Team) now also emails them their join link, from the account's
  connected email account, with who invited them and the role. Copying the link by hand still
  works, and is the only way when no email account is connected.

  messages.team_invitation_id marks these emails so the mailer picks them up (wf_tick asks it to
  send every minute). Safe to run more than once.
*/

ALTER TABLE messages ADD COLUMN IF NOT EXISTS team_invitation_id uuid REFERENCES team_invitations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_team_invitation ON messages(team_invitation_id) WHERE team_invitation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION team_invitation_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  acc email_accounts; ws_name text; inviter text; link text; role_label text; subj text; txt text; html text;
BEGIN
  IF NEW.status <> 'pending' OR coalesce(NEW.email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN NEW; END IF;
  SELECT * INTO acc FROM email_accounts WHERE workspace_id = NEW.workspace_id AND status = 'active' ORDER BY created_at LIMIT 1;
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
          coalesce(nullif(acc.display_name, ''), ws_name), NEW.email, acc.id, NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invitation email not queued: %', SQLERRM;  -- the invitation itself still goes in
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION team_invitation_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS team_invitation_email ON team_invitations;
CREATE TRIGGER team_invitation_email AFTER INSERT ON team_invitations FOR EACH ROW EXECUTE FUNCTION team_invitation_email();

-- ===== 20261117090000_workflow_fixes.sql
/*
  # Workflow fixes

  1. A paused or draft workflow holds its runs: someone waiting in it doesn't carry on (no emails,
     no tags) until the workflow is published again. A deleted workflow's runs stop.
  2. Wait steps with a decimal (1.5 hours) wait, instead of skipping straight to the next step.
  3. Replies to sent emails come back every 5 minutes, even when nothing is waiting to be sent
     (they were only checked when the mailer had something to send).
  4. Task reminders aren't sent for tasks already completed.

  Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION wf_run(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r wf_runs; w workflows; step jsonb; sid text; res text; hops int := 0;
BEGIN
  SELECT * INTO r FROM wf_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('active', 'waiting') THEN RETURN; END IF;
  SELECT * INTO w FROM workflows WHERE id = r.workflow_id;
  IF NOT FOUND THEN PERFORM wf_finish(r.id, 'stopped', 'The workflow was deleted'); RETURN; END IF;
  -- A paused or draft workflow holds its runs where they are; they carry on when it's published again.
  IF w.status <> 'active' AND NOT r.is_test THEN RETURN; END IF;
  UPDATE wf_runs SET status = 'active', resume_at = NULL WHERE id = r.id;
  sid := r.current_step;
  LOOP
    hops := hops + 1;
    IF coalesce(sid, '') = '' THEN PERFORM wf_finish(r.id, 'completed', 'Workflow completed'); RETURN; END IF;
    IF hops > 200 THEN PERFORM wf_finish(r.id, 'failed', 'Too many steps in one go (is there a loop?)'); RETURN; END IF;
    step := w.definition->'graph'->sid;
    IF step IS NULL THEN PERFORM wf_finish(r.id, 'completed', 'The next step was deleted from the workflow'); RETURN; END IF;
    UPDATE wf_runs SET current_step = sid WHERE id = r.id;
    SELECT * INTO r FROM wf_runs WHERE id = r.id;
    BEGIN
      res := wf_exec_step(r, w, sid, step);
    EXCEPTION WHEN OTHERS THEN
      PERFORM wf_log(r, step, sid, 'failed', SQLERRM);
      res := 'fail';
    END;
    CASE res
      WHEN 'wait' THEN RETURN;
      WHEN 'end' THEN PERFORM wf_finish(r.id, 'completed', 'Ended by a step'); RETURN;
      WHEN 'fail' THEN
        -- Keep going after a failed step, like most builders do; the log shows what failed.
        sid := step->>'next';
      WHEN 'yes' THEN sid := step->>'yes';
      WHEN 'no' THEN sid := step->>'no';
      ELSE sid := step->>'next';
    END CASE;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION wf_exec_step(p_run wf_runs, p_wf workflows, p_id text, p_step jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce(p_step->'config', '{}'::jsonb);
  c record; t text; n int; secs bigint; amt numeric; until timestamptz; tz text; acct record; uids uuid[]; uid uuid;
  subj text; body text; ok boolean; other workflows; target uuid; dnd text[]; fld text;
  ch chat_channels; mt meetings; dep departments;
BEGIN
  SELECT * INTO c FROM contacts WHERE id = p_run.contact_id;
  IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'The contact no longer exists.'); RETURN 'fail'; END IF;
  PERFORM set_config('synapse.wf_depth', (p_run.depth + 1)::text, true);

  CASE p_step->>'type'
  WHEN 'add_tag' THEN
    FOR t IN SELECT jsonb_array_elements_text(coalesce(cfg->'tags', '[]')) LOOP
      INSERT INTO contact_tags(contact_id, tag_id) VALUES (c.id, wf_tag_id(c.workspace_id, t)) ON CONFLICT DO NOTHING;
    END LOOP;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Added: ' || coalesce((SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(coalesce(cfg->'tags', '[]')) x), ''));
  WHEN 'remove_tag' THEN
    DELETE FROM contact_tags ct USING tags tg WHERE ct.contact_id = c.id AND tg.id = ct.tag_id AND lower(tg.name) = ANY(wf_lower_list(cfg->'tags'));
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Removed: ' || coalesce((SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(coalesce(cfg->'tags', '[]')) x), ''));
  WHEN 'update_field' THEN
    fld := cfg->>'field';
    IF fld NOT IN ('first_name','last_name','email','phone','company','job_title','contact_type','timezone','date_of_birth','source') THEN
      PERFORM wf_log(p_run, p_step, p_id, 'failed', 'That field can''t be changed by a workflow.'); RETURN 'fail';
    END IF;
    BEGIN
      IF fld = 'date_of_birth' THEN
        UPDATE contacts SET date_of_birth = nullif(cfg->>'value', '')::date, updated_at = now() WHERE id = c.id;
      ELSE
        EXECUTE format('UPDATE contacts SET %I = $1, updated_at = now() WHERE id = $2', fld)
        USING nullif(wf_merge(cfg->>'value', c.id, p_run.context), ''), c.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM wf_log(p_run, p_step, p_id, 'failed', SQLERRM); RETURN 'fail';
    END;
    PERFORM wf_log(p_run, p_step, p_id, 'success', fld || ' set to "' || coalesce(cfg->>'value', '') || '"');
  WHEN 'assign_user' THEN
    UPDATE contacts SET owner_id = nullif(cfg->>'user_id', '')::uuid, updated_at = now() WHERE id = c.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Assigned');
  WHEN 'remove_assigned_user' THEN
    UPDATE contacts SET owner_id = NULL, updated_at = now() WHERE id = c.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Unassigned');
  WHEN 'set_dnd' THEN
    IF coalesce(cfg->>'scope', 'all') = 'all' THEN
      UPDATE contacts SET dnd_all = (cfg->>'mode' = 'enable'), updated_at = now() WHERE id = c.id;
    ELSE
      dnd := ARRAY(SELECT x FROM jsonb_array_elements_text(coalesce(cfg->'channels', '[]')) x WHERE x IN ('email','sms','calls'));
      IF cfg->>'mode' = 'enable' THEN
        UPDATE contacts SET dnd_channels = ARRAY(SELECT DISTINCT unnest(dnd_channels || dnd)), updated_at = now() WHERE id = c.id;
      ELSE
        UPDATE contacts SET dnd_channels = ARRAY(SELECT x FROM unnest(dnd_channels) x WHERE NOT x = ANY(dnd)), updated_at = now() WHERE id = c.id;
      END IF;
    END IF;
    PERFORM wf_log(p_run, p_step, p_id, 'success', CASE WHEN cfg->>'mode' = 'enable' THEN 'Do Not Disturb on' ELSE 'Do Not Disturb off' END);
  WHEN 'add_note' THEN
    INSERT INTO notes(workspace_id, contact_id, content) VALUES (c.workspace_id, c.id, coalesce(nullif(wf_merge(cfg->>'text', c.id, p_run.context), ''), '(empty note)'));
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Note added');
  WHEN 'add_task' THEN
    INSERT INTO tasks(workspace_id, contact_id, title, body, due_at, assigned_to)
    VALUES (c.workspace_id, c.id, left(coalesce(nullif(wf_merge(cfg->>'title', c.id, p_run.context), ''), 'Follow up'), 200), wf_merge(cfg->>'body', c.id, p_run.context),
      CASE WHEN cfg->>'due_in_days' ~ '^\d+$' THEN now() + make_interval(days => (cfg->>'due_in_days')::int) END,
      CASE WHEN cfg->>'assign' = 'owner' THEN c.owner_id ELSE nullif(cfg->>'assign', '')::uuid END);
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Task added');
  WHEN 'notify' THEN
    IF cfg->>'to' = 'users' THEN uids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(cfg->'users', '[]')) x);
    ELSIF cfg->>'to' = 'everyone' THEN uids := ARRAY(SELECT user_id FROM workspace_members WHERE workspace_id = c.workspace_id AND coalesce(status, 'active') = 'active');
    ELSE uids := ARRAY[c.owner_id]; END IF;
    uids := ARRAY(SELECT DISTINCT x FROM unnest(uids) x WHERE x IS NOT NULL);
    IF cardinality(uids) = 0 THEN PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'Nobody to notify (the contact has no assigned user).'); RETURN 'next'; END IF;
    FOREACH uid IN ARRAY uids LOOP
      INSERT INTO team_notifications(workspace_id, user_id, title, body, link)
      VALUES (c.workspace_id, uid, left(coalesce(nullif(wf_merge(cfg->>'title', c.id, p_run.context), ''), p_wf.name), 200), wf_merge(cfg->>'body', c.id, p_run.context), '/contacts/' || c.id);
    END LOOP;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Notified ' || cardinality(uids) || ' ' || CASE WHEN cardinality(uids) = 1 THEN 'person' ELSE 'people' END);
  WHEN 'send_email' THEN
    IF coalesce(c.email, '') = '' THEN PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'The contact has no email address.'); RETURN 'next'; END IF;
    IF c.dnd_all OR 'email' = ANY(c.dnd_channels) OR NOT coalesce(c.email_opt_in, true) THEN
      PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'The contact has Do Not Disturb on for email.'); RETURN 'next';
    END IF;
    tz := CASE WHEN p_wf.settings->>'timezone' = 'contact' AND coalesce(c.timezone, '') <> '' THEN c.timezone ELSE (SELECT timezone FROM workspaces WHERE id = c.workspace_id) END;
    until := wf_window_next(p_wf.settings, tz);
    IF until > now() + interval '30 seconds' THEN
      UPDATE wf_runs SET status = 'waiting', resume_at = until, current_step = p_id WHERE id = p_run.id;
      PERFORM wf_log(p_run, p_step, p_id, 'waiting', 'Outside the sending window. Sends at ' || to_char(until AT TIME ZONE coalesce(tz, 'UTC'), 'Dy DD Mon HH24:MI'));
      RETURN 'wait';
    END IF;
    SELECT * INTO acct FROM email_accounts WHERE id = coalesce(nullif(cfg->>'account_id', ''), nullif(p_wf.settings->'sender'->>'account_id', ''))::uuid AND workspace_id = c.workspace_id;
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'No sending email account chosen. Pick one in this workflow''s Settings → Sender.'); RETURN 'fail'; END IF;
    subj := wf_merge(cfg->>'subject', c.id, p_run.context); body := wf_merge(cfg->>'body', c.id, p_run.context);
    INSERT INTO messages(workspace_id, contact_id, channel, direction, subject, body, status, from_email, from_name, to_address, email_account_id, wf_run_id)
    VALUES (c.workspace_id, c.id, 'email', 'outbound', subj, body, 'queued', acct.email, coalesce(nullif(p_wf.settings->'sender'->>'from_name', ''), acct.display_name), c.email, acct.id, p_run.id);
    UPDATE wf_runs SET context = context || '{"messaged": true}'::jsonb WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Email queued to ' || c.email || ': "' || subj || '"');
  WHEN 'wait' THEN
    -- Decimals (1.5 hours) and words that aren't numbers no longer skip the wait.
    amt := greatest(coalesce(CASE WHEN trim(coalesce(cfg->>'amount', '')) ~ '^\d+(\.\d+)?$' THEN trim(cfg->>'amount')::numeric END, 1), 0);
    secs := round(amt * CASE coalesce(cfg->>'unit', 'hours') WHEN 'minutes' THEN 60 WHEN 'days' THEN 86400 ELSE 3600 END);
    UPDATE wf_runs SET status = 'waiting', resume_at = now() + make_interval(secs => secs), current_step = coalesce(p_step->>'next', '') WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'waiting', 'Waiting ' || amt || ' ' || coalesce(cfg->>'unit', 'hours'));
    RETURN 'wait';
  WHEN 'if_else' THEN
    ok := wf_conditions_ok(cfg, c.id);
    PERFORM wf_log(p_run, p_step, p_id, 'success', CASE WHEN ok THEN 'Yes branch' ELSE 'No branch' END);
    RETURN CASE WHEN ok THEN 'yes' ELSE 'no' END;
  WHEN 'webhook' THEN
    IF coalesce(cfg->>'url', '') !~ '^https://' THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'The webhook needs an https:// address.'); RETURN 'fail'; END IF;
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := ''{"Content-Type": "application/json"}''::jsonb)'
      USING cfg->>'url', jsonb_build_object('event', 'synapse.workflow', 'workflow', jsonb_build_object('id', p_wf.id, 'name', p_wf.name),
        'contact', (SELECT to_jsonb(x) - 'workspace_id' FROM contacts x WHERE x.id = c.id), 'tags', to_jsonb(wf_contact_tags(c.id)), 'trigger', p_run.trigger_name, 'context', p_run.context);
      PERFORM wf_log(p_run, p_step, p_id, 'success', 'Sent to ' || (cfg->>'url'));
    EXCEPTION WHEN OTHERS THEN
      PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Couldn''t send the webhook: ' || SQLERRM); RETURN 'fail';
    END;
  WHEN 'add_to_workflow' THEN
    SELECT * INTO other FROM workflows WHERE id = nullif(cfg->>'workflow_id', '')::uuid AND workspace_id = c.workspace_id;
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a workflow.'); RETURN 'fail'; END IF;
    target := wf_enroll(other, jsonb_build_object('id', 'added', 'name', 'Added by ' || p_wf.name), c.id, 'Added by workflow "' || p_wf.name || '"', '{}'::jsonb, p_run.depth + 1, false, true);
    PERFORM wf_log(p_run, p_step, p_id, CASE WHEN target IS NULL THEN 'skipped' ELSE 'success' END, CASE WHEN target IS NULL THEN 'Already in "' || other.name || '" (or it is a draft)' ELSE 'Added to "' || other.name || '"' END);
  WHEN 'remove_from_workflow' THEN
    IF coalesce(cfg->>'workflow_id', 'current') = 'current' THEN
      PERFORM wf_log(p_run, p_step, p_id, 'success', 'Removed from this workflow');
      PERFORM wf_finish(p_run.id, 'removed', 'Removed by a step in this workflow');
      RETURN 'end';
    END IF;
    UPDATE wf_runs SET status = 'removed', exit_reason = 'Removed by workflow "' || p_wf.name || '"', finished_at = now(), resume_at = NULL
    WHERE workflow_id = (cfg->>'workflow_id')::uuid AND contact_id = c.id AND status IN ('active', 'waiting');
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Removed from the other workflow');
  WHEN 'end' THEN
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'End');
    RETURN 'end';
  WHEN 'post_to_channel' THEN
    SELECT * INTO ch FROM chat_channels WHERE id = nullif(cfg->>'channel_id', '')::uuid AND workspace_id = c.workspace_id AND kind = 'channel';
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a channel to post in.'); RETURN 'fail'; END IF;
    IF ch.archived_at IS NOT NULL THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'The channel #' || ch.name || ' is archived.'); RETURN 'fail'; END IF;
    body := wf_merge(coalesce(nullif(cfg->>'text', ''), '{{contact.name}} · {{contact.link}}'), c.id, p_run.context);
    PERFORM wf_post(ch.id, p_wf, p_run, body);
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Posted in #' || ch.name);
  WHEN 'create_meeting' THEN
    uid := CASE WHEN coalesce(cfg->>'host', 'owner') = 'owner' THEN c.owner_id ELSE nullif(cfg->>'host', '')::uuid END;
    IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = c.workspace_id AND m.user_id = uid AND coalesce(m.status, 'active') = 'active') THEN
      uid := (SELECT owner_id FROM workspaces WHERE id = c.workspace_id);
    END IF;
    subj := left(coalesce(nullif(btrim(wf_merge(cfg->>'title', c.id, p_run.context)), ''), 'Call with ' || coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'a contact')), 120);
    target := wf_new_meeting(c.workspace_id, uid, subj, greatest(5, least(600, coalesce(nullif(cfg->>'duration_min', '')::int, 30))));
    SELECT * INTO mt FROM meetings WHERE id = target;
    t := wf_app_url() || '/meetings/' || mt.code || '?invite=' || mt.invite_token;
    UPDATE wf_runs SET context = context || jsonb_build_object('meeting_id', mt.id, 'meeting_code', mt.code, 'meeting_link', t) WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'success', 'Meeting ' || mt.code || ' created: ' || t);
  WHEN 'notify_department' THEN
    SELECT * INTO dep FROM departments WHERE id = nullif(cfg->>'department_id', '')::uuid AND workspace_id = c.workspace_id;
    IF NOT FOUND THEN PERFORM wf_log(p_run, p_step, p_id, 'failed', 'Choose a department.'); RETURN 'fail'; END IF;
    uids := ARRAY(SELECT dm.user_id FROM department_members dm
                  JOIN workspace_members m ON m.workspace_id = dm.workspace_id AND m.user_id = dm.user_id AND coalesce(m.status, 'active') = 'active'
                  WHERE dm.department_id = dep.id);
    subj := left(coalesce(nullif(wf_merge(cfg->>'title', c.id, p_run.context), ''), p_wf.name), 200);
    body := wf_merge(cfg->>'body', c.id, p_run.context);
    FOREACH uid IN ARRAY uids LOOP
      INSERT INTO team_notifications(workspace_id, user_id, title, body, link) VALUES (c.workspace_id, uid, subj, body, '/contacts/' || c.id);
    END LOOP;
    t := 'Notified ' || cardinality(uids) || ' ' || CASE WHEN cardinality(uids) = 1 THEN 'person' ELSE 'people' END || ' in ' || dep.name;
    IF coalesce((cfg->>'post')::boolean, true) THEN
      SELECT * INTO ch FROM chat_channels WHERE department_id = dep.id AND is_department AND archived_at IS NULL;
      IF FOUND THEN
        PERFORM wf_post(ch.id, p_wf, p_run, subj || CASE WHEN coalesce(body, '') <> '' THEN E'\n' || body ELSE '' END);
        t := t || ' and posted in #' || ch.name;
      END IF;
    END IF;
    IF cardinality(uids) = 0 AND t NOT LIKE '%posted%' THEN PERFORM wf_log(p_run, p_step, p_id, 'skipped', 'Nobody is in ' || dep.name || ' yet.'); RETURN 'next'; END IF;
    PERFORM wf_log(p_run, p_step, p_id, 'success', t);
  ELSE
    PERFORM wf_log(p_run, p_step, p_id, 'failed', 'This step type isn''t supported: ' || coalesce(p_step->>'type', '?'));
    RETURN 'fail';
  END CASE;
  RETURN 'next';
END $$;

CREATE OR REPLACE FUNCTION wf_daily_scan() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w workflows; t jsonb; f jsonb; tz text; today date; target date; n int := 0; c record; days int; ofs text; hit boolean; dob date; mmdd text;
BEGIN
  FOR w IN SELECT * FROM workflows WHERE status = 'active' AND definition IS NOT NULL
           AND definition->'triggers' @? '$[*] ? (@.type == "birthday_reminder" || @.type == "custom_date_reminder" || @.type == "task_reminder")' LOOP
    tz := coalesce((SELECT nullif(timezone, '') FROM workspaces WHERE id = w.workspace_id), 'UTC');
    BEGIN today := (now() AT TIME ZONE tz)::date; EXCEPTION WHEN OTHERS THEN tz := 'UTC'; today := (now() AT TIME ZONE tz)::date; END;
    IF (now() AT TIME ZONE tz)::time < time '08:00' THEN CONTINUE; END IF;
    FOR t IN SELECT * FROM jsonb_array_elements(w.definition->'triggers') LOOP
      f := coalesce(t->'filters', '{}'::jsonb);
      days := greatest(coalesce(nullif(f->>'days', '')::int, 0), 0);
      ofs := coalesce(f->>'offset', 'on');
      target := CASE ofs WHEN 'before' THEN today + days WHEN 'after' THEN today - days ELSE today END;
      IF t->>'type' IN ('birthday_reminder', 'custom_date_reminder') THEN
        IF coalesce(f->>'weekday', '') <> '' AND extract(dow FROM today)::int <> (f->>'weekday')::int THEN CONTINUE; END IF;
        FOR c IN SELECT id, date_of_birth, created_at FROM contacts WHERE workspace_id = w.workspace_id LOOP
          dob := CASE WHEN t->>'type' = 'birthday_reminder' OR coalesce(f->>'field', 'date_of_birth') = 'date_of_birth' THEN c.date_of_birth
                      ELSE (c.created_at AT TIME ZONE tz)::date END;
          IF dob IS NULL THEN CONTINUE; END IF;
          IF coalesce(f->>'month', '') <> '' AND extract(month FROM dob)::int <> (f->>'month')::int THEN CONTINUE; END IF;
          IF t->>'type' = 'custom_date_reminder' AND coalesce((f->>'match_year')::boolean, false) THEN
            hit := dob = target;
          ELSE
            mmdd := to_char(dob, 'MM-DD');
            -- 29 February birthdays are celebrated on 28 February in other years.
            IF mmdd = '02-29' AND NOT (extract(year FROM target)::int % 4 = 0 AND (extract(year FROM target)::int % 100 <> 0 OR extract(year FROM target)::int % 400 = 0)) THEN mmdd := '02-28'; END IF;
            hit := mmdd = to_char(target, 'MM-DD');
          END IF;
          IF NOT hit THEN CONTINUE; END IF;
          IF coalesce(f->>'has_tag', '') <> '' AND NOT lower(f->>'has_tag') = ANY(wf_contact_tags(c.id)) THEN CONTINUE; END IF;
          INSERT INTO wf_daily_marks VALUES (w.id, coalesce(t->>'id', ''), c.id, today) ON CONFLICT DO NOTHING;
          IF NOT FOUND THEN CONTINUE; END IF;
          IF wf_enroll(w, t, c.id, coalesce(nullif(t->>'name', ''), t->>'type'), '{}'::jsonb, 0, false, true) IS NOT NULL THEN n := n + 1; END IF;
        END LOOP;
      ELSIF t->>'type' = 'task_reminder' THEN
        FOR c IN SELECT id, contact_id, title FROM tasks WHERE workspace_id = w.workspace_id AND contact_id IS NOT NULL AND due_at IS NOT NULL AND completed_at IS NULL
                   AND (due_at AT TIME ZONE tz)::date = CASE ofs WHEN 'after' THEN today - days ELSE today + days END LOOP
          INSERT INTO wf_daily_marks VALUES (w.id, coalesce(t->>'id', ''), c.id, today) ON CONFLICT DO NOTHING;
          IF NOT FOUND THEN CONTINUE; END IF;
          IF wf_enroll(w, t, c.contact_id, coalesce(nullif(t->>'name', ''), 'Task reminder') || ': ' || c.title, jsonb_build_object('task_id', c.id, 'title', c.title), 0, false, true) IS NOT NULL THEN n := n + 1; END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;

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
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND (wf_run_id IS NOT NULL OR form_submission_id IS NOT NULL OR team_invitation_id IS NOT NULL);
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

-- ===== 20261117100000_chat_cards_live_bell.sql
/*
  # Chat cards and a live bell

  1. Workflow posts in a channel carry what they're about: the contact, and the meeting link when
     the workflow made one. Conversations shows them as a card with **Join meeting** and **Claim**.
  2. chat_claim_contact(message): the first person to press Claim becomes the contact's owner;
     everyone sees "Claimed by …" (the message updates live), and a second press says who has it.
  3. The bell (team_notifications) updates live: it's added to Supabase Realtime.

  Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION wf_post(p_channel uuid, p_wf workflows, p_run wf_runs, p_body text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chat_messages(channel_id, workspace_id, user_id, body, source, sender_name, meta)
  VALUES (p_channel, p_wf.workspace_id, NULL, left(coalesce(nullif(btrim(p_body), ''), p_wf.name), 8000), 'system', left('Workflow: ' || p_wf.name, 80),
          jsonb_strip_nulls(jsonb_build_object(
            'workflow_id', p_wf.id, 'run_id', p_run.id, 'contact_id', p_run.contact_id,
            'contact_name', (SELECT nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') FROM contacts c WHERE c.id = p_run.contact_id),
            'meeting_link', p_run.context->>'meeting_link', 'meeting_code', p_run.context->>'meeting_code')));
$$;
REVOKE ALL ON FUNCTION wf_post(uuid, workflows, wf_runs, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION chat_claim_contact(p_message uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m chat_messages; me uuid := auth.uid(); who text; cid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO m FROM chat_messages WHERE id = p_message FOR UPDATE;
  IF NOT FOUND OR NOT can_see_channel(m.channel_id) OR NOT member_can(m.workspace_id, 'conversations') THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF m.source <> 'system' OR m.deleted_at IS NOT NULL OR coalesce(m.meta->>'contact_id', '') = '' THEN RAISE EXCEPTION 'There is nothing to claim here'; END IF;
  IF coalesce(m.meta->>'claimed_by', '') <> '' THEN
    IF m.meta->>'claimed_by' = me::text THEN RETURN m.meta; END IF;
    RAISE EXCEPTION 'Already claimed by %', coalesce(m.meta->>'claimed_name', 'someone else');
  END IF;
  cid := (m.meta->>'contact_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = cid AND workspace_id = m.workspace_id) THEN RAISE EXCEPTION 'That contact was deleted'; END IF;
  SELECT coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'A teammate') INTO who FROM profiles p WHERE p.user_id = me;
  UPDATE contacts SET owner_id = me WHERE id = cid;
  UPDATE chat_messages SET meta = meta || jsonb_build_object('claimed_by', me, 'claimed_name', coalesce(who, 'A teammate'), 'claimed_at', now())
    WHERE id = m.id RETURNING meta INTO m.meta;
  RETURN m.meta;
END $$;
REVOKE ALL ON FUNCTION chat_claim_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION chat_claim_contact(uuid) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'team_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_notifications;
  END IF;
END $$;

-- ===== 20261117110000_invite_only_spaces.sql
/*
  # Invite-only offices

  An office (space) set to "Invite only" now has an invite list. Only the people on it, the
  person who made the office, and the account's Owner and Admins can see it, enter it, or get
  onto its audio and video (the call token checks the same list). Other offices are unchanged.

  - space_invitees: who is invited to which office. Admins and the office's creator manage it;
    everyone allowed into the office can see who's on it.
  - can_enter_space(space): the one rule, used by the policies (and mirrored in livekit-token).

  Safe to run more than once.
*/

CREATE TABLE IF NOT EXISTS space_invitees (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_space_invitees_user ON space_invitees(user_id);
ALTER TABLE space_invitees ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_enter_space(p_space uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT s.access_mode <> 'invite_only'
        OR s.created_by = auth.uid()
        OR is_workspace_admin(s.workspace_id)
        OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = s.workspace_id AND w.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM space_invitees i WHERE i.space_id = s.id AND i.user_id = auth.uid())
    FROM spaces s WHERE s.id = p_space
  ), false);
$$;
REVOKE ALL ON FUNCTION can_enter_space(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_enter_space(uuid) TO authenticated;

-- Who manages an office's invite list: Admins, the account's owner, and whoever made it.
CREATE OR REPLACE FUNCTION can_manage_space(p_space uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT s.created_by = auth.uid() OR is_workspace_admin(s.workspace_id)
        OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = s.workspace_id AND w.owner_id = auth.uid())
    FROM spaces s WHERE s.id = p_space
  ), false);
$$;
REVOKE ALL ON FUNCTION can_manage_space(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION can_manage_space(uuid) TO authenticated;

DROP POLICY IF EXISTS space_invitees_select ON space_invitees;
CREATE POLICY space_invitees_select ON space_invitees FOR SELECT TO authenticated USING (can_enter_space(space_id));
DROP POLICY IF EXISTS space_invitees_insert ON space_invitees;
CREATE POLICY space_invitees_insert ON space_invitees FOR INSERT TO authenticated
  WITH CHECK (can_manage_space(space_id)
              AND EXISTS (SELECT 1 FROM spaces s JOIN workspace_members m ON m.workspace_id = s.workspace_id
                          WHERE s.id = space_id AND m.user_id = space_invitees.user_id));
DROP POLICY IF EXISTS space_invitees_delete ON space_invitees;
CREATE POLICY space_invitees_delete ON space_invitees FOR DELETE TO authenticated USING (can_manage_space(space_id));

-- The office itself, and who's in it, follow the list.
DROP POLICY IF EXISTS spaces_invite_only ON spaces;
CREATE POLICY spaces_invite_only ON spaces AS RESTRICTIVE FOR SELECT TO authenticated USING (can_enter_space(id));
DROP POLICY IF EXISTS space_members_invite_only ON space_members;
CREATE POLICY space_members_invite_only ON space_members AS RESTRICTIVE FOR ALL TO authenticated
  USING (can_enter_space(space_id)) WITH CHECK (can_enter_space(space_id));

