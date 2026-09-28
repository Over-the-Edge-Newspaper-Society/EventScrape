# EventScrape

EventScrape collects events from website and Instagram sources, supports review and duplicate matching, and exports events to files or WordPress. The current runtime uses a React admin app, a self-hosted Convex backend, and a TypeScript/Playwright worker.

Production runs on Kubernetes (K3s). The old Fastify/PostgreSQL/Redis API is [retired](apps/api/RETIRED.md); its source remains for historical reference.

## Current status — September 28, 2026

Scraper retries/readiness, scheduler isolation, run counts/timing, and WordPress upload warnings are committed to `main`. Deployment and live-test evidence are recorded in the guides below. Campus Manager [2.3.1 is a full stable release](https://github.com/Over-the-Edge-Newspaper-Society/campusmanager/releases/tag/v2.3.1).

The local WordPress compatibility replay updated **14 events, with 0 failures, 0 skips, and 5 image warnings**, preserving all 18 occurrences. Correct application-password credentials worked; deliberately invalid credentials returned HTTP 401 as expected. See [WordPress integration](docs/wordpress-integration.md) for drafts, permissions, warnings, and remaining limitations. A later [upcoming-catalogue publication](docs/upcoming-publication-2026-09-28.md) added 1,145 local events and 80 dates to existing events; all 1,258 valid event groups were verified through public REST/calendar reads.

## Architecture

| Component | Location | Responsibility |
| --- | --- | --- |
| Admin | `apps/admin` | Review, sources, runs, schedules, exports, and WordPress settings; calls Convex directly from the browser |
| Backend | `convex` | Data, file storage, job queue, schedule dispatch, and bounded external actions |
| Worker | `worker` | Claims Convex jobs; runs Playwright scrapers and longer background work |
| Retired API | `apps/api` | Historical Fastify/Drizzle/BullMQ implementation; excluded from current dev/build commands |

WordPress imports run through `wordpressUpload:uploadEvents`. Scheduled upload jobs call that action. Scrape source activation and recurring scheduling are separate: discovering or syncing a source does not create a schedule.

## Local development

Use Node.js compatible with the repository packages, pinned **pnpm 9.15.9**, and Docker with Compose for the local Convex backend. The package declares Node.js 18 or newer; deployment images and lockfile are the reference for runtime dependencies.

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm convex:docker:up
pnpm convex:docker:key
```

Save the generated local admin key in an untracked root `.env.local`:

```dotenv
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<generated local admin key>
```

Deploy functions, install the browser used by the worker, and start the applications:

```sh
pnpm convex:deploy
pnpm --filter @eventscrape/worker exec playwright install chromium
pnpm --filter @eventscrape/admin --filter @eventscrape/worker --parallel -r dev
```

On Linux, Playwright may also require its system dependencies. For continuous Convex development, run `pnpm convex:dev` in another terminal.

| Local service | Address |
| --- | --- |
| Admin | http://localhost:3000 |
| Convex backend | http://127.0.0.1:3210 |
| Convex HTTP actions | http://127.0.0.1:3211 |
| Convex dashboard | http://localhost:6791 |

The admin defaults to the local backend. Set `VITE_CONVEX_URL` in `apps/admin/.env.local` when using another browser-reachable backend; it is baked into production builds. The worker reads `CONVEX_URL`, then `CONVEX_SELF_HOSTED_URL`, and defaults to `http://127.0.0.1:3210`. Export worker overrides in its process environment or put them in `worker/.env`. Deployment admin keys belong only in trusted CLI/server configuration, never in `VITE_*` values.

Stop the backend with `pnpm convex:docker:down`; its data persists in the Docker volume. The old root `.env.example` describes the retired API and is not the current Convex setup template.

## Scraping and run results

1. Start the worker to discover and sync scraper modules, or request a source sync in the admin.
2. Activate the intended sources and queue a manual scrape.
3. Check Runs for completion, failures, retries, and found/new/updated/unchanged/failed counts.
4. Configure a separate recurring schedule for each source that should run automatically.
5. Review events and select the intended export destination and post status.

The September 28 sweep ran all **17 active website sources**: 15 initially succeeded and 2 failed. Subsequent fixes and full reruns verified PG Pride (7 found), PGPL (41), and Tourism PG (166). Two Rivers returned zero events and still needs investigation. Instagram was disabled during that sweep; its separate pipeline was repaired and its existing schedule resumed later that day (see below). The demo and AI poster sources were not part of the website sweep. Only six website schedules were enabled at that verification; the eleven newer website sources were not automatically scheduled.

Instagram now runs **Monday/Wednesday/Friday at 5 p.m. America/Vancouver**, fetching up to **four recent posts for each of 38 active accounts**. Manual mode saves posts and images to the review queue; it does not automatically create or publish events. Ingestion and review use the configured global AI provider (currently OpenRouter). See the [repair, pilot and verification report](docs/instagram-pipeline-2026-09-28.md). Review pages now refresh background work automatically and use indexed Instagram reads; see the [responsiveness fixes and full-account pull](docs/review-queue-performance-2026-09-28.md).

For new website runs, “found” includes unchanged events. Historical runs retain their older new/updated counts and are labelled accordingly. Run history separates active processing from total elapsed/waiting time. A schedule's `lastRunAt` records dispatch, so verify its associated run actually completed.

## Verification commands

These focused checks passed before the September 28 push:

```sh
pnpm exec tsx --test scripts/tests/*.test.ts
pnpm exec tsc -p convex/tsconfig.json --noEmit
pnpm --filter @eventscrape/worker exec vitest run \
  src/lib/navigation.test.ts \
  src/modules/pgpl_ca/pgpl_ca.test.ts \
  src/modules/pgpride_com/pgpride_com.test.ts \
  src/modules/tourismpg_com/tourismpg_com.test.ts
pnpm build
```

Results: 16 script regressions and 16 targeted worker tests passed, Convex type checking passed, and both admin and worker production builds passed. These are focused checks, not a claim that every scraper has full automated coverage. The repository currently has no GitHub Actions workflow; Campus Manager has its own release CI.

## Deployment and backups

Use [the Kubernetes deployment guide](docs/deploy-k8s.md) for the current production cluster. Admin/worker image rollout and Convex function deployment are separate operations. A Git push alone does not deploy either.

The admin needs a public Convex URL because the browser calls it directly; the worker can use the cluster's internal service address. Kubernetes data lives on the cluster node's disk and needs backups. `pnpm backup:export` exports a Convex snapshot with file storage. `pnpm backup:import` wraps replacement import; use it only for an intentional restore to the selected backend.

## Documentation

- [WordPress integration and troubleshooting](docs/wordpress-integration.md)
- [Kubernetes deployment and scheduler fix](docs/deploy-k8s.md)
- [Scraper fixes and final full-run results](docs/run-fixes-2026-09-28.md)
- [Initial scrape sweep and local import record](docs/verification-2026-09-28.md)
- [Upload-warning UI verification](docs/wordpress-upload-warnings-2026-09-28.md)
- [Scraper development guide](worker/docs/scraper-development-guide.md)
- [Script reference](scripts/README.md)
- [Convex migration history](docs/convex-migration.md)

Older REST API, PostgreSQL/Redis, nginx quick-start, and LXC documents describe previous deployments; prefer this README and the Kubernetes guide for the current runtime.
