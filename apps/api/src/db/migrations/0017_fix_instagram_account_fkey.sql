-- Fix migration 0014 issues
-- This migration cleans up any orphaned foreign key references and ensures data consistency

-- First, check if the foreign key constraint exists and drop it if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'events_raw_instagram_account_id_fkey'
    ) THEN
        ALTER TABLE "events_raw" DROP CONSTRAINT "events_raw_instagram_account_id_fkey";
    END IF;
END $$;

-- Clean up any NULL or invalid instagram_account_id values in events_raw
UPDATE "events_raw"
SET "instagram_account_id" = NULL
WHERE "instagram_account_id" IS NOT NULL
  AND "instagram_account_id" NOT IN (SELECT "id" FROM "instagram_accounts");

-- Ensure instagram_accounts table exists and has the right structure
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

-- Create indexes if they don't exist
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_accounts_username_idx" ON "instagram_accounts" ("instagram_username");
CREATE INDEX IF NOT EXISTS "instagram_accounts_active_idx" ON "instagram_accounts" ("active");

-- Ensure the column exists (without the foreign key for now)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'events_raw' AND column_name = 'instagram_account_id'
    ) THEN
        ALTER TABLE "events_raw" ADD COLUMN "instagram_account_id" uuid;
    END IF;
END $$;

-- Migrate existing Instagram sources to instagram_accounts (if not already done)
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
  AND NOT EXISTS (
    SELECT 1 FROM "instagram_accounts" ia
    WHERE ia."instagram_username" = "sources"."instagram_username"
  )
ON CONFLICT ("instagram_username") DO NOTHING;

-- Update events_raw to reference instagram_accounts
UPDATE "events_raw" er
SET "instagram_account_id" = s."id"
FROM "sources" s
WHERE er."source_id" = s."id"
  AND s."source_type" = 'instagram'
  AND s."instagram_username" IS NOT NULL
  AND er."instagram_account_id" IS NULL;

-- Now add the foreign key constraint
ALTER TABLE "events_raw"
ADD CONSTRAINT "events_raw_instagram_account_id_fkey"
FOREIGN KEY ("instagram_account_id")
REFERENCES "instagram_accounts"("id");

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
DELETE FROM "sources"
WHERE "source_type" = 'instagram'
AND "id" != 'ffffffff-ffff-ffff-ffff-ffffffffffff';
