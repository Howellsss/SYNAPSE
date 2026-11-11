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
