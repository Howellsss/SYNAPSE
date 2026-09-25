/*
# Allow public booking pages to show assigned host names safely

1. Security scope
- Adds a read policy for profiles used by active public calendars.
- Visitors can only see the profile columns needed by the booking host selector.
- Private profile fields remain unavailable to anonymous visitors.

2. Modified tables
- `profiles`: anonymous SELECT is limited to `user_id`, `first_name`, `last_name`, and `avatar_url`.
- `profiles`: public rows are limited to users assigned to an active calendar.

3. Important notes
- Authenticated users retain the existing owner-scoped profile access.
- No profile data is deleted or changed.
*/

REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (user_id, first_name, last_name, avatar_url) ON public.profiles TO anon;

DROP POLICY IF EXISTS "profiles_public_booking_hosts" ON public.profiles;
CREATE POLICY "profiles_public_booking_hosts"
ON public.profiles
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.calendar_hosts
    JOIN public.calendars ON calendars.id = calendar_hosts.calendar_id
    WHERE calendar_hosts.user_id = profiles.user_id
      AND calendars.status = 'active'
  )
);