-- Add OpenRouter as an AI provider option

-- Add 'openrouter' to the ai_provider enum
ALTER TYPE ai_provider ADD VALUE IF NOT EXISTS 'openrouter';

-- Add OpenRouter API key column
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "openrouter_api_key" text;

-- Add OpenRouter model selection column (stores the model ID like 'google/gemini-2.0-flash-exp')
ALTER TABLE "system_settings"
ADD COLUMN IF NOT EXISTS "openrouter_model" text DEFAULT 'google/gemini-2.0-flash-exp';
