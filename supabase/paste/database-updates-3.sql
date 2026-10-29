-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Phase 13 database update (30 October 2026): the three new workflow actions (post to a channel,
-- create a meeting link, notify a department) and the new merge fields. Safe to run more than once.
-- Made from supabase/migrations/20261030090000_workflow_new_actions.sql; don't edit here.

/*
  # Workflows: three new actions

  - Post to a channel: a message in a Conversations channel, from "Workflow: <name>".
  - Create a meeting link: a real SYNAPSE meeting that anyone with the link can join; later steps
    use it as {{meeting.link}} (in an email, a channel post or a notification).
  - Notify a department: a notification under the bell for everyone in the department, and a post
    in the department's channel.

  New merge fields for any step: {{contact.link}} (the contact in SYNAPSE), {{meeting.link}} and
  {{meeting.code}}, {{form.name}} and {{form.answers}} (when a form or survey started it).

  Needs 20261010090000_workflow_engine.sql, 20261016090000_conversations.sql and
  20261029150000_department_channels.sql. Safe to run more than once.
*/

-- The address links point to (the public app, not a Vercel preview).
INSERT INTO wf_private.settings(key, value) VALUES ('app_url', 'https://synapse-dj3a.vercel.app') ON CONFLICT (key) DO NOTHING;
CREATE OR REPLACE FUNCTION wf_app_url() RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT rtrim(coalesce((SELECT value FROM wf_private.settings WHERE key = 'app_url'), 'https://synapse-dj3a.vercel.app'), '/');
$$;

-- A form submission's answers as "Label: answer" lines, in the form's order.
CREATE OR REPLACE FUNCTION wf_form_answers(p_submission uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s form_submissions; def jsonb; out text;
BEGIN
  SELECT * INTO s FROM form_submissions WHERE id = p_submission;
  IF NOT FOUND THEN RETURN ''; END IF;
  SELECT CASE WHEN jsonb_typeof(f.definition) = 'string' THEN (f.definition #>> '{}')::jsonb ELSE f.definition END INTO def FROM forms f WHERE f.id = s.form_id;
  SELECT string_agg(coalesce(nullif(el->'field'->>'label', ''), a.key) || ': ' || a.value, E'\n'
                    ORDER BY coalesce((el->>'sortOrder')::int, 999), a.key)
    INTO out
  FROM jsonb_each_text(coalesce(s.answers, '{}'::jsonb)) a
  LEFT JOIN LATERAL (SELECT e.value AS el FROM jsonb_each(coalesce(def->'elements', '{}'::jsonb)) e WHERE e.value->'field'->>'fieldId' = a.key LIMIT 1) x ON true;
  RETURN coalesce(out, '');
EXCEPTION WHEN OTHERS THEN RETURN '';
END $$;

-- A message from a workflow in a channel.
CREATE OR REPLACE FUNCTION wf_post(p_channel uuid, p_wf workflows, p_run wf_runs, p_body text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chat_messages(channel_id, workspace_id, user_id, body, source, sender_name, meta)
  VALUES (p_channel, p_wf.workspace_id, NULL, left(coalesce(nullif(btrim(p_body), ''), p_wf.name), 8000), 'system', left('Workflow: ' || p_wf.name, 80),
          jsonb_build_object('workflow_id', p_wf.id, 'run_id', p_run.id, 'contact_id', p_run.contact_id));
$$;

-- A new meeting with a fresh join code (like FOCU-358) and an invite link anyone can use.
CREATE OR REPLACE FUNCTION wf_new_meeting(p_workspace uuid, p_host uuid, p_title text, p_minutes int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE letters text; code text; mid uuid; i int;
BEGIN
  FOR i IN 1..10 LOOP
    letters := left(regexp_replace(upper(p_title), '[^A-Z]', '', 'g'), 4);
    WHILE length(letters) < 4 LOOP letters := letters || substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1); END LOOP;
    code := letters || '-' || lpad(floor(random() * 1000)::int::text, 3, '0');
    BEGIN
      INSERT INTO meetings(workspace_id, host_id, title, code, kind, duration_min) VALUES (p_workspace, p_host, p_title, code, 'instant', p_minutes) RETURNING id INTO mid;
      RETURN mid;
    EXCEPTION WHEN unique_violation THEN
      letters := ''; -- that code is taken: try random letters
      p_title := '';
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not make a meeting code';
END $$;

-- {{contact.first_name}} etc., and the new {{contact.link}}, {{meeting.*}} and {{form.*}}.
CREATE OR REPLACE FUNCTION wf_merge(p_text text, p_contact uuid, p_ctx jsonb DEFAULT '{}'::jsonb) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; s text := coalesce(p_text, ''); full_name text;
BEGIN
  SELECT * INTO c FROM contacts WHERE id = p_contact;
  IF FOUND THEN
    full_name := btrim(concat_ws(' ', c.first_name, c.last_name));
    s := replace(s, '{{contact.first_name}}', coalesce(c.first_name, ''));
    s := replace(s, '{{contact.last_name}}', coalesce(c.last_name, ''));
    s := replace(s, '{{contact.name}}', full_name);
    s := replace(s, '{{contact.email}}', coalesce(c.email, ''));
    s := replace(s, '{{contact.phone}}', coalesce(c.phone, ''));
    s := replace(s, '{{contact.company}}', coalesce(c.company, ''));
    s := replace(s, '{{contact.link}}', wf_app_url() || '/contacts/' || c.id);
    s := replace(s, '{{first_name}}', coalesce(c.first_name, ''));
    s := replace(s, '{{last_name}}', coalesce(c.last_name, ''));
    s := replace(s, '{{email}}', coalesce(c.email, ''));
    s := replace(s, '{{phone}}', coalesce(c.phone, ''));
    s := replace(s, '{{company}}', coalesce(c.company, ''));
  END IF;
  s := replace(s, '{{appointment.title}}', coalesce(p_ctx->>'title', ''));
  s := replace(s, '{{appointment.start_time}}', coalesce(p_ctx->>'start_time', ''));
  -- From a "Create meeting link" step earlier in the workflow.
  s := replace(s, '{{meeting.link}}', coalesce(p_ctx->>'meeting_link', ''));
  s := replace(s, '{{meeting.code}}', coalesce(p_ctx->>'meeting_code', ''));
  -- When a form or survey started the workflow.
  IF position('{{form.' IN s) > 0 THEN
    s := replace(s, '{{form.name}}', coalesce((SELECT f.name FROM forms f WHERE f.id = nullif(p_ctx->>'form_id', '')::uuid), ''));
    s := replace(s, '{{form.answers}}', wf_form_answers(nullif(p_ctx->>'submission_id', '')::uuid));
  END IF;
  RETURN s;
END $$;

-- Runs one step. Returns the branch to follow: 'next', 'yes', 'no', 'wait' (paused), 'end' or 'fail'.
CREATE OR REPLACE FUNCTION wf_exec_step(p_run wf_runs, p_wf workflows, p_id text, p_step jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce(p_step->'config', '{}'::jsonb);
  c record; t text; n int; secs bigint; until timestamptz; tz text; acct record; uids uuid[]; uid uuid;
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
    n := greatest(coalesce(nullif(cfg->>'amount', '')::int, 1), 0);
    secs := n * CASE coalesce(cfg->>'unit', 'hours') WHEN 'minutes' THEN 60 WHEN 'days' THEN 86400 ELSE 3600 END;
    UPDATE wf_runs SET status = 'waiting', resume_at = now() + make_interval(secs => secs), current_step = coalesce(p_step->>'next', '') WHERE id = p_run.id;
    PERFORM wf_log(p_run, p_step, p_id, 'waiting', 'Waiting ' || n || ' ' || coalesce(cfg->>'unit', 'hours'));
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

