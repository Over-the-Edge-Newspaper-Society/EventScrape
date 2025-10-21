-- Add global scraper type settings to instagram_settings
ALTER TABLE "instagram_settings"
  ADD COLUMN IF NOT EXISTS "default_scraper_type" "instagram_scraper_type" DEFAULT 'instagram-private-api',
  ADD COLUMN IF NOT EXISTS "allow_per_account_override" boolean DEFAULT true;

-- Update existing settings row if it exists
UPDATE "instagram_settings"
SET
  "default_scraper_type" = COALESCE("default_scraper_type", 'instagram-private-api'),
  "allow_per_account_override" = COALESCE("allow_per_account_override", true),
  "updated_at" = NOW()
WHERE "default_scraper_type" IS NULL OR "allow_per_account_override" IS NULL;
