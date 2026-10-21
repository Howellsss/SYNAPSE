-- SYNAPSE: follow the latest submission of a form all the way to the email. Read only.
-- Change 'Test Form' below to your form's name, then run it in the Supabase SQL Editor.
with s as (
  select fs.* from form_submissions fs join forms f on f.id = fs.form_id
  where f.name = 'Test Form' order by fs.created_at desc limit 1
), r as (
  select r.*, w.name as wname from wf_runs r join workflows w on w.id = r.workflow_id, s
  where r.contact_id = s.contact_id and r.started_at >= s.created_at - interval '1 minute'
)
select step, to_char(at at time zone 'UTC', 'HH24:MI:SS') as "time (UTC)", result from (
  select 1 as o, '1. Submission' as step, s.created_at as at,
         coalesce('contact: ' || trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) || ' <' || coalesce(c.email, 'no email') || '>', 'NO CONTACT attached') as result
    from s left join contacts c on c.id = s.contact_id
  union all
  select 2, '2. Workflow trigger', e.created_at,
         case when e.processed_at is null then 'waiting for the minute job' else 'picked up by the minute job' end
    from wf_events e, s where e.type = 'form_submitted' and e.data ->> 'submission_id' = s.id::text
  union all
  select 3, '3. Workflow run', r.started_at, r.wname || ': ' || r.status || coalesce(' (' || r.exit_reason || ')', '') from r
  union all
  select 4, '4. Step ' || coalesce(l.step_name, l.step_type), l.at, l.status || coalesce(': ' || l.detail, '')
    from wf_logs l join r on r.id = l.run_id
  union all
  select 5, '5. Email', m.created_at, m.status || ' to ' || coalesce(m.to_address, '?') || coalesce(': ' || m.error, '')
    from messages m, s where m.contact_id = s.contact_id and m.channel = 'email' and m.created_at >= s.created_at - interval '1 minute'
  union all
  select 6, '6. Active workflows on form submitted', null,
         coalesce((select string_agg(w.name, ', ') from workflows w, s where w.workspace_id = s.workspace_id and w.status = 'active'
                   and w.definition -> 'triggers' @? '$[*] ? (@.type == "form_submitted")'), 'NONE: publish the workflow')
  union all
  select 7, '7. Mailer key saved', null,
         case when exists (select 1 from wf_private.settings where key = 'client_key') then 'yes' else 'NO: open Workflows in SYNAPSE once' end
) x order by o, at;
