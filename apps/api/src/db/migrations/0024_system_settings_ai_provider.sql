-- Add AI provider columns to system_settings table
-- Note: ai_provider enum type was already created in migration 0023

-- Add AI provider selection column with default 'gemini'
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "ai_provider" ai_provider DEFAULT 'gemini';

-- Add Gemini API key column
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "gemini_api_key" text;

-- Add Claude API key column
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "claude_api_key" text;
