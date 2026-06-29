import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

/**
 * Caledonia Nordic Ski Club (caledonianordic.com)
 *
 * The site runs WordPress with "The Events Calendar" plugin, which exposes a
 * public REST API at /wp-json/tribe/events/v1/events. We read that JSON feed
 * directly instead of scraping HTML — it returns fully structured events
 * (start/end with timezone, venue, categories, cost, image), so this module is
 * tagged `api` rather than `calendar`/`page-navigation`.
 *
 * API reference: https://theeventscalendar.com/knowledgebase/k/rest-api-events/
 */

const BASE_URL = 'https://caledonianordic.com';
const API_PATH = '/wp-json/tribe/events/v1/events';
const DEFAULT_TZ = 'America/Vancouver';
const MAX_PER_PAGE = 50; // The Events Calendar caps per_page at 50

// --- Tribe API shapes (loosely typed — only the fields we consume) -----------

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
  end_date?: string;         // site-local, "yyyy-MM-dd HH:mm:ss"
  utc_start_date?: string;
  utc_end_date?: string;
  timezone?: string;         // e.g. "America/Vancouver"
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

// --- Pure helpers (unit-tested against the fixture) --------------------------

/** Decode the handful of HTML entities WordPress emits in titles/categories. */
export function decodeEntities(input?: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/g, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

/** Convert a site-local "yyyy-MM-dd HH:mm:ss" string + zone into an ISO string. */
export function toIsoWithZone(local?: string, zone: string = DEFAULT_TZ): string | undefined {
  if (!local) return undefined;
  const dt = DateTime.fromFormat(local, 'yyyy-MM-dd HH:mm:ss', { zone });
  return dt.isValid ? (dt.toISO() ?? undefined) : undefined;
}

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

/**
 * Map a single Tribe API event onto the canonical RawEvent shape.
 * Falls back sensibly when optional fields are missing.
 */
export function mapTribeEventToRawEvent(ev: TribeEvent): RawEvent {
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
    city: venue?.city || 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: organizerName ? decodeEntities(organizerName) : 'Caledonia Nordic Ski Club',
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

// --- Module ------------------------------------------------------------------

const caledoniaNordicModule: ScraperModule = {
  key: 'caledonianordic_com',
  label: 'Caledonia Nordic Ski Club',
  startUrls: [`${BASE_URL}/events/`],
  paginationType: 'calendar',
  integrationTags: ['api'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const scrapeMode = jobData?.scrapeMode || 'full';
    const paginationOptions = jobData?.paginationOptions;

    logger.info(`Starting ${isTestMode ? 'test ' : scrapeMode} scrape of ${this.label} via Events Calendar REST API`);

    // Determine the date window to request.
    const now = DateTime.now().setZone(DEFAULT_TZ);
    let startDate = paginationOptions?.startDate || now.toFormat('yyyy-MM-dd');
    let endDate = paginationOptions?.endDate;
    if (!endDate) {
      const monthsAhead = isTestMode ? 1 : 12;
      endDate = now.plus({ months: monthsAhead }).toFormat('yyyy-MM-dd');
    }
    logger.info(`Requesting events from ${startDate} to ${endDate}`);

    const perPage = isTestMode ? 10 : MAX_PER_PAGE;
    const maxPages = isTestMode ? 1 : 25; // safety cap (25 * 50 = 1250 events)
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
      const url = `${BASE_URL}${API_PATH}?${params.toString()}`;

      logger.info(`Fetching API page ${pageNum}: ${url}`);
      // Use Playwright's request context so we share the worker's network stack.
      const response = await page.request.get(url, { timeout: 30000 });
      if (ctx.stats) ctx.stats.pagesCrawled++;

      if (!response.ok()) {
        // 400 is how The Events Calendar signals "page beyond the last" — treat as end.
        if (response.status() === 400 && pageNum > 1) {
          logger.info(`Reached end of pages at page ${pageNum} (HTTP 400)`);
          break;
        }
        logger.warn(`API request failed: HTTP ${response.status()} for page ${pageNum}`);
        break;
      }

      const { events: apiEvents, totalPages, total } = parseEventsResponse(await response.json());
      if (pageNum === 1) {
        logger.info(`API reports ${total} event(s) across ${totalPages} page(s)`);
      }

      for (const apiEvent of apiEvents) {
        try {
          const mapped = mapTribeEventToRawEvent(apiEvent);
          const dedupeKey = mapped.sourceEventId || mapped.url;
          if (dedupeKey && seen.has(dedupeKey)) continue;
          if (dedupeKey) seen.add(dedupeKey);
          events.push(mapped);
        } catch (err) {
          logger.warn(`Failed to map event ${apiEvent?.id}: ${err}`);
        }
      }

      if (apiEvents.length === 0 || pageNum >= totalPages) break;

      // Be polite between page requests.
      await delay(addJitter(1000, 50));
    }

    logger.info(`Scrape completed. Total events: ${events.length}, API pages crawled: ${ctx.stats?.pagesCrawled ?? 0}`);
    return events;
  },
};

export default caledoniaNordicModule;
