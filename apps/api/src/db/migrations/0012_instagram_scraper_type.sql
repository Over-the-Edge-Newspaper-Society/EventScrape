-- Migration 0012: Add Instagram scraper type field
-- Allows choosing between Apify and instagram-private-api for scraping

-- Create enum for Instagram scraper types
DO $$ BEGIN
  CREATE TYPE instagram_scraper_type AS ENUM('apify', 'instagram-private-api');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add instagram_scraper_type column to sources table
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS instagram_scraper_type instagram_scraper_type DEFAULT 'instagram-private-api';

-- Add comment
COMMENT ON COLUMN sources.instagram_scraper_type IS 'Instagram scraper backend: apify (reliable, paid) or instagram-private-api (free, requires session)';
