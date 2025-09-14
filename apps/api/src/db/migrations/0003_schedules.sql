-- Schedules for automated runs
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id),
  cron TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/Vancouver' NOT NULL,
  active BOOLEAN DEFAULT TRUE NOT NULL,
  repeat_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS schedules_source_id_idx ON schedules(source_id);
CREATE INDEX IF NOT EXISTS schedules_active_idx ON schedules(active);

