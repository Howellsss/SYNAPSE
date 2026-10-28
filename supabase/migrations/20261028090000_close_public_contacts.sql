/*
  # Close the public doors on contacts and appointments

  Until now, three rules made for the public booking pages let anyone with the site's public key,
  signed in or not, read every contact of every account, change any contact, and change any
  appointment. They go. The booking pages do the two things they need through two narrow
  functions instead:

  - public_booking_contact(): finds the visitor's contact by email in the account the calendar
    or form belongs to, or adds them. It returns only the contact's id, never anyone's details,
    and on an existing contact it only fills in what's empty (a stranger who knows someone's
    email can't overwrite their name or phone).
  - public_cancel_booking(): the visitor cancels the booking they just made, by its id (which
    only they have), and only one still to come.

  Staff keep their usual access through the account's own rules. Safe to run more than once.
*/

DROP POLICY IF EXISTS "contacts_public_select" ON contacts;
DROP POLICY IF EXISTS "contacts_public_update" ON contacts;
DROP POLICY IF EXISTS "contacts_public_insert" ON contacts;
DROP POLICY IF EXISTS "appts_public_update" ON appointments;

CREATE OR REPLACE FUNCTION public_booking_contact(
  p_workspace uuid, p_owner uuid, p_first text, p_last text, p_email text, p_phone text, p_source text DEFAULT 'booking_page'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em text := nullif(lower(trim(coalesce(p_email, ''))), '');
  first_name_in text := nullif(left(trim(coalesce(p_first, '')), 100), '');
  last_name_in text := nullif(left(trim(coalesce(p_last, '')), 100), '');
  phone_in text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  cid uuid;
BEGIN
  -- Only a real account (or a calendar owner, for calendars outside any account).
  IF p_workspace IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace) THEN RAISE EXCEPTION 'Unknown account'; END IF;
  ELSIF p_owner IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner) THEN
    RAISE EXCEPTION 'Unknown account';
  END IF;
  IF em IS NOT NULL AND em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN em := NULL; END IF;
  IF em IS NULL AND first_name_in IS NULL AND phone_in IS NULL THEN RETURN NULL; END IF;

  IF em IS NOT NULL THEN
    SELECT id INTO cid FROM contacts
    WHERE lower(email) = em
      AND (CASE WHEN p_workspace IS NOT NULL THEN workspace_id = p_workspace ELSE workspace_id IS NULL AND owner_id = p_owner END)
    ORDER BY created_at LIMIT 1;
  END IF;

  IF cid IS NOT NULL THEN
    UPDATE contacts SET
      first_name = coalesce(nullif(first_name, ''), first_name_in),
      last_name = coalesce(nullif(last_name, ''), last_name_in),
      phone = coalesce(nullif(phone, ''), phone_in),
      last_activity_at = now()
    WHERE id = cid;
    RETURN cid;
  END IF;

  INSERT INTO contacts (workspace_id, owner_id, first_name, last_name, email, phone, source)
  VALUES (p_workspace, CASE WHEN p_workspace IS NULL THEN p_owner END, first_name_in, last_name_in, em, phone_in,
          left(coalesce(nullif(p_source, ''), 'booking_page'), 40))
  RETURNING id INTO cid;
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public_booking_contact(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_booking_contact(uuid, uuid, text, text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public_cancel_booking(p_appointment uuid, p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE appointments
  SET status = 'cancelled', cancellation_reason = nullif(left(coalesce(p_reason, ''), 300), ''), updated_at = now()
  WHERE id = p_appointment AND status IN ('confirmed', 'pending') AND start_time > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public_cancel_booking(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_cancel_booking(uuid, text) TO anon, authenticated;
