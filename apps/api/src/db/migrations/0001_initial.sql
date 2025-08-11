-- Create enums (skip if exists)
CREATE TYPE run_status AS ENUM ('queued', 'running', 'success', 'partial', 'error');
CREATE TYPE match_status AS ENUM ('open', 'confirmed', 'rejected');
CREATE TYPE canonical_status AS ENUM ('new', 'ready', 'exported', 'ignored');
CREATE TYPE export_status AS ENUM ('success', 'error');
CREATE TYPE export_format AS ENUM ('csv', 'json', 'ics', 'wp-rest');

-- Create sources table
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    module_key TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true,
    default_timezone TEXT DEFAULT 'UTC',
    notes TEXT,
    rate_limit_per_min INTEGER DEFAULT 60,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create runs table
CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,
    status run_status NOT NULL DEFAULT 'queued',
    pages_crawled INTEGER DEFAULT 0,
    events_found INTEGER DEFAULT 0,
    errors_jsonb JSONB
);

-- Create indexes for runs
CREATE INDEX runs_source_id_idx ON runs(source_id);
CREATE INDEX runs_started_at_idx ON runs(started_at);

-- Create events_raw table
CREATE TABLE events_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id),
    run_id UUID NOT NULL REFERENCES runs(id),
    source_event_id TEXT,
    title TEXT NOT NULL,
    description_html TEXT,
    start_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    end_datetime TIMESTAMP WITH TIME ZONE,
    timezone TEXT,
    venue_name TEXT,
    venue_address TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    organizer TEXT,
    category TEXT,
    price TEXT,
    tags JSONB,
    url TEXT NOT NULL,
    image_url TEXT,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    raw JSONB NOT NULL,
    content_hash TEXT NOT NULL
);

-- Create indexes for events_raw
CREATE UNIQUE INDEX events_raw_source_event_id_idx ON events_raw(source_id, source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX events_raw_start_datetime_city_idx ON events_raw(start_datetime, city);
CREATE INDEX events_raw_raw_gin_idx ON events_raw USING gin(raw);
CREATE INDEX events_raw_content_hash_idx ON events_raw(content_hash);

-- Create matches table
CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_id_a UUID NOT NULL REFERENCES events_raw(id),
    raw_id_b UUID NOT NULL REFERENCES events_raw(id),
    score DOUBLE PRECISION NOT NULL,
    reason JSONB NOT NULL,
    status match_status NOT NULL DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    created_by TEXT
);

-- Create indexes for matches
CREATE INDEX matches_raw_id_a_idx ON matches(raw_id_a);
CREATE INDEX matches_raw_id_b_idx ON matches(raw_id_b);
CREATE INDEX matches_status_idx ON matches(status);
CREATE INDEX matches_score_idx ON matches(score);

-- Create events_canonical table
CREATE TABLE events_canonical (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dedupe_key TEXT,
    title TEXT NOT NULL,
    description_html TEXT,
    start_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    end_datetime TIMESTAMP WITH TIME ZONE,
    timezone TEXT,
    venue_name TEXT,
    venue_address TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    organizer TEXT,
    category TEXT,
    price TEXT,
    tags JSONB,
    url_primary TEXT NOT NULL,
    image_url TEXT,
    merged_from_raw_ids JSONB NOT NULL,
    status canonical_status NOT NULL DEFAULT 'new',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes for events_canonical
CREATE UNIQUE INDEX events_canonical_dedupe_key_idx ON events_canonical(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX events_canonical_start_datetime_idx ON events_canonical(start_datetime);
CREATE INDEX events_canonical_status_idx ON events_canonical(status);
CREATE INDEX events_canonical_city_idx ON events_canonical(city);

-- Create exports table
CREATE TABLE exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    format export_format NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    item_count INTEGER NOT NULL,
    file_path TEXT,
    params JSONB NOT NULL,
    status export_status NOT NULL,
    error_message TEXT
);

-- Create indexes for exports
CREATE INDEX exports_created_at_idx ON exports(created_at);
CREATE INDEX exports_format_idx ON exports(format);
CREATE INDEX exports_status_idx ON exports(status);

-- Create users table (optional)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create audit_logs table (optional)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes for audit_logs
CREATE INDEX audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);