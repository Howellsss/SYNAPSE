/*
  # Email details on messages

  The contact page's email composer records who it is from, who it goes to
  (including CC/BCC) and the formatted body, ready for an email provider.

  - from_email  text   : sender address
  - from_name   text   : sender display name
  - to_address  text   : recipient email or phone number
  - cc          text[] : CC addresses
  - bcc         text[] : BCC addresses
  - body_html   text   : formatted email body (body keeps the plain-text version)
*/

ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_email text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_name text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_address text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cc text[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS bcc text[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_html text;
