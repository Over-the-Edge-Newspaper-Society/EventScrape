-- WordPress integration settings table
CREATE TABLE IF NOT EXISTS "wordpress_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"site_url" text NOT NULL,
	"username" text NOT NULL,
	"application_password" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
