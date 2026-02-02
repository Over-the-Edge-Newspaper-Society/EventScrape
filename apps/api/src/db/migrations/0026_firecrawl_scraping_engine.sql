-- Add Firecrawl as an alternative scraping engine
-- Sources can choose between 'playwright' (default) and 'firecrawl'

-- Add scraping_engine column to sources
ALTER TABLE "sources"
ADD COLUMN IF NOT EXISTS "scraping_engine" text NOT NULL DEFAULT 'playwright';

-- Add firecrawl_api_key to system_settings
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "firecrawl_api_key" text;
