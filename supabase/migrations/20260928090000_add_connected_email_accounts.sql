/*
  # Connected email accounts (Gmail)

  Lets a team member connect their own Google account and send email from it
  inside SYNAPSE.

  1. email_accounts
     One row per connected mailbox. A user can see and remove only their own
     connections; tokens never live here.

  2. email_account_secrets
     The encrypted OAuth refresh token and the short-lived access token.
     Row level security is on with NO policies, so the browser can never read
     it. Only Edge Functions using the service role key touch this table.

  3. messages.email_account_id
     Which connected mailbox a message was sent from.
*/

CREATE TABLE IF NOT EXISTS email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  email text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  last_error text,
  scopes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, provider, email)
);
CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts(user_id);
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_accounts_select_own" ON email_accounts;
CREATE POLICY "email_accounts_select_own" ON email_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "email_accounts_delete_own" ON email_accounts;
CREATE POLICY "email_accounts_delete_own" ON email_accounts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS email_account_secrets (
  account_id uuid PRIMARY KEY REFERENCES email_accounts(id) ON DELETE CASCADE,
  refresh_token_enc text NOT NULL,
  access_token_enc text,
  access_token_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_account_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_account_secrets FROM anon, authenticated;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_account_id uuid
  REFERENCES email_accounts(id) ON DELETE SET NULL;
