/*
  # Meeting invite links for people outside the account

  Each meeting gets a private invite token. The link SYNAPSE copies
  (/meetings/FOCU-358?invite=<token>) lets anyone who has it join as a guest with their name,
  without a SYNAPSE account. Members still join with their login as before.
  Safe to run more than once.

  1. meetings.invite_token   random 32 hex characters, unique
  2. meeting_by_invite(code, token)
       What a guest needs to see before joining (title, host name, ended or not), and only when
       the token matches. Nothing else about the account is exposed.
*/

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS invite_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
CREATE UNIQUE INDEX IF NOT EXISTS meetings_invite_token_key ON meetings(invite_token);

CREATE OR REPLACE FUNCTION meeting_by_invite(p_code text, p_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', m.id,
    'workspace_id', m.workspace_id,
    'host_id', m.host_id,
    'title', m.title,
    'code', m.code,
    'nickname', NULL,
    'kind', m.kind,
    'scheduled_at', m.scheduled_at,
    'duration_min', m.duration_min,
    'ended_at', m.ended_at,
    'created_at', m.created_at,
    'invite_token', m.invite_token,
    'host_name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), w.name, '')
  )
  FROM meetings m
  LEFT JOIN profiles p ON p.user_id = m.host_id
  LEFT JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.code = upper(btrim(p_code))
    AND coalesce(btrim(p_token), '') <> ''
    AND m.invite_token = btrim(p_token)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION meeting_by_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION meeting_by_invite(text, text) TO anon, authenticated;
