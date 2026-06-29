import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { PG_TZ, isoFromNaiveZ } from '../../lib/dates.js';
import { extractFromPage } from '../../lib/dom-extract.js';

/**
 * Caledonia Ramblers Hiking Club (caledoniaramblers.ca) — Drupal.
 *
 * The /schedule page is a server-rendered Drupal view table, one row per
 * upcoming hike, with a `<time datetime>` meeting time, a destination link,
 * and metadata columns (cost, difficulty, duration, distance, elevation,
 * trip leader). We parse that table (tag `page-navigation`).
 *
 * The site also has an RSS feed at /events/feed, but it omits hike dates, so
 * the schedule table is the authoritative source.
 */

const BASE_URL = 'https://www.caledoniaramblers.ca';
const DEFAULT_TZ = PG_TZ;

export interface RawHike {
  title: string | null;
  relativeUrl: string | null;
  dateAttr: string | null;      // Date column <time datetime>
  meetingAttr: string | null;   // Meeting Time column <time datetime>
  meetingText: string | null;
  cost: string | null;
  difficulty: string | null;
  duration: string | null;
  distance: string | null;
  elevation: string | null;
  leader: string | null;
  cancelled: boolean;
}

/**
 * Extract hike rows from the schedule document. Self-contained (no closures)
 * so it can be serialized and run inside the browser via page.evaluate, and
 * also unit-tested against a jsdom Document.
 */
export const extractHikesFromDocument = (doc: Document): RawHike[] => {
  const text = (el: Element | null): string | null => {
    const t = el?.textContent?.replace(/\s+/g, ' ').trim();
    return t ? t : null;
  };
  const rows = Array.from(doc.querySelectorAll('table tr'));
  const hikes: RawHike[] = [];

  for (const row of rows) {
    const link = row.querySelector('td.views-field-title a') as HTMLAnchorElement | null;
    if (!link) continue; // header / non-hike rows

    const dateEl = row.querySelector('td.views-field-field-trip-end-date time');
    const meetingEl = row.querySelector('td.views-field-field-trip-date-and-meeting-time-1 time');
    const cancelledEl = row.querySelector('td.views-field-field-cancelled');

    hikes.push({
      title: text(link),
      relativeUrl: link.getAttribute('href'),
      dateAttr: dateEl?.getAttribute('datetime') || null,
      meetingAttr: meetingEl?.getAttribute('datetime') || null,
      meetingText: text(meetingEl),
      cost: text(row.querySelector('td.views-field-field-travel-cost')),
      difficulty: text(row.querySelector('td.views-field-field-trail-difficulty-1')),
      duration: text(row.querySelector('td.views-field-field-trip-duration')),
      distance: text(row.querySelector('td.views-field-field-trip-distance')),
      elevation: text(row.querySelector('td.views-field-field-hike-elevation-gain')),
      leader: text(row.querySelector('td.views-field-field-phone-number')),
      cancelled: !!(text(cancelledEl) && /cancel/i.test(text(cancelledEl) as string)),
    });
  }
  return hikes;
};

/**
 * The site stores the meeting time as a naive wall-clock value but serializes
 * it with a 'Z'. We therefore strip the Z and interpret the timestamp in PG
 * local time rather than UTC.
 */
export function hikeStartIso(hike: RawHike, zone = DEFAULT_TZ): string | undefined {
  return isoFromNaiveZ(hike.meetingAttr || hike.dateAttr, zone);
}

/** Map a parsed hike row onto RawEvent. Returns null if it has no date. */
export function mapHikeToRawEvent(hike: RawHike, zone = DEFAULT_TZ): RawEvent | null {
  const start = hikeStartIso(hike, zone);
  if (!start || !hike.relativeUrl) return null;

  const url = hike.relativeUrl.startsWith('http') ? hike.relativeUrl : `${BASE_URL}${hike.relativeUrl}`;
  const title = hike.cancelled ? `CANCELLED: ${hike.title || 'Hike'}` : (hike.title || 'Hike');

  return {
    sourceEventId: hike.relativeUrl,
    title,
    start,
    url,
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Caledonia Ramblers Hiking Club',
    category: 'Outdoors / Hiking',
    raw: {
      meetingTimeText: hike.meetingText,
      travelCost: hike.cost,
      difficulty: hike.difficulty,
      duration: hike.duration,
      distance: hike.distance,
      elevationGain: hike.elevation,
      tripLeader: hike.leader,
      cancelled: hike.cancelled,
      extractedAt: new Date().toISOString(),
    },
  };
}

const ramblersModule: ScraperModule = {
  key: 'caledoniaramblers_ca',
  label: 'Caledonia Ramblers Hiking Club',
  startUrls: [`${BASE_URL}/schedule`],
  paginationType: 'none',
  integrationTags: ['page-navigation'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

    await page.goto(`${BASE_URL}/schedule`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (ctx.stats) ctx.stats.pagesCrawled++;

    const hikes = await extractFromPage<RawHike[]>(page, extractHikesFromDocument);

    logger.info(`Found ${hikes.length} hike row(s) in the schedule`);

    const events: RawEvent[] = [];
    const slice = isTestMode ? hikes.slice(0, 3) : hikes;
    for (const hike of slice) {
      const e = mapHikeToRawEvent(hike, zone);
      if (e) events.push(e);
    }

    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default ramblersModule;
