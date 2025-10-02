-- Add include_media column to wordpress_settings table
ALTER TABLE wordpress_settings
ADD COLUMN include_media BOOLEAN NOT NULL DEFAULT true;
