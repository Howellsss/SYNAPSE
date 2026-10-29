-- Workflows: every trigger starts the workflow it should (and not the ones it shouldn't), and every
-- action does what it says. Run by scripts/test-database.sh on a throwaway database.
--
-- Each case is a DO block: t.reset() pauses every workflow and clears old events, t.flow() makes
-- the one workflow under test, something happens to a contact, t.tick() runs the engine once (as
-- the every-minute job does), then t.check() looks at the result. A case that crashes counts as
-- failed; the file fails at the end if anything did.

SET client_min_messages = notice;
CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE IF NOT EXISTS t.failures (name text, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS t.passes (n int);
TRUNCATE t.failures, t.passes;

CREATE OR REPLACE FUNCTION t.case(p_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('t.case', p_name, false); RAISE NOTICE '%', p_name; END $$;

CREATE OR REPLACE FUNCTION t.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(p_ok, false) THEN
    INSERT INTO t.passes VALUES (1);
    RAISE NOTICE '  ✓ %', p_what;
  ELSE
    INSERT INTO t.failures(name) VALUES (current_setting('t.case', true) || ': ' || p_what);
    RAISE NOTICE '  ✗ %', p_what;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION t.crashed(p_case text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t.failures(name) VALUES (p_case || ': crashed: ' || p_err);
  RAISE NOTICE '  ✗ crashed: %', p_err;
END $$;

-- The account everything happens in.
CREATE OR REPLACE FUNCTION t.ws() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a0000000-0000-4000-8000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION t.owner() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a0000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE OR REPLACE FUNCTION t.member() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a0000000-0000-4000-8000-0000000000a2'::uuid $$;
CREATE OR REPLACE FUNCTION t.mailbox() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a0000000-0000-4000-8000-0000000000e1'::uuid $$;
CREATE OR REPLACE FUNCTION t.calendar() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a0000000-0000-4000-8000-0000000000c1'::uuid $$;

INSERT INTO auth.users(id, email) VALUES (t.owner(), 'owner@example.com'), (t.member(), 'member@example.com') ON CONFLICT DO NOTHING;
INSERT INTO workspaces(id, name, slug, owner_id, timezone) VALUES (t.ws(), 'Test Co', 'test-co', t.owner(), 'UTC') ON CONFLICT DO NOTHING;
INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (t.ws(), t.owner(), 'owner'), (t.ws(), t.member(), 'member') ON CONFLICT DO NOTHING;
INSERT INTO email_accounts(id, workspace_id, user_id, provider, email, display_name, status)
  VALUES (t.mailbox(), t.ws(), t.owner(), 'google', 'team@example.com', 'Test Co', 'active') ON CONFLICT DO NOTHING;
INSERT INTO calendars(id, workspace_id, owner_id, name, slug) VALUES (t.calendar(), t.ws(), t.owner(), 'Intro call', 'intro-call') ON CONFLICT DO NOTHING;

-- Pause every workflow and forget earlier events, so each case starts clean.
CREATE OR REPLACE FUNCTION t.reset() RETURNS void LANGUAGE sql AS $$
  UPDATE workflows SET status = 'draft' WHERE workspace_id = t.ws();
  UPDATE wf_events SET processed_at = now() WHERE processed_at IS NULL;
  DELETE FROM net.requests;
$$;

-- A published workflow: its triggers, its steps (graph) and the first step.
CREATE OR REPLACE FUNCTION t.flow(p_name text, p_triggers jsonb, p_graph jsonb, p_start text DEFAULT 's1', p_settings jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO workflows(workspace_id, name, status, trigger_type, definition, settings)
  VALUES (t.ws(), p_name, 'active', coalesce(p_triggers->0->>'type', 'manual'),
          jsonb_build_object('triggers', p_triggers, 'start', p_start, 'graph', p_graph), p_settings)
  RETURNING id;
$$;

-- A one-step workflow that tags whoever it runs for, to show it ran.
CREATE OR REPLACE FUNCTION t.tagging_flow(p_name text, p_trigger jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT t.flow(p_name, jsonb_build_array(p_trigger || jsonb_build_object('id', 'tr1')),
    jsonb_build_object('s1', jsonb_build_object('type', 'add_tag', 'config', jsonb_build_object('tags', jsonb_build_array('ran')))));
$$;

CREATE OR REPLACE FUNCTION t.contact(p_first text, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO contacts(workspace_id, first_name, email, owner_id) VALUES (t.ws(), p_first, lower(p_first) || '@example.com', t.owner()) RETURNING id INTO v_id;
  IF p_extra <> '{}'::jsonb THEN
    UPDATE contacts c SET
      date_of_birth = coalesce((p_extra->>'date_of_birth')::date, c.date_of_birth),
      email = CASE WHEN p_extra ? 'email' THEN p_extra->>'email' ELSE c.email END,
      dnd_all = coalesce((p_extra->>'dnd_all')::boolean, c.dnd_all)
    WHERE c.id = v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION t.tick() RETURNS void LANGUAGE sql AS $$ SELECT wf_tick(); $$;
CREATE OR REPLACE FUNCTION t.runs(p_wf uuid, p_contact uuid DEFAULT NULL) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM wf_runs WHERE workflow_id = p_wf AND (p_contact IS NULL OR contact_id = p_contact) AND NOT is_test;
$$;
CREATE OR REPLACE FUNCTION t.has_tag(p_contact uuid, p_tag text) RETURNS boolean LANGUAGE sql AS $$
  SELECT lower(p_tag) = ANY(wf_contact_tags(p_contact));
$$;
CREATE OR REPLACE FUNCTION t.tag(p_contact uuid, p_tag text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO contact_tags(contact_id, tag_id) VALUES (p_contact, wf_tag_id(t.ws(), p_tag)) ON CONFLICT DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION t.log(p_wf uuid, p_step text) RETURNS wf_logs LANGUAGE sql AS $$
  SELECT * FROM wf_logs WHERE workflow_id = p_wf AND step_id = p_step ORDER BY id DESC LIMIT 1;
$$;

-- ============================================================================ triggers

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Trigger: contact created'); PERFORM t.reset();
  w := t.tagging_flow('New contacts', '{"type": "contact_created"}');
  c := t.contact('Ana'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'a new contact starts the workflow');
  PERFORM t.check(t.has_tag(c, 'ran'), 'its step ran (tag added)');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: contact created', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Trigger: contact changed'); PERFORM t.reset();
  c := t.contact('Ben'); PERFORM t.tick();
  w := t.tagging_flow('Company changed to Acme', '{"type": "contact_changed", "filters": {"field": "company", "op": "has_changed_to", "value": "Acme"}}');
  UPDATE contacts SET company = 'Other' WHERE id = c; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 0, 'a change to something else does not start it');
  UPDATE contacts SET company = 'Acme' WHERE id = c; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'the matching change starts it');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: contact changed', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Trigger: tag added / removed'); PERFORM t.reset();
  c := t.contact('Cara'); PERFORM t.tick();
  w := t.tagging_flow('Hot leads', '{"type": "contact_tag", "filters": {"event": "added", "tags": ["Hot"]}}');
  PERFORM t.tag(c, 'cold'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 0, 'another tag does not start it');
  PERFORM t.tag(c, 'hot'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'adding the tag starts it (any capitals)');
  UPDATE workflows SET status = 'draft' WHERE id = w;
  w := t.tagging_flow('Tag removed', '{"type": "contact_tag", "filters": {"event": "removed", "tags": ["cold"]}}');
  DELETE FROM contact_tags ct USING tags tg WHERE ct.contact_id = c AND tg.id = ct.tag_id AND tg.name = 'cold'; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'removing a tag starts a "tag removed" workflow');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: tag added / removed', SQLERRM); END $$;

DO $$ DECLARE w uuid; ws uuid; c uuid; f uuid; s uuid; BEGIN
  PERFORM t.case('Trigger: form submitted and survey submitted'); PERFORM t.reset();
  INSERT INTO forms(workspace_id, name, type, status) VALUES (t.ws(), 'Contact us', 'form', 'published') RETURNING id INTO f;
  INSERT INTO forms(workspace_id, name, type, status) VALUES (t.ws(), 'Feedback', 'survey', 'published') RETURNING id INTO s;
  w := t.tagging_flow('Contact us form', jsonb_build_object('type', 'form_submitted', 'filters', jsonb_build_object('forms', jsonb_build_array(f))));
  ws := t.tagging_flow('Any survey', '{"type": "form_submitted"}');
  UPDATE workflows SET status = 'draft' WHERE id = ws;
  c := t.contact('Dev'); PERFORM t.tick();
  -- The way form-submit saves it: first without the contact, then the contact is attached.
  INSERT INTO form_submissions(workspace_id, form_id, answers) VALUES (t.ws(), s, '{}') RETURNING id INTO ws;
  UPDATE form_submissions SET contact_id = c WHERE id = ws; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 0, 'a different form does not start a workflow for this form');
  INSERT INTO form_submissions(workspace_id, form_id, contact_id, answers) VALUES (t.ws(), f, c, '{}'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'submitting the form starts it');
  UPDATE workflows SET status = 'draft' WHERE id = w;
  w := t.tagging_flow('Survey', jsonb_build_object('type', 'form_submitted', 'filters', jsonb_build_object('forms', jsonb_build_array(s))));
  INSERT INTO form_submissions(workspace_id, form_id, answers) VALUES (t.ws(), s, '{}') RETURNING id INTO ws;
  UPDATE form_submissions SET contact_id = c WHERE id = ws; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'a survey starts it when the contact is attached after saving');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: form submitted and survey submitted', SQLERRM); END $$;

DO $$ DECLARE w uuid; ws uuid; c uuid; a uuid; BEGIN
  PERFORM t.case('Trigger: booking made and booking status'); PERFORM t.reset();
  w := t.tagging_flow('Booked', jsonb_build_object('type', 'customer_booked_appointment', 'filters', jsonb_build_object('calendars', jsonb_build_array(t.calendar()))));
  ws := t.flow('No-show', '[{"id": "tr1", "type": "appointment_status", "filters": {"statuses": ["no_show"]}}]',
    '{"s1": {"type": "add_tag", "config": {"tags": ["no-show"]}}}');
  c := t.contact('Eve'); PERFORM t.tick();
  INSERT INTO appointments(workspace_id, calendar_id, contact_id, title, status, start_time, end_time)
  VALUES (t.ws(), t.calendar(), c, 'Intro', 'confirmed', now() + interval '1 day', now() + interval '1 day 30 minutes') RETURNING id INTO a;
  PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'a booking starts "booked"');
  PERFORM t.check(t.runs(ws, c) = 0, 'a booking does not start "no-show"');
  UPDATE appointments SET status = 'no_show' WHERE id = a; PERFORM t.tick();
  PERFORM t.check(t.runs(ws, c) = 1 AND t.has_tag(c, 'no-show'), 'marking it a no-show starts "no-show"');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: booking made and booking status', SQLERRM); END $$;

DO $$ DECLARE w uuid; ws uuid; c uuid; k uuid; BEGIN
  PERFORM t.case('Trigger: task added and task completed'); PERFORM t.reset();
  w := t.tagging_flow('Task added', jsonb_build_object('type', 'task_added', 'filters', jsonb_build_object('users', jsonb_build_array(t.member()))));
  ws := t.flow('Task done', '[{"id": "tr1", "type": "task_completed"}]', '{"s1": {"type": "add_tag", "config": {"tags": ["task-done"]}}}');
  c := t.contact('Finn'); PERFORM t.tick();
  INSERT INTO tasks(workspace_id, contact_id, title, assigned_to) VALUES (t.ws(), c, 'For the owner', t.owner()); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 0, 'a task for someone else does not start it');
  INSERT INTO tasks(workspace_id, contact_id, title, assigned_to) VALUES (t.ws(), c, 'Call back', t.member()) RETURNING id INTO k; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'a task for the chosen person starts it');
  UPDATE tasks SET completed_at = now() WHERE id = k; PERFORM t.tick();
  PERFORM t.check(t.runs(ws, c) = 1 AND t.has_tag(c, 'task-done'), 'completing the task starts "task done"');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: task added and task completed', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Trigger: customer replied (and Stop on response)'); PERFORM t.reset();
  c := t.contact('Gia'); PERFORM t.tick();
  -- A drip that emails, then waits two days: a reply should stop it.
  w := t.flow('Drip', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["drip"]}}]',
    jsonb_build_object('s1', jsonb_build_object('type', 'send_email', 'next', 's2', 'config', jsonb_build_object('account_id', t.mailbox(), 'subject', 'Hi {{contact.first_name}}', 'body', 'Hello')),
                       's2', '{"type": "wait", "next": "s3", "config": {"amount": 2, "unit": "days"}}'::jsonb,
                       's3', '{"type": "add_tag", "config": {"tags": ["drip-done"]}}'::jsonb),
    's1', '{"stop_on_response": true}');
  PERFORM t.tag(c, 'drip'); PERFORM t.tick();
  PERFORM t.check((SELECT status FROM wf_runs WHERE workflow_id = w AND contact_id = c) = 'waiting', 'the drip is waiting after its email');
  PERFORM t.flow('Replied', '[{"id": "tr1", "type": "customer_replied", "filters": {"channels": ["email"]}}]', '{"s1": {"type": "add_tag", "config": {"tags": ["replied"]}}}');
  INSERT INTO messages(workspace_id, contact_id, channel, direction, subject, body, status) VALUES (t.ws(), c, 'email', 'inbound', 'Re: Hi', 'Thanks', 'delivered');
  PERFORM t.tick();
  PERFORM t.check(t.has_tag(c, 'replied'), 'a reply starts the "replied" workflow');
  PERFORM t.check((SELECT status FROM wf_runs WHERE workflow_id = w AND contact_id = c) = 'stopped', 'the drip stopped because they replied');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: customer replied (and Stop on response)', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; other uuid; tz text; today date; BEGIN
  PERFORM t.case('Trigger: birthday'); PERFORM t.reset();
  -- Birthdays fire from 8 AM in the account's time zone: use one where it is daytime now.
  SELECT name INTO tz FROM pg_timezone_names WHERE (now() AT TIME ZONE name)::time BETWEEN '09:00' AND '22:00' AND name LIKE '%/%' ORDER BY name LIMIT 1;
  UPDATE workspaces SET timezone = tz WHERE id = t.ws();
  today := (now() AT TIME ZONE tz)::date;
  c := t.contact('Hana', jsonb_build_object('date_of_birth', (today - interval '30 years')::date));
  other := t.contact('Ivo', jsonb_build_object('date_of_birth', (today - interval '30 years' + interval '3 days')::date));
  PERFORM t.tick();
  w := t.tagging_flow('Birthday', '{"type": "birthday_reminder"}');
  PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'it runs on the contact''s birthday');
  PERFORM t.check(t.runs(w, other) = 0, 'not for someone whose birthday is another day');
  PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'only once that day');
  UPDATE workspaces SET timezone = 'UTC' WHERE id = t.ws();
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: birthday', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Trigger: note added'); PERFORM t.reset();
  c := t.contact('Jon'); PERFORM t.tick();
  w := t.tagging_flow('Note', '{"type": "note_added"}');
  INSERT INTO notes(workspace_id, contact_id, content) VALUES (t.ws(), c, 'Called, left a message'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'a note starts it');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: note added', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; ev uuid; BEGIN
  PERFORM t.case('Trigger: event registration'); PERFORM t.reset();
  c := t.contact('Kai'); PERFORM t.tick();
  INSERT INTO events(workspace_id, slug, title, starts_at, ends_at) VALUES (t.ws(), 'launch-night', 'Launch night', now() + interval '7 days', now() + interval '7 days 2 hours') RETURNING id INTO ev;
  w := t.tagging_flow('Registered', jsonb_build_object('type', 'event_registered', 'filters', jsonb_build_object('events', jsonb_build_array(ev))));
  INSERT INTO event_registrations(event_id, contact_id, first_name, email, pin) VALUES (ev, c, 'Kai', 'kai@example.com', '123456'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'registering for the event starts it');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: event registration', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Trigger: Do Not Disturb changed'); PERFORM t.reset();
  c := t.contact('Dina'); PERFORM t.tick();
  w := t.tagging_flow('DND on for email', '{"type": "contact_dnd", "filters": {"flag": "enabled_specific", "channels": ["email"]}}');
  UPDATE contacts SET dnd_channels = ARRAY['sms'] WHERE id = c; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 0, 'turning on Do Not Disturb for another channel does not start it');
  UPDATE contacts SET dnd_channels = ARRAY['sms', 'email'] WHERE id = c; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'turning it on for email starts it');
  UPDATE workflows SET status = 'draft' WHERE id = w;
  w := t.tagging_flow('DND all on', '{"type": "contact_dnd", "filters": {"flag": "enabled_all"}}');
  UPDATE contacts SET dnd_all = true WHERE id = c; PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'turning on Do Not Disturb for everything starts an "all channels" workflow');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Trigger: Do Not Disturb changed', SQLERRM); END $$;

DO $$ DECLARE w uuid; ws uuid; c uuid; other uuid; k uuid; tz text; today date; BEGIN
  PERFORM t.case('Triggers: custom date reminder and task reminder'); PERFORM t.reset();
  -- Like birthdays, these fire from 8 AM in the account's time zone: use one where it is daytime now.
  SELECT name INTO tz FROM pg_timezone_names WHERE (now() AT TIME ZONE name)::time BETWEEN '09:00' AND '22:00' AND name LIKE '%/%' ORDER BY name LIMIT 1;
  UPDATE workspaces SET timezone = tz WHERE id = t.ws();
  today := (now() AT TIME ZONE tz)::date;
  -- Custom date: 3 days before the date (this year's date, matching the year), only for tagged contacts.
  c := t.contact('Cleo', jsonb_build_object('date_of_birth', today + 3));
  other := t.contact('Cole', jsonb_build_object('date_of_birth', today + 3));
  PERFORM t.tag(c, 'renewal'); PERFORM t.tick();
  w := t.tagging_flow('Renewal reminder', '{"type": "custom_date_reminder", "filters": {"field": "date_of_birth", "offset": "before", "days": 3, "match_year": true, "has_tag": "renewal"}}');
  PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'custom date: runs 3 days before the date');
  PERFORM t.check(t.runs(w, other) = 0, 'custom date: only for contacts with the chosen tag');
  PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'custom date: only once that day');
  UPDATE workflows SET status = 'draft' WHERE id = w;
  -- Task reminder: the day before a task is due.
  INSERT INTO tasks(workspace_id, contact_id, title, due_at) VALUES (t.ws(), other, 'Send contract', ((today + 1) + time '15:00') AT TIME ZONE tz) RETURNING id INTO k;
  INSERT INTO tasks(workspace_id, contact_id, title, due_at) VALUES (t.ws(), c, 'Later task', ((today + 5) + time '15:00') AT TIME ZONE tz);
  PERFORM t.tick();
  ws := t.flow('Due tomorrow', '[{"id": "tr1", "type": "task_reminder", "filters": {"offset": "before", "days": 1}}]', '{"s1": {"type": "add_tag", "config": {"tags": ["task-due"]}}}');
  PERFORM t.tick();
  PERFORM t.check(t.has_tag(other, 'task-due') AND (SELECT context->>'title' FROM wf_runs WHERE workflow_id = ws AND contact_id = other) = 'Send contract',
    'task reminder: runs the day before the task is due, with the task');
  PERFORM t.check(t.runs(ws, c) = 0, 'task reminder: not for a task due another day');
  UPDATE workspaces SET timezone = 'UTC' WHERE id = t.ws();
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Triggers: custom date reminder and task reminder', SQLERRM); END $$;

-- ============================================================================ actions

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Actions: tags, fields, owner, Do Not Disturb, note, task'); PERFORM t.reset();
  w := t.flow('Many steps', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["go"]}}]', jsonb_build_object(
    's1', '{"type": "add_tag", "next": "s2", "config": {"tags": ["a", "b"]}}'::jsonb,
    's2', '{"type": "remove_tag", "next": "s3", "config": {"tags": ["b"]}}'::jsonb,
    's3', '{"type": "update_field", "next": "s4", "config": {"field": "company", "value": "{{contact.first_name}} Ltd"}}'::jsonb,
    's4', '{"type": "remove_assigned_user", "next": "s5"}'::jsonb,
    's5', jsonb_build_object('type', 'assign_user', 'next', 's6', 'config', jsonb_build_object('user_id', t.member())),
    's6', '{"type": "set_dnd", "next": "s7", "config": {"mode": "enable", "scope": "channels", "channels": ["sms"]}}'::jsonb,
    's7', '{"type": "add_note", "next": "s8", "config": {"text": "Hello {{contact.first_name}}"}}'::jsonb,
    's8', '{"type": "add_task", "next": "s9", "config": {"title": "Call {{contact.first_name}}", "due_in_days": "2", "assign": "owner"}}'::jsonb,
    's9', '{"type": "update_field", "config": {"field": "owner_id", "value": "x"}}'::jsonb));
  c := t.contact('Lia'); PERFORM t.tick();
  PERFORM t.tag(c, 'go'); PERFORM t.tick();
  PERFORM t.check(t.has_tag(c, 'a') AND NOT t.has_tag(c, 'b'), 'add tag and remove tag');
  PERFORM t.check((SELECT company FROM contacts WHERE id = c) = 'Lia Ltd', 'update field (with the contact''s name filled in)');
  PERFORM t.check((SELECT owner_id FROM contacts WHERE id = c) = t.member(), 'unassign, then assign a person');
  PERFORM t.check((SELECT 'sms' = ANY(dnd_channels) AND NOT dnd_all FROM contacts WHERE id = c), 'Do Not Disturb for SMS only');
  PERFORM t.check(EXISTS (SELECT 1 FROM notes WHERE contact_id = c AND content = 'Hello Lia'), 'add note');
  PERFORM t.check(EXISTS (SELECT 1 FROM tasks WHERE contact_id = c AND title = 'Call Lia' AND assigned_to = t.member() AND due_at > now() + interval '1 day'),
    'add task, due in 2 days, for the contact''s owner');
  PERFORM t.check((t.log(w, 's9')).status = 'failed', 'a field workflows may not change is refused');
  PERFORM t.check((SELECT status FROM wf_runs WHERE workflow_id = w AND contact_id = c) = 'completed', 'the run finishes');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Actions: tags, fields, owner, Do Not Disturb, note, task', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; n int; BEGIN
  PERFORM t.case('Action: internal notification'); PERFORM t.reset();
  w := t.flow('Notify', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["ping"]}}]', jsonb_build_object(
    's1', '{"type": "notify", "next": "s2", "config": {"to": "owner", "title": "New lead: {{contact.first_name}}"}}'::jsonb,
    's2', '{"type": "notify", "config": {"to": "everyone", "title": "Everyone"}}'::jsonb));
  c := t.contact('Mo'); PERFORM t.tick();
  PERFORM t.tag(c, 'ping'); PERFORM t.tick();
  PERFORM t.check(EXISTS (SELECT 1 FROM team_notifications WHERE user_id = t.owner() AND title = 'New lead: Mo'), 'the contact''s owner is notified');
  SELECT count(*) INTO n FROM team_notifications WHERE title = 'Everyone';
  PERFORM t.check(n = 2, 'everyone in the account is notified');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: internal notification', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; q uuid; d uuid; BEGIN
  PERFORM t.case('Action: send email'); PERFORM t.reset();
  w := t.flow('Email', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["mail"]}}]', jsonb_build_object(
    's1', jsonb_build_object('type', 'send_email', 'config', jsonb_build_object('account_id', t.mailbox(), 'subject', 'Welcome {{contact.first_name}}', 'body', 'Hi {{first_name}}'))));
  c := t.contact('Nia'); q := t.contact('Oli', '{"dnd_all": true}'); d := t.contact('Pat', '{"email": ""}'); PERFORM t.tick();
  PERFORM t.tag(c, 'mail'); PERFORM t.tag(q, 'mail'); PERFORM t.tag(d, 'mail'); PERFORM t.tick();
  PERFORM t.check(EXISTS (SELECT 1 FROM messages WHERE contact_id = c AND status = 'queued' AND subject = 'Welcome Nia' AND body = 'Hi Nia' AND from_email = 'team@example.com'),
    'the email is queued from the chosen mailbox, with the name filled in');
  PERFORM t.check(EXISTS (SELECT 1 FROM net.requests WHERE body->>'mode' = 'queue'), 'the mailer is asked to send it');
  PERFORM t.check(NOT EXISTS (SELECT 1 FROM messages WHERE contact_id = q AND direction = 'outbound'), 'not sent to someone with Do Not Disturb on');
  PERFORM t.check(NOT EXISTS (SELECT 1 FROM messages WHERE contact_id = d AND direction = 'outbound') AND
    (SELECT detail FROM wf_logs WHERE workflow_id = w AND contact_id = d ORDER BY id DESC LIMIT 1) LIKE '%no email address%', 'skipped (and says why) when there is no email address');
  UPDATE workflows SET status = 'draft' WHERE id = w;
  w := t.flow('No mailbox', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["mail2"]}}]',
    '{"s1": {"type": "send_email", "config": {"subject": "x", "body": "y"}}}');
  PERFORM t.tag(c, 'mail2'); PERFORM t.tick();
  PERFORM t.check((t.log(w, 's1')).status = 'failed' AND (t.log(w, 's1')).detail LIKE '%No sending email account%', 'fails with a clear reason when no mailbox is chosen');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: send email', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; r uuid; BEGIN
  PERFORM t.case('Action: wait, then carry on'); PERFORM t.reset();
  w := t.flow('Wait', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["wait"]}}]', jsonb_build_object(
    's1', '{"type": "wait", "next": "s2", "config": {"amount": 3, "unit": "hours"}}'::jsonb,
    's2', '{"type": "add_tag", "config": {"tags": ["after-wait"]}}'::jsonb));
  c := t.contact('Quin'); PERFORM t.tick();
  PERFORM t.tag(c, 'wait'); PERFORM t.tick();
  SELECT id INTO r FROM wf_runs WHERE workflow_id = w AND contact_id = c;
  PERFORM t.check((SELECT status = 'waiting' AND resume_at BETWEEN now() + interval '2 hours 59 minutes' AND now() + interval '3 hours 1 minute' FROM wf_runs WHERE id = r),
    'it waits 3 hours');
  PERFORM t.check(NOT t.has_tag(c, 'after-wait'), 'the next step has not run yet');
  UPDATE wf_runs SET resume_at = now() - interval '1 second' WHERE id = r; PERFORM t.tick();
  PERFORM t.check(t.has_tag(c, 'after-wait') AND (SELECT status FROM wf_runs WHERE id = r) = 'completed', 'when the wait is over it carries on and finishes');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: wait, then carry on', SQLERRM); END $$;

DO $$ DECLARE w uuid; vip uuid; plain uuid; BEGIN
  PERFORM t.case('Action: if / else'); PERFORM t.reset();
  w := t.flow('Branch', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["branch"]}}]', jsonb_build_object(
    's1', '{"type": "if_else", "yes": "y", "no": "n", "config": {"match": "all", "conditions": [{"field": "tag", "op": "has", "value": "vip"}, {"field": "email", "op": "contains", "value": "@example.com"}]}}'::jsonb,
    'y', '{"type": "add_tag", "config": {"tags": ["went-yes"]}}'::jsonb,
    'n', '{"type": "add_tag", "config": {"tags": ["went-no"]}}'::jsonb));
  vip := t.contact('Rae'); plain := t.contact('Sol'); PERFORM t.tick();
  PERFORM t.tag(vip, 'vip'); PERFORM t.tick();
  PERFORM t.tag(vip, 'branch'); PERFORM t.tag(plain, 'branch'); PERFORM t.tick();
  PERFORM t.check(t.has_tag(vip, 'went-yes') AND NOT t.has_tag(vip, 'went-no'), 'meets every condition: Yes branch');
  PERFORM t.check(t.has_tag(plain, 'went-no') AND NOT t.has_tag(plain, 'went-yes'), 'doesn''t: No branch');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: if / else', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Action: webhook'); PERFORM t.reset();
  w := t.flow('Webhook', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["hook"]}}]', jsonb_build_object(
    's1', '{"type": "webhook", "next": "s2", "config": {"url": "https://hooks.example.com/in"}}'::jsonb,
    's2', '{"type": "webhook", "next": "s3", "config": {"url": "http://insecure.example.com"}}'::jsonb,
    's3', '{"type": "add_tag", "config": {"tags": ["after-hook"]}}'::jsonb));
  c := t.contact('Tom'); PERFORM t.tick();
  PERFORM t.tag(c, 'hook'); PERFORM t.tick();
  PERFORM t.check(EXISTS (SELECT 1 FROM net.requests WHERE url = 'https://hooks.example.com/in' AND body->>'event' = 'synapse.workflow'
    AND body->'contact'->>'first_name' = 'Tom' AND body->'tags' ? 'hook'), 'posts the contact, tags and workflow to the address');
  PERFORM t.check((t.log(w, 's2')).status = 'failed' AND (t.log(w, 's2')).detail LIKE '%https://%', 'refuses an address that isn''t https');
  PERFORM t.check(t.has_tag(c, 'after-hook'), 'a failed step doesn''t stop the rest of the workflow');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: webhook', SQLERRM); END $$;

DO $$ DECLARE a uuid; b uuid; c uuid; BEGIN
  PERFORM t.case('Actions: add to / remove from a workflow, end'); PERFORM t.reset();
  b := t.flow('Nurture', '[]', jsonb_build_object(
    's1', '{"type": "wait", "next": "s2", "config": {"amount": 1, "unit": "days"}}'::jsonb,
    's2', '{"type": "add_tag", "config": {"tags": ["nurtured"]}}'::jsonb));
  a := t.flow('Router', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["route"]}}]', jsonb_build_object(
    's1', jsonb_build_object('type', 'add_to_workflow', 'next', 's2', 'config', jsonb_build_object('workflow_id', b)),
    's2', '{"type": "end", "next": "s3"}'::jsonb,
    's3', '{"type": "add_tag", "config": {"tags": ["after-end"]}}'::jsonb));
  c := t.contact('Uma'); PERFORM t.tick();
  PERFORM t.tag(c, 'route'); PERFORM t.tick();
  PERFORM t.check((SELECT status FROM wf_runs WHERE workflow_id = b AND contact_id = c) = 'waiting', 'add to workflow: they are in the other workflow');
  PERFORM t.check(NOT t.has_tag(c, 'after-end') AND (SELECT status FROM wf_runs WHERE workflow_id = a AND contact_id = c) = 'completed', 'end stops the workflow there');
  UPDATE workflows SET status = 'draft' WHERE id = a;
  a := t.flow('Unsubscribe', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["stop"]}}]', jsonb_build_object(
    's1', jsonb_build_object('type', 'remove_from_workflow', 'config', jsonb_build_object('workflow_id', b))));
  PERFORM t.tag(c, 'stop'); PERFORM t.tick();
  PERFORM t.check((SELECT status FROM wf_runs WHERE workflow_id = b AND contact_id = c) = 'removed', 'remove from workflow takes them out of the other one');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Actions: add to / remove from a workflow, end', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; ch uuid; m record; BEGIN
  PERFORM t.case('Action: post to a channel'); PERFORM t.reset();
  INSERT INTO chat_channels(workspace_id, kind, name, created_by) VALUES (t.ws(), 'channel', 'leads', t.owner()) RETURNING id INTO ch;
  w := t.flow('Post', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["post"]}}]', jsonb_build_object(
    's1', jsonb_build_object('type', 'post_to_channel', 'next', 's2', 'config', jsonb_build_object('channel_id', ch, 'text', 'New lead: {{contact.name}} {{contact.link}}')),
    's2', '{"type": "post_to_channel", "config": {"channel_id": ""}}'::jsonb));
  c := t.contact('Xia'); PERFORM t.tick();
  PERFORM t.tag(c, 'post'); PERFORM t.tick();
  SELECT * INTO m FROM chat_messages WHERE channel_id = ch ORDER BY created_at DESC LIMIT 1;
  PERFORM t.check(m.body = 'New lead: Xia https://synapse-dj3a.vercel.app/contacts/' || c, 'posts the message, with the name and a link to the contact');
  PERFORM t.check(m.source = 'system' AND m.sender_name = 'Workflow: Post' AND m.user_id IS NULL, 'it comes from the workflow, not a person');
  PERFORM t.check((t.log(w, 's2')).status = 'failed' AND (t.log(w, 's2')).detail LIKE '%Choose a channel%', 'no channel chosen: fails with a reason');
  UPDATE chat_channels SET archived_at = now() WHERE id = ch;
  DELETE FROM contact_tags ct USING tags tg WHERE ct.contact_id = c AND tg.id = ct.tag_id AND tg.name = 'post';
  UPDATE workflows SET settings = '{"allow_reentry": true}' WHERE id = w;
  PERFORM t.tag(c, 'post'); PERFORM t.tick();
  PERFORM t.check((t.log(w, 's1')).detail LIKE '%archived%', 'an archived channel: fails with a reason');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: post to a channel', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; ch uuid; mt record; ctx jsonb; BEGIN
  PERFORM t.case('Action: create a meeting link'); PERFORM t.reset();
  INSERT INTO chat_channels(workspace_id, kind, name, created_by) VALUES (t.ws(), 'channel', 'video-calls', t.owner()) RETURNING id INTO ch;
  w := t.flow('Video call', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["video"]}}]', jsonb_build_object(
    's1', '{"type": "create_meeting", "next": "s2", "config": {"title": "Video call with {{contact.first_name}}", "duration_min": 45}}'::jsonb,
    's2', jsonb_build_object('type', 'post_to_channel', 'next', 's3', 'config', jsonb_build_object('channel_id', ch, 'text', '{{contact.name}} wants a video call: {{meeting.link}}')),
    's3', jsonb_build_object('type', 'send_email', 'config', jsonb_build_object('account_id', t.mailbox(), 'subject', 'Your call', 'body', 'Join here: {{meeting.link}}'))));
  c := t.contact('Yara'); PERFORM t.tick();
  PERFORM t.tag(c, 'video'); PERFORM t.tick();
  SELECT context INTO ctx FROM wf_runs WHERE workflow_id = w AND contact_id = c;
  SELECT * INTO mt FROM meetings WHERE id = (ctx->>'meeting_id')::uuid;
  PERFORM t.check(mt.title = 'Video call with Yara' AND mt.duration_min = 45 AND mt.host_id = t.owner() AND mt.code ~ '^[A-Z]{4}-[0-9]{3}$',
    'a real meeting is made, hosted by the contact''s owner');
  PERFORM t.check(ctx->>'meeting_link' = 'https://synapse-dj3a.vercel.app/meetings/' || mt.code || '?invite=' || mt.invite_token, 'its link lets anyone join (invite link)');
  PERFORM t.check(EXISTS (SELECT 1 FROM chat_messages WHERE channel_id = ch AND body = 'Yara wants a video call: ' || (ctx->>'meeting_link')), 'a later channel post uses {{meeting.link}}');
  PERFORM t.check(EXISTS (SELECT 1 FROM messages WHERE contact_id = c AND body = 'Join here: ' || (ctx->>'meeting_link')), 'a later email uses {{meeting.link}}');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: create a meeting link', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; d uuid; e uuid; n int; BEGIN
  PERFORM t.case('Action: notify a department'); PERFORM t.reset();
  INSERT INTO departments(workspace_id, name) VALUES (t.ws(), 'Sales Team') RETURNING id INTO d;
  INSERT INTO department_members(department_id, workspace_id, user_id) VALUES (d, t.ws(), t.member());
  INSERT INTO departments(workspace_id, name) VALUES (t.ws(), 'Empty Team') RETURNING id INTO e;
  w := t.flow('Tell sales', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["call-request"]}}]', jsonb_build_object(
    's1', jsonb_build_object('type', 'notify_department', 'next', 's2', 'config', jsonb_build_object('department_id', d, 'title', '{{contact.name}} asked for a call', 'body', '{{contact.phone}}')),
    's2', jsonb_build_object('type', 'notify_department', 'config', jsonb_build_object('department_id', e, 'post', false, 'title', 'x'))));
  c := t.contact('Zed'); PERFORM t.tick();
  PERFORM t.tag(c, 'call-request'); PERFORM t.tick();
  SELECT count(*) INTO n FROM team_notifications WHERE title = 'Zed asked for a call';
  PERFORM t.check(n = 1 AND EXISTS (SELECT 1 FROM team_notifications WHERE title = 'Zed asked for a call' AND user_id = t.member()), 'everyone in the department gets a notification (and nobody else)');
  PERFORM t.check(EXISTS (SELECT 1 FROM chat_messages cm JOIN chat_channels cc ON cc.id = cm.channel_id WHERE cc.department_id = d AND cc.is_department AND cm.body LIKE 'Zed asked for a call%'),
    'it is posted in the department''s channel');
  PERFORM t.check((t.log(w, 's1')).detail = 'Notified 1 person in Sales Team and posted in #sales-team', 'the log says who was told and where');
  PERFORM t.check((t.log(w, 's2')).status = 'skipped', 'a department with nobody in it is skipped, with a reason');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Action: notify a department', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; f uuid; sub uuid; m text; BEGIN
  PERFORM t.case('Merge fields: the form''s answers'); PERFORM t.reset();
  INSERT INTO forms(workspace_id, name, type, status, definition) VALUES (t.ws(), 'Call me back', 'form', 'published',
    to_jsonb('{"elements": {"e1": {"sortOrder": 0, "field": {"fieldId": "f1", "label": "Best time"}}, "e2": {"sortOrder": 1, "field": {"fieldId": "f2", "label": "Topic"}}}}'::text))
    RETURNING id INTO f;
  w := t.flow('Form filled', jsonb_build_array(jsonb_build_object('id', 'tr1', 'type', 'form_submitted', 'filters', jsonb_build_object('forms', jsonb_build_array(f)))),
    '{"s1": {"type": "add_note", "config": {"text": "{{form.name}}\n{{form.answers}}"}}}');
  c := t.contact('Ada'); PERFORM t.tick();
  INSERT INTO form_submissions(workspace_id, form_id, contact_id, answers) VALUES (t.ws(), f, c, '{"f2": "Pricing", "f1": "Mornings"}'); PERFORM t.tick();
  SELECT content INTO m FROM notes WHERE contact_id = c ORDER BY created_at DESC LIMIT 1;
  PERFORM t.check(m = E'Call me back\nBest time: Mornings\nTopic: Pricing', '{{form.answers}} lists each answer with its question, in the form''s order');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Merge fields: the form''s answers', SQLERRM); END $$;

-- ============================================================================ the engine's rules

DO $$ DECLARE w uuid; c uuid; r uuid; BEGIN
  PERFORM t.case('Rules: drafts, re-entry, test runs, unknown steps'); PERFORM t.reset();
  w := t.tagging_flow('Draft', '{"type": "contact_tag", "filters": {"event": "added", "tags": ["d"]}}');
  UPDATE workflows SET status = 'draft' WHERE id = w;
  c := t.contact('Vic'); PERFORM t.tick();
  PERFORM t.tag(c, 'd'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 0, 'a draft workflow does not run');
  UPDATE workflows SET status = 'active' WHERE id = w;
  DELETE FROM contact_tags ct USING tags tg WHERE ct.contact_id = c AND tg.id = ct.tag_id AND tg.name = 'd';
  PERFORM t.tag(c, 'd'); PERFORM t.tick();
  DELETE FROM contact_tags ct USING tags tg WHERE ct.contact_id = c AND tg.id = ct.tag_id AND tg.name = 'd';
  PERFORM t.tag(c, 'd'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 1, 'without "allow re-entry" a contact goes through once');
  UPDATE workflows SET settings = '{"allow_reentry": true}' WHERE id = w;
  DELETE FROM contact_tags ct USING tags tg WHERE ct.contact_id = c AND tg.id = ct.tag_id AND tg.name = 'd';
  PERFORM t.tag(c, 'd'); PERFORM t.tick();
  PERFORM t.check(t.runs(w, c) = 2, 'with "allow re-entry" they can go through again');
  UPDATE workflows SET status = 'draft', definition = jsonb_set(definition, '{graph,s1,config,tags}', '["tested"]') WHERE id = w;
  -- "Test workflow" in the builder, as a member of the account.
  PERFORM set_config('request.jwt.claim.sub', t.owner()::text, true);
  r := wf_test_run(w, c);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM t.check((SELECT is_test AND status = 'completed' FROM wf_runs WHERE id = r) AND t.has_tag(c, 'tested'), 'Test workflow runs a draft for one contact');
  w := t.flow('Unknown', '[{"id": "tr1", "type": "contact_tag", "filters": {"tags": ["u"]}}]',
    '{"s1": {"type": "teleport", "next": "s2"}, "s2": {"type": "add_tag", "config": {"tags": ["after-unknown"]}}}');
  PERFORM t.tag(c, 'u'); PERFORM t.tick();
  PERFORM t.check((t.log(w, 's1')).status = 'failed' AND (t.log(w, 's1')).detail LIKE '%isn''t supported%', 'an unknown step fails with a reason');
  PERFORM t.check(t.has_tag(c, 'after-unknown'), 'and the workflow carries on');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Rules: drafts, re-entry, test runs, unknown steps', SQLERRM); END $$;

DO $$ DECLARE w uuid; c uuid; BEGIN
  PERFORM t.case('Rules: a workflow that keeps triggering itself is stopped'); PERFORM t.reset();
  -- Every run removes and re-adds the tag that starts it.
  w := t.flow('Loop', '[{"id": "tr1", "type": "contact_tag", "filters": {"event": "added", "tags": ["loop"]}}]', jsonb_build_object(
    's1', '{"type": "remove_tag", "next": "s2", "config": {"tags": ["loop"]}}'::jsonb,
    's2', '{"type": "add_tag", "config": {"tags": ["loop"]}}'::jsonb), 's1', '{"allow_reentry": true}');
  c := t.contact('Wes'); PERFORM t.tick();
  PERFORM t.tag(c, 'loop');
  FOR i IN 1..8 LOOP PERFORM t.tick(); END LOOP;
  PERFORM t.check(t.runs(w, c) BETWEEN 1 AND 3, 'it runs at most 3 times in 10 minutes, not forever');
EXCEPTION WHEN OTHERS THEN PERFORM t.crashed('Rules: a workflow that keeps triggering itself is stopped', SQLERRM); END $$;

-- ============================================================================ result

DO $$ DECLARE f int; p int; r record; BEGIN
  SELECT count(*) INTO f FROM t.failures; SELECT count(*) INTO p FROM t.passes;
  IF f > 0 THEN
    FOR r IN SELECT name FROM t.failures ORDER BY at LOOP RAISE NOTICE 'FAILED: %', r.name; END LOOP;
    RAISE EXCEPTION 'workflows: % passed, % failed', p, f;
  END IF;
  RAISE NOTICE 'workflows: all % checks passed', p;
END $$;
