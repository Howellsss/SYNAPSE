-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- New address (22 November 2026): links in emails, tickets and invitations use https://synapseconnector.com.
-- Run database-updates-19.sql first, and only once synapseconnector.com opens the app. Safe to run more than once.
-- Made from supabase/migrations/20261122090000_domain_synapseconnector.sql; don't edit here.

/*
  # SYNAPSE moves to synapseconnector.com

  Links SYNAPSE writes from now on (ticket links and QR codes, door passes, invitations, meeting
  invites, contact links in workflow emails) use https://synapseconnector.com instead of
  https://synapse-dj3a.vercel.app. The old address forwards to the new one (set in Vercel), so
  tickets and links already sent keep working.

  Also moves posters and logos stored with the old address to the new one.
  Run only once synapseconnector.com opens the app. Safe to run more than once.
*/

INSERT INTO wf_private.settings(key, value) VALUES ('app_url', 'https://synapseconnector.com')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION wf_app_url() RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT rtrim(coalesce((SELECT value FROM wf_private.settings WHERE key = 'app_url'), 'https://synapseconnector.com'), '/');
$$;
REVOKE ALL ON FUNCTION wf_app_url() FROM PUBLIC, anon, authenticated;

UPDATE events SET cover_url = replace(cover_url, 'https://synapse-dj3a.vercel.app/', 'https://synapseconnector.com/')
WHERE cover_url LIKE 'https://synapse-dj3a.vercel.app/%';
UPDATE events SET organiser_logo_url = replace(organiser_logo_url, 'https://synapse-dj3a.vercel.app/', 'https://synapseconnector.com/')
WHERE organiser_logo_url LIKE 'https://synapse-dj3a.vercel.app/%';
