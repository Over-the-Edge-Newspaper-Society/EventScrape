import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';
import { fetchAndExtract } from '../../lib/dom-extract.js';
import { paginateWpRest } from '../../lib/wp.js';

/**
 * Royal Canadian Legion Branch 43 (legion43pg.ca) — WordPress + Modern Events
 * Calendar (MEC).
 *
 * MEC's default REST route (/wp-json/wp/v2/mec-events) lists event posts but
 * does NOT expose start/end dates (they live in postmeta). So we use the REST
 * route only to discover event URLs, then parse the dates from each event
 * page's MEC markup (.mec-start-date-label + .mec-events-abbr time).
 * Tagged `page-navigation`.
 */

const BASE_URL = 'https://legion43pg.ca';
const DEFAULT_TZ = 'America/Vancouver';

interface McePost { id: number; link: string }

export interface RawMecEvent {
  title: string | null;
  startDateLabel: string | null; // "Jul 01 2026"
  endDateLabel: string | null;
  timeText: string | null;       // "6:00 pm - 9:00 pm"
  descriptionHtml: string | null;
  imageUrl: string | null;
}

/** Self-contained MEC detail extractor (serialized into browser + jsdom-tested). */
export const extractMecEventFromDocument = (doc: Document): RawMecEvent => {
  const txt = (sel: string): string | null => {
    const el = doc.querySelector(sel);
    const t = el?.textContent?.replace(/\s+/g, ' ').trim();
    return t ? t : null;
  };
  const timeEl = doc.querySelector('.mec-single-event-time .mec-events-abbr');
  const descEl = doc.querySelector('.mec-single-event-description, .mec-event-content');
  const imgEl = doc.querySelector('.mec-events-event-image img') as HTMLImageElement | null;
  const ogImg = doc.querySelector('meta[property="og:image"]');

  return {
    title: txt('.mec-single-title') || txt('h1'),
    startDateLabel: txt('.mec-start-date-label'),
    endDateLabel: txt('.mec-end-date-label'),
    timeText: timeEl?.textContent?.replace(/\s+/g, ' ').trim() || null,
    descriptionHtml: descEl?.innerHTML?.trim() || null,
    imageUrl: imgEl?.getAttribute('src') || ogImg?.getAttribute('content') || null,
  };
};

function combine(dateLabel: string | null, timeStr: string | null, zone: string): string | undefined {
  if (!dateLabel) return undefined;
  const t = (timeStr || '').trim();
  const fmt = t ? 'MMM d yyyy h:mm a' : 'MMM d yyyy';
  const dt = DateTime.fromFormat(t ? `${dateLabel} ${t}` : dateLabel, fmt, { zone });
  return dt.isValid ? (dt.toISO() ?? undefined) : undefined;
}

/** Split "6:00 pm - 9:00 pm" into [start, end]. */
export function splitTimeRange(timeText: string | null): [string | null, string | null] {
  if (!timeText) return [null, null];
  const parts = timeText.split(/\s*[-–—]\s*/);
  return [parts[0]?.trim() || null, parts[1]?.trim() || null];
}

/** Map a parsed MEC event page onto RawEvent. Returns null without a start. */
export function mapMecEvent(raw: RawMecEvent, url: string, zone = DEFAULT_TZ): RawEvent | null {
  const [startTime, endTime] = splitTimeRange(raw.timeText);
  const start = combine(raw.startDateLabel, startTime, zone);
  if (!start) return null;
  const end = combine(raw.endDateLabel || raw.startDateLabel, endTime, zone);

  const event: RawEvent = {
    sourceEventId: url.replace(`${BASE_URL}/events/`, '').replace(/\/$/, '') || url,
    title: raw.title || 'Legion Event',
    start,
    url,
    venueName: 'Royal Canadian Legion Branch 43',
    venueAddress: '1116 6th Ave, Prince George, BC',
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Royal Canadian Legion Branch 43',
    category: 'Community Event',
    raw: {
      startDateLabel: raw.startDateLabel,
      endDateLabel: raw.endDateLabel,
      timeText: raw.timeText,
      extractedAt: new Date().toISOString(),
    },
  };
  if (end && end !== start) event.end = end;
  if (raw.descriptionHtml) event.descriptionHtml = raw.descriptionHtml;
  if (raw.imageUrl) event.imageUrl = raw.imageUrl;
  return event;
}

const legionModule: ScraperModule = {
  key: 'legion43pg_ca',
  label: 'Royal Canadian Legion Branch 43',
  startUrls: [`${BASE_URL}/events/`],
  paginationType: 'none',
  integrationTags: ['page-navigation'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

    // 1) Discover event URLs from the MEC REST route.
    const posts = await paginateWpRest<McePost>(page, `${BASE_URL}/wp-json/wp/v2/mec-events`, {
      perPage: 100,
      maxPages: isTestMode ? 1 : 10,
      query: { status: 'publish' },
      logger,
      onPage: () => { if (ctx.stats) ctx.stats.pagesCrawled++; },
    });
    const links = posts.map(p => p.link).filter(Boolean);
    logger.info(`Discovered ${links.length} MEC event(s)`);

    const now = DateTime.now().setZone(zone).minus({ days: 1 });
    const targets = isTestMode ? links.slice(0, 2) : links;
    const events: RawEvent[] = [];

    // 2) Parse the date off each event page.
    for (const [i, url] of targets.entries()) {
      try {
        const raw = await fetchAndExtract<RawMecEvent>(page, url, extractMecEventFromDocument);
        if (ctx.stats) ctx.stats.pagesCrawled++;
        if (!raw) { logger.warn(`Failed to fetch ${url}`); continue; }

        const event = mapMecEvent(raw, url, zone);
        if (!event) { logger.warn(`No parseable date for ${url}`); continue; }
        if (!isTestMode && DateTime.fromISO(event.start) < now) continue;
        events.push(event);
      } catch (err) {
        logger.warn(`Error processing ${url}: ${err}`);
      }
      if (i < targets.length - 1) await delay(addJitter(800, 50));
    }

    logger.info(`Scrape completed. Total upcoming events: ${events.length}`);
    return events;
  },
};

export default legionModule;
