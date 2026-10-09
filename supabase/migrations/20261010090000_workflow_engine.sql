/*
  # Workflows that really run

  Everything the new Workflows builder needs on the server. Workflows run inside the database,
  every minute, so waits really wait and nothing depends on anyone keeping a browser open.
  Safe to run more than once.

  1. New data the triggers and actions use
     - contacts.date_of_birth             Birthday Reminder / Custom Date Reminder
     - tasks                               Task Added / Task Reminder / Task Completed, Add Task
     - team_notifications                  Send Internal Notification (shown under the bell)
     - workflows.definition, workflows.notes
         definition = { triggers: [...], start: <step id>, graph: { <step id>: step } }

  2. The engine's own tables (members of the account can read them; only the engine writes)
     - wf_events        what happened (filled automatically by the triggers below)
     - wf_runs          one row per contact going through a workflow (Enrollment History)
     - wf_logs          one row per step run (Execution Logs)
     - wf_daily_marks   so a birthday / date / task reminder fires once per day
     - wf_private.settings  internal key the scheduler uses to ask the mailer to send emails

  3. Event capture: contacts, tags, notes, tasks, appointments, form submissions, replies and
     event registrations each record an event. Events made by a workflow's own actions carry a
     depth, so a workflow can trigger another one but loops stop after a few hops.

  4. The engine
     - wf_tick()   every minute: handle new events, continue contacts whose wait is over,
                   run the 8 AM date reminders, and ask the mailer to send queued emails.
     - wf_test_run(workflow, contact)  "Test workflow" in the builder.

  5. Scheduling: pg_cron runs wf_tick() every minute (pg_net is used for webhooks and the mailer).
*/

-- 0. Extensions (Supabase allows these; skipped quietly where they don't exist) ----------------
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron not available: %', SQLERRM; END $$;
DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net not available: %', SQLERRM; END $$;

-- 1. Data ------------------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS definition jsonb;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  due_at timestamptz,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_due ON tasks(workspace_id, due_at) WHERE completed_at IS NULL;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_all" ON tasks;
CREATE POLICY "tasks_all" ON tasks FOR ALL TO authenticated
  USING (can_access_workspace(workspace_id)) WITH CHECK (can_access_workspace(workspace_id));

CREATE TABLE IF NOT EXISTS team_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_team_notifications_user ON team_notifications(user_id, created_at DESC);
ALTER TABLE team_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "team_notifications_own" ON team_notifications;
CREATE POLICY "team_notifications_own" ON team_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "team_notifications_read" ON team_notifications;
CREATE POLICY "team_notifications_read" ON team_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2. Engine tables ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wf_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  type text NOT NULL,
  contact_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  depth int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wf_events_todo ON wf_events(id) WHERE processed_at IS NULL;
ALTER TABLE wf_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wf_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_id text,
  trigger_name text,
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waiting', 'completed', 'failed', 'removed', 'stopped')),
  current_step text,
  resume_at timestamptz,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  depth int NOT NULL DEFAULT 0,
  is_test boolean NOT NULL DEFAULT false,
  exit_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wf_runs_workflow ON wf_runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_runs_contact ON wf_runs(contact_id, workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_runs_due ON wf_runs(resume_at) WHERE status = 'waiting';
ALTER TABLE wf_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wf_logs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  contact_id uuid,
  step_id text,
  step_type text,
  step_name text,
  status text NOT NULL CHECK (status IN ('success', 'skipped', 'failed', 'waiting')),
  detail text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_logs_workflow ON wf_logs(workflow_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_logs_run ON wf_logs(run_id, id);
ALTER TABLE wf_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wf_daily_marks (
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_id text NOT NULL,
  subject_id uuid NOT NULL,
  day date NOT NULL,
  PRIMARY KEY (workflow_id, trigger_id, subject_id, day)
);
ALTER TABLE wf_daily_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wf_runs_select" ON wf_runs;
CREATE POLICY "wf_runs_select" ON wf_runs FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));
DROP POLICY IF EXISTS "wf_logs_select" ON wf_logs;
CREATE POLICY "wf_logs_select" ON wf_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM workflows w WHERE w.id = workflow_id AND can_access_workspace(w.workspace_id)));
DROP POLICY IF EXISTS "wf_events_select" ON wf_events;
CREATE POLICY "wf_events_select" ON wf_events FOR SELECT TO authenticated USING (can_access_workspace(workspace_id));

-- Workflow-queued emails remember which run sent them (for "Stop on response").
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wf_run_id uuid;
CREATE INDEX IF NOT EXISTS idx_messages_queued ON messages(created_at) WHERE status = 'queued';

CREATE SCHEMA IF NOT EXISTS wf_private;
REVOKE ALL ON SCHEMA wf_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS wf_private.settings (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO wf_private.settings(key, value) VALUES ('mailer_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;
INSERT INTO wf_private.settings(key, value) VALUES ('mailer_url', 'https://parmtumfpsdtdtgwvscq.supabase.co/functions/v1/send-email')
ON CONFLICT (key) DO NOTHING;

-- The mailer (send-email, service role) checks the key the scheduler sends.
CREATE OR REPLACE FUNCTION wf_mailer_secret() RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT value FROM wf_private.settings WHERE key = 'mailer_secret';
$$;
REVOKE ALL ON FUNCTION wf_mailer_secret() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN GRANT EXECUTE ON FUNCTION wf_mailer_secret() TO service_role; EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- The app's public (anon) key, so the scheduler's call passes Supabase's gateway. It's the same
-- key every visitor's browser already has; the app saves it here when a member opens Workflows.
CREATE OR REPLACE FUNCTION wf_set_client_key(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = auth.uid()) THEN RETURN; END IF;
  IF p_key IS NULL OR char_length(p_key) NOT BETWEEN 20 AND 2000 OR p_key !~ '^[A-Za-z0-9._-]+$' THEN RETURN; END IF;
  INSERT INTO wf_private.settings(key, value) VALUES ('client_key', p_key) ON CONFLICT (key) DO UPDATE SET value = excluded.value;
END $$;
REVOKE ALL ON FUNCTION wf_set_client_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_set_client_key(text) TO authenticated;

-- 3. Event capture ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wf_emit(p_workspace uuid, p_type text, p_contact uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d int := coalesce(nullif(current_setting('synapse.wf_depth', true), '')::int, 0);
BEGIN
  IF p_workspace IS NULL THEN RETURN; END IF;
  INSERT INTO wf_events(workspace_id, type, contact_id, data, depth) VALUES (p_workspace, p_type, p_contact, coalesce(p_data, '{}'::jsonb), d);
END $$;

CREATE OR REPLACE FUNCTION wf_on_contact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE changed jsonb := '{}'::jsonb; f text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM wf_emit(NEW.workspace_id, 'contact_created', NEW.id, '{}'::jsonb);
    RETURN NEW;
  END IF;
  FOREACH f IN ARRAY ARRAY['first_name','last_name','email','phone','company','job_title','contact_type','owner_id','timezone','date_of_birth','source'] LOOP
    IF (to_jsonb(OLD)->f) IS DISTINCT FROM (to_jsonb(NEW)->f) THEN
      changed := changed || jsonb_build_object(f, jsonb_build_object('old', to_jsonb(OLD)->f, 'new', to_jsonb(NEW)->f));
    END IF;
  END LOOP;
  IF changed <> '{}'::jsonb THEN PERFORM wf_emit(NEW.workspace_id, 'contact_changed', NEW.id, jsonb_build_object('changed', changed)); END IF;
  IF OLD.dnd_all IS DISTINCT FROM NEW.dnd_all OR OLD.dnd_channels IS DISTINCT FROM NEW.dnd_channels THEN
    PERFORM wf_emit(NEW.workspace_id, 'contact_dnd', NEW.id, jsonb_build_object(
      'old_all', OLD.dnd_all, 'new_all', NEW.dnd_all,
      'old_channels', to_jsonb(OLD.dnd_channels), 'new_channels', to_jsonb(NEW.dnd_channels)));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wf_contact_events ON contacts;
CREATE TRIGGER wf_contact_events AFTER INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION wf_on_contact();

CREATE OR REPLACE FUNCTION wf_on_contact_tag() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; ws uuid; tname text;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT t.workspace_id, t.name INTO ws, tname FROM tags t WHERE t.id = r.tag_id;
  -- A contact being deleted takes its tags with it: that isn't a "tag removed".
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = r.contact_id) THEN RETURN NULL; END IF;
  PERFORM wf_emit(ws, 'contact_tag', r.contact_id, jsonb_build_object('event', CASE WHEN TG_OP = 'DELETE' THEN 'removed' ELSE 'added' END, 'tag', tname));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_contact_tag_events ON contact_tags;
CREATE TRIGGER wf_contact_tag_events AFTER INSERT OR DELETE ON contact_tags FOR EACH ROW EXECUTE FUNCTION wf_on_contact_tag();

CREATE OR REPLACE FUNCTION wf_on_note() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN PERFORM wf_emit(NEW.workspace_id, 'note_added', NEW.contact_id, jsonb_build_object('note', left(NEW.content, 2000))); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_note_events ON notes;
CREATE TRIGGER wf_note_events AFTER INSERT ON notes FOR EACH ROW EXECUTE FUNCTION wf_on_note();

CREATE OR REPLACE FUNCTION wf_on_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM wf_emit(NEW.workspace_id, 'task_added', NEW.contact_id, jsonb_build_object('task_id', NEW.id, 'title', NEW.title, 'assigned_to', NEW.assigned_to));
  ELSIF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
    PERFORM wf_emit(NEW.workspace_id, 'task_completed', NEW.contact_id, jsonb_build_object('task_id', NEW.id, 'title', NEW.title, 'assigned_to', NEW.assigned_to));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_task_events ON tasks;
CREATE TRIGGER wf_task_events AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION wf_on_task();

CREATE OR REPLACE FUNCTION wf_on_appointment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM wf_emit(NEW.workspace_id, 'appointment_booked', NEW.contact_id, jsonb_build_object('appointment_id', NEW.id, 'calendar_id', NEW.calendar_id, 'status', 'booked', 'start_time', NEW.start_time, 'title', NEW.title));
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM wf_emit(NEW.workspace_id, 'appointment_status', NEW.contact_id, jsonb_build_object('appointment_id', NEW.id, 'calendar_id', NEW.calendar_id,
      'status', CASE NEW.status WHEN 'completed' THEN 'showed' ELSE NEW.status END, 'start_time', NEW.start_time, 'title', NEW.title));
  ELSIF OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    PERFORM wf_emit(NEW.workspace_id, 'appointment_status', NEW.contact_id, jsonb_build_object('appointment_id', NEW.id, 'calendar_id', NEW.calendar_id, 'status', 'rescheduled', 'start_time', NEW.start_time, 'title', NEW.title));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_appointment_events ON appointments;
CREATE TRIGGER wf_appointment_events AFTER INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION wf_on_appointment();

CREATE OR REPLACE FUNCTION wf_on_form_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN PERFORM wf_emit(NEW.workspace_id, 'form_submitted', NEW.contact_id, jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id)); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_form_events ON form_submissions;
CREATE TRIGGER wf_form_events AFTER INSERT ON form_submissions FOR EACH ROW EXECUTE FUNCTION wf_on_form_submission();

CREATE OR REPLACE FUNCTION wf_on_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'inbound' AND NEW.contact_id IS NOT NULL THEN
    PERFORM wf_emit(NEW.workspace_id, 'customer_replied', NEW.contact_id, jsonb_build_object('channel', NEW.channel));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_message_events ON messages;
CREATE TRIGGER wf_message_events AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION wf_on_message();

DO $$ BEGIN
  IF to_regclass('public.event_registrations') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION wf_on_event_registration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      DECLARE ws uuid;
      BEGIN
        IF NEW.contact_id IS NULL THEN RETURN NULL; END IF;
        SELECT workspace_id INTO ws FROM events WHERE id = NEW.event_id;
        PERFORM wf_emit(ws, 'event_registered', NEW.contact_id, jsonb_build_object('event_id', NEW.event_id));
        RETURN NULL;
      END $b$;
    $f$;
    EXECUTE 'DROP TRIGGER IF EXISTS wf_event_registration_events ON event_registrations';
    EXECUTE 'CREATE TRIGGER wf_event_registration_events AFTER INSERT ON event_registrations FOR EACH ROW EXECUTE FUNCTION wf_on_event_registration()';
  END IF;
END $$;

-- 4. Engine -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wf_contact_tags(p_contact uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(lower(t.name)), '{}') FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = p_contact;
$$;

-- jsonb array of strings -> lower-case text[]
CREATE OR REPLACE FUNCTION wf_lower_list(j jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(lower(x)), '{}') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(j) = 'array' THEN j ELSE '[]'::jsonb END) x;
$$;

-- Contact Created / Contact DND tag rules: every rule must pass.
CREATE OR REPLACE FUNCTION wf_tag_rules_ok(p_rules jsonb, p_tags text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb; want text[];
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_rules) = 'array' THEN p_rules ELSE '[]'::jsonb END) LOOP
    want := wf_lower_list(r->'tags');
    IF cardinality(want) = 0 THEN CONTINUE; END IF;
    CASE r->>'op'
      WHEN 'equals' THEN IF NOT (p_tags @> want) THEN RETURN false; END IF;
      WHEN 'not_equals' THEN IF p_tags @> want THEN RETURN false; END IF;
      WHEN 'any_of' THEN IF NOT (p_tags && want) THEN RETURN false; END IF;
      WHEN 'none_of' THEN IF p_tags && want THEN RETURN false; END IF;
      ELSE NULL;
    END CASE;
  END LOOP;
  RETURN true;
END $$;

-- Does this trigger (from a workflow's definition) match this event?
CREATE OR REPLACE FUNCTION wf_trigger_matches(t jsonb, ev wf_events) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f jsonb := coalesce(t->'filters', '{}'::jsonb); tags text[]; ch jsonb; op text; v text; nchan text[]; ochan text[];
BEGIN
  CASE t->>'type'
    WHEN 'contact_created' THEN
      RETURN ev.type = 'contact_created' AND wf_tag_rules_ok(f->'tag_rules', wf_contact_tags(ev.contact_id));
    WHEN 'contact_changed' THEN
      IF ev.type <> 'contact_changed' THEN RETURN false; END IF;
      IF coalesce(f->>'field', '') = '' THEN RETURN true; END IF;
      ch := ev.data->'changed'->(f->>'field');
      IF ch IS NULL THEN RETURN false; END IF;
      op := coalesce(f->>'op', 'has_changed'); v := coalesce(f->>'value', '');
      IF op = 'has_changed_to' THEN RETURN lower(coalesce(ch->>'new', '')) = lower(v); END IF;
      RETURN true;
    WHEN 'contact_dnd' THEN
      IF ev.type <> 'contact_dnd' THEN RETURN false; END IF;
      nchan := wf_lower_list(ev.data->'new_channels'); ochan := wf_lower_list(ev.data->'old_channels');
      CASE coalesce(f->>'flag', 'any')
        WHEN 'enabled_all' THEN IF NOT ((ev.data->>'new_all')::boolean AND NOT coalesce((ev.data->>'old_all')::boolean, false)) THEN RETURN false; END IF;
        WHEN 'disabled_all' THEN IF NOT (coalesce((ev.data->>'old_all')::boolean, false) AND NOT (ev.data->>'new_all')::boolean) THEN RETURN false; END IF;
        WHEN 'enabled_specific' THEN
          IF NOT EXISTS (SELECT 1 FROM unnest(nchan) c WHERE NOT c = ANY(ochan) AND (cardinality(wf_lower_list(f->'channels')) = 0 OR c = ANY(wf_lower_list(f->'channels')))) THEN RETURN false; END IF;
        WHEN 'disabled_specific' THEN
          IF NOT EXISTS (SELECT 1 FROM unnest(ochan) c WHERE NOT c = ANY(nchan) AND (cardinality(wf_lower_list(f->'channels')) = 0 OR c = ANY(wf_lower_list(f->'channels')))) THEN RETURN false; END IF;
        ELSE NULL;
      END CASE;
      RETURN wf_tag_rules_ok(f->'tag_rules', wf_contact_tags(ev.contact_id));
    WHEN 'contact_tag' THEN
      IF ev.type <> 'contact_tag' THEN RETURN false; END IF;
      IF coalesce(f->>'event', 'any') <> 'any' AND f->>'event' <> ev.data->>'event' THEN RETURN false; END IF;
      tags := wf_lower_list(f->'tags');
      RETURN cardinality(tags) = 0 OR lower(ev.data->>'tag') = ANY(tags);
    WHEN 'note_added' THEN
      IF ev.type <> 'note_added' THEN RETURN false; END IF;
      tags := wf_contact_tags(ev.contact_id);
      IF coalesce(f->>'has_tag', '') <> '' AND NOT lower(f->>'has_tag') = ANY(tags) THEN RETURN false; END IF;
      IF coalesce(f->>'not_tag', '') <> '' AND lower(f->>'not_tag') = ANY(tags) THEN RETURN false; END IF;
      RETURN true;
    WHEN 'task_added' THEN
      IF ev.type <> 'task_added' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'users')) = 0 OR lower(coalesce(ev.data->>'assigned_to', '')) = ANY(wf_lower_list(f->'users'));
    WHEN 'task_completed' THEN
      IF ev.type <> 'task_completed' THEN RETURN false; END IF;
      v := lower(coalesce(ev.data->>'assigned_to', ''));
      CASE coalesce(f->>'user_op', 'any')
        WHEN 'is' THEN RETURN v = ANY(wf_lower_list(f->'users'));
        WHEN 'is_not' THEN RETURN NOT (v = ANY(wf_lower_list(f->'users')));
        WHEN 'is_empty' THEN RETURN v = '';
        WHEN 'is_not_empty' THEN RETURN v <> '';
        ELSE RETURN true;
      END CASE;
    WHEN 'appointment_status' THEN
      IF ev.type NOT IN ('appointment_status', 'appointment_booked') THEN RETURN false; END IF;
      IF cardinality(wf_lower_list(f->'statuses')) > 0 AND NOT lower(ev.data->>'status') = ANY(wf_lower_list(f->'statuses')) THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'calendars')) = 0 OR lower(ev.data->>'calendar_id') = ANY(wf_lower_list(f->'calendars'));
    WHEN 'customer_booked_appointment' THEN
      IF ev.type <> 'appointment_booked' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'calendars')) = 0 OR lower(ev.data->>'calendar_id') = ANY(wf_lower_list(f->'calendars'));
    WHEN 'form_submitted' THEN
      IF ev.type <> 'form_submitted' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'forms')) = 0 OR lower(ev.data->>'form_id') = ANY(wf_lower_list(f->'forms'));
    WHEN 'customer_replied' THEN
      IF ev.type <> 'customer_replied' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'channels')) = 0 OR lower(ev.data->>'channel') = ANY(wf_lower_list(f->'channels'));
    WHEN 'event_registered' THEN
      IF ev.type <> 'event_registered' THEN RETURN false; END IF;
      RETURN cardinality(wf_lower_list(f->'events')) = 0 OR lower(ev.data->>'event_id') = ANY(wf_lower_list(f->'events'));
    ELSE RETURN false;
  END CASE;
END $$;

-- {{contact.first_name}} etc.
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
    s := replace(s, '{{first_name}}', coalesce(c.first_name, ''));
    s := replace(s, '{{last_name}}', coalesce(c.last_name, ''));
    s := replace(s, '{{email}}', coalesce(c.email, ''));
    s := replace(s, '{{phone}}', coalesce(c.phone, ''));
    s := replace(s, '{{company}}', coalesce(c.company, ''));
  END IF;
  s := replace(s, '{{appointment.title}}', coalesce(p_ctx->>'title', ''));
  s := replace(s, '{{appointment.start_time}}', coalesce(p_ctx->>'start_time', ''));
  RETURN s;
END $$;

-- If/Else: does the contact meet the step's conditions?
CREATE OR REPLACE FUNCTION wf_conditions_ok(p_cfg jsonb, p_contact uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cnd jsonb; ok boolean; all_mode boolean := coalesce(p_cfg->>'match', 'all') = 'all'; any_hit boolean := false; val text; tags text[]; crow jsonb;
BEGIN
  SELECT to_jsonb(c) INTO crow FROM contacts c WHERE c.id = p_contact;
  IF crow IS NULL THEN RETURN false; END IF;
  tags := wf_contact_tags(p_contact);
  FOR cnd IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cfg->'conditions') = 'array' THEN p_cfg->'conditions' ELSE '[]'::jsonb END) LOOP
    IF cnd->>'field' = 'tag' THEN
      ok := CASE cnd->>'op' WHEN 'not_has' THEN NOT (lower(cnd->>'value') = ANY(tags)) ELSE lower(cnd->>'value') = ANY(tags) END;
    ELSIF cnd->>'field' = 'dnd_all' THEN
      ok := coalesce((crow->>'dnd_all')::boolean, false) = (cnd->>'op' = 'is_true');
    ELSE
      val := lower(coalesce(crow->>(cnd->>'field'), ''));
      ok := CASE cnd->>'op'
        WHEN 'equals' THEN val = lower(coalesce(cnd->>'value', ''))
        WHEN 'not_equals' THEN val <> lower(coalesce(cnd->>'value', ''))
        WHEN 'contains' THEN position(lower(coalesce(cnd->>'value', '')) IN val) > 0
        WHEN 'is_empty' THEN val = ''
        WHEN 'is_not_empty' THEN val <> ''
        ELSE false END;
    END IF;
    IF all_mode AND NOT ok THEN RETURN false; END IF;
    IF ok THEN any_hit := true; END IF;
  END LOOP;
  RETURN all_mode OR any_hit;
END $$;

-- The next moment inside the workflow's time window (or now, if there's no window or we're in it).
CREATE OR REPLACE FUNCTION wf_window_next(p_settings jsonb, p_tz text, p_now timestamptz DEFAULT now()) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := p_settings->'time_window'; tz text := coalesce(nullif(p_tz, ''), 'UTC'); local_ts timestamp; d int; i int; st time; en time; days int[]; cand timestamp;
BEGIN
  IF w IS NULL OR NOT coalesce((w->>'enabled')::boolean, false) THEN RETURN p_now; END IF;
  st := coalesce(w->>'start', '09:00')::time; en := coalesce(w->>'end', '17:00')::time;
  days := coalesce(ARRAY(SELECT x::int FROM jsonb_array_elements_text(w->'days') x), ARRAY[0,1,2,3,4,5,6]);
  IF cardinality(days) = 0 THEN days := ARRAY[0,1,2,3,4,5,6]; END IF;
  BEGIN local_ts := p_now AT TIME ZONE tz; EXCEPTION WHEN OTHERS THEN tz := 'UTC'; local_ts := p_now AT TIME ZONE tz; END;
  FOR i IN 0..7 LOOP
    cand := date_trunc('day', local_ts) + make_interval(days => i);
    d := extract(dow FROM cand)::int;
    IF NOT d = ANY(days) THEN CONTINUE; END IF;
    IF i = 0 THEN
      IF local_ts::time >= st AND local_ts::time < en THEN RETURN p_now; END IF;
      IF local_ts::time < st THEN RETURN (cand + st) AT TIME ZONE tz; END IF;
    ELSE
      RETURN (cand + st) AT TIME ZONE tz;
    END IF;
  END LOOP;
  RETURN p_now;
END $$;

CREATE OR REPLACE FUNCTION wf_log(p_run wf_runs, p_step jsonb, p_id text, p_status text, p_detail text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO wf_logs(run_id, workflow_id, contact_id, step_id, step_type, step_name, status, detail)
  VALUES (p_run.id, p_run.workflow_id, p_run.contact_id, p_id, p_step->>'type', coalesce(nullif(p_step->>'name', ''), p_step->>'type'), p_status, left(coalesce(p_detail, ''), 1000));
$$;

CREATE OR REPLACE FUNCTION wf_finish(p_run uuid, p_status text, p_reason text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE wf_runs SET status = p_status, exit_reason = p_reason, finished_at = now(), resume_at = NULL WHERE id = p_run AND status IN ('active', 'waiting');
$$;

CREATE OR REPLACE FUNCTION wf_tag_id(p_ws uuid, p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid;
BEGIN
  SELECT id INTO tid FROM tags WHERE workspace_id = p_ws AND lower(name) = lower(btrim(p_name));
  IF tid IS NULL THEN INSERT INTO tags(workspace_id, name) VALUES (p_ws, btrim(p_name)) RETURNING id INTO tid; END IF;
  RETURN tid;
END $$;

-- Runs one step. Returns the branch to follow: 'next', 'yes', 'no', 'wait' (paused), 'end' or 'fail'.
CREATE OR REPLACE FUNCTION wf_exec_step(p_run wf_runs, p_wf workflows, p_id text, p_step jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := coalesce(p_step->'config', '{}'::jsonb);
  c record; t text; n int; secs bigint; until timestamptz; tz text; acct record; uids uuid[]; uid uuid;
  subj text; body text; ok boolean; other workflows; target uuid; dnd text[]; fld text;
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
  ELSE
    PERFORM wf_log(p_run, p_step, p_id, 'failed', 'This step type isn''t supported: ' || coalesce(p_step->>'type', '?'));
    RETURN 'fail';
  END CASE;
  RETURN 'next';
END $$;

-- Walk a run forward until it waits or finishes.
CREATE OR REPLACE FUNCTION wf_run(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r wf_runs; w workflows; step jsonb; sid text; res text; hops int := 0;
BEGIN
  SELECT * INTO r FROM wf_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('active', 'waiting') THEN RETURN; END IF;
  SELECT * INTO w FROM workflows WHERE id = r.workflow_id;
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

-- Put a contact into a workflow (respects Allow Re-entry; never twice at the same time).
CREATE OR REPLACE FUNCTION wf_enroll(p_wf workflows, p_trigger jsonb, p_contact uuid, p_reason text, p_ctx jsonb, p_depth int, p_test boolean, p_run_now boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF p_contact IS NULL THEN RETURN NULL; END IF;
  IF NOT p_test THEN
    IF p_wf.status <> 'active' THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM wf_runs WHERE workflow_id = p_wf.id AND contact_id = p_contact AND status IN ('active', 'waiting')) THEN RETURN NULL; END IF;
    IF NOT coalesce((p_wf.settings->>'allow_reentry')::boolean, false)
       AND EXISTS (SELECT 1 FROM wf_runs WHERE workflow_id = p_wf.id AND contact_id = p_contact AND NOT is_test) THEN RETURN NULL; END IF;
    -- Safety net against loops (a workflow that keeps re-triggering itself): at most 3 entries
    -- for the same contact in 10 minutes.
    IF (SELECT count(*) FROM wf_runs WHERE workflow_id = p_wf.id AND contact_id = p_contact AND NOT is_test AND started_at > now() - interval '10 minutes') >= 3 THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO wf_runs(workflow_id, workspace_id, contact_id, trigger_id, trigger_name, reason, current_step, context, depth, is_test)
  VALUES (p_wf.id, p_wf.workspace_id, p_contact, p_trigger->>'id', coalesce(nullif(p_trigger->>'name', ''), p_trigger->>'type'), p_reason,
          p_wf.definition->>'start', coalesce(p_ctx, '{}'::jsonb), p_depth, p_test)
  RETURNING id INTO rid;
  UPDATE workflows SET total_runs = coalesce(total_runs, 0) + 1, last_run_at = now() WHERE id = p_wf.id;
  IF p_run_now THEN PERFORM wf_run(rid); END IF;
  RETURN rid;
END $$;

-- Handle one event: stop-on-response, then enrol into every matching published workflow.
CREATE OR REPLACE FUNCTION wf_handle_event(ev wf_events) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w workflows; t jsonb;
BEGIN
  IF ev.depth > 4 THEN RETURN; END IF; -- workflows triggering workflows: stop runaway chains
  IF ev.type = 'customer_replied' THEN
    UPDATE wf_runs r SET status = 'stopped', exit_reason = 'The contact replied (Stop on response)', finished_at = now(), resume_at = NULL
    FROM workflows w2
    WHERE w2.id = r.workflow_id AND r.contact_id = ev.contact_id AND r.status IN ('active', 'waiting')
      AND coalesce((w2.settings->>'stop_on_response')::boolean, false) AND coalesce((r.context->>'messaged')::boolean, false);
  END IF;
  FOR w IN SELECT * FROM workflows WHERE workspace_id = ev.workspace_id AND status = 'active' AND definition IS NOT NULL LOOP
    FOR t IN SELECT * FROM jsonb_array_elements(coalesce(w.definition->'triggers', '[]'::jsonb)) LOOP
      IF wf_trigger_matches(t, ev) THEN
        PERFORM wf_enroll(w, t, ev.contact_id, coalesce(nullif(t->>'name', ''), t->>'type'), ev.data, ev.depth, false, true);
        EXIT; -- one enrolment per workflow per event
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Birthday / Custom Date / Task reminders: once a day, from 8 AM in the account's time zone.
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
        FOR c IN SELECT id, contact_id, title FROM tasks WHERE workspace_id = w.workspace_id AND contact_id IS NOT NULL AND due_at IS NOT NULL
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

-- Every minute (pg_cron): new events, finished waits, daily reminders, queued emails.
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
  FOR r IN SELECT id FROM wf_runs WHERE status = 'waiting' AND resume_at <= now() ORDER BY resume_at LIMIT 500 LOOP
    BEGIN PERFORM wf_run(r.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf run % failed: %', r.id, SQLERRM; END;
    n_runs := n_runs + 1;
  END LOOP;
  BEGIN n_daily := wf_daily_scan(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf daily scan failed: %', SQLERRM; END;
  -- Housekeeping: keep 30 days of history, like the manual's logs.
  DELETE FROM wf_events WHERE processed_at < now() - interval '30 days';
  DELETE FROM wf_logs WHERE at < now() - interval '30 days';
  -- Ask the mailer to send workflow emails.
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND wf_run_id IS NOT NULL;
  IF queued > 0 AND to_regnamespace('net') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT net.http_post(url := $1, body := ''{"mode":"queue"}''::jsonb, headers := jsonb_strip_nulls(jsonb_build_object(''Content-Type'', ''application/json'', ''x-synapse-mailer'', $2, ''apikey'', $3, ''Authorization'', ''Bearer '' || $3)))'
      USING (SELECT value FROM wf_private.settings WHERE key = 'mailer_url'), wf_mailer_secret(), (SELECT value FROM wf_private.settings WHERE key = 'client_key');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'wf mailer call failed: %', SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('events', n_ev, 'resumed', n_runs, 'daily', n_daily, 'queued_emails', queued);
END $$;
REVOKE ALL ON FUNCTION wf_tick() FROM PUBLIC, anon, authenticated;

-- "Test workflow": run it now for one contact (works on drafts too). Members only.
CREATE OR REPLACE FUNCTION wf_test_run(p_workflow uuid, p_contact uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w workflows; rid uuid;
BEGIN
  SELECT * INTO w FROM workflows WHERE id = p_workflow;
  IF NOT FOUND OR NOT can_access_workspace(w.workspace_id) THEN RAISE EXCEPTION 'Workflow not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact AND workspace_id = w.workspace_id) THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF w.definition IS NULL OR coalesce(w.definition->>'start', '') = '' THEN RAISE EXCEPTION 'Add at least one step first'; END IF;
  rid := wf_enroll(w, jsonb_build_object('id', 'test', 'name', 'Test run'), p_contact, 'Test run from the builder', '{}'::jsonb, 0, true, true);
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION wf_test_run(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_test_run(uuid, uuid) TO authenticated;

-- Remove a contact from a workflow (Enrollment History → Remove).
CREATE OR REPLACE FUNCTION wf_remove_run(p_run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wf_runs WHERE id = p_run AND can_access_workspace(workspace_id)) THEN RAISE EXCEPTION 'Not found'; END IF;
  PERFORM wf_finish(p_run, 'removed', 'Removed by a team member');
END $$;
REVOKE ALL ON FUNCTION wf_remove_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_remove_run(uuid) TO authenticated;

-- 5. Every minute -------------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'synapse-workflows';
    PERFORM cron.schedule('synapse-workflows', '* * * * *', 'SELECT public.wf_tick()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Could not schedule workflows: %', SQLERRM;
END $$;
