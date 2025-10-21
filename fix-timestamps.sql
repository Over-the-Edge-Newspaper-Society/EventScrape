-- Create a temporary table with the timestamp data from the old database
CREATE TEMP TABLE temp_timestamps (
    instagram_id TEXT,
    post_timestamp TIMESTAMP
);

-- You'll need to populate this table with data from the SQLite database
-- For now, let's create a simpler approach using a DO block

DO $$
DECLARE
    event_record RECORD;
    updated_count INTEGER := 0;
BEGIN
    -- For each event that has an instagram_post_id
    FOR event_record IN
        SELECT id, instagram_post_id, raw, start_datetime
        FROM events_raw
        WHERE instagram_post_id IS NOT NULL
    LOOP
        -- Update the raw field to add instagram.timestamp using start_datetime
        UPDATE events_raw
        SET raw = jsonb_set(
            COALESCE(raw::jsonb, '{}'::jsonb),
            '{instagram,timestamp}',
            to_jsonb(start_datetime::text)
        )
        WHERE id = event_record.id;

        updated_count := updated_count + 1;
    END LOOP;

    RAISE NOTICE 'Updated % records', updated_count;
END $$;
