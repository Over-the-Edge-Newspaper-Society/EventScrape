ALTER TABLE "instagram_settings"
ADD COLUMN IF NOT EXISTS "auto_classify_with_ai" boolean DEFAULT false;

UPDATE "instagram_settings"
SET "auto_classify_with_ai" = COALESCE("auto_classify_with_ai", false);
