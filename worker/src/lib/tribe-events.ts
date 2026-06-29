import { DateTime } from 'luxon';
import type { Page } from 'playwright';
import type { RawEvent, ScraperModule, RunContext } from '../types.js';
import { delay, addJitter } from './utils.js';
import { decodeEntities } from './text.js';
import { PG_TZ, localStringToIso } from './dates.js';
import { fetchJson } from './wp.js';

// Re-export shared helpers so existing importers (and their tests) keep working.
export { decodeEntities } from './text.js';
/** Site-local "yyyy-MM-dd HH:mm:ss" → ISO with the zone's offset. */
export const toIsoWithZone = localStringToIso;

/**
 * Shared client + mapper for WordPress sites running "The Events Calendar"
 * plugin, which exposes a public REST API at
 *   /wp-json/tribe/events/v1/events
 *
 * Used by any module whose site runs that plugin (e.g. caledonianordic.com,
 * theexplorationplace.com). Keeping the mapping here means the date/venue/
 * entity-decoding logic is written and tested once.
 *
 * API reference: https://theeventscalendar.com/knowledgebase/k/rest-api-events/
 */

const DEFAULT_TZ = PG_TZ;
const MAX_PER_PAGE = 50; // The Events Calendar caps per_page at 50

// --- Tribe API shapes (only the fields we consume) ---------------------------

export interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  province?: string;
  state?: string;
  stateprovince?: string;
  zip?: string;
  country?: string;
  website?: string;
}

export interface TribeEvent {
  id: number;
  url: string;
  title: string;
  description?: string;
  excerpt?: string;
  start_date?: string;       // site-local, "yyyy-MM-dd HH:mm:ss"
  end_date?: string;
  utc_start_date?: string;
  utc_end_date?: string;
  timezone?: string;
  all_day?: boolean;
  cost?: string;
  venue?: TribeVenue | unknown[];
  categories?: Array<{ name?: string }>;
  organizer?: Array<{ organizer?: string }> | unknown[];
  image?: { url?: string } | false | string;
}

export interface TribeEventsResponse {
  events?: TribeEvent[];
  total?: number;
  total_pages?: number;
  rest_url?: string;
}

export interface TribeMapDefaults {
  organizer: string;
  city?: string;
  region?: string;
  country?: string;
}

// --- Pure helpers (unit-tested) ----------------------------------------------

function isVenueObject(v: TribeEvent['venue']): v is TribeVenue {
  return !!v && !Array.isArray(v) && typeof v === 'object';
}

/** Join the venue address parts the API exposes into a single address line. */
export function buildVenueAddress(venue?: TribeVenue): string | undefined {
  if (!venue) return undefined;
  const region = venue.stateprovince || venue.province || venue.state;
  const parts = [venue.address, venue.city, region, venue.zip]
    .map(p => (p || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function imageUrl(image: TribeEvent['image']): string | undefined {
  if (!image) return undefined;
  if (typeof image === 'string') return image;
  return image.url || undefined;
}

/** Map a single Tribe API event onto the canonical RawEvent shape. */
export function mapTribeEventToRawEvent(ev: TribeEvent, defaults: TribeMapDefaults): RawEvent {
  const zone = ev.timezone || DEFAULT_TZ;
  const venue = isVenueObject(ev.venue) ? ev.venue : undefined;

  const start = toIsoWithZone(ev.start_date, zone) || ev.utc_start_date || ev.start_date || '';
  const end = toIsoWithZone(ev.end_date, zone);

  const category = ev.categories?.find(c => c.name)?.name;
  const organizerName = Array.isArray(ev.organizer)
    ? (ev.organizer as Array<{ organizer?: string }>).find(o => o?.organizer)?.organizer
    : undefined;

  const event: RawEvent = {
    sourceEventId: String(ev.id),
    title: decodeEntities(ev.title) || 'Untitled Event',
    start,
    url: ev.url,
    city: venue?.city || defaults.city || 'Prince George',
    region: defaults.region || 'British Columbia',
    country: defaults.country || 'Canada',
    organizer: organizerName ? decodeEntities(organizerName) : defaults.organizer,
    raw: {
      apiId: ev.id,
      allDay: ev.all_day ?? false,
      timezone: zone,
      startLocal: ev.start_date,
      endLocal: ev.end_date,
      utcStart: ev.utc_start_date,
      utcEnd: ev.utc_end_date,
      categories: (ev.categories || []).map(c => decodeEntities(c.name)).filter(Boolean),
      extractedAt: new Date().toISOString(),
    },
  };

  if (end) event.end = end;
  if (ev.description) event.descriptionHtml = ev.description;
  if (category) event.category = decodeEntities(category);
  if (ev.cost && ev.cost.trim()) event.price = ev.cost.trim();
  if (venue?.venue) event.venueName = decodeEntities(venue.venue);

  const address = buildVenueAddress(venue);
  if (address) event.venueAddress = address;

  const img = imageUrl(ev.image);
  if (img) event.imageUrl = img;

  return event;
}

/** Normalize a raw API response body into a typed, defensively-defaulted shape. */
export function parseEventsResponse(body: unknown): {
  events: TribeEvent[];
  totalPages: number;
  total: number;
} {
  const data = (body || {}) as TribeEventsResponse;
  const events = Array.isArray(data.events) ? data.events : [];
  return {
    events,
    totalPages: typeof data.total_pages === 'number' ? data.total_pages : 1,
    total: typeof data.total === 'number' ? data.total : events.length,
  };
}

// --- Fetcher -----------------------------------------------------------------

export interface FetchTribeOptions {
  startDate: string;     // yyyy-MM-dd
  endDate: string;       // yyyy-MM-dd
  perPage?: number;
  maxPages?: number;
  logger: { info: (m: string) => void; warn: (m: string) => void };
  defaults: TribeMapDefaults;
  onPage?: () => void;   // e.g. increment ctx.stats.pagesCrawled
}

/**
 * Page through a site's Events Calendar REST API and return mapped RawEvents.
 * Uses Playwright's request context so we share the worker's network stack.
 */
export async function fetchTribeEvents(
  page: Page,
  baseUrl: string,
  opts: FetchTribeOptions,
): Promise<RawEvent[]> {
  const { startDate, endDate, logger, defaults } = opts;
  const perPage = opts.perPage ?? MAX_PER_PAGE;
  const maxPages = opts.maxPages ?? 25;
  const apiBase = `${baseUrl.replace(/\/$/, '')}/wp-json/tribe/events/v1/events`;

  const seen = new Set<string>();
  const events: RawEvent[] = [];

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const params = new URLSearchParams({
      page: String(pageNum),
      per_page: String(perPage),
      start_date: startDate,
      end_date: endDate,
      status: 'publish',
    });
    const url = `${apiBase}?${params.toString()}`;
    logger.info(`Fetching Events Calendar API page ${pageNum}: ${url}`);

    const { ok, status, data } = await fetchJson(page, url);
    opts.onPage?.();

    if (!ok) {
      if (status === 400 && pageNum > 1) {
        logger.info(`Reached end of pages at page ${pageNum} (HTTP 400)`);
        break;
      }
      logger.warn(`API request failed: HTTP ${status} for page ${pageNum}`);
      break;
    }

    const { events: apiEvents, totalPages, total } = parseEventsResponse(data);
    if (pageNum === 1) logger.info(`API reports ${total} event(s) across ${totalPages} page(s)`);

    for (const apiEvent of apiEvents) {
      try {
        const mapped = mapTribeEventToRawEvent(apiEvent, defaults);
        const key = mapped.sourceEventId || mapped.url;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        events.push(mapped);
      } catch (err) {
        logger.warn(`Failed to map event ${apiEvent?.id}: ${err}`);
      }
    }

    if (apiEvents.length === 0 || pageNum >= totalPages) break;
    await delay(addJitter(1000, 50));
  }

  return events;
}

// --- Module factory ----------------------------------------------------------

export interface TribeModuleConfig {
  key: string;
  label: string;
  baseUrl: string;
  organizer: string;
  startPath?: string;       // default '/events/'
  fullMonths?: number;      // forward window in full mode (default 12)
  testMonths?: number;      // forward window in test mode (default 1)
  /** Emit a Cloudflare/aggregator-fallback hint when 0 events come back. */
  cloudflareNote?: boolean;
}

/**
 * Build a complete ScraperModule for a WordPress site running "The Events
 * Calendar". Collapses a per-venue module to its config; the run() body (date
 * window + paginated fetch + mapping) lives here once.
 */
export function createTribeModule(config: TribeModuleConfig): ScraperModule {
  const startPath = config.startPath ?? '/events/';
  const defaults: TribeMapDefaults = { organizer: config.organizer };

  return {
    key: config.key,
    label: config.label,
    startUrls: [`${config.baseUrl}${startPath}`],
    paginationType: 'calendar',
    integrationTags: ['api'],

    async run(ctx: RunContext): Promise<RawEvent[]> {
      const { page, logger, jobData } = ctx;
      const isTestMode = jobData?.testMode === true;
      const paginationOptions = jobData?.paginationOptions;

      logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${config.label} via Events Calendar REST API`);

      const now = DateTime.now().setZone(PG_TZ);
      const months = isTestMode ? (config.testMonths ?? 1) : (config.fullMonths ?? 12);
      const startDate = paginationOptions?.startDate || now.toFormat('yyyy-MM-dd');
      const endDate = paginationOptions?.endDate || now.plus({ months }).toFormat('yyyy-MM-dd');
      logger.info(`Requesting events from ${startDate} to ${endDate}`);

      const events = await fetchTribeEvents(page, config.baseUrl, {
        startDate,
        endDate,
        perPage: isTestMode ? 10 : 50,
        maxPages: isTestMode ? 1 : 25,
        logger,
        defaults,
        onPage: () => { if (ctx.stats) ctx.stats.pagesCrawled++; },
      });

      if (events.length === 0 && config.cloudflareNote) {
        logger.warn('No events returned — the origin may be blocking this IP (Cloudflare 522). Consider the fraserfinds_ca aggregator as a fallback.');
      }
      logger.info(`Scrape completed. Total events: ${events.length}`);
      return events;
    },
  };
}
