-- Instagram Integration Migration

-- Create enums for Instagram support
DO $$ BEGIN
  CREATE TYPE source_type AS ENUM('website', 'instagram');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE classification_mode AS ENUM('manual', 'auto');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add Instagram-specific columns to sources table
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS source_type source_type NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS instagram_username TEXT,
  ADD COLUMN IF NOT EXISTS classification_mode classification_mode DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_checked TIMESTAMP;

-- Create index on instagram_username for faster lookups
CREATE INDEX IF NOT EXISTS sources_instagram_username_idx ON sources(instagram_username);

-- Add Instagram-specific columns to events_raw table
ALTER TABLE events_raw
  ADD COLUMN IF NOT EXISTS instagram_post_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_caption TEXT,
  ADD COLUMN IF NOT EXISTS local_image_path TEXT,
  ADD COLUMN IF NOT EXISTS classification_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_event_poster BOOLEAN;

-- Create index on instagram_post_id for faster lookups
CREATE INDEX IF NOT EXISTS events_raw_instagram_post_id_idx ON events_raw(instagram_post_id);

-- Create instagram_sessions table for storing Instagram authentication
CREATE TABLE IF NOT EXISTS instagram_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  session_data JSONB NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  last_used_at TIMESTAMP,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE
);

-- Create unique index on username
CREATE UNIQUE INDEX IF NOT EXISTS instagram_sessions_username_idx ON instagram_sessions(username);
