-- Allow anon (public booking page) to look up existing contacts by email
-- so the booking flow can update an existing contact instead of duplicating.
CREATE POLICY "contacts_public_select"
  ON contacts FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow anon (public booking page) to insert confirmation messages
-- after a booking is created.
CREATE POLICY "messages_public_insert"
  ON messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow anon to update contacts (e.g. last_activity_at) when a returning
-- visitor books again.
CREATE POLICY "contacts_public_update"
  ON contacts FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
