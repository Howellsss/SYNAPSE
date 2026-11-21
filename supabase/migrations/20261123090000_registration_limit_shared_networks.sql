/*
  # Registering: a fairer limit for people on the same network

  Mobile networks (MTN, Airtel, Glo…) put many customers behind one shared internet address, and
  so does a church's or venue's Wi-Fi. At most 20 registrations in 10 minutes from one address could
  turn real people away when a link spreads in WhatsApp groups. The limit is now 200 in 10 minutes
  from one address: still a stop for a robot filling the form, never for a crowd.
  The limit per registration type (60 a minute) and on "email my ticket again" stay as they are.
  Safe to run more than once.
*/

CREATE OR REPLACE FUNCTION event_registration_limit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF event_visitor_ip() IS NOT NULL AND NOT event_is_organiser(NEW.event_id)
     AND NOT event_visitor_allowed('register', 200, interval '10 minutes') THEN
    RAISE EXCEPTION 'busy';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_registration_limit() FROM PUBLIC, anon, authenticated;
