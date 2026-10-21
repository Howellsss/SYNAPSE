-- Forms start workflows ("Form submitted") even when the contact is linked just after the response is saved.
CREATE OR REPLACE FUNCTION wf_on_form_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.contact_id IS NULL) THEN
    PERFORM wf_emit(NEW.workspace_id, 'form_submitted', NEW.contact_id, jsonb_build_object('form_id', NEW.form_id, 'submission_id', NEW.id));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS wf_form_events ON form_submissions;
CREATE TRIGGER wf_form_events AFTER INSERT OR UPDATE OF contact_id ON form_submissions FOR EACH ROW EXECUTE FUNCTION wf_on_form_submission();
