-- Migration: Add event series and occurrences tables to support TEC occurrence types
-- This migration adds support for:
-- 1. Single-day events
-- 2. Multi-day events
-- 3. All-day events
-- 4. Recurring events (series)
-- 5. Virtual/online events
-- 6. Event status types (scheduled, canceled, postponed)

-- Create new enums
CREATE TYPE occurrence_type AS ENUM (
  'single',      -- Single-day event
  'multi_day',   -- Spans multiple consecutive days
  'all_day',     -- All-day event (no specific times)
  'recurring',   -- Part of a recurring series
  'virtual'      -- Virtual/online event
);

CREATE TYPE recurrence_type AS ENUM (
  'none',        -- Not recurring
  'daily',       -- Daily recurrence
  'weekly',      -- Weekly recurrence
  'monthly',     -- Monthly recurrence
  'yearly',      -- Yearly recurrence
  'custom'       -- Custom RRULE pattern
);

CREATE TYPE event_status_type AS ENUM (
  'scheduled',   -- Event is confirmed and happening
  'canceled',    -- Event has been canceled
  'postponed'    -- Event has been postponed
);

-- Create event_series table (parent/master events)
CREATE TABLE event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  last_updated_by_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,

  -- Source identification
  source_event_id TEXT, -- Original ID from source website

  -- Basic event info
  title TEXT NOT NULL,
  description_html TEXT,

  -- Event classification
  occurrence_type occurrence_type NOT NULL DEFAULT 'single',
  event_status event_status_type NOT NULL DEFAULT 'scheduled',
  status_reason TEXT, -- Reason for canceled/postponed

  -- Recurrence info
  recurrence_type recurrence_type NOT NULL DEFAULT 'none',
  recurrence_pattern TEXT, -- RRULE or RDATE pattern if detectable

  -- All-day flag
  is_all_day BOOLEAN NOT NULL DEFAULT false,

  -- Virtual event info
  is_virtual BOOLEAN NOT NULL DEFAULT false,
  virtual_url TEXT,

  -- Location info (inherited by occurrences)
  venue_name TEXT,
  venue_address TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,

  -- Organization info
  organizer TEXT,
  category TEXT,
  price TEXT,
  tags JSONB,

  -- Primary URL
  url_primary TEXT NOT NULL,
  image_url TEXT,

  -- Metadata
  raw JSONB NOT NULL, -- Original scraped data
  content_hash TEXT NOT NULL, -- For change detection

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Indexes will be added below
  CONSTRAINT event_series_source_event_id_unique
    UNIQUE NULLS NOT DISTINCT (source_id, source_event_id)
);

-- Create event_occurrences table (individual instances)
-- Modeled after TEC's tec_occurrences table
CREATE TABLE event_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Series relationship
  series_id UUID NOT NULL REFERENCES event_series(id) ON DELETE CASCADE,

  -- Occurrence identification
  occurrence_hash TEXT NOT NULL, -- For deduplication: hash(series_id + start + end)
  sequence INTEGER NOT NULL DEFAULT 1, -- Position in series (1, 2, 3...)

  -- Date/time info (local timezone)
  start_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
  end_datetime TIMESTAMP WITH TIME ZONE,

  -- Date/time info (UTC for efficient querying)
  start_datetime_utc TIMESTAMP WITH TIME ZONE NOT NULL,
  end_datetime_utc TIMESTAMP WITH TIME ZONE,

  -- Duration
  duration_seconds INTEGER, -- Event duration in seconds

  -- Timezone
  timezone TEXT NOT NULL,

  -- Recurrence metadata
  has_recurrence BOOLEAN NOT NULL DEFAULT false,
  is_provisional BOOLEAN NOT NULL DEFAULT false, -- Tentative/provisional date

  -- Override fields (can override series defaults for this occurrence)
  title_override TEXT,
  description_override TEXT,
  venue_name_override TEXT,
  venue_address_override TEXT,
  event_status_override event_status_type,
  status_reason_override TEXT,

  -- Source-specific metadata
  raw JSONB, -- Occurrence-specific raw data

  -- Tracking
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Unique constraint: one occurrence per series per hash
  CONSTRAINT event_occurrences_occurrence_hash_unique UNIQUE (occurrence_hash)
);

-- Create indexes for event_series
CREATE INDEX event_series_source_id_idx ON event_series(source_id);
CREATE INDEX event_series_run_id_idx ON event_series(run_id);
CREATE INDEX event_series_occurrence_type_idx ON event_series(occurrence_type);
CREATE INDEX event_series_recurrence_type_idx ON event_series(recurrence_type);
CREATE INDEX event_series_event_status_idx ON event_series(event_status);
CREATE INDEX event_series_is_virtual_idx ON event_series(is_virtual);
CREATE INDEX event_series_city_idx ON event_series(city);
CREATE INDEX event_series_content_hash_idx ON event_series(content_hash);
CREATE INDEX event_series_created_at_idx ON event_series(created_at);

-- Create indexes for event_occurrences
CREATE INDEX event_occurrences_series_id_idx ON event_occurrences(series_id);
CREATE INDEX event_occurrences_start_datetime_idx ON event_occurrences(start_datetime);
CREATE INDEX event_occurrences_start_datetime_utc_idx ON event_occurrences(start_datetime_utc);
CREATE INDEX event_occurrences_sequence_idx ON event_occurrences(sequence);
CREATE INDEX event_occurrences_timezone_idx ON event_occurrences(timezone);
CREATE INDEX event_occurrences_scraped_at_idx ON event_occurrences(scraped_at);

-- Composite indexes for common queries
CREATE INDEX event_occurrences_series_sequence_idx ON event_occurrences(series_id, sequence);
CREATE INDEX event_occurrences_start_city_idx ON event_occurrences(start_datetime_utc, series_id);

-- Add series_id and occurrence_id to events_raw for backwards compatibility
ALTER TABLE events_raw
ADD COLUMN series_id UUID REFERENCES event_series(id) ON DELETE SET NULL,
ADD COLUMN occurrence_id UUID REFERENCES event_occurrences(id) ON DELETE SET NULL;

CREATE INDEX events_raw_series_id_idx ON events_raw(series_id);
CREATE INDEX events_raw_occurrence_id_idx ON events_raw(occurrence_id);

-- Create function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for event_series
CREATE TRIGGER update_event_series_updated_at
  BEFORE UPDATE ON event_series
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE event_series IS 'Parent/master events that may have multiple occurrences';
COMMENT ON TABLE event_occurrences IS 'Individual event occurrences/instances, modeled after TEC tec_occurrences table';
COMMENT ON COLUMN event_series.occurrence_type IS 'Type of event: single, multi_day, all_day, recurring, or virtual';
COMMENT ON COLUMN event_series.recurrence_type IS 'Type of recurrence pattern: none, daily, weekly, monthly, yearly, or custom';
COMMENT ON COLUMN event_series.recurrence_pattern IS 'RRULE or RDATE pattern if detectable from source';
COMMENT ON COLUMN event_occurrences.occurrence_hash IS 'Unique hash for deduplication: hash(series_id + start + end)';
COMMENT ON COLUMN event_occurrences.sequence IS 'Position in series (1 for first occurrence, 2 for second, etc.)';
COMMENT ON COLUMN event_occurrences.has_recurrence IS 'Indicates if this occurrence is part of a recurring series';
COMMENT ON COLUMN event_occurrences.is_provisional IS 'Indicates if this is a tentative/provisional date';
