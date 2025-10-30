ALTER TABLE runs
  ADD COLUMN parent_run_id uuid REFERENCES runs(id),
  ADD COLUMN metadata jsonb;

CREATE INDEX IF NOT EXISTS runs_parent_run_id_idx
  ON runs(parent_run_id);
