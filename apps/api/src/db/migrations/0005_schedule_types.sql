-- Add schedule type support for WordPress exports
CREATE TYPE schedule_type AS ENUM ('scrape', 'wordpress_export');

-- Add new columns to schedules table
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS schedule_type schedule_type NOT NULL DEFAULT 'scrape',
  ADD COLUMN IF NOT EXISTS wordpress_settings_id uuid REFERENCES wordpress_settings(id),
  ADD COLUMN IF NOT EXISTS config jsonb;

-- Make source_id nullable since WordPress exports don't need a source
ALTER TABLE schedules
  ALTER COLUMN source_id DROP NOT NULL;

-- Add check constraint to ensure proper configuration
ALTER TABLE schedules
  ADD CONSTRAINT schedules_config_check
  CHECK (
    (schedule_type = 'scrape' AND source_id IS NOT NULL AND wordpress_settings_id IS NULL) OR
    (schedule_type = 'wordpress_export' AND wordpress_settings_id IS NOT NULL)
  );
