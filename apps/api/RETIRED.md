# apps/api is retired

This Fastify + Drizzle + BullMQ REST API has been **retired** by the Convex migration
(2026-06-04). It is no longer started by `pnpm dev`, the docker compose stack, or
the build (`pnpm build` filters to `@eventscrape/admin` + `@eventscrape/worker`).

- The **admin UI** now talks to Convex directly (`apps/admin/src/lib/api.ts` is a
  Convex adapter via `ConvexHttpClient`).
- The **worker** claims jobs from Convex (`jobs.claimNext`) and reads/writes data
  through `convex/worker.ts` — no Postgres, no Redis/BullMQ.
- Data lives in the self-hosted Convex backend (`docker-compose.convex.yml`).

## Why the source is kept (not deleted)

Every feature has been ported off this package. The source is kept only as
historical reference for the original implementations; nothing here runs.

**Done (ported off this package):**
- Source sync — the worker discovers scraper modules and pushes them to Convex
  (`sources:syncFromModules`) on startup; the admin "Sync" button enqueues an
  on-demand `moduleSync` job (`sources:enqueueSync` → worker `moduleSync` queue).
- Database backup/restore — native Convex snapshots (`pnpm backup:export` /
  `pnpm backup:import`, wrapping `convex export --include-file-storage` /
  `convex import --replace`). One ZIP holds every table + all stored files. Also
  available from the Convex dashboard (Settings → Snapshot Export).
- WordPress event upload — Convex Node action `wordpressUpload:uploadEvents`
  (synchronous; resolves images from Convex storage for media upload).
- WordPress connection test + category fetch — Convex actions in `convex/wordpress.ts`.
- Export file generation (CSV/JSON/ICS) — Convex action `exports:generateFile`
  writes to Convex storage; download via `exports:getDownloadUrl`.
- OpenRouter vision-model listing — Convex action `openrouter:listVisionModels`.
- Instagram manual AI re-classify/extract — Convex `instagramReview:enqueue*`
  mutations + worker `review` queue handler (`worker/src/jobs/reviewAi.ts`).
- Poster import — Convex `posterImport:enqueue` + worker `posterImport` queue
  handler (`worker/src/jobs/posterImport.ts`); image stored in Convex storage.
- Apify run import/snapshot — `instagramApify:snapshot` action +
  `instagramApifyQueue:enqueueImport` + worker `apifyImport` handler.
- Instagram image serving — Convex storage. The worker uploads poster images at
  scrape time, queries resolve storage URLs, and existing images were backfilled
  from the backup bundle via `scripts/backfill-instagram-images-from-dir.ts`.

These are currently **gated in the admin UI** with clear "requires the actions
phase" messages. When porting them, move the logic into either the worker (for
long/heavy I/O) or Convex actions (for short, bounded calls) — see
`docs/convex-actions-tradeoffs.md`.

## To permanently delete

Once every feature above is ported and verified, this directory and its
Postgres/Redis dependencies can be removed, and `apps/*` in `pnpm-workspace.yaml`
narrowed accordingly.
