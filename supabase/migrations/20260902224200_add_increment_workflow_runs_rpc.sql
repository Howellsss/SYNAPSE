/*
# Add increment_workflow_runs RPC function

1. New Functions
- `increment_workflow_runs(uuid)`: Atomically increments the `total_runs` column by 1
  and sets `last_run_at` to now() for the given workflow ID. Returns the new run count.
  This is called by the workflow engine after each execution.

2. Security
- SECURITY DEFINER so it can run with elevated privileges for the atomic update.
- Granted EXECUTE to authenticated role.
*/

CREATE OR REPLACE FUNCTION increment_workflow_runs(workflow_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  UPDATE workflows
  SET total_runs = total_runs + 1,
      last_run_at = now()
  WHERE id = workflow_id
  RETURNING total_runs INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION increment_workflow_runs(uuid) TO authenticated;
