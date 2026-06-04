# Decision Record: Where heavy external work runs (worker vs Convex actions)

**Status:** Decided — keep the work in the external worker (for now).
**Date:** 2026-06-04
**Context:** Full Convex-native migration. Postgres + Redis are being retired regardless of this decision. The open question is *only* where the non-Playwright heavy I/O runs: AI classification/extraction (Gemini/Claude/OpenRouter), Apify Instagram fetch, Instagram image download, WordPress REST upload, and export file generation (CSV/JSON/ICS).

Playwright website scraping is out of scope for this decision — it **cannot** run inside Convex and must stay in the worker no matter what.

---

## The two options

### Option A — Keep it in the worker (CHOSEN)
The external Node worker keeps owning all heavy/long I/O. It claims jobs from the Convex `jobs` table, runs the existing integration code, and writes results back through the Convex client. Convex actions stay minimal or unused.

### Option B — Port it into Convex actions
Reimplement the AI/Apify/WordPress/export-generation code as Convex actions (Node runtime). The worker shrinks to Playwright-only. "Everything lives in Convex" except the browser.

---

## Upsides of Convex actions (Option B)

- **Fewer moving parts conceptually.** Logic, data, and scheduling live in one system. A Convex cron can call an action directly with no worker online — e.g. a nightly WordPress export or OpenRouter model refresh runs even if the worker is down.
- **Reactivity for free.** Action results land in Convex tables and the admin UI updates live with no extra plumbing.
- **Transactional adjacency.** Actions can call mutations to persist results atomically; less risk of "job ran but DB write failed" drift than a worker writing over the network.
- **Built-in retries / observability.** Convex tracks action invocations, logs, and scheduling in its dashboard, so we'd lean less on the custom `jobs` table for these flows.
- **Secrets management.** API keys (Gemini/Claude/OpenRouter/Apify) live in Convex environment variables, scoped to the deployment, instead of the worker's `.env`.
- **No always-on worker for non-scraping tasks.** If website scraping were ever dropped, the worker could disappear entirely.

## Downsides of Convex actions (Option B)

- **Execution time limits.** Convex actions have a bounded runtime (~minutes, not hours). Long batch jobs — scraping dozens of Instagram accounts, classifying hundreds of posters with vision models, large WordPress pushes — risk timing out and need manual chunking/checkpointing. The worker has no such ceiling.
- **No Playwright.** The headless browser can't run in Convex, so a worker is required anyway as long as we scrape websites. Option B doesn't actually remove the worker; it just thins it.
- **Rewrite cost.** ~10k LOC of *working, tested* integration code (Apify enhanced client, Gemini/Claude/OpenRouter extractors, image download pipeline, WordPress client, ICS/CSV/JSON generators) would have to be reimplemented and re-tested against the action runtime, including its bundling/dependency constraints.
- **Dependency/runtime friction.** Node actions bundle differently; some npm packages (native deps, large SDKs, filesystem assumptions) don't port cleanly. Image/file handling that currently uses the local filesystem must move to Convex storage.
- **Concurrency caps.** The self-hosted backend caps concurrent Node actions (`APPLICATION_MAX_CONCURRENT_NODE_ACTIONS`, default 16). Heavy parallel scraping competes with everything else in the deployment; a separate worker isolates that load.
- **Cost/locality.** Long-running external calls inside the backend consume backend resources; on Convex Cloud that's billable compute, and on self-hosted it's contention on the single backend container.

---

## Why we chose Option A (keep the worker) for now

1. **It still achieves the actual goal:** Redis and Postgres are removed either way. Keeping the worker does not require either of them — the worker talks to Convex (`jobs.claimNext` instead of BullMQ, Convex client instead of `postgres-js`, `runLogs.append` instead of Redis streams).
2. **Reuses ~10k LOC of proven integration code** instead of rewriting and re-testing it under action constraints.
3. **No time-limit risk** for long scrape/classify/export batches.
4. **Playwright forces a worker to exist anyway**, so Option B wouldn't eliminate the process — only move code around for marginal benefit.

## When to revisit (move specific flows to actions later)

Porting a *single* flow to a Convex action can make sense piecemeal, independent of the rest:

- **OpenRouter model-list fetch** — short, read-only, no Playwright. Good first candidate; lets the admin fetch models without the worker running.
- **WordPress connection test** — short HTTP round-trip; nice as an action so the settings page works standalone.
- **Scheduled WordPress export** — if exports are small and you want them to fire from a Convex cron with no worker online.

Anything bounded, short (< ~1 min), and free of Playwright/local-filesystem/large-batch needs is a reasonable action. Everything else stays in the worker.

---

## End-state architecture (Option A)

```
Admin UI ──(useQuery/useMutation/useAction)──> Convex ── data + jobs queue + crons
Worker  ──(poll jobs.claimNext, write via Convex client)──> Convex
Worker  ── runs Playwright + Gemini/Claude/OpenRouter + Apify + WordPress upload + export gen

Retired: Postgres, Redis, BullMQ, Drizzle
Kept:    Convex, admin UI, worker (Playwright + integrations)
```
