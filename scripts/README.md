# EventScrape Scripts

Utility scripts for database migrations, cleanup, and maintenance.

## Instagram Post Management

### cleanup-duplicate-instagram-posts.js

Removes duplicate Instagram post records from the database.

**When to use:**
- After discovering duplicate posts in the review queue
- After migrating data from an old system
- As routine maintenance if duplicates appear

**Usage:**
```bash
node scripts/cleanup-duplicate-instagram-posts.js
```

**What it does:**
- Finds all Instagram posts with duplicate records (same `instagram_post_id`)
- Keeps the most recent record (by `scraped_at` date)
- Deletes all older duplicate records

**Safe to run:** Yes, can be run multiple times. Does nothing if no duplicates exist.

---

### migrate-instagram-timestamps.js

Imports actual Instagram post timestamps from SQLite backup into PostgreSQL.

**When to use:**
- When migrating from the old Instagram monitor system
- To preserve actual Instagram post publication dates

**Prerequisites:**
1. Have a SQLite backup from the old Instagram monitor (`instagram_monitor.db`)
2. Export timestamps to JSON format

**Usage:**

Step 1: Export timestamps from SQLite backup:
```bash
sqlite3 "/path/to/instagram_monitor.db" \
  "SELECT instagram_id, post_timestamp FROM posts ORDER BY post_timestamp DESC;" \
  -json > /tmp/instagram_timestamps.json
```

Step 2: Run migration:
```bash
node scripts/migrate-instagram-timestamps.js
```

Or with custom path:
```bash
TIMESTAMPS_JSON_PATH=/path/to/timestamps.json node scripts/migrate-instagram-timestamps.js
```

**Note:** This script has already been run once (October 2025). Only run again if you have a new backup or need to re-import timestamps.

---

## Other Scripts

Additional scripts for various maintenance tasks can be found in this directory.
