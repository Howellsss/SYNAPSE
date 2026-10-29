/*
  # Suspending and removing a person, with hand-over

  - A suspended person is locked out of the account everywhere, not only in the menu: the
    membership checks now count active people only. (Until now a suspended person kept full
    access to the database.) The account owner is never locked out.
  - offboard_member(): an Admin suspends or removes someone in one step and hands their work to
    another active person in the account:
      contacts they own, their open tasks, the calendars they own or host (and the bookings still
      to come on them), their booking links and calendar groups, forms, events, meetings not yet
      ended, and the rooms assigned to them. Channels they own get the new person as an owner.
    Removing also takes them out of the account's channels, departments, rooms and spaces, then
    deletes their membership. Suspending keeps all of that, so they can be brought back.
    Each step is written to the audit log.
  - Their sign-ins are ended (when they belong to no other account), so they are signed out on
    every device. The app also checks every minute and on returning to the tab.
  - my_membership_status(): what the app asks to know whether the signed-in person still belongs.

  Safe to run more than once.
*/

-- ============================================================
-- 1. Only active people count as members
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
SELECT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = check_workspace_id AND user_id = auth.uid() AND coalesce(status, 'active') = 'active'
) OR EXISTS (
  SELECT 1 FROM workspaces
  WHERE id = check_workspace_id AND owner_id = auth.uid()
);
$function$;

-- A suspended person is not "outside" the account: they get nothing.
CREATE OR REPLACE FUNCTION member_can(p_workspace uuid, p_feature text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT coalesce(m.status, 'active') = 'active'
       AND (m.role IN ('owner', 'admin') OR p_feature = ANY(coalesce(m.access, default_member_access())))
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid()
    LIMIT 1
  ), true) END;
$$;

CREATE OR REPLACE FUNCTION member_is_admin_or_outside(p_workspace uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_workspace IS NULL OR auth.uid() IS NULL THEN true ELSE coalesce((
    SELECT coalesce(m.status, 'active') = 'active' AND m.role IN ('owner', 'admin')
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid()
    LIMIT 1
  ), true) END;
$$;

-- ============================================================
-- 2. Am I still in this account?
-- ============================================================

/** 'active', 'suspended', or 'removed' (no longer in the account) for the signed-in person. */
CREATE OR REPLACE FUNCTION my_membership_status(p_workspace uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN 'removed'
    WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = p_workspace AND w.owner_id = auth.uid()) THEN 'active'
    ELSE coalesce((
      SELECT CASE WHEN coalesce(m.status, 'active') = 'suspended' THEN 'suspended' ELSE 'active' END
      FROM workspace_members m WHERE m.workspace_id = p_workspace AND m.user_id = auth.uid() LIMIT 1
    ), 'removed')
  END;
$$;
REVOKE ALL ON FUNCTION my_membership_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_membership_status(uuid) TO authenticated;

-- ============================================================
-- 3. What someone has, for the hand-over screen
-- ============================================================

CREATE OR REPLACE FUNCTION member_work(p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE ws uuid; uid uuid;
BEGIN
  SELECT workspace_id, user_id INTO ws, uid FROM workspace_members WHERE id = p_member;
  IF ws IS NULL THEN RAISE EXCEPTION 'That person is not in this account'; END IF;
  IF NOT is_workspace_admin(ws) THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
  RETURN jsonb_build_object(
    'contacts', (SELECT count(*) FROM contacts WHERE workspace_id = ws AND owner_id = uid),
    'tasks', (SELECT count(*) FROM tasks WHERE workspace_id = ws AND assigned_to = uid AND completed_at IS NULL),
    'calendars', (SELECT count(*) FROM calendars c WHERE c.workspace_id = ws AND (c.owner_id = uid
                   OR EXISTS (SELECT 1 FROM calendar_hosts h WHERE h.calendar_id = c.id AND h.user_id = uid))),
    'bookings', (SELECT count(*) FROM appointments WHERE workspace_id = ws AND (host_id = uid OR owner_id = uid)
                  AND start_time > now() AND status IN ('confirmed', 'pending')),
    'forms', (SELECT count(*) FROM forms WHERE workspace_id = ws AND owner_id = uid),
    'events', (SELECT count(*) FROM events WHERE workspace_id = ws AND created_by = uid),
    'meetings', (SELECT count(*) FROM meetings WHERE workspace_id = ws AND host_id = uid AND ended_at IS NULL),
    'rooms', (SELECT count(*) FROM company_room_assignees WHERE workspace_id = ws AND user_id = uid)
  );
END $$;
REVOKE ALL ON FUNCTION member_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION member_work(uuid) TO authenticated;

-- ============================================================
-- 4. Suspend or remove, with hand-over
-- ============================================================

CREATE OR REPLACE FUNCTION offboard_member(p_member uuid, p_action text, p_hand_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws uuid; uid uuid; who_role text; ws_owner uuid;
  moved jsonb := '{}'::jsonb; n int;
BEGIN
  IF p_action NOT IN ('suspend', 'remove') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  SELECT workspace_id, user_id, role INTO ws, uid, who_role FROM workspace_members WHERE id = p_member;
  IF ws IS NULL THEN RAISE EXCEPTION 'That person is not in this account'; END IF;
  IF NOT is_workspace_admin(ws) THEN RAISE EXCEPTION 'Only admins can suspend or remove people'; END IF;
  SELECT owner_id INTO ws_owner FROM workspaces WHERE id = ws;
  IF uid = ws_owner OR who_role = 'owner' THEN RAISE EXCEPTION 'The account owner cannot be suspended or removed'; END IF;
  IF uid = auth.uid() THEN RAISE EXCEPTION 'You cannot suspend or remove yourself'; END IF;
  IF p_action = 'remove' AND p_hand_to IS NULL THEN RAISE EXCEPTION 'Choose who takes over their work'; END IF;
  IF p_hand_to IS NOT NULL AND (p_hand_to = uid OR NOT (p_hand_to = ws_owner OR EXISTS (
       SELECT 1 FROM workspace_members m WHERE m.workspace_id = ws AND m.user_id = p_hand_to AND coalesce(m.status, 'active') = 'active'))) THEN
    RAISE EXCEPTION 'The person taking over must be active in this account';
  END IF;

  -- Hand-over
  IF p_hand_to IS NOT NULL THEN
    UPDATE contacts SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('contacts', n);

    UPDATE tasks SET assigned_to = p_hand_to, updated_at = now() WHERE workspace_id = ws AND assigned_to = uid AND completed_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('tasks', n);

    UPDATE calendars SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('calendars', n);
    INSERT INTO calendar_hosts (calendar_id, user_id, priority, weight, is_primary)
      SELECT h.calendar_id, p_hand_to, h.priority, h.weight, h.is_primary
      FROM calendar_hosts h JOIN calendars c ON c.id = h.calendar_id
      WHERE c.workspace_id = ws AND h.user_id = uid
      ON CONFLICT (calendar_id, user_id) DO NOTHING;
    DELETE FROM calendar_hosts h USING calendars c WHERE c.id = h.calendar_id AND c.workspace_id = ws AND h.user_id = uid;

    UPDATE appointments SET host_id = CASE WHEN host_id = uid THEN p_hand_to ELSE host_id END,
                            owner_id = CASE WHEN owner_id = uid THEN p_hand_to ELSE owner_id END
      WHERE workspace_id = ws AND (host_id = uid OR owner_id = uid) AND start_time > now() AND status IN ('confirmed', 'pending');
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('bookings', n);

    UPDATE booking_links SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    UPDATE calendar_groups SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE forms SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('forms', n);
    UPDATE form_submissions SET owner_id = p_hand_to WHERE workspace_id = ws AND owner_id = uid;

    UPDATE events SET created_by = p_hand_to WHERE workspace_id = ws AND created_by = uid;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('events', n);

    UPDATE meetings SET host_id = p_hand_to WHERE workspace_id = ws AND host_id = uid AND ended_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('meetings', n);

    INSERT INTO company_room_assignees (room_id, workspace_id, user_id, assigned_by)
      SELECT a.room_id, ws, p_hand_to, auth.uid() FROM company_room_assignees a WHERE a.workspace_id = ws AND a.user_id = uid
      ON CONFLICT (room_id, user_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved || jsonb_build_object('rooms', n);

    INSERT INTO chat_members (channel_id, workspace_id, user_id, role)
      SELECT cm.channel_id, ws, p_hand_to, 'owner' FROM chat_members cm WHERE cm.workspace_id = ws AND cm.user_id = uid AND cm.role = 'owner'
      ON CONFLICT (channel_id, user_id) DO UPDATE SET role = 'owner';
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE workspace_members SET status = 'suspended' WHERE id = p_member;
  ELSE
    DELETE FROM chat_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM department_members WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM company_room_assignees WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM space_members sm USING spaces s WHERE s.id = sm.space_id AND s.workspace_id = ws AND sm.user_id = uid;
    DELETE FROM member_status WHERE workspace_id = ws AND user_id = uid;
    DELETE FROM workspace_members WHERE id = p_member;
  END IF;

  INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details)
  VALUES (ws, auth.uid(), CASE p_action WHEN 'suspend' THEN 'member_suspended' ELSE 'member_removed' END, 'member', uid,
          jsonb_build_object('handed_to', p_hand_to, 'moved', moved));

  -- Sign them out everywhere, unless they still belong to another account.
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.user_id = uid AND m.workspace_id <> ws AND coalesce(m.status, 'active') = 'active')
     AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = uid AND w.id <> ws)
     AND to_regclass('auth.sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING uid;
    EXCEPTION WHEN insufficient_privilege THEN NULL;  -- the app and the checks above still lock them out
    END;
  END IF;

  RETURN moved;
END $$;
REVOKE ALL ON FUNCTION offboard_member(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION offboard_member(uuid, text, uuid) TO authenticated;
