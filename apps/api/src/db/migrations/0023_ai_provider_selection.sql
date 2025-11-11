-- Create AI provider enum type
CREATE TYPE ai_provider AS ENUM ('gemini', 'claude');

-- Add AI provider selection column with default 'gemini'
ALTER TABLE "instagram_settings"
ADD COLUMN IF NOT EXISTS "ai_provider" ai_provider DEFAULT 'gemini';

-- Add Claude API key column
ALTER TABLE "instagram_settings"
ADD COLUMN IF NOT EXISTS "claude_api_key" text;

-- Add Claude prompt column
ALTER TABLE "instagram_settings"
ADD COLUMN IF NOT EXISTS "claude_prompt" text;

-- Set existing records to use 'gemini' provider (since that's what we've been using)
UPDATE "instagram_settings"
SET "ai_provider" = 'gemini'
WHERE "ai_provider" IS NULL;
