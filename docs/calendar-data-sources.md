# Calendar Data Sources — Investigation & Integration Plan

Investigation of candidate Prince George / Northern BC event sources, each probed
live for the cleanest ingestion method, plus the modules built from that work.
EventScrape modules declare how they pull data via
`integrationTags: ('calendar' | 'csv' | 'page-navigation' | 'api' | 'rss')[]`
(see `worker/src/types.ts`). Prefer an `api`/`rss` feed over HTML scraping
whenever one exists — it is faster, needs no headless browser, and breaks less
often.

## Key finding: fraserfinds.ca is an aggregator

`https://fraserfinds.ca` is a custom React app backed by its own JSON API:

| Endpoint | Returns |
|----------|---------|
| `GET /api/events` | ~870 events aggregated from 20+ local feeds (`title/date/start/end/venue/category/description/link/source`) |
| `GET /api/sales`  | Garage sales (`address`, `days[].{date,start,end}`, `lat/lng`, `categories`) |
| `GET /api/indoor` | Indoor-activity business directory |

Every aggregated event keeps its original `source` name **and** a `link` back
to the source page, so the `fraserfinds_ca` module preserves that attribution
(the canonical `url` points at the origin venue, and `raw.originalSource` /
`raw.aggregatedVia` record the chain). Sources it pulls from (counts at time of
probe): The Exploration Place (309), PG Public Library (147), Hart Pioneer
Centre (80), Two Rivers Gallery (63), City of Prince George (59), PG Golf &
Curling (40), Facebook events (36), Caledonia Ramblers (19), Farmers Market
(19), PG Symphony (17), CN Centre (15), Northern Lights Winery (14), Omineca
Arts Centre (10), PGARA (9), Tourism PG (7), Legion (7), PG Pride (7), Theatre
NorthWest (6), BCNE (4), Caledonia Nordic (2).

This means the aggregator alone covers the JS-only website-builder venues
(PG Pride, PGARA) and Facebook events that have no scrapable first-party feed.

## Per-source results & build status

| # | Source | Tech | Integration | Tag | Module | Status |
|---|--------|------|-------------|-----|--------|--------|
| 1 | fraserfinds.ca (calendar + sales) | Custom React + API | `/api/events` + `/api/sales` | `api` | `fraserfinds_ca` | ✅ Built |
| 2 | caledonianordic.com | WP + The Events Calendar | `/wp-json/tribe/events/v1/events` | `api` | `caledonianordic_com` | ✅ Built |
| 3 | tworiversgallery.ca | WP custom post types | `/wp-json/wp/v2/events` + `/programs` (ACF dates) | `api` | `tworiversgallery_com` | ✅ Built |
| 4 | northernlightswinery.ca | Squarespace + Eventbrite | `?format=json` collection feed | `api` | `northernlightswinery_ca` | ✅ Built |
| 5 | theexplorationplace.com | WP + The Events Calendar | same tribe API (shared lib) | `api` | `theexplorationplace_com` | ✅ Built¹ |
| 6 | ominecaartscentre.com | Google Sites + Google Calendar | public iCal feed (`/ical/.../public/basic.ics`) | `rss` | `ominecaartscentre_com` | ✅ Built |
| 7 | caledoniaramblers.ca | Drupal 11 | `/schedule` view table | `page-navigation` | `caledoniaramblers_ca` | ✅ Built |
| 8 | cncentre.ca | Drupal 10 | sitemap.xml → detail pages (ISO `<time>`) | `page-navigation` | `cncentre_ca` | ✅ Built |
| 9 | legion43pg.ca | WP + Modern Events Calendar | MEC REST (discovery) → event-page dates | `page-navigation` | `legion43pg_ca` | ✅ Built |
| 10 | pgpride.com | GoDaddy Website Builder | render + text-scan calendar widget | `page-navigation` | `pgpride_com` | ⚠️ Built (brittle)² |
| 11 | pgara.ca | Wix | render + text-scan race schedule | `page-navigation` | `pgara_ca` | ⚠️ Built (brittle)² |
| 12 | facebook.com/events/… | Facebook | Auth-walled + anti-bot | — | via `fraserfinds_ca` | ◐ Aggregator³ |

¹ The Exploration Place origin sits behind Cloudflare and returns HTTP 522 to
datacenter IP ranges. The module uses the same shared Events Calendar client and
runs from the worker's real browser; if Cloudflare still blocks it, Fraser Finds
re-publishes 300+ Exploration Place events as the fallback.

² BRITTLE. No scrapable first-party feed — the events are rendered client-side
by a JS website builder (GoDaddy / Wix). These modules RENDER the page with the
worker's real browser and text-scan for date-anchored events using heuristics,
so they WILL need adjustment when the builder changes its markup. Their pure
date-parsing logic is unit-tested against representative rendered fixtures, but
the live DOM extraction is best-effort. The `fraserfinds_ca` aggregator remains
the reliable fallback for both venues.

³ Auth-walled + anti-bot; not scrapable directly. Covered through the
`fraserfinds_ca` aggregator (36 Facebook events at time of probe).

## Notes on the API endpoints

- **The Events Calendar** (`caledonianordic`, `theexplorationplace`):
  `GET /wp-json/tribe/events/v1/events?per_page=50&page=N&start_date=…&end_date=…&status=publish`.
  Shared client/mapper in `worker/src/lib/tribe-events.ts`. Each event has
  site-local `start_date`/`end_date` + a `timezone` field, `all_day`, nested
  `venue`, `categories[]`, `cost`, `image.url`. `per_page` caps at 50; HTTP 400
  marks "past the last page."
- **Two Rivers Gallery**: `/wp-json/wp/v2/events` and `/programs`. Dates live in
  `acf.{start_date,end_date}` ("yyyyMMdd") and `acf.{start_time,end_time}`
  ("HH:mm:ss"). `?_embed=1` resolves the featured image.
- **Modern Events Calendar** (`legion43pg`): `wp/v2/mec-events` lists posts but
  omits start/end (they live in postmeta), so we parse each event page's MEC
  markup (`.mec-start-date-label` + `.mec-events-abbr` time).
- **Squarespace** (`northernlightswinery`): append `?format=json`; events are in
  `upcoming[]` with `startDate`/`endDate` epoch ms, `location`, `assetUrl`, and
  `sourceUrl` (the Eventbrite/shop ticket link).
- **Google Calendar iCal** (`ominecaartscentre`): the Google Sites page embeds a
  public calendar; `…/ical/<id>/public/basic.ics` is a clean VEVENT feed. The
  module includes a focused iCal parser with basic RRULE expansion.
- **Drupal** (`caledoniaramblers`, `cncentre`): server-rendered. Ramblers' meeting
  time is serialized with a spurious `Z`; we strip it and read it as PG-local.
  CN Centre's listing is AJAX, so we discover event URLs from `sitemap.xml`.

## Reuse — shared helpers

Common logic lives in `worker/src/lib/` so modules don't re-implement it:

- **`lib/tribe-events.ts`** — client + mapper for any WordPress site running
  "The Events Calendar" plugin, plus a **`createTribeModule({key, label,
  baseUrl, organizer})`** factory that returns a whole `ScraperModule`. A new
  such venue is ~10 lines (`caledonianordic_com`, `theexplorationplace_com`).
- **`lib/dom-extract.ts`** — `serializeExtractor` / `extractFromPage` /
  `fetchAndExtract`: author a DOM extractor once (jsdom-testable) and run it in
  the browser without re-writing the `page.evaluate(eval(...))` plumbing
  (`caledoniaramblers_ca`, `cncentre_ca`, `legion43pg_ca`, `pgpride_com`,
  `pgara_ca`).
- **`lib/wp.ts`** — `fetchJson` / `fetchText` (over `page.request`) and
  `paginateWpRest` (generic WordPress REST paginator). Used by the API/feed
  modules.
- **`lib/ical.ts`** — iCal (RFC 5545) parser with basic RRULE expansion, for
  Google Calendar / Teamup / Tockify feeds (`ominecaartscentre_com`).
- **`lib/dates.ts`** — timezone-aware date kit (`PG_TZ` + `localStringToIso`,
  `combineDateAndTime`, `epochMsToIso`, `normalizeIsoZone`, `isoFromNaiveZ`,
  `parseLooseDate`, `parseClockTime`, `rollForwardIfPast`). Every module's date
  helper now delegates here, so date bugs are fixed in one place.
- **`lib/text.ts`** — `decodeEntities` (HTML-entity decoding) shared across the
  API modules.
- **`lib/utils.ts`** — `delay`, `addJitter`, `normalizeEvent` (pre-existing).
