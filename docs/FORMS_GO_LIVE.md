# Forms and surveys: going live

Everything here is for the SYNAPSE Supabase project `parmtumfpsdtdtgwvscq`. Do the steps in order.

## 1. Run the two database updates

Open the SQL Editor: https://supabase.com/dashboard/project/parmtumfpsdtdtgwvscq/sql/new

Paste each file in full, then click **Run**. Do them one at a time, in this order. Both are safe
to run more than once.

1. `supabase/migrations/20261021090000_forms_upgrade.sql`
   - On GitHub: https://github.com/Howellsss/SYNAPSE/blob/main/supabase/migrations/20261021090000_forms_upgrade.sql
   - Plain text to copy: https://raw.githubusercontent.com/Howellsss/SYNAPSE/main/supabase/migrations/20261021090000_forms_upgrade.sql
   - Adds quiz scores, disqualified, payments, where people came from, and the link between form
     emails and their submission.
2. `supabase/migrations/20261021120000_form_workflow_trigger.sql`
   - On GitHub: https://github.com/Howellsss/SYNAPSE/blob/main/supabase/migrations/20261021120000_form_workflow_trigger.sql
   - Plain text to copy: https://raw.githubusercontent.com/Howellsss/SYNAPSE/main/supabase/migrations/20261021120000_form_workflow_trigger.sql
   - Makes form and survey submissions start "Form submitted" workflows.
   - Makes the once-a-minute job send a form's own emails.

Check it worked by running this in the SQL Editor. It should return 2 rows.

```sql
select tgname from pg_trigger where tgname in ('wf_form_events', 'wf_form_contact_events');
```

## 2. Check the once-a-minute job

Workflows and all queued emails run from a job every minute. It needs the **pg_cron** and
**pg_net** extensions.

- Extensions: https://supabase.com/dashboard/project/parmtumfpsdtdtgwvscq/database/extensions
  Search for each one and switch it on.
- Then check the job exists in the SQL Editor:

```sql
select jobname, schedule, active from cron.job where jobname = 'synapse-workflows';
```

If that returns nothing (pg_cron was switched on after the workflow update ran), create the job:

```sql
select cron.schedule('synapse-workflows', '* * * * *', 'SELECT public.wf_tick()');
```

## 3. Deploy the two functions

Both changed for forms: `form-submit` saves submissions, and `send-email` sends form emails.

- In the dashboard: https://supabase.com/dashboard/project/parmtumfpsdtdtgwvscq/functions
  - Open each function, then **Code**, paste the file, and **Deploy**.
  - The sources:
    - https://github.com/Howellsss/SYNAPSE/blob/main/supabase/functions/form-submit/index.ts
    - https://github.com/Howellsss/SYNAPSE/tree/main/supabase/functions/send-email (`index.ts` and `replies.ts`)
  - In each function's settings, turn **Enforce JWT verification** off. Both check logins themselves, and
    the public form has no login.
- Or from a computer with the Supabase CLI, in the SYNAPSE folder:

```sh
supabase functions deploy form-submit --project-ref parmtumfpsdtdtgwvscq --no-verify-jwt
supabase functions deploy send-email --project-ref parmtumfpsdtdtgwvscq --no-verify-jwt
```

## 4. Add the secrets

Add them on the Edge Function secrets page: https://supabase.com/dashboard/project/parmtumfpsdtdtgwvscq/functions/secrets

| Name | Value | Needed for |
|---|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_live_…`, or `sk_test_…` to try it first), from https://dashboard.stripe.com/apikeys | Forms with a Payment element only |
| `PUBLIC_APP_URL` | The address of the live app, e.g. `https://synapse-dj3a.vercel.app` (no slash at the end) | Bringing people back to the form after Stripe |

The Gmail secrets the mailer already uses stay as they are (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`).

## 5. In SYNAPSE

1. Connect the Gmail account that form emails should come from: **Settings → Email**.
2. Open **Workflows** once while signed in. This lets the minute job reach the mailer.

## 6. Try it

1. Make a form: **Forms → New**.
2. Drag a few elements in and **Publish**.
3. Make the workflow: **Settings → Use in a workflow**, add a **Send email** step, and publish it.
4. Open the form's link, `https://<your app>/f/<form id>`, in a private window and submit it.
5. Within a minute you should see all of these:
   - a new contact in **Contacts**;
   - the response under the form's **Submissions**;
   - the workflow listed under that contact;
   - the email in the inbox.
6. The builder's **Preview** works the same way on drafts. It's marked "Preview" and never charges
   a card.
