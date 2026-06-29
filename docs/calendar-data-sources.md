# Calendar Data Sources — Investigation & Integration Plan

Investigation of candidate Prince George / Northern BC event sources, each probed
live for the cleanest ingestion method. EventScrape modules declare how they pull
data via `integrationTags: ('calendar' | 'csv' | 'page-navigation' | 'api' | 'rss')[]`
(see `worker/src/types.ts`). Prefer an `api`/`rss` feed over HTML scraping whenever
one exists — it is faster, needs no headless browser, and breaks less often.

## Key finding: fraserfinds.ca is already an aggregator

`https://fraserfinds.ca` is a custom React app backed by its own JSON API:

| Endpoint | Returns |
|----------|---------|
| `GET /api/events` | ~585 KB aggregated community calendar (`title/date/start/end/venue/category/description/link`) |
| `GET /api/sales`  | Garage sales (`address`, `days[].{date,start,end}`, `lat/lng`, `categories`) |
| `GET /api/indoor` | Indoor-activity business directory |
| `GET /api/sponsors`, `/api/submit`, `/api/digest/subscribe` | sponsors / submissions / newsletter |

`/api/events` already covers many of the venues below (event counts at time of probe):
The Exploration Place (309), PG Public Library (147), Two Rivers Gallery (63),
CN Centre (15), Northern Lights Winery (14), Omineca Arts Centre (10),
PGARA Speedway (9), Legion Hall (7), plus Studio 2880, Knox, PG Playhouse, etc.

Trade-off: ingesting `/api/events` gives instant broad coverage with minimal code,
but makes us depend on their curation/uptime and re-publishes a peer aggregator's
data. Recommended use: build direct modules for the clean primary sources, and use
`/api/events` only to backfill the hard (Cloudflare/Wix/GoDaddy) venues.

## Per-source results

| Source | Tech | Best integration | Tag | Effort | Status |
|--------|------|------------------|-----|--------|--------|
| caledonianordic.com | WordPress + The Events Calendar | `GET /wp-json/tribe/events/v1/events` (full structured events) | `api` | Easy | **Built** |
| fraserfinds.ca (garage sales) | Custom React + API | `GET /api/sales` | `api` | Easy | Planned |
| fraserfinds.ca (#calendar) | Custom React + API | `GET /api/events` (aggregated) | `api` | Easy | Planned |
| tworiversgallery.ca | WordPress, custom post types | `GET /wp-json/wp/v2/events` and `/programs` (ACF start/end date+time) | `api` | Easy | Planned |
| northernlightswinery.ca | Squarespace + Eventbrite | `?format=json` collection, or Eventbrite API | `api` | Med | Planned |
| caledoniaramblers.ca | Drupal 11 | RSS `/events/feed` + `/schedule` table for dates | `rss` | Med | Planned |
| cncentre.ca | Drupal 10 | Server-rendered HTML (`<time datetime>`, `field-when`); listing `/events-tickets/events-calendar` | `page-navigation` | Med | Planned |
| legion43pg.ca | WordPress + Modern Events Calendar | `/wp-json/wp/v2/mec-events` for discovery; dates NOT in REST → scrape event pages | `page-navigation` | Med | Planned |
| theexplorationplace.com | WordPress + Events Calendar | Cloudflare returns 522 to datacenter IPs → needs a real browser. Fully covered by fraserfinds | `page-navigation` | Hard | Backfill via fraserfinds |
| ominecaartscentre.com | "ESF" host | HTML scrape `/events/calendar`. Also in fraserfinds | `page-navigation` | Hard | Backfill via fraserfinds |
| pgpride.com | GoDaddy Website Builder | JS-rendered calendar widget (iframe srcdoc), no feed → Playwright, brittle | `page-navigation` | Hard | Deferred |
| pgara.ca | Wix | Wix Events in `wix-warmup-data` (warmup showed season archives; schedule unclear). Also in fraserfinds | `page-navigation` | Hard | Deferred |
| facebook.com/events/… | Facebook | Auth-walled + anti-bot, single event URL → not cleanly scrapeable. Use `ai_poster_import`/Instagram path or manual entry | — | Skip | Skip |

## Notes on the API endpoints

- **The Events Calendar** (`caledonianordic`, `theexplorationplace`):
  `GET /wp-json/tribe/events/v1/events?per_page=50&page=N&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&status=publish`.
  Response: `{ events: [...], total, total_pages }`. Each event has site-local
  `start_date`/`end_date` plus a `timezone` field, `all_day`, nested `venue`,
  `categories[]`, `cost`, `image.url`. `per_page` caps at 50; HTTP 400 marks
  "past the last page."
- **Two Rivers Gallery** custom post types: `GET /wp-json/wp/v2/events` and
  `/wp-json/wp/v2/programs`. Dates live in `acf.{start_date,end_date,start_time,end_time}`
  as pre-formatted strings (e.g. `"September 9"`, `"6:00 pm"`).
- **Modern Events Calendar** (`legion43pg`): the default `wp/v2/mec-events` REST
  returns post fields but NOT event start/end (they live in postmeta). Either read
  the rendered event page or the plugin's iCal export.
- **Squarespace** (`northernlightswinery`): append `?format=json` to any collection
  URL for the underlying JSON; the page also embeds Eventbrite tickets.
- **Drupal feed** (`caledoniaramblers`): `/events/feed` is a views RSS feed of
  upcoming hikes; hike dates are on the `/schedule` table and `/hike-details/*` pages.

## Build order

1. **Tier 1 (clean JSON APIs):** `caledonianordic_com` ✅, `tworiversgallery_com`,
   `fraserfinds_ca` (garage sales).
2. **Tier 2 (HTML/feed):** `cncentre_ca`, `caledoniaramblers_ca`,
   `northernlightswinery_ca`, `legion43pg_ca`.
3. **Tier 3 (browser/Cloudflare):** mostly backfilled by `fraserfinds.ca /api/events`;
   build direct modules only if first-party data/attribution is required.
