# Convex Migration Plan

> **Current status (September 28, 2026):** the runtime uses self-hosted Convex, the admin UI, and the worker. PostgreSQL, Redis, and the Fastify API are retired from the run path. WordPress upload/connection/category actions, export generation, poster/review queues, backups, and storage-backed images have implementations in the current code. See [the README](../README.md) for current setup and [WordPress verification](wordpress-upload-warnings-2026-09-28.md) for tested import behavior.

The remainder of this document records the migration design and one-time import procedure. Its migration order is historical, not an outstanding deployment checklist.

## Target Architecture

- Convex database replaces Postgres tables.
- Convex `jobs` table replaces BullMQ job state in Redis.
- External Node worker keeps running scraper modules and Playwright, but claims jobs through Convex mutations.
- Convex scheduled functions and cron jobs replace Redis repeatable jobs.
- Convex `runLogs` table plus reactive queries replace Redis streams and API SSE log endpoints.
- The admin app can move from REST/React Query to Convex React subscriptions one page at a time.

## Local Docker Backend

This repo includes a Docker Compose file for the official self-hosted Convex backend and dashboard:

```bash
pnpm convex:docker:up
pnpm convex:docker:key
```

The backend listens on `http://127.0.0.1:3210`, HTTP actions listen on `http://127.0.0.1:3211`, and the dashboard listens on `http://localhost:6791`.

After generating an admin key, create `.env.local`:

```bash
CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
CONVEX_SELF_HOSTED_ADMIN_KEY='<admin key from pnpm convex:docker:key>'
```

Then push functions to the local backend:

```bash
pnpm convex:dev
```

Use `pnpm convex:docker:logs` to inspect the backend/dashboard logs and `pnpm convex:docker:down` to stop the containers. The backend stores data in the `convex_data` Docker volume.

## Postgres and Instagram Photo Import

Run the Postgres import against the local Convex backend:

```bash
set -a
source .env.local
set +a
pnpm convex:migrate:pg
```

The importer copies relational rows into Convex tables and uploads Instagram cache files referenced by `events_raw.local_image_path` into Convex file storage. Migrated raw events keep the original `localImagePath` and also get `localImageStorageId`, `localImageContentType`, and `localImageSize` when the file is found.

Set `INSTAGRAM_IMAGES_DIR` if the cache is not in one of the default search locations:

```bash
INSTAGRAM_IMAGES_DIR=/data/instagram_images pnpm convex:migrate:pg
```

If local cache files are missing, the importer can try to download `events_raw.image_url` and upload the response directly to Convex storage:

```bash
CONVEX_MIGRATION_DOWNLOAD_MISSING_IMAGES=true pnpm convex:migrate:pg
```

Direct Instagram CDN URLs often expire, so the reliable path is to restore or mount the photo cache before running the import. The importer clears existing Convex file storage by default on full imports; set `CONVEX_MIGRATION_CLEAR_STORAGE=false` to preserve existing uploaded files.

## Migration Order

1. Add Convex schema and primitives for sources, runs, jobs, and logs.
2. Import existing Postgres data into Convex with legacy ID fields for traceability.
3. Add a Convex-backed worker mode behind an environment flag.
4. Move live logs from Redis streams to `runLogs`.
5. Move scrape/match/Instagram queues from BullMQ to `jobs`.
6. Move schedules from BullMQ repeatable jobs to Convex scheduling.
7. Switch admin pages from REST routes to Convex queries/mutations.
8. Remove Postgres, Redis, Drizzle, BullMQ, and related Docker services after parity checks.

## Notes

- Keep Playwright scraping in the external worker. Convex actions are useful for short external calls, but the browser pool and long scrape jobs are better suited to a worker process.
- Prefer Convex native document IDs for new records. `legacyId` fields exist only to support import, comparison, and rollback during migration.
- Store timestamps as epoch milliseconds in Convex.
