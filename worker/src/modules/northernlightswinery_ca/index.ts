import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { PG_TZ, epochMsToIso } from '../../lib/dates.js';
import { decodeEntities } from '../../lib/text.js';
import { fetchJson } from '../../lib/wp.js';

// Re-export shared helpers for this module's tests.
export { decodeEntities };
/** Epoch ms → ISO string in the venue timezone, floored to the minute. */
export const msToIso = epochMsToIso;

/**
 * Northern Lights Estate Winery (northernlightswinery.ca) — Squarespace.
 *
 * Squarespace exposes any collection as JSON by appending `?format=json`. The
 * events-calendar collection returns `{ upcoming: [...], past: [...] }` where
 * each item has `startDate`/`endDate` as epoch milliseconds, `title`,
 * `fullUrl`, `body`/`excerpt` HTML, `location` (address + lat/lng), `assetUrl`
 * (image) and `sourceUrl` (the Eventbrite / shop ticket link). Tagged `api`.
 */

const BASE_URL = 'https://www.northernlightswinery.ca';
const COLLECTION_PATH = '/events-calendar';
const DEFAULT_TZ = PG_TZ;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000; // ignore end dates implausibly far out

// --- Squarespace shapes (only what we use) -----------------------------------

export interface SqsLocation {
  addressTitle?: string;
  addressLine1?: string;
  addressLine2?: string;
  mapLat?: number;
  mapLng?: number;
}

export interface SqsEventItem {
  id: string;
  title?: string;
  startDate?: number; // epoch ms
  endDate?: number;   // epoch ms
  fullUrl?: string;   // relative
  sourceUrl?: string; // external ticket link
  body?: string;
  excerpt?: string;
  assetUrl?: string;
  location?: SqsLocation;
  categories?: string[];
}

export interface SqsCollectionResponse {
  upcoming?: SqsEventItem[];
  past?: SqsEventItem[];
}

// --- Pure helpers (unit-tested) ----------------------------------------------

function buildAddress(loc?: SqsLocation): string | undefined {
  if (!loc) return undefined;
  const parts = [loc.addressLine1, loc.addressLine2].map(p => (p || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

/** Map a Squarespace event item onto RawEvent. Returns null if no start date. */
export function mapSquarespaceItem(item: SqsEventItem, zone = DEFAULT_TZ): RawEvent | null {
  const start = msToIso(item.startDate, zone);
  if (!start) return null;

  // Only honour an end date when it sits within a day of the start; Squarespace
  // reports a far-future endDate for recurring items, which we don't want to
  // treat as one multi-month event.
  let end: string | undefined;
  if (typeof item.startDate === 'number' && typeof item.endDate === 'number') {
    const dur = item.endDate - item.startDate;
    if (dur > 0 && dur <= MAX_DURATION_MS) end = msToIso(item.endDate, zone);
  }

  const loc = item.location;
  const event: RawEvent = {
    sourceEventId: item.id,
    title: decodeEntities(item.title) || 'Untitled Event',
    start,
    url: item.fullUrl ? `${BASE_URL}${item.fullUrl}` : `${BASE_URL}${COLLECTION_PATH}`,
    venueName: loc?.addressTitle ? decodeEntities(loc.addressTitle) : 'Northern Lights Estate Winery',
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Northern Lights Estate Winery',
    category: item.categories?.[0] ? decodeEntities(item.categories[0]) : 'Food & Drink',
    raw: {
      sqsId: item.id,
      startMs: item.startDate ?? null,
      endMs: item.endDate ?? null,
      ticketUrl: item.sourceUrl || null,
      extractedAt: new Date().toISOString(),
    },
  };

  if (end && end !== start) event.end = end;
  const address = buildAddress(loc);
  if (address) event.venueAddress = address;
  if (typeof loc?.mapLat === 'number') event.lat = loc.mapLat;
  if (typeof loc?.mapLng === 'number') event.lon = loc.mapLng;
  const html = item.body || item.excerpt;
  if (html) event.descriptionHtml = html;
  if (item.assetUrl) event.imageUrl = item.assetUrl;

  return event;
}

// --- Module ------------------------------------------------------------------

const wineryModule: ScraperModule = {
  key: 'northernlightswinery_ca',
  label: 'Northern Lights Estate Winery',
  startUrls: [`${BASE_URL}${COLLECTION_PATH}`],
  paginationType: 'none',
  integrationTags: ['api'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;
    const events: RawEvent[] = [];

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label} via Squarespace JSON`);

    const url = `${BASE_URL}${COLLECTION_PATH}?format=json`;
    const { ok, status, data } = await fetchJson<SqsCollectionResponse>(page, url);
    if (ctx.stats) ctx.stats.pagesCrawled++;
    if (!ok || !data) {
      logger.error(`Squarespace JSON returned HTTP ${status}`);
      throw new Error(`HTTP ${status} from ${url}`);
    }

    const items = data.upcoming || [];
    const slice = isTestMode ? items.slice(0, 3) : items;
    logger.info(`Squarespace returned ${items.length} upcoming item(s)`);

    for (const item of slice) {
      const e = mapSquarespaceItem(item, zone);
      if (e) events.push(e);
      else logger.warn(`Skipped item without start date: ${item.id}`);
    }

    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default wineryModule;
