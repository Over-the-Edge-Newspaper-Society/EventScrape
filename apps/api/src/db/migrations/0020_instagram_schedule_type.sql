-- Extend schedule_type enum to support Instagram scraping schedules
ALTER TYPE schedule_type ADD VALUE IF NOT EXISTS 'instagram_scrape';

-- Update schedules configuration constraint for the new schedule type
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_config_check;

ALTER TABLE schedules
  ADD CONSTRAINT schedules_config_check
  CHECK (
    (schedule_type = 'scrape' AND source_id IS NOT NULL AND wordpress_settings_id IS NULL)
    OR (schedule_type = 'wordpress_export' AND wordpress_settings_id IS NOT NULL)
    OR (schedule_type = 'instagram_scrape' AND source_id IS NULL AND wordpress_settings_id IS NULL)
  );
