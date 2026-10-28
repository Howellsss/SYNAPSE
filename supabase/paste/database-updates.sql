-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- The six database updates from 17–22 October 2026 (dashboard summary, member status, forms upgrade,
-- form → workflow trigger, form files, roles and access), in order. Safe to run more than once.
-- Made from supabase/migrations/2026101712…2026102212; don't edit here.

-- Dashboard in one request: today's and the week's bookings (with their contact and calendar) and
-- the four counts, which the dashboard used to fetch with six separate requests.
--
-- SECURITY INVOKER: it runs as the person asking, so row-level security decides exactly what it
-- sees, the same as the six requests did. Safe to run more than once.

create or replace function public.dashboard_summary(
  p_workspace_id uuid,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_now timestamptz,
  p_week_end timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with booked as (
    select a.start_time,
           to_jsonb(a)
             || jsonb_build_object(
                  'contacts', case when c.id is null then null else to_jsonb(c) end,
                  'calendars', case when cal.id is null then null else to_jsonb(cal) end
                ) as row
    from appointments a
    left join contacts c on c.id = a.contact_id
    left join calendars cal on cal.id = a.calendar_id
    where a.workspace_id = p_workspace_id
      and a.status in ('confirmed', 'pending')
      and a.start_time >= least(p_today_start, p_now)
      and a.start_time <= greatest(p_today_end, p_week_end)
  )
  select jsonb_build_object(
    'today', coalesce((
      select jsonb_agg(b.row order by b.start_time)
      from booked b
      where b.start_time >= p_today_start and b.start_time <= p_today_end
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(u.row order by u.start_time)
      from (
        select b.row, b.start_time from booked b
        where b.start_time >= p_now and b.start_time <= p_week_end
        order by b.start_time
        limit 6
      ) u
    ), '[]'::jsonb),
    'contacts', (select count(*) from contacts where workspace_id = p_workspace_id),
    'members', (select count(*) from workspace_members where workspace_id = p_workspace_id),
    'completed', (select count(*) from appointments where workspace_id = p_workspace_id and status = 'completed'),
    'messages', (select count(*) from messages where workspace_id = p_workspace_id)
  );
$$;

revoke all on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;

/*
  # Member status: what people are up to, and whether they are away

  Everyone in the account sees each other's status (an emoji and a short line, like "In a
  meeting"), when it clears, and whether they set themselves away. Each person sets only their
  own. Who is online right now is not stored: the app works that out live. Safe to run more
  than once.

  1. member_status: one row per person per account
  2. RLS: members read the account's statuses; each person writes only their own row
  3. Realtime: changes reach everyone straight away
*/

CREATE TABLE IF NOT EXISTS member_status (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text CHECK (emoji IS NULL OR char_length(emoji) <= 16),
  text text CHECK (text IS NULL OR char_length(text) <= 100),
  clear_at timestamptz,
  away boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE member_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_status_select" ON member_status;
CREATE POLICY "member_status_select" ON member_status FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_insert" ON member_status;
CREATE POLICY "member_status_insert" ON member_status FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_update" ON member_status;
CREATE POLICY "member_status_update" ON member_status FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "member_status_delete" ON member_status;
CREATE POLICY "member_status_delete" ON member_status FOR DELETE TO authenticated USING (user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'member_status') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE member_status;
    END IF;
  END IF;
END $$;

/*
  # Forms and surveys: quiz scores, disqualified leads, payments, where people came from, emails

  Each submission keeps its quiz score and result, whether logic disqualified the person, the
  payment taken with it (Stripe Checkout), and where they came from (utm tags, ?source=, the page
  that sent them). Form notification emails are queued as messages linked to their submission and
  sent by the same mailer as workflow emails. Safe to run more than once.

  1. form_submissions: meta, score / score_max / score_percent / quiz_result, disqualified,
     payment_status / payment_amount / payment_currency / stripe_session_id
  2. messages.form_submission_id: the submission a queued email belongs to
*/

ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score numeric;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score_max numeric;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score_percent integer;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS quiz_result text;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS disqualified boolean NOT NULL DEFAULT false;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'none';
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_amount integer;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_currency text;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS stripe_session_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_payment_status_check') THEN
    ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_payment_status_check
      CHECK (payment_status IN ('none', 'pending', 'paid', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created ON form_submissions(form_id, created_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_form_queued ON messages(created_at) WHERE status = 'queued' AND form_submission_id IS NOT NULL;

/*
  # Forms: start "Form submitted" workflows when the contact is attached

  The form-submit function saves the submission first and attaches the contact a moment later
  (an UPDATE). The workflow trigger only listened for INSERTs with a contact already set, so
  form and survey submissions never started a workflow.

  This adds a second trigger for the moment a submission gets its contact. A submission saved
  with its contact already set still fires once (on INSERT); one saved without a contact fires
  once when the contact is attached.

  It also wakes the mailer for a form's own emails (the team alert and the auto-reply). The
  once-a-minute job only called the mailer when a workflow email was waiting, so form emails
  stayed queued until some workflow happened to send one. Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION wf_on_form_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM wf_emit(NEW.workspace_id, 'form_submitted', NEW.contact_id, jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS wf_form_events ON form_submissions;
CREATE TRIGGER wf_form_events AFTER INSERT ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION wf_on_form_submission();

DROP TRIGGER IF EXISTS wf_form_contact_events ON form_submissions;
CREATE TRIGGER wf_form_contact_events AFTER UPDATE OF contact_id ON form_submissions
  FOR EACH ROW WHEN (OLD.contact_id IS NULL AND NEW.contact_id IS NOT NULL)
  EXECUTE FUNCTION wf_on_form_submission();

-- The column form emails are linked by (also added by 20261021090000_forms_upgrade.sql).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;

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
  -- Ask the mailer to send workflow emails and form emails (team alert, auto-reply).
  SELECT count(*) INTO queued FROM messages WHERE status = 'queued' AND (wf_run_id IS NOT NULL OR form_submission_id IS NOT NULL);
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

/*
  # Forms: pictures and files uploaded from the device

  One public bucket, `form-files`, with two folders:

  - `assets/<workspace id>/...`: what the builder uploads (images, logos, backgrounds). Only
    members of that workspace can add, replace or remove them.
  - `responses/<form id>/...`: what people filling a form in upload (File Upload answers and
    signatures). Anyone may add a file, but only to a form that is published, or as a member of
    the form's workspace (the builder's Preview works on drafts). Nobody can change or remove
    them except the workspace.

  The files are public links (like a form's own images), with random names that can't be
  guessed. 10 MB each. Safe to run more than once.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('form-files', 'form-files', true, 10485760)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;

-- Builder pictures: members of the workspace in the second folder name.
DROP POLICY IF EXISTS "form_files_assets_insert" ON storage.objects;
CREATE POLICY "form_files_assets_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets'
    AND can_access_workspace(((storage.foldername(name))[2])::uuid)
  );
DROP POLICY IF EXISTS "form_files_assets_update" ON storage.objects;
CREATE POLICY "form_files_assets_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid))
  WITH CHECK (bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid));
DROP POLICY IF EXISTS "form_files_assets_delete" ON storage.objects;
CREATE POLICY "form_files_assets_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid));

-- Answers: into a published form, or any form of your own workspace (Preview).
CREATE OR REPLACE FUNCTION form_accepts_files(p_form text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM forms f
    WHERE f.id::text = p_form AND (f.status = 'published' OR (auth.uid() IS NOT NULL AND can_access_workspace(f.workspace_id)))
  );
$$;
GRANT EXECUTE ON FUNCTION form_accepts_files(text) TO anon, authenticated;

DROP POLICY IF EXISTS "form_files_responses_insert" ON storage.objects;
CREATE POLICY "form_files_responses_insert" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'responses'
    AND form_accepts_files((storage.foldername(name))[2])
  );
DROP POLICY IF EXISTS "form_files_responses_delete" ON storage.objects;
CREATE POLICY "form_files_responses_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'form-files' AND (storage.foldername(name))[1] = 'responses'
    AND EXISTS (SELECT 1 FROM forms f WHERE f.id::text = (storage.foldername(name))[2] AND can_access_workspace(f.workspace_id))
  );

-- Public links need no read policy, but listing the bucket stays closed: reading rows of
-- storage.objects is limited to the workspace's own folders.
DROP POLICY IF EXISTS "form_files_read" ON storage.objects;
CREATE POLICY "form_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'form-files' AND (
      ((storage.foldername(name))[1] = 'assets' AND can_access_workspace(((storage.foldername(name))[2])::uuid))
      OR ((storage.foldername(name))[1] = 'responses' AND EXISTS (SELECT 1 FROM forms f WHERE f.id::text = (storage.foldername(name))[2] AND can_access_workspace(f.workspace_id)))
    )
  );

/*
  # Roles: Owner, Admin, User, and what each User can see

  - Three roles. Owner (the account holder) and Admins see and do everything; an Admin can make
    other people Admins. Everyone else is a User ('member' in the database). There are no
    Supervisors any more: they become Users, and department leads are cleared.
  - What a User sees: `workspace_members.access`, a list of sections. Empty (NULL) means the
    standard set: Conversations, Workspaces, Meetings (with the rooms assigned to them) and
    Calendars (only the calendars they own or are a host of). Admins switch more on per person.
  - Enforced in the database, not only in the menu: a restrictive policy on each section's tables
    lets a User of the account reach them only when that section is on for them. People outside
    the account (public booking pages, public forms) are untouched: their own policies decide.
  - Company settings, connected email accounts, webhooks, integrations and the audit log can only
    be changed by Admins. Only Admins change roles, status, titles or what someone can see.
  - Rooms: only Admins create, change and assign them.

  Safe to run more than once.
*/

-- ============================================================
-- 1. No more Supervisors
-- ============================================================

UPDATE workspace_members SET role = 'member' WHERE role = 'supervisor';
UPDATE team_invitations SET role = 'member' WHERE role = 'supervisor';
UPDATE department_members SET is_lead = false WHERE is_lead;

ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));
ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_role_check;
ALTER TABLE team_invitations ADD CONSTRAINT team_invitations_role_check
  CHECK (role IN ('admin', 'member')) NOT VALID;

-- Nobody leads a department now (rooms and department changes are for Admins).
CREATE OR REPLACE FUNCTION is_department_lead(check_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION can_create_rooms(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_workspace_admin(p_workspace);
$$;

CREATE OR REPLACE FUNCTION can_manage_room(p_room uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM company_rooms r WHERE r.id = p_room AND is_workspace_admin(r.workspace_id));
$$;

-- ============================================================
-- 2. What each User can see
-- ============================================================

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS access text[];

/** The sections a User sees when nobody has chosen for them. Keep in step with src/lib/access.ts. */
CREATE OR REPLACE FUNCTION default_member_access() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['conversations', 'workspaces', 'meetings', 'calendars'];
$$;

/**
 * May the signed-in person use this section of this account? Owners and Admins: always. Users: when
 * it is in their list. Someone who is not in the account at all (or a row with no account): yes,
 * because this only narrows what the account's own people can do; their other policies still apply.
 */
CREATE OR REPLACE FUNCTION member_can(p_workspace uuid, p_feature text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT m.role IN ('owner', 'admin') OR p_feature = ANY(coalesce(m.access, default_member_access()))
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() AND coalesce(m.status, 'active') = 'active'
    LIMIT 1
  ), true) END;
$$;

/** Admin-only parts of an account (same rule: people outside the account are not affected). */
CREATE OR REPLACE FUNCTION member_is_admin_or_outside(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT m.role IN ('owner', 'admin')
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() AND coalesce(m.status, 'active') = 'active'
    LIMIT 1
  ), true) END;
$$;

/** A User sees only the calendars they own or host; Admins (and outsiders' own rules) see the rest. */
CREATE OR REPLACE FUNCTION member_sees_calendar(p_calendar uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_calendar IS NULL THEN true ELSE coalesce((
    SELECT member_is_admin_or_outside(c.workspace_id)
      OR (member_can(c.workspace_id, 'calendars')
          AND (c.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM calendar_hosts h WHERE h.calendar_id = c.id AND h.user_id = auth.uid())))
    FROM calendars c WHERE c.id = p_calendar
  ), true) END;
$$;

-- Only Admins (or the owner) change roles, status, titles or what someone can see.
CREATE OR REPLACE FUNCTION workspace_members_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws_owner uuid;
BEGIN
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = NEW.workspace_id;
  IF NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM ws_owner THEN
    RAISE EXCEPTION 'Only the workspace owner can have the owner role';
  END IF;
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      RAISE EXCEPTION 'The owner''s role cannot be changed';
    END IF;
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.title IS DISTINCT FROM OLD.title OR NEW.access IS DISTINCT FROM OLD.access)
       AND NOT is_workspace_admin(NEW.workspace_id) AND auth.uid() IS DISTINCT FROM ws_owner THEN
      RAISE EXCEPTION 'Only admins can change roles, status, titles or what someone can see';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_members_guard ON workspace_members;
CREATE TRIGGER workspace_members_guard BEFORE INSERT OR UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION workspace_members_guard();

-- ============================================================
-- 3. Each section's tables follow it
-- ============================================================

DO $$
DECLARE
  pair text[];
  sections text[][] := ARRAY[
    ARRAY['contacts', 'contacts'], ARRAY['tags', 'contacts'], ARRAY['notes', 'contacts'],
    ARRAY['smart_lists', 'contacts'], ARRAY['tasks', 'contacts'], ARRAY['messages', 'contacts'],
    ARRAY['calendar_groups', 'calendars'], ARRAY['booking_links', 'calendars'],
    ARRAY['host_availability_rules', 'calendars'], ARRAY['external_busy_periods', 'calendars'],
    ARRAY['forms', 'forms'], ARRAY['form_submissions', 'forms'],
    ARRAY['form_notification_logs', 'forms'], ARRAY['form_activity_timeline', 'forms'],
    ARRAY['workflows', 'workflows'], ARRAY['wf_events', 'workflows'], ARRAY['wf_runs', 'workflows'],
    ARRAY['events', 'events'], ARRAY['streams', 'streams'], ARRAY['recordings', 'recordings']
  ];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY sections LOOP
    IF to_regclass('public.' || pair[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1] || '_section_access', pair[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_can(workspace_id, %L)) WITH CHECK (member_can(workspace_id, %L))',
        pair[1] || '_section_access', pair[1], pair[2], pair[2]);
    END IF;
  END LOOP;

  -- Admin-only to read and change.
  FOREACH pair SLICE 1 IN ARRAY ARRAY[ARRAY['webhooks', ''], ARRAY['integrations', ''], ARRAY['audit_logs', '']] LOOP
    IF to_regclass('public.' || pair[1]) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1] || '_admins_only', pair[1]);
      EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id))',
        pair[1] || '_admins_only', pair[1]);
    END IF;
  END LOOP;
END $$;

-- Calendars and their bookings: a User sees only their own calendars.
DROP POLICY IF EXISTS calendars_section_access ON calendars;
CREATE POLICY calendars_section_access ON calendars AS RESTRICTIVE FOR ALL TO authenticated
  USING (member_sees_calendar(id))
  WITH CHECK (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND owner_id = auth.uid()));
DROP POLICY IF EXISTS appointments_section_access ON appointments;
CREATE POLICY appointments_section_access ON appointments AS RESTRICTIVE FOR ALL TO authenticated
  USING (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND member_sees_calendar(calendar_id)))
  WITH CHECK (member_is_admin_or_outside(workspace_id) OR (member_can(workspace_id, 'calendars') AND member_sees_calendar(calendar_id)));

-- Company settings and connected email accounts: everyone in the account may read (sending email
-- from a contact needs the account), only Admins change them.
DROP POLICY IF EXISTS workspace_settings_admin_insert ON workspace_settings;
CREATE POLICY workspace_settings_admin_insert ON workspace_settings AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS workspace_settings_admin_update ON workspace_settings;
CREATE POLICY workspace_settings_admin_update ON workspace_settings AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS workspace_settings_admin_delete ON workspace_settings;
CREATE POLICY workspace_settings_admin_delete ON workspace_settings AS RESTRICTIVE FOR DELETE TO authenticated
  USING (member_is_admin_or_outside(workspace_id));

DROP POLICY IF EXISTS email_accounts_admin_insert ON email_accounts;
CREATE POLICY email_accounts_admin_insert ON email_accounts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS email_accounts_admin_update ON email_accounts;
CREATE POLICY email_accounts_admin_update ON email_accounts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (member_is_admin_or_outside(workspace_id)) WITH CHECK (member_is_admin_or_outside(workspace_id));
DROP POLICY IF EXISTS email_accounts_admin_delete ON email_accounts;
CREATE POLICY email_accounts_admin_delete ON email_accounts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (member_is_admin_or_outside(workspace_id));

