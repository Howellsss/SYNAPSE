# Turn on "Send from Gmail"

Team members connect their own Gmail in **Settings → Email → Connected email accounts**
(or from the email composer on a contact). SYNAPSE then sends through the Gmail API, so
emails come from their real address, land in their Gmail "Sent" folder, and replies go to
their inbox.

Nothing secret ever reaches the browser: Google tokens are encrypted and stored in
`email_account_secrets`, which only the Edge Functions can read.

## 1. Database

Run `supabase/migrations/20260928090000_add_connected_email_accounts.sql` in the Supabase
SQL editor. It is safe to run more than once.

## 2. Google Cloud (one time)

1. Go to <https://console.cloud.google.com>, create a project (for example "SYNAPSE").
2. **APIs & Services → Library** → enable **Gmail API**.
3. **Google Auth Platform → Branding** (older consoles: **OAuth consent screen**):
   - App name `SYNAPSE`, support email, and developer contact email.
   - Audience: **External**, publishing status **Testing**.
   - **Test users**: add every Gmail address that will try it (up to 100).
4. **Data Access** (or **Scopes**): add `.../auth/gmail.send`, `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`.
5. **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Type **Web application**.
   - Authorised redirect URI:
     `https://parmtumfpsdtdtgwvscq.supabase.co/functions/v1/gmail-oauth`
   - Copy the **Client ID** and **Client secret**.

While the app is in *Testing*, only listed test users can connect, and Google asks them to
reconnect every 7 days. To open it to everyone, publish the app and complete Google's
verification for the `gmail.send` scope (needs a privacy policy and terms page on your domain).

## 3. Supabase secrets

Supabase dashboard → **Edge Functions → Secrets** → add:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | from step 2.5 |
| `GOOGLE_CLIENT_SECRET` | from step 2.5 |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64. Generate with `openssl rand -base64 32` |
| `APP_URL` | `https://synapse-dj3a.vercel.app` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
Never change `TOKEN_ENCRYPTION_KEY` after people have connected (they would have to reconnect).

## 4. Deploy the functions

With the Supabase CLI:

```sh
npx supabase login
npx supabase link --project-ref parmtumfpsdtdtgwvscq
npx supabase functions deploy gmail-oauth --no-verify-jwt
npx supabase functions deploy send-email
```

Or in the dashboard: **Edge Functions → Deploy a new function → Via editor**, name it
`gmail-oauth`, paste `supabase/functions/gmail-oauth/index.ts`, deploy, then open its
settings and turn **off** "Enforce JWT verification" (Google's redirect has no Supabase login).
Repeat for `send-email`, pasting `supabase/functions/send-email/index.ts` and leaving JWT
verification **on**.

## 5. Test

1. Open SYNAPSE → Settings → Email → **Connect Gmail**, pick a test-user Gmail, allow access
   (make sure "Send email on your behalf" is ticked).
2. Open a contact whose email you can check → composer → From shows `you@gmail.com (Gmail)`
   → write a subject and message → **Send**.
3. The message shows **Sent** in the thread, arrives in the contact's inbox, and appears in
   your Gmail "Sent" folder.

If something fails, the reason is shown on the message in the thread, and the function logs
are under **Edge Functions → gmail-oauth / send-email → Logs**.
