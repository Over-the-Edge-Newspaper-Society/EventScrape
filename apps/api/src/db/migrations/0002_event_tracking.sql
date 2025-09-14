-- Event tracking enhancements
ALTER TABLE events_raw 
  ADD COLUMN IF NOT EXISTS last_updated_by_run_id UUID REFERENCES runs(id);

ALTER TABLE events_raw 
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS events_raw_last_seen_at_idx ON events_raw(last_seen_at);

