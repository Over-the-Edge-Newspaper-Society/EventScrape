-- System settings table to hold feature toggles
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poster_import_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ensure a singleton row exists for the application
INSERT INTO system_settings (id, poster_import_enabled)
VALUES ('00000000-0000-0000-0000-000000000100', true)
ON CONFLICT (id) DO NOTHING;

-- Maintain updated_at automatically
CREATE OR REPLACE FUNCTION update_system_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_settings_set_updated_at ON system_settings;
CREATE TRIGGER system_settings_set_updated_at
BEFORE UPDATE ON system_settings
FOR EACH ROW
EXECUTE FUNCTION update_system_settings_updated_at();
