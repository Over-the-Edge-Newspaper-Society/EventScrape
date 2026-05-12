# Convex Migration Plan

This repository can move to Convex incrementally. The current Postgres and Redis stack stays in place until each slice is switched over and verified.

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
