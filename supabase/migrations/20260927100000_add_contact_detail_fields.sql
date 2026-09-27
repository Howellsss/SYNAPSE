/*
  # Contact detail fields for the Add Contact form

  Adds the fields the redesigned Add Contact form collects:
  - additional_emails  text[]  : emails beyond the primary one (primary stays in `email`)
  - phone_type         text    : type of the primary phone (mobile, home, work, other)
  - additional_phones  jsonb   : [{ "type": "mobile", "number": "+234 803 552 3054" }, ...]
  - contact_type       text    : 'lead' or 'customer'
  - timezone           text    : IANA time zone, e.g. 'Africa/Lagos'
  - dnd_all            boolean : do not disturb on every channel
  - dnd_channels       text[]  : any of 'email', 'sms', 'calls', 'inbound'
*/

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS additional_emails text[] NOT NULL DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_type text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS additional_phones jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_type text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dnd_all boolean NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dnd_channels text[] NOT NULL DEFAULT '{}';

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type IS NULL OR contact_type IN ('lead', 'customer'));

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_type_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_phone_type_check
  CHECK (phone_type IS NULL OR phone_type IN ('mobile', 'home', 'work', 'other'));

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_dnd_channels_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_dnd_channels_check
  CHECK (dnd_channels <@ ARRAY['email', 'sms', 'calls', 'inbound']::text[]);
