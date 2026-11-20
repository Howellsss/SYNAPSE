/*
  # Send from your own domain (Resend), not only from a Gmail

  An email account can now be a sending address on a domain you own (for example
  tickets@deraspeaks.com), delivered through Resend, instead of a connected Gmail. Nothing
  changes for Gmail accounts.

    - email_accounts.provider: 'google' (a connected Gmail) or 'resend' (a domain sender).
    - email_accounts.reply_to: where replies go (a domain sender has no inbox of its own).
    - email_domain_sender_set(event slug, address, From name, reply-to): adds the address to the
      account that owns the event and makes it that event's sender. SQL Editor only:
        SELECT email_domain_sender_set('unscathed', 'tickets@deraspeaks.com',
                                       'Deraspeaks · Ample Room', 'reply-here@example.com');

  Before it sends: the domain is verified in Resend (its DNS records added in Cloudflare) and the
  Resend API key is saved in Supabase → Edge Functions → Secrets as RESEND_API_KEY, and the
  send-email function is redeployed (supabase/paste/send-email.ts). Safe to run more than once.
*/

ALTER TABLE email_accounts DROP CONSTRAINT IF EXISTS email_accounts_provider_check;
ALTER TABLE email_accounts ADD CONSTRAINT email_accounts_provider_check CHECK (provider IN ('google', 'resend'));
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS reply_to text;

CREATE OR REPLACE FUNCTION email_domain_sender_set(p_event_slug text, p_email text, p_name text, p_reply_to text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e events; owner uuid; em text := lower(btrim(coalesce(p_email, ''))); rt text := nullif(lower(btrim(coalesce(p_reply_to, ''))), ''); acc uuid;
BEGIN
  SELECT * INTO e FROM events WHERE slug = lower(btrim(coalesce(p_event_slug, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'No event with the web address "%".', p_event_slug; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION '"%" is not an email address.', p_email; END IF;
  IF rt IS NOT NULL AND rt !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION '"%" is not an email address.', p_reply_to; END IF;
  SELECT owner_id INTO owner FROM workspaces WHERE id = e.workspace_id;

  INSERT INTO email_accounts (workspace_id, user_id, provider, email, display_name, status, reply_to, scopes)
  VALUES (e.workspace_id, owner, 'resend', em, nullif(btrim(coalesce(p_name, '')), ''), 'active', rt, '{}')
  ON CONFLICT (workspace_id, user_id, provider, email) DO UPDATE
    SET display_name = EXCLUDED.display_name, reply_to = EXCLUDED.reply_to, status = 'active', last_error = NULL, updated_at = now()
  RETURNING id INTO acc;

  UPDATE events SET email_account_id = acc WHERE id = e.id;
  RETURN format('%s now sends from %s%s. Check with: SELECT * FROM email_setup_check();',
    e.title, em, CASE WHEN rt IS NOT NULL THEN ' (replies go to ' || rt || ')' ELSE '' END);
END $$;
REVOKE ALL ON FUNCTION email_domain_sender_set(text, text, text, text) FROM PUBLIC, anon, authenticated;
