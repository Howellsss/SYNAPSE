# UNSCATHED: set-up and acceptance test

Run this in the live app, top to bottom. Tick each step. When a step doesn't do what the
**Expect** line says, note the step number and what you saw (a screenshot helps), and send it back.

You need two browsers or devices: one signed in as the organiser, one signed out (or private
window) as a guest. A phone is needed for the door scanner. Use two real email addresses you can
read (e.g. a personal Gmail with `+guest1`, `+performer1`).

---

## 0. Before you start (once)

- [ ] **0.1** Supabase → SQL Editor: run `supabase/check-missing-updates.sql`.
  **Expect:** nothing missing. If something is listed, run the paste files it names, in number
  order (`database-updates-12.sql` to `-17.sql` are the newest).
- [ ] **0.2** Supabase → Edge Functions: `send-email`, `form-submit` and `livekit-token` are deployed
  (redeploy `livekit-token` and `send-email` after `-15`).
- [ ] **0.3** Supabase → Database → Extensions: `pg_cron` and `pg_net` are on.
- [ ] **0.4** SYNAPSE → Settings → Email: an email account is connected.
  **Expect:** it shows as connected. Without it, no tickets or reminders are sent.
- [ ] **0.5** Supabase plan or usage sorted before 13 November, and a backup taken.

## 1. The two forms

- [ ] **1.1** Forms → New form → **UNSCATHED – Attendee**. Fields: Full name, Email, Phone
  (+234), and a Consent tick box. Save.
- [ ] **1.2** Forms → New form → **UNSCATHED – Performer application**. Fields: Full name, Email,
  Phone, "Your art" (dropdown: Spoken Word, Music, Other), "Link to your work" (short answer),
  Consent. Save.
  **Expect:** both show in Forms, and Preview shows each one as a visitor would see it.

## 2. The event

- [ ] **2.1** Events → **New event**.
  - Basics: Title **UNSCATHED**, Tagline **Words. Sound. Style.**, Programme: Spoken Word, Music.
  - Date & time: leave the date empty for now (to be announced).
  - Location: Venue **Light Nation**, City **Port Harcourt**.
  - Poster: upload the poster (PNG/JPG/WebP, up to 8 MB).
  - Branding & privacy: main and accent colours, organiser logo, and the privacy notice.
- [ ] **2.2** Tickets & registration → **Add ticket** twice (each with **Status: Open**):
  - **Attendee**, web address `register`, form "UNSCATHED – Attendee".
  - **Performer application**, web address `apply`, form "UNSCATHED – Performer application",
    **People apply; you choose**.
- [ ] **2.3** Emails: look at each one (confirmation, application received, selected, reminder).
  Leave **Send a reminder the day before** ticked.
- [ ] **2.4** Who can find it: **Public** (or **Unlisted** if only people with the link should see
  it). Save, then **Publish** on the manage page.
  **Expect:** **View page** shows the event with "Date to be announced", the poster, and both
  registration types.

## 3. A guest registers (signed-out browser)

- [ ] **3.1** Open `…/#/e/unscathed/register`. Fill the form with guest email 1. Submit.
  **Expect:** "Your ticket code" (like `UNS-7K4Q`) and **Open my ticket**.
- [ ] **3.2** Open the ticket.
  **Expect:** the QR code, ticket code and check-in PIN, in the event's colours.
- [ ] **3.3** Check guest email 1 (within a few minutes, and the spam folder).
  **Expect:** one branded confirmation email with the QR code and ticket code.
- [ ] **3.4** Register again with the same email.
  **Expect:** "You're already registered", and no second registration.
- [ ] **3.5** On the event page, **Lost your ticket?** with guest email 1.
  **Expect:** the ticket email arrives again. Try an email that never registered: the page
  says the same thing, and nothing is sent.

## 4. A performer applies and is chosen

- [ ] **4.1** Signed out: open `…/#/e/unscathed/apply`, fill it with performer email 1. Submit.
  **Expect:** "Application received". No ticket yet. An "application received" email arrives.
- [ ] **4.2** Organiser: manage page → **Applications** → **Open the review board**.
  **Expect:** the application, with their answers (art, link).
- [ ] **4.3** **Shortlist**, then **Select**.
  **Expect:** a "selected" email with their ticket arrives at performer email 1.
- [ ] **4.4** Apply with performer email 2, then **Decline** it.
  **Expect:** it shows as declined and no ticket is sent.

## 5. The organiser's dashboard

- [ ] **5.1** Manage page: **By registration type** and **Latest registrations**.
  **Expect:** 1 attendee and 2 performer applications (1 selected, 1 declined).
- [ ] **5.2** **See all registrations**: filter by type, status and check-in.
- [ ] **5.3** **Add someone** (by hand) as an Attendee with a third email.
  **Expect:** they're added and get a ticket email.
- [ ] **5.4** **Export registrations (CSV)**.
  **Expect:** a file that opens in Excel or Sheets, with one row per person and their answers.
- [ ] **5.5** Forms → "UNSCATHED – Attendee" → submissions.
  **Expect:** the registrations' answers are there too, and each person is in Contacts.

## 6. The door

- [ ] **6.1** Manage page → **Check-in team**: switch on a team member who does **not** have Events
  access (invite them in Settings → Team first if needed). **Copy link for your team** and send
  it to them.
- [ ] **6.2** On their phone, signed in as them: open the link.
  **Expect:** the door scanner opens (and nothing else of Events).
- [ ] **6.3** **Start scanning** and point at guest 1's QR code.
  **Expect:** green, "checked in", with their name.
- [ ] **6.3b** Or with the phone's own camera: on that phone, sign in to SYNAPSE once in its normal
  browser (Safari or Chrome) as the team member. Then point the camera at a ticket's QR and tap the link.
  **Expect:** the screen turns green with the guest's name: they're checked in. Not signed in, or not
  on the team, the same link just shows the ticket.
- [ ] **6.3c** Door pass (a volunteer without an account): manage page → **Door scanners** → add a
  name and an email you can read → **Send pass**. On a phone, open the pass email's link in Safari
  (iPhone) or Chrome (Android). **Expect:** a green "This phone is a scanner" page. Then scan a
  ticket's QR with that phone's camera and tap the link: green, checked in. Remove the pass on the
  manage page and scan again: the ticket just shows (that phone can't check anyone in any more).
- [ ] **6.4** Scan the same QR again.
  **Expect:** "Already checked in", with the time (not a second check-in).
- [ ] **6.5** **Can't scan? Find them**: search for the selected performer by name. **Check in**.
  Then **Undo**.
  **Expect:** checked in, then back to not checked in.
- [ ] **6.6** Turn the phone's Wi-Fi and data off, try a check-in.
  **Expect:** "No connection" in red; it doesn't say green until the connection is back.
- [ ] **6.7** Manage page → **Latest scans**.
  **Expect:** the scans from 6.3–6.5, with who scanned them.

## 7. Privacy

- [ ] **7.1** Sign in as a team member **without** Events access and open Events in the menu.
  **Expect:** they can't see Events or any registration (names, emails, answers).
- [ ] **7.2** As that member, Contacts (if they have it) still works as before.

## 8. The reminder (needs a date)

- [ ] **8.1** Edit → Date & time: set the event to start in about **23 hours** (and an end). Save.
- [ ] **8.2** Wait up to 15 minutes.
  **Expect:** a "Tomorrow: UNSCATHED" email with the ticket to everyone who holds a place and
  registered more than a day before. People who registered today won't get one (that's on
  purpose); to test it, change one test registration's date in Supabase or wait a day.
- [ ] **8.3** Set the real date and time afterwards. Moving the date sends a new reminder the day
  before the new date.

## 9. Clean up and go live

- [ ] **9.1** Cancel the test registrations (registration → **Cancel this registration**), or delete
  and recreate the event if you prefer a clean dashboard.
- [ ] **9.2** Set the real date, check every email's wording once more, and share
  `…/#/e/unscathed` (event page), `…/register` and `…/apply`.
- [ ] **9.3** On the day: the check-in team opens the scanner link on their phones before doors open.

---

## Handover: where things are

| What | Where |
|---|---|
| Event page | `/#/e/unscathed` |
| Registration pages | `/#/e/unscathed/register`, `/#/e/unscathed/apply` |
| A guest's ticket | `/#/e/ticket/<token>` (linked from their email) |
| Manage the event | Events → UNSCATHED |
| Review performers | Manage page → Applications → Open the review board |
| Door scanner | Manage page → Door scanner → Open the scanner (or the team link) |
| Email wording | Edit → Emails |
| Answers and contacts | Forms → the form's submissions; Contacts |

No payments are taken through SYNAPSE. "Mark paid" on a registration is only a note for the
organiser.
