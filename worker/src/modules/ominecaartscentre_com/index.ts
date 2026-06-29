import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { parseICal, expandOccurrences, type VEvent } from './ical.js';
import { PG_TZ } from '../../lib/dates.js';
import { fetchText } from '../../lib/wp.js';

/**
 * Omineca Arts Centre (ominecaartscentre.com).
 *
 * The site is a Google Sites page whose "calendar" is an embedded *public*
 * Google Calendar. Rather than scrape the JS-rendered Sites markup, we read the
 * calendar's public iCal feed directly:
 *   https://calendar.google.com/calendar/ical/<CAL_ID>/public/basic.ics
 * Tagged `rss` (a subscribe-able feed).
 */

const CAL_ID = 'c_9ddad3eb5ba84ca41db304f7846d3012e08bfa1f246ff1c5d03acac455296c08@group.calendar.google.com';
const ICAL_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL_ID)}/public/basic.ics`;
const SITE_URL = 'https://www.ominecaartscentre.com/events/calendar';
const DEFAULT_TZ = PG_TZ;

/** Map a VEVENT + one expanded occurrence onto a RawEvent. */
export function mapOccurrence(ev: VEvent, occ: { start: string; end?: string; allDay: boolean }): RawEvent {
  const event: RawEvent = {
    sourceEventId: `${ev.uid || 'omineca'}#${occ.start}`,
    title: ev.summary || 'Untitled Event',
    start: occ.start,
    url: ev.url || SITE_URL,
    venueName: 'Omineca Arts Centre',
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Omineca Arts Centre',
    category: 'Arts & Culture',
    raw: {
      uid: ev.uid || null,
      allDay: occ.allDay,
      source: 'google-calendar-ical',
      extractedAt: new Date().toISOString(),
    },
  };
  if (occ.end) event.end = occ.end;
  if (ev.description) event.descriptionHtml = ev.description.replace(/\n/g, '<br>');
  if (ev.location) event.venueAddress = ev.location;
  return event;
}

/** Pure: parse an iCal document and expand to RawEvents within a window. */
export function eventsFromIcal(
  ical: string,
  windowStart: DateTime,
  windowEnd: DateTime,
  zone = DEFAULT_TZ,
): RawEvent[] {
  const vevents = parseICal(ical);
  const out: RawEvent[] = [];
  for (const ev of vevents) {
    if (ev.status && ev.status.toUpperCase() === 'CANCELLED') continue;
    for (const occ of expandOccurrences(ev, windowStart, windowEnd, zone)) {
      out.push(mapOccurrence(ev, occ));
    }
  }
  return out;
}

const ominecaModule: ScraperModule = {
  key: 'ominecaartscentre_com',
  label: 'Omineca Arts Centre',
  startUrls: [SITE_URL],
  paginationType: 'calendar',
  integrationTags: ['rss'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;
    const paginationOptions = jobData?.paginationOptions;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label} via Google Calendar iCal feed`);

    const now = DateTime.now().setZone(zone);
    const windowStart = paginationOptions?.startDate
      ? DateTime.fromISO(paginationOptions.startDate, { zone })
      : now.minus({ days: 1 });
    const windowEnd = paginationOptions?.endDate
      ? DateTime.fromISO(paginationOptions.endDate, { zone })
      : now.plus({ months: isTestMode ? 1 : 6 });

    const { ok, status, text } = await fetchText(page, ICAL_URL);
    if (ctx.stats) ctx.stats.pagesCrawled++;
    if (!ok || !text) {
      logger.error(`iCal feed returned HTTP ${status}`);
      throw new Error(`HTTP ${status} from ${ICAL_URL}`);
    }

    const events = eventsFromIcal(text, windowStart, windowEnd, zone);
    logger.info(`Expanded ${events.length} occurrence(s) within ${windowStart.toISODate()}..${windowEnd.toISODate()}`);
    return events;
  },
};

export default ominecaModule;
