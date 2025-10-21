-- Create instagram_accounts table
CREATE TABLE IF NOT EXISTS "instagram_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "instagram_username" text NOT NULL UNIQUE,
  "classification_mode" "classification_mode" DEFAULT 'manual' NOT NULL,
  "instagram_scraper_type" "instagram_scraper_type" DEFAULT 'instagram-private-api' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "default_timezone" text DEFAULT 'America/Vancouver' NOT NULL,
  "notes" text,
  "last_checked" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_accounts_username_idx" ON "instagram_accounts" ("instagram_username");
CREATE INDEX IF NOT EXISTS "instagram_accounts_active_idx" ON "instagram_accounts" ("active");

-- Add instagram_account_id to events_raw table
ALTER TABLE "events_raw" ADD COLUMN IF NOT EXISTS "instagram_account_id" uuid REFERENCES "instagram_accounts"("id");

-- Migrate existing Instagram sources to instagram_accounts
INSERT INTO "instagram_accounts" (
  "id",
  "name",
  "instagram_username",
  "classification_mode",
  "instagram_scraper_type",
  "active",
  "default_timezone",
  "notes",
  "last_checked",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "name",
  "instagram_username",
  COALESCE("classification_mode", 'manual'),
  COALESCE("instagram_scraper_type", 'instagram-private-api'),
  COALESCE("active", true),
  COALESCE("default_timezone", 'America/Vancouver'),
  "notes",
  "last_checked",
  "created_at",
  "updated_at"
FROM "sources"
WHERE "source_type" = 'instagram'
  AND "instagram_username" IS NOT NULL
ON CONFLICT ("instagram_username") DO NOTHING;

-- Update events_raw to reference instagram_accounts
UPDATE "events_raw" er
SET "instagram_account_id" = s."id"
FROM "sources" s
WHERE er."source_id" = s."id"
  AND s."source_type" = 'instagram'
  AND s."instagram_username" IS NOT NULL;

-- Create or update the single "Instagram" source
INSERT INTO "sources" (
  "id",
  "name",
  "base_url",
  "module_key",
  "source_type",
  "active",
  "default_timezone",
  "notes",
  "created_at",
  "updated_at"
)
VALUES (
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'Instagram',
  'https://instagram.com',
  'instagram',
  'instagram',
  true,
  'America/Vancouver',
  'General Instagram source - manage individual accounts via Instagram Sources page',
  now(),
  now()
)
ON CONFLICT ("module_key") DO UPDATE SET
  "name" = 'Instagram',
  "source_type" = 'instagram',
  "notes" = 'General Instagram source - manage individual accounts via Instagram Sources page';

-- Update all Instagram events to use the single Instagram source
UPDATE "events_raw"
SET "source_id" = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
WHERE "instagram_account_id" IS NOT NULL;

-- Update all runs for Instagram sources to reference the single Instagram source
UPDATE "runs"
SET "source_id" = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
WHERE "source_id" IN (
  SELECT "id" FROM "sources"
  WHERE "source_type" = 'instagram'
  AND "id" != 'ffffffff-ffff-ffff-ffff-ffffffffffff'
);

-- Update all schedules for Instagram sources to reference the single Instagram source
UPDATE "schedules"
SET "source_id" = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
WHERE "source_id" IN (
  SELECT "id" FROM "sources"
  WHERE "source_type" = 'instagram'
  AND "id" != 'ffffffff-ffff-ffff-ffff-ffffffffffff'
);

-- Delete old Instagram sources from sources table (keep only the single Instagram source)
DELETE FROM "sources" WHERE "source_type" = 'instagram' AND "id" != 'ffffffff-ffff-ffff-ffff-ffffffffffff';
