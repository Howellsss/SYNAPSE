-- ONE FILE TO PASTE into Supabase → SQL Editor → Run.
-- Event times (24 November 2026): a time note like "Doors open 3:30 pm · Main event 4:00 pm", and the
-- choice to hide the finish time. Run database-updates-21.sql first. Safe to run more than once.
-- Made from supabase/migrations/20261124090000_event_time_note.sql; don't edit here.

/*
  # Events: a time note, and the choice to hide the finish time

  Some posters give times like "Doors open 3:30 pm · Main event 4:00 pm" and no finish time.
    - events.time_note: shown after the date instead of a time range (optional).
    - events.show_end_time: false hides the finish time on the event pages and tickets.
  The finish time (ends_at) is still needed behind the scenes: registration closes then, and door
  passes stop working 12 hours after. Both new fields are in the public event data.
  Safe to run more than once.
*/

ALTER TABLE events ADD COLUMN IF NOT EXISTS time_note text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_end_time boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION event_public_json(e events)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'organiser_id', e.workspace_id, 'slug', e.slug, 'title', e.title,
    'summary', e.summary, 'description', e.description, 'category', e.category,
    'cover_url', e.cover_url, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
    'timezone', e.timezone, 'mode', e.mode, 'venue_name', e.venue_name,
    'address', e.address, 'city', e.city, 'status', e.status, 'visibility', e.visibility,
    'organiser_name', coalesce(nullif(e.organiser_name, ''), (SELECT w.name FROM workspaces w WHERE w.id = e.workspace_id), ''),
    'organiser_logo_url', e.organiser_logo_url, 'tagline', e.tagline, 'programme', to_jsonb(e.programme), 'brand', e.brand,
    'questions', e.questions,
    'time_note', nullif(btrim(coalesce(e.time_note, '')), ''), 'show_end_time', e.show_end_time,
    'registered', (SELECT count(*) FROM event_registrations r WHERE r.event_id = e.id AND event_holds_place(r.status)),
    'tickets', event_ticket_list(e.id)
  );
$$;
REVOKE ALL ON FUNCTION event_public_json(events) FROM PUBLIC;
