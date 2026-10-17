-- Dashboard in one request: today's and the week's bookings (with their contact and calendar) and
-- the four counts, which the dashboard used to fetch with six separate requests.
--
-- SECURITY INVOKER: it runs as the person asking, so row-level security decides exactly what it
-- sees, the same as the six requests did. Safe to run more than once.

create or replace function public.dashboard_summary(
  p_workspace_id uuid,
  p_today_start timestamptz,
  p_today_end timestamptz,
  p_now timestamptz,
  p_week_end timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with booked as (
    select a.start_time,
           to_jsonb(a)
             || jsonb_build_object(
                  'contacts', case when c.id is null then null else to_jsonb(c) end,
                  'calendars', case when cal.id is null then null else to_jsonb(cal) end
                ) as row
    from appointments a
    left join contacts c on c.id = a.contact_id
    left join calendars cal on cal.id = a.calendar_id
    where a.workspace_id = p_workspace_id
      and a.status in ('confirmed', 'pending')
      and a.start_time >= least(p_today_start, p_now)
      and a.start_time <= greatest(p_today_end, p_week_end)
  )
  select jsonb_build_object(
    'today', coalesce((
      select jsonb_agg(b.row order by b.start_time)
      from booked b
      where b.start_time >= p_today_start and b.start_time <= p_today_end
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(u.row order by u.start_time)
      from (
        select b.row, b.start_time from booked b
        where b.start_time >= p_now and b.start_time <= p_week_end
        order by b.start_time
        limit 6
      ) u
    ), '[]'::jsonb),
    'contacts', (select count(*) from contacts where workspace_id = p_workspace_id),
    'members', (select count(*) from workspace_members where workspace_id = p_workspace_id),
    'completed', (select count(*) from appointments where workspace_id = p_workspace_id and status = 'completed'),
    'messages', (select count(*) from messages where workspace_id = p_workspace_id)
  );
$$;

revoke all on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;
