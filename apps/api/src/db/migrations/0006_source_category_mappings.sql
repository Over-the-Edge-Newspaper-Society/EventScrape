-- Add source category mappings to WordPress settings
ALTER TABLE "wordpress_settings" ADD COLUMN "source_category_mappings" jsonb DEFAULT '{}' NOT NULL;
