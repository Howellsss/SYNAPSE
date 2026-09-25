-- RPC to get submission counts for a list of form IDs
CREATE OR REPLACE FUNCTION get_form_submission_counts(form_ids uuid[])
RETURNS TABLE(form_id uuid, count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT form_id, COUNT(*) as count
  FROM form_submissions
  WHERE form_id = ANY(form_ids)
  GROUP BY form_id;
$$;

GRANT EXECUTE ON FUNCTION get_form_submission_counts(uuid[]) TO authenticated;
