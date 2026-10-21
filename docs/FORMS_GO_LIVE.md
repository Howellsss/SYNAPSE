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

## 2. Turn on the once-a-minute job

**What it is.** Supabase runs a small job every minute. It is what actually does the work:

- starts the workflows for new submissions;
- sends the waiting emails (workflow emails, form alerts and auto-replies).

If the job isn't running, forms still save contacts, but no workflow starts and no email goes out.
The job needs two Supabase add-ons, called extensions: **pg_cron** (the clock) and **pg_net** (lets
the database call the email function).

### A. Check where things stand

Open the SQL Editor: https://supabase.com/dashboard/project/parmtumfpsdtdtgwvscq/sql/new

Paste this, then click **Run**:

```sql
select
  case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'ON' else 'OFF: switch it on (step B)' end as "pg_cron",
  case when exists (select 1 from pg_extension where extname = 'pg_net')  then 'ON' else 'OFF: switch it on (step B)' end as "pg_net",
  case
    when not exists (select 1 from pg_extension where extname = 'pg_cron') then 'Can''t check yet: pg_cron is off'
    when query_to_xml('select 1 from cron.job where jobname = ''synapse-workflows'' and active', false, false, '')::text like '%<row>%' then 'OK: runs every minute'
    else 'MISSING: do step C'
  end as "minute job";
```

You get one row with three answers. If all three say **ON / ON / OK: runs every minute**, skip to
step 3.

### B. If pg_cron or pg_net says OFF

1. Open https://supabase.com/dashboard/project/parmtumfpsdtdtgwvscq/database/extensions
2. Type `pg_cron` in the search box and switch it on. If it asks for a schema, keep the default.
3. Do the same for `pg_net`.
4. Run the check in step A again.

### C. If the minute job says MISSING

In the SQL Editor, run:

```sql
select cron.schedule('synapse-workflows', '* * * * *', 'SELECT public.wf_tick()');
```

- `synapse-workflows` is the job's name.
- `* * * * *` means "every minute".
- `SELECT public.wf_tick()` is what it runs.

It answers with a number, the job's id. That means it worked. Running it again does no harm: it
updates the same job. Run the check in step A once more, and it should say
**OK: runs every minute**.

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
