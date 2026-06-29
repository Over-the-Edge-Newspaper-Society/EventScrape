import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

/**
 * Fraser Finds (fraserfinds.ca) — Prince George community hub.
 *
 * Fraser Finds is itself an *aggregator*: it crawls many local venues and
 * exposes the results through its own JSON API. We read two endpoints:
 *
 *   GET /api/events  → an aggregated community calendar. Each event keeps the
 *                      original `source` name and a `link` back to the source
 *                      page, so we preserve that attribution rather than
 *                      claiming Fraser Finds as the origin.
 *   GET /api/sales   → neighbourhood garage / yard sales (not covered anywhere
 *                      else), each with one or more dated days.
 *
 * Sources Fraser Finds aggregates from (observed): The Exploration Place,
 * PG Public Library, Hart Pioneer Centre, Two Rivers Gallery, City of Prince
 * George, PG Golf & Curling, Caledonia Ramblers, Farmers Market, PG Symphony,
 * CN Centre, Northern Lights Winery, Omineca Arts Centre, PGARA, Tourism PG,
 * Legion, Theatre NorthWest, BCNE, Caledonia Nordic, and Facebook events.
 */

const BASE_URL = 'https://fraserfinds.ca';
const DEFAULT_TZ = 'America/Vancouver';
const AGGREGATOR = 'fraserfinds.ca';

// --- API shapes (only the fields we consume) ---------------------------------

export interface FraserFindsEvent {
  id: string;
  title: string;
  date: string;            // "yyyy-MM-dd"
  start?: string;          // "10:00 AM" or ""
  end?: string;            // "12:00 PM" or ""
  venue?: string;
  category?: string;
  description?: string;
  link?: string;           // original source page
  photos?: string[];
  recurring?: boolean;
  recurrence?: string;
  source?: string;         // original source name, e.g. "Exploration Place"
  lat?: number;
  lng?: number;
}

export interface FraserFindsSaleDay {
  date: string;            // "yyyy-MM-dd"
  start?: string;
  end?: string;
}

export interface FraserFindsSale {
  id: string;
  address?: string;
  categories?: string;
  weatherPolicy?: string;
  description?: string;
  photo?: string[];
  days?: FraserFindsSaleDay[];
  lat?: number;
  lng?: number;
}

// --- Pure helpers (unit-tested) ----------------------------------------------

/**
 * Combine a "yyyy-MM-dd" date and an optional "h:mm AM/PM" time into an ISO
 * string with the venue's timezone offset. When the time is missing we treat
 * it as an all-day event starting at midnight local time.
 */
export function combineDateTime(date: string, time: string | undefined, zone = DEFAULT_TZ): string | undefined {
  if (!date) return undefined;
  const t = (time || '').trim();
  if (t) {
    const dt = DateTime.fromFormat(`${date} ${t}`, 'yyyy-MM-dd h:mm a', { zone });
    if (dt.isValid) return dt.toISO() ?? undefined;
  }
  const dateOnly = DateTime.fromFormat(date, 'yyyy-MM-dd', { zone });
  return dateOnly.isValid ? (dateOnly.toISO() ?? undefined) : undefined;
}

/** Derive a readable source/host label from the original link. */
export function sourceHost(link?: string): string | undefined {
  if (!link) return undefined;
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Map an aggregated Fraser Finds event onto RawEvent, preserving attribution. */
export function mapAggregatedEvent(ev: FraserFindsEvent, zone = DEFAULT_TZ): RawEvent | null {
  const start = combineDateTime(ev.date, ev.start, zone);
  if (!start) return null;
  const end = combineDateTime(ev.date, ev.end, zone);

  const originalLink = ev.link?.trim();
  const originalSource = ev.source?.trim();

  const event: RawEvent = {
    sourceEventId: ev.id,
    title: (ev.title || 'Untitled Event').trim(),
    start,
    // Link back to the ORIGINAL source page when we have one, so the canonical
    // URL points at the venue rather than the aggregator.
    url: originalLink || `${BASE_URL}/#calendar`,
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    // Attribute the event to its original source, noting it came via Fraser Finds.
    organizer: originalSource || 'Fraser Finds',
    raw: {
      aggregatedVia: AGGREGATOR,
      originalSource: originalSource || null,
      originalSourceHost: sourceHost(originalLink) || null,
      originalLink: originalLink || null,
      recurring: ev.recurring ?? false,
      recurrence: ev.recurrence || null,
      startTimeText: ev.start || null,
      endTimeText: ev.end || null,
      extractedAt: new Date().toISOString(),
    },
  };

  if (end && end !== start) event.end = end;
  if (ev.description) event.descriptionHtml = ev.description;
  if (ev.venue) event.venueName = ev.venue;
  if (ev.category) event.category = ev.category;
  if (typeof ev.lat === 'number') event.lat = ev.lat;
  if (typeof ev.lng === 'number') event.lon = ev.lng;
  if (ev.photos && ev.photos.length) event.imageUrl = ev.photos[0];

  return event;
}

/** Expand a garage sale into one RawEvent per scheduled day. */
export function mapSaleToEvents(sale: FraserFindsSale, zone = DEFAULT_TZ): RawEvent[] {
  const days = sale.days || [];
  const baseTitle = sale.address ? `Garage Sale — ${sale.address}` : 'Garage Sale';

  return days
    .map((day): RawEvent | null => {
      const start = combineDateTime(day.date, day.start, zone);
      if (!start) return null;
      const end = combineDateTime(day.date, day.end, zone);

      const event: RawEvent = {
        sourceEventId: `${sale.id}#${day.date}`,
        title: baseTitle,
        start,
        url: `${BASE_URL}/garagesales`,
        city: 'Prince George',
        region: 'British Columbia',
        country: 'Canada',
        organizer: 'Fraser Finds',
        category: 'Garage Sale',
        raw: {
          aggregatedVia: AGGREGATOR,
          saleId: sale.id,
          categories: sale.categories || null,
          weatherPolicy: sale.weatherPolicy || null,
          day,
          extractedAt: new Date().toISOString(),
        },
      };

      if (end && end !== start) event.end = end;
      if (sale.description) event.descriptionHtml = sale.description;
      if (sale.address) event.venueAddress = sale.address;
      if (typeof sale.lat === 'number') event.lat = sale.lat;
      if (typeof sale.lng === 'number') event.lon = sale.lng;
      if (sale.photo && sale.photo.length) event.imageUrl = sale.photo[0];

      return event;
    })
    .filter((e): e is RawEvent => e !== null);
}

// --- Module ------------------------------------------------------------------

const fraserFindsModule: ScraperModule = {
  key: 'fraserfinds_ca',
  label: 'Fraser Finds (Prince George Community Hub)',
  startUrls: [`${BASE_URL}/`],
  paginationType: 'none',
  integrationTags: ['api'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;
    const events: RawEvent[] = [];

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label} (aggregator JSON API)`);

    // 1) Aggregated community calendar -------------------------------------
    try {
      const url = `${BASE_URL}/api/events`;
      logger.info(`Fetching aggregated events: ${url}`);
      const res = await page.request.get(url, { timeout: 30000 });
      if (ctx.stats) ctx.stats.pagesCrawled++;
      if (res.ok()) {
        const body = (await res.json()) as FraserFindsEvent[];
        const list = Array.isArray(body) ? body : [];
        const slice = isTestMode ? list.slice(0, 5) : list;
        let mapped = 0;
        for (const ev of slice) {
          const e = mapAggregatedEvent(ev, zone);
          if (e) { events.push(e); mapped++; }
        }
        // Surface what the aggregator pulled from, for visibility in logs.
        const bySource = new Map<string, number>();
        for (const ev of list) {
          const s = ev.source || sourceHost(ev.link) || 'unknown';
          bySource.set(s, (bySource.get(s) || 0) + 1);
        }
        const summary = [...bySource.entries()].sort((a, b) => b[1] - a[1])
          .map(([s, n]) => `${s}(${n})`).join(', ');
        logger.info(`Mapped ${mapped} aggregated events. Sources: ${summary}`);
      } else {
        logger.warn(`/api/events returned HTTP ${res.status()}`);
      }
    } catch (err) {
      logger.warn(`Failed to fetch aggregated events: ${err}`);
    }

    await delay(addJitter(1000, 50));

    // 2) Garage sales ------------------------------------------------------
    try {
      const url = `${BASE_URL}/api/sales`;
      logger.info(`Fetching garage sales: ${url}`);
      const res = await page.request.get(url, { timeout: 30000 });
      if (ctx.stats) ctx.stats.pagesCrawled++;
      if (res.ok()) {
        const body = (await res.json()) as FraserFindsSale[];
        const list = Array.isArray(body) ? body : [];
        const slice = isTestMode ? list.slice(0, 3) : list;
        let mapped = 0;
        for (const sale of slice) {
          const saleEvents = mapSaleToEvents(sale, zone);
          events.push(...saleEvents);
          mapped += saleEvents.length;
        }
        logger.info(`Mapped ${mapped} garage-sale day events from ${slice.length} sale(s)`);
      } else {
        logger.warn(`/api/sales returned HTTP ${res.status()}`);
      }
    } catch (err) {
      logger.warn(`Failed to fetch garage sales: ${err}`);
    }

    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default fraserFindsModule;
