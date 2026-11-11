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
