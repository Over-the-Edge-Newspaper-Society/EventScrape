# Event Scraper & Review System — Technical Plan

## 0) High-level Summary
Build a modular event-scraping pipeline (Playwright-based) plus a review UI (shadcn/ui) that:
- Scrapes multiple event sites via plug-in modules you can add/remove at will.
- Normalizes and stores raw results in a database with full source attribution.
- Flags likely duplicates (same date/time/location with slightly different titles) and missing info.
- Lets a human compare, merge, and finalize canonical records.
- Bulk-exports to WordPress (file formats and/or REST API) while preserving source URLs.

Non-goals: fully automated publishing without review; mandatory enrichment of all missing fields.

---

## 1) Architecture
**Stack**
- **Scraping Workers:** Node.js + TypeScript + Playwright (headless). One module per website.
- **Web App / Admin UI:** Vite + React + TypeScript + shadcn/ui + Tailwind (SPA).
- **API Layer:** Fastify (Node.js) with REST (or tRPC) endpoints to the DB and queue.
- **Queue & Scheduling:** Redis + BullMQ; cron-like schedules per source.
- **Database:** PostgreSQL (with `jsonb` for raw payloads) + drizzle/prisma.
- **Storage:** Local/Docker volume or S3-equivalent for export files & optional screenshots.
- **Containers:** Docker Compose for `web`, `worker`, `redis`, `postgres`.
- **Observability:** pino logs, health endpoints, per-run metrics.

**Data Flow / Pipeline**
1) Scheduler enqueues a scrape job per active source.
2) Worker runs the site’s module with Playwright; outputs normalized `events_raw` rows.
3) Matcher generates candidate duplicates (blocking + similarity scoring).
4) Reviewer uses UI to compare/merge into `events_canonical` (or ignore).
5) Bulk export (CSV/JSON/ICS or WordPress REST import). Export artifacts are tracked.


## 1A) Vite Setup Quickstart
**Front-end (admin)**
- `pnpm create vite@latest admin --template react-ts`
- `cd admin && pnpm i`
- `pnpm i -D tailwindcss postcss autoprefixer && npx tailwindcss init -p`
- Update `tailwind.config.js` content: `./index.html`, `./src/**/*.{ts,tsx}`; add shadcn/ui preset if you use one.
- Install UI deps: `pnpm i class-variance-authority tailwind-merge lucide-react @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-toast sonner`
- Add shadcn/ui components via CLI or copy the component files into `src/components/ui`; ensure Tailwind and Radix styles are wired.
- Router: React Router or TanStack Router; either works fine for an internal admin SPA.

**API**
- `pnpm i fastify @fastify/cors zod pino pino-pretty`
- Expose routes under `/api` for events, matches, exports. Keep auth simple (token header) unless you need users/roles.

**Dev DX** (workspace optional)
- Root scripts to run all services: `pnpm -r dev` (admin, api, worker).
- Use Docker Compose for Postgres/Redis.

---

## 2) Data Model (PostgreSQL)
**`sources`**
- `id` (pk, uuid), `name`, `base_url`, `module_key`, `active` (bool), `default_timezone`, `notes`, `rate_limit_per_min`.

**`runs`** (one per scrape execution)
- `id`, `source_id` (fk), `started_at`, `finished_at`, `status` (queued/running/success/partial/error), `pages_crawled`, `events_found`, `errors_jsonb`.

**`events_raw`** (immutable raw observations)
- `id` (uuid, pk), `source_id` (fk), `run_id` (fk), `source_event_id` (text), `title`, `description_html`,
- `start_datetime` (timestamptz), `end_datetime` (timestamptz), `timezone` (text),
- `venue_name`, `venue_address`, `city`, `region`, `country`, `lat` (float8), `lon` (float8),
- `organizer`, `category`, `price` (text), `tags` (jsonb),
- `url` (text), `image_url` (text), `scraped_at` (timestamptz), `raw` (jsonb),
- `content_hash` (text) — hash of salient fields for idempotency.

**Indexes / Constraints**
- Unique (`source_id`, `source_event_id`) where `source_event_id` is not null.
- Index on (`start_datetime`, `city`), GIN on `raw`.

**`matches`** (machine-suggested potential duplicates)
- `id`, `raw_id_a`, `raw_id_b`, `score` (0–1), `reason` (jsonb: features), `status` (open/confirmed/rejected), `created_at`, `created_by` (nullable for auto).

**`events_canonical`** (human-approved records)
- `id` (uuid, pk), `dedupe_key` (text), `title`, `description_html`,
- `start_datetime`, `end_datetime`, `timezone`, `venue_name`, `venue_address`, `city`, `region`, `country`, `lat`, `lon`, `organizer`, `category`, `price`, `tags` (jsonb), `url_primary` (canonical URL), `image_url`,
- `merged_from_raw_ids` (uuid[]), `status` (new/ready/exported/ignored), `created_at`, `updated_at`.

**`exports`**
- `id`, `format` (csv/json/ics/wp-rest), `created_at`, `item_count`, `file_path`, `params` (jsonb), `status` (success/error).

**Optional:** `users`, `audit_logs` (who decided what in review), `notes` per event.

---

## 3) Scraper Modules (Playwright)
**Module Contract (TypeScript)**
```ts
export type RawEvent = {
  sourceEventId?: string;
  title: string; descriptionHtml?: string;
  start: string; // ISO or site-local with tz hint
  end?: string;  // ISO or site-local with tz hint
  venueName?: string; venueAddress?: string; city?: string; region?: string; country?: string;
  lat?: number; lon?: number;
  organizer?: string; category?: string; price?: string; tags?: string[];
  url: string; imageUrl?: string;
  raw: unknown; // original snippet
};

export interface ScraperModule {
  key: string;               // e.g. "example_com"
  label: string;             // Human-friendly
  startUrls: string[];       // entry points
  run(ctx: RunContext): Promise<RawEvent[]>; // uses Playwright page/browser
}
```

**Runtime Behaviors**
- Respect robots.txt and site ToS; set polite defaults: `rate_limit_per_min`, random UA, small jitter, backoff/retry.
- Use `page.waitForLoadState('networkidle')`, infinite scroll where needed, pagination, and DOM selectors resilient to minor changes.
- Normalize dates with `luxon` or `date-fns-tz`; infer timezone from source or `default_timezone` on `sources`.
- Emit `sourceEventId` when available; otherwise compute `content_hash` as a stable fingerprint.
- On errors, capture minimal `page.screenshot()` (optional), log and continue.
- Each module ships with a `fixtures/` sample page and unit tests.

**Repo Structure**
```
/apps
  /admin   (Vite + React + shadcn/ui + Tailwind)
    index.html
    src/
      main.tsx
      components/
      pages/
  /api     (Fastify + REST/tRPC)
    src/
      server.ts
      routes/
      db/
      queue/
/worker
  /modules
    example_com/
      index.ts
      selectors.ts
      fixtures/
      example.test.ts
  matcher.ts
  queue.ts
  db.ts
/packages
  /ui        # optional shared UI pieces
  /config    # tsconfig, eslint, tailwind presets
```

---

## 4) Duplicate Detection & Canonicalization
**Blocking (candidate pairing):**
- Same calendar **date** and **city/region** and start time within ±30 minutes; OR
- Same venue (fuzzy) and date; OR
- Same title (fuzzy) and start ±60 minutes.

**Scoring (0–1)**
- Title similarity (token-set + Jaro-Winkler) — weight 0.45
- Start datetime proximity (minutes delta normalized) — weight 0.25
- Venue/geo proximity (≤1 km = 1.0, 1–5 km scaled) — weight 0.20
- Organizer similarity — weight 0.10

Thresholds: ≥0.78 → auto-suggest duplicate; 0.60–0.77 → needs review; <0.60 → ignore.

**Merge Rules (UI-driven):**
- Side-by-side fields with per-field pickers; default to the field with higher completeness or from a whitelisted "trusted" source.
- Preserve **all** contributing raw IDs under `merged_from_raw_ids` for traceability.

---

## 5) Review UI (shadcn/ui)
**Screens**
1) **Dashboard:** last runs, errors, events found, pending reviews.
2) **Events (Raw):** DataTable with filters: date range, source, city, status, "duplicates only", "missing fields".
3) **Compare & Merge:** Drawer or Modal with two (or more) candidate events, similarity breakdown, field pickers, and action buttons: `Confirm same event` → produce/update `events_canonical`; `Not a duplicate`; `Ignore`.
4) **Canonical List:** Ready-to-export events; bulk select; edit-in-place.
5) **Exports:** History with download links, params, counts.

**Components**
- `DataTable` with server-side pagination & column filters.
- `SimilarityBadge`, `MissingFieldBadge`.
- `ExportWizard` (format → field mapping → preview → confirm).

**UX Notes**
- Keyboard shortcuts (J/K to navigate, Enter to merge, E to edit).
- Persisted filters per user.
- Toasts for actions; optimistic UI.

---

## 6) Export to WordPress
**Options**
- **CSV** compatible with WP All Import (safe default). Columns include:
  - `external_id` (canonical `id`), `post_title`, `post_content`, `event_start`, `event_end`, `timezone`, `venue_name`, `venue_address`, `city`, `organizer`, `price`, `category`, `tags`, `image_url`, `source_url`, `source_site`.
- **JSON** for custom pipelines.
- **ICS** (optional) for calendar subscribers.
- **WordPress REST API** (optional): upsert into a custom post type or supported events plugin.

**Idempotency**
- Use `external_id` for upserts; do not create duplicates on re-import.
- Keep `source_url` and `source_site` as custom fields.

**Provenance**
- Always include `source_url`, `source_site`, and `merged_from_raw_ids` in exports (even if only in a hidden/meta column or JSON blob).

---

## 7) API Endpoints (suggested)
- `POST /api/scrape/:sourceKey` → enqueue now
- `GET /api/runs?sourceKey=&limit=` → list runs
- `GET /api/events/raw` → filterable list
- `GET /api/events/raw/:id` → details
- `POST /api/matches/recompute` → rebuild candidates for a date window
- `POST /api/merge` → body: `{rawIds: string[], decisions?: Record<string,string>}`
- `GET /api/events/canonical` → list
- `POST /api/exports` → body: `{format: 'csv'|'json'|'ics'|'wp-rest', filters, fieldMap?}` returns artifact path or REST results

---

## 8) Scheduling & Operations
- Cron-like rules per source (e.g., nightly, hourly during business hours).
- Backoff & retry: 3 attempts/job; exponential 2^n seconds.
- Site-specific rate limits via `sources.rate_limit_per_min`.
- Feature flags to disable problematic modules quickly.
- Metrics: events/hour, duplicates suggested, merge latency, error rate.

---

## 9) Compliance & Safety
- Respect robots.txt and terms of service; avoid login-only pages unless written permission.
- Identify as a bot in UA if allowed; provide contact email.
- Honor `noindex`/`nofollow` conventions where applicable.

---

## 10) Testing
- Unit tests: date parsing, similarity scoring, module extractors with `fixtures/` HTML.
- Integration: spin up worker + DB in CI; run a mock site.
- Golden CSV snapshots for export mapping.

---

## 11) Acceptance Criteria
- ✅ Add or remove a site by dropping in/out a single module directory and registering `module_key` in `sources`.
- ✅ After a scrape, raw events are in `events_raw` with `source_url` recorded.
- ✅ System proposes duplicates for same-day/time events even with slightly different titles; reviewer can merge or reject.
- ✅ Bulk export produces a CSV with canonical events and provenance fields suitable for WP import; REST option works when configured.
- ✅ Past runs and exports are queryable; data is exportable and importable.

---

## 12) Example: Matching Pseudocode
```ts
function scorePair(a: RawLike, b: RawLike): number {
  const title = jw(a.title, b.title) * 0.25 + tokenSet(a.title, b.title) * 0.20;
  const time = timeProximity(a.start, b.start); // 0..1 scaled within ±60m
  const venue = max(jw(a.venueName, b.venueName), geoProx(a, b));
  const org = jw(a.organizer ?? '', b.organizer ?? '');
  return title*0.45 + time*0.25 + venue*0.20 + org*0.10;
}
```

---

## 13) Example CSV Header (WP All Import)
```
external_id,post_title,post_content,event_start,event_end,timezone,venue_name,venue_address,city,organizer,price,category,tags,image_url,source_url,source_site
```

---

## 14) Env Vars (sample)
- `DATABASE_URL=postgres://...`
- `REDIS_URL=redis://...`
- `EXPORT_DIR=/data/exports`
- `PLAYWRIGHT_HEADLESS=true`
- `WORDPRESS_BASE_URL=https://...` (optional)
- `WORDPRESS_USERNAME=...` (optional)
- `WORDPRESS_APP_PASSWORD=...` (optional)

---

## 15) Implementation Notes for "another bot"
- Generate types from DB schema; fail builds on drift.
- Put field normalizers in one place (title case, trim, collapse whitespace).
- Keep a small library of parser helpers (date patterns, currency, geo lookup by venue).
- Everything async/await; no unhandled rejections.
- Idempotent scrapes: upsert `events_raw` by (`source_id`, `source_event_id`) or `content_hash`.
- Maintain comprehensive source attribution on every record and in every export.

