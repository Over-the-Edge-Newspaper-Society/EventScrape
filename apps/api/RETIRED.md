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

This package still contains reference implementations for the **actions-phase**
features that have not yet been re-homed into Convex actions / worker handlers:

- WordPress REST client + event upload (`services/wordpress-client.ts`, routes/wordpress.ts)
- Export file generation: CSV / JSON / ICS (`routes/exports.ts`)
- Poster import + AI extraction triggers (`routes/poster-import.ts`)
- Database backup/restore bundles (`routes/backups.ts`, `routes/database.ts`)
- Instagram image serving + Apify run import/snapshot
- OpenRouter vision-model listing

These are currently **gated in the admin UI** with clear "requires the actions
phase" messages. When porting them, move the logic into either the worker (for
long/heavy I/O) or Convex actions (for short, bounded calls) — see
`docs/convex-actions-tradeoffs.md`.

## To permanently delete

Once every feature above is ported and verified, this directory and its
Postgres/Redis dependencies can be removed, and `apps/*` in `pnpm-workspace.yaml`
narrowed accordingly.
