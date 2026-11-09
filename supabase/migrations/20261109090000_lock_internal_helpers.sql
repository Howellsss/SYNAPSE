/*
  # Lock the database's internal helpers

  Supabase lets the app's public key call any database function, and by default it may. These
  functions are only ever used inside the database (by triggers, the minute scheduler and other
  functions), never by the app, so outside callers are now refused. Before this, someone with the
  public key could, for example, post into a chat channel, create tags or start workflow runs.

  Also tightened, among functions the app does call:
    - seed_workspace_demo_data: only the new account's owner, for their own account.
    - wf_set_client_key: set once; only a platform admin can change it afterwards.
    - increment_workflow_runs and get_form_submission_counts now run with the caller's own
      permissions, so they only touch workflows and forms the caller can already see.

  Nothing the app does changes. Safe to run more than once.
*/

-- 1. Internal helpers: no outside callers. (The database itself, the scheduler and the
--    service role used by edge functions keep using them.)
DO $$
DECLARE s text; f regprocedure;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'api_contact(uuid)',
    'api_route(api_keys, text, text[], jsonb, jsonb)',
    'audit_person(uuid)',
    'audit_write(uuid, text, text, uuid, jsonb)',
    'can_use_room(uuid)',
    'ensure_department_channel(uuid)',
    'event_public_json(events)',
    'event_ticket_list(uuid)',
    'webhook_contact(uuid)',
    'webhook_dispatch(uuid)',
    'webhook_form_answers(uuid)',
    'webhook_queue(uuid, text, jsonb)',
    'wf_app_url()',
    'wf_conditions_ok(jsonb, uuid)',
    'wf_contact_tags(uuid)',
    'wf_daily_scan()',
    'wf_emit(uuid, text, uuid, jsonb)',
    'wf_enroll(workflows, jsonb, uuid, text, jsonb, integer, boolean, boolean)',
    'wf_exec_step(wf_runs, workflows, text, jsonb)',
    'wf_finish(uuid, text, text)',
    'wf_form_answers(uuid)',
    'wf_handle_event(wf_events)',
    'wf_log(wf_runs, jsonb, text, text, text)',
    'wf_merge(text, uuid, jsonb)',
    'wf_new_meeting(uuid, uuid, text, integer)',
    'wf_post(uuid, workflows, wf_runs, text)',
    'wf_run(uuid)',
    'wf_tag_id(uuid, text)',
    'wf_tick()',
    'wf_trigger_matches(jsonb, wf_events)'
  ] LOOP
    f := to_regprocedure('public.' || s);
    CONTINUE WHEN f IS NULL;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); EXCEPTION WHEN undefined_object THEN NULL; END;
  END LOOP;
END $$;

-- 2. Demo data: only the owner, for their own new account. The original keeps its body under
--    another name that only the database can call.
DO $$
BEGIN
  IF to_regprocedure('public.seed_workspace_demo_data_unchecked(uuid, uuid)') IS NULL
     AND to_regprocedure('public.seed_workspace_demo_data(uuid, uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.seed_workspace_demo_data(uuid, uuid) RENAME TO seed_workspace_demo_data_unchecked;
  END IF;
END $$;
DO $$
BEGIN
  IF to_regprocedure('public.seed_workspace_demo_data_unchecked(uuid, uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.seed_workspace_demo_data_unchecked(uuid, uuid) FROM PUBLIC, anon, authenticated;
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.seed_workspace_demo_data(p_workspace_id uuid, p_owner_id uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        IF auth.uid() IS NULL OR auth.uid() <> p_owner_id OR NOT has_workspace_role(p_workspace_id, ARRAY['owner']) THEN
          RAISE EXCEPTION 'Only the account owner can do this.';
        END IF;
        PERFORM seed_workspace_demo_data_unchecked(p_workspace_id, p_owner_id);
      END $b$;
    $f$;
    REVOKE ALL ON FUNCTION public.seed_workspace_demo_data(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.seed_workspace_demo_data(uuid, uuid) TO authenticated;
  END IF;
END $$;

-- 3. The scheduler's gateway key: the first value sticks; later changes only by a platform admin.
CREATE OR REPLACE FUNCTION wf_set_client_key(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = auth.uid()) THEN RETURN; END IF;
  IF p_key IS NULL OR char_length(p_key) NOT BETWEEN 20 AND 2000 OR p_key !~ '^[A-Za-z0-9._-]+$' THEN RETURN; END IF;
  IF is_platform_admin() THEN
    INSERT INTO wf_private.settings(key, value) VALUES ('client_key', p_key) ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  ELSE
    INSERT INTO wf_private.settings(key, value) VALUES ('client_key', p_key) ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION wf_set_client_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wf_set_client_key(text) TO authenticated;

-- 4. Run with the caller's own permissions (row-level security decides what they touch).
DO $$
BEGIN
  IF to_regprocedure('public.increment_workflow_runs(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.increment_workflow_runs(uuid) SECURITY INVOKER;
    REVOKE ALL ON FUNCTION public.increment_workflow_runs(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.increment_workflow_runs(uuid) TO authenticated;
  END IF;
  IF to_regprocedure('public.get_form_submission_counts(uuid[])') IS NOT NULL THEN
    ALTER FUNCTION public.get_form_submission_counts(uuid[]) SECURITY INVOKER;
    REVOKE ALL ON FUNCTION public.get_form_submission_counts(uuid[]) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_form_submission_counts(uuid[]) TO authenticated;
  END IF;
END $$;
