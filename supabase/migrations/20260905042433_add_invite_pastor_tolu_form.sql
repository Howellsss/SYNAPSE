/*
# Create "Invite Pastor Tolu" form

1. New Tables
   - None
2. Changes
   - Creates a new form record "Invite Pastor Tolu" for the Pastor Tolu workspace
   - Adds 7 form fields matching the spec: Organisation/Church Name, Contact Person Email,
     Event Title, Proposed Event Date, Expected Attendance (dropdown), Venue Physical Address,
     Brief Event Overview
3. Security
   - No new tables, no RLS changes needed
4. Notes
   - This form is used by the "Invite Pastor Tolu" tab on the Pastor Tolu group booking page
   - Form submissions are saved to the existing form_submissions table
*/

INSERT INTO forms (id, name, description, workspace_id)
VALUES (
  'd1a00000-0000-4000-8000-000000000001',
  'Invite Pastor Tolu',
  'Form for inviting Pastor Tolu to speak at an event',
  'c505e65d-b276-499f-ba27-4cd4dcc4a184'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO form_fields (form_id, label, field_type, sort_order, required, placeholder, options, help_text, mapped_field)
VALUES
  ('d1a00000-0000-4000-8000-000000000001', 'Organisation/Church Name', 'text', 0, true, 'Enter organisation or church name', NULL, NULL, NULL),
  ('d1a00000-0000-4000-8000-000000000001', 'Contact Person Email', 'email', 1, true, 'you@example.com', NULL, NULL, NULL),
  ('d1a00000-0000-4000-8000-000000000001', 'Event Title', 'text', 2, true, 'Name of the event', NULL, NULL, NULL),
  ('d1a00000-0000-4000-8000-000000000001', 'Proposed Event Date', 'date', 3, true, NULL, NULL, NULL, NULL),
  ('d1a00000-0000-4000-8000-000000000001', 'Expected Attendance', 'dropdown', 4, true, NULL, '["Under 50", "50-100", "100-500", "500-1000", "1000+"]', NULL, NULL),
  ('d1a00000-0000-4000-8000-000000000001', 'Venue Physical Address', 'long_text', 5, true, 'Full address of the venue', NULL, NULL, NULL),
  ('d1a00000-0000-4000-8000-000000000001', 'Brief Event Overview', 'long_text', 6, true, 'Tell us about your event...', NULL, NULL, NULL)
ON CONFLICT DO NOTHING;
