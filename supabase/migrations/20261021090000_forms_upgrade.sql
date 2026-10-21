/*
  # Forms and surveys: quiz scores, disqualified leads, payments, where people came from, emails

  Each submission keeps its quiz score and result, whether logic disqualified the person, the
  payment taken with it (Stripe Checkout), and where they came from (utm tags, ?source=, the page
  that sent them). Form notification emails are queued as messages linked to their submission and
  sent by the same mailer as workflow emails. Safe to run more than once.

  1. form_submissions: meta, score / score_max / score_percent / quiz_result, disqualified,
     payment_status / payment_amount / payment_currency / stripe_session_id
  2. messages.form_submission_id: the submission a queued email belongs to
*/

ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score numeric;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score_max numeric;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS score_percent integer;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS quiz_result text;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS disqualified boolean NOT NULL DEFAULT false;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'none';
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_amount integer;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS payment_currency text;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS stripe_session_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_payment_status_check') THEN
    ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_payment_status_check
      CHECK (payment_status IN ('none', 'pending', 'paid', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created ON form_submissions(form_id, created_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS form_submission_id uuid REFERENCES form_submissions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_form_queued ON messages(created_at) WHERE status = 'queued' AND form_submission_id IS NOT NULL;
