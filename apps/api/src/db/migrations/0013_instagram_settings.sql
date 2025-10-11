-- Migration 0013: Add Instagram settings table for global configuration
-- Stores API keys (Apify, Gemini), scraping config, and automation settings

-- Create instagram_settings table
CREATE TABLE IF NOT EXISTS instagram_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- API keys (should be encrypted in production)
  apify_api_token TEXT,
  gemini_api_key TEXT,

  -- Scraping configuration
  apify_actor_id TEXT DEFAULT 'apify/instagram-profile-scraper',
  apify_results_limit INTEGER DEFAULT 10,
  fetch_delay_minutes INTEGER DEFAULT 5,

  -- Automation settings
  auto_extract_new_posts BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add comment
COMMENT ON TABLE instagram_settings IS 'Global Instagram scraping configuration including API keys and automation settings';

-- Insert default settings row
INSERT INTO instagram_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;
