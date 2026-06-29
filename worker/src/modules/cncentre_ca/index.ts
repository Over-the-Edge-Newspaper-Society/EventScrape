import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';
import { PG_TZ, normalizeIsoZone } from '../../lib/dates.js';
import { fetchAndExtract } from '../../lib/dom-extract.js';
import { fetchText } from '../../lib/wp.js';

/**
 * CN Centre (cncentre.ca) — Prince George's arena. Drupal 10.
 *
 * The events listing is an AJAX-loaded Drupal view, but every event has a
 * server-rendered detail page at /events-tickets/events-calendar/<slug> with a
 * clean `<time datetime>` (ISO + offset) "when" field. We discover the event
 * URLs from sitemap.xml (no JS needed) and parse each detail page.
 * Tagged `page-navigation`.
 */

const BASE_URL = 'https://www.cncentre.ca';
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;
const EVENT_PATH = '/events-tickets/events-calendar/';
const DEFAULT_TZ = PG_TZ;

export interface RawCnEvent {
  title: string | null;
  startAttr: string | null;
  endAttr: string | null;
  descriptionHtml: string | null;
  imageUrl: string | null;
}

/** Pull event detail URLs out of the sitemap XML (Node-side, no DOM needed). */
export function extractEventUrlsFromSitemap(xml: string): string[] {
  const urls = new Set<string>();
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    // Match the event path but not the listing page itself.
    if (url.includes(EVENT_PATH) && !url.replace(/\/$/, '').endsWith('events-calendar')) {
      urls.add(url);
    }
  }
  return [...urls];
}

/** Self-contained detail extractor (serialized into the browser + jsdom-tested). */
export const extractEventFromDocument = (doc: Document): RawCnEvent => {
  const titleEl = doc.querySelector('h1 .field--name-title') || doc.querySelector('h1');
  const times = Array.from(doc.querySelectorAll('.field--name-field-when time'));
  const bodyEl = doc.querySelector('.field--name-body');
  const imgEl = doc.querySelector('.field--name-field-image img, .field--name-field-media-image img') as HTMLImageElement | null;
  const ogImg = doc.querySelector('meta[property="og:image"]');

  return {
    title: titleEl?.textContent?.replace(/\s+/g, ' ').trim() || null,
    startAttr: times[0]?.getAttribute('datetime') || null,
    endAttr: times.length > 1 ? times[times.length - 1].getAttribute('datetime') : null,
    descriptionHtml: bodyEl?.innerHTML?.trim() || null,
    imageUrl: imgEl?.getAttribute('src') || ogImg?.getAttribute('content') || null,
  };
};

/** Map a parsed detail page onto RawEvent. Returns null without a start date. */
export function mapCnEvent(raw: RawCnEvent, url: string, zone = DEFAULT_TZ): RawEvent | null {
  const start = normalizeIsoZone(raw.startAttr, zone);
  if (!start) return null;
  const end = normalizeIsoZone(raw.endAttr, zone);

  const event: RawEvent = {
    sourceEventId: url.replace(`${BASE_URL}${EVENT_PATH}`, '').replace(/\/$/, ''),
    title: raw.title || 'CN Centre Event',
    start,
    url,
    venueName: 'CN Centre',
    venueAddress: '2187 Ospika Blvd S, Prince George, BC',
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'CN Centre',
    category: 'Concert / Show',
    raw: { startAttr: raw.startAttr, endAttr: raw.endAttr, extractedAt: new Date().toISOString() },
  };
  if (end && end !== start) event.end = end;
  if (raw.descriptionHtml) event.descriptionHtml = raw.descriptionHtml;
  if (raw.imageUrl) event.imageUrl = raw.imageUrl;
  return event;
}

const cnCentreModule: ScraperModule = {
  key: 'cncentre_ca',
  label: 'CN Centre',
  startUrls: [`${BASE_URL}${EVENT_PATH}`],
  paginationType: 'none',
  integrationTags: ['page-navigation'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

    // 1) Discover event URLs from the sitemap.
    const sitemap = await fetchText(page, SITEMAP_URL);
    if (ctx.stats) ctx.stats.pagesCrawled++;
    if (!sitemap.ok || !sitemap.text) {
      logger.error(`sitemap.xml returned HTTP ${sitemap.status}`);
      throw new Error(`HTTP ${sitemap.status} from ${SITEMAP_URL}`);
    }
    const urls = extractEventUrlsFromSitemap(sitemap.text);
    logger.info(`Discovered ${urls.length} event URL(s) in sitemap`);

    const now = DateTime.now().setZone(zone).minus({ days: 1 });
    const targets = isTestMode ? urls.slice(0, 2) : urls;
    const events: RawEvent[] = [];

    // 2) Parse each detail page in the browser context.
    for (const [i, url] of targets.entries()) {
      try {
        const raw = await fetchAndExtract<RawCnEvent>(page, url, extractEventFromDocument);
        if (ctx.stats) ctx.stats.pagesCrawled++;
        if (!raw) { logger.warn(`Failed to fetch ${url}`); continue; }

        const event = mapCnEvent(raw, url, zone);
        if (!event) continue;
        // Skip events that already finished.
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

export default cnCentreModule;
