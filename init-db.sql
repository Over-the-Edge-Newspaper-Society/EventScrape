-- This file is automatically run when PostgreSQL container starts for the first time
-- It ensures all permissions are properly set

-- Grant all privileges to eventscrape user
GRANT ALL PRIVILEGES ON DATABASE eventscrape TO eventscrape;
GRANT ALL PRIVILEGES ON SCHEMA public TO eventscrape;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO eventscrape;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO eventscrape;

-- Ensure eventscrape can create tables
ALTER SCHEMA public OWNER TO eventscrape;