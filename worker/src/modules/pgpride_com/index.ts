import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { navigateToPage } from '../../lib/navigation.js';

const CALENDAR_URL = 'https://pgpride.com/event-calendar';

export interface CalendarEvent {
  title: string;
  start: string;
  end?: string;
  desc?: string;
  location?: string;
  allDay?: boolean;
}

export function mapCalendarEvent(event: CalendarEvent): RawEvent {
  if (!event || typeof event.title !== 'string' || !event.title.trim() ||
      typeof event.start !== 'string' || !DateTime.fromISO(event.start, { setZone: true }).isValid) {
    throw new Error('Pride calendar returned an event without a valid title/start date');
  }
  const start = DateTime.fromISO(event.start, { setZone: true });
  const end = event.end ? DateTime.fromISO(event.end, { setZone: true }) : null;
  const description = (event.desc || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return {
    sourceEventId: `${event.title.trim()}|${start.toUTC().toISO()}`,
    title: event.title.trim(),
    start: event.start,
    end: end?.isValid && end.toMillis() > start.toMillis() ? event.end : undefined,
    descriptionHtml: description || undefined,
    venueAddress: event.location || undefined,
    url: CALENDAR_URL,
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Prince George Pride Society',
    category: 'Community Event',
    raw: { ...event, isAllDay: event.allDay === true, provider: 'godaddy-calendar' },
  };
}

const pgPrideModule: ScraperModule = {
  key: 'pgpride_com',
  label: 'Prince George Pride Society',
  startUrls: [CALENDAR_URL],
  paginationType: 'none',
  integrationTags: ['api'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger } = ctx;
    logger.info('Loading Prince George Pride Society calendar feed');

    // Discover the feed from the page's own request rather than hardcoding widget
    // IDs. It includes all events (including those behind "More Events"), exact
    // years, end times and DST offsets. GoDaddy telemetry never reaches networkidle.
    const feedPromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.hostname === 'calendar.apps.secureserver.net' && url.pathname.startsWith('/v1/events/');
    }, { timeout: 25000 }).catch(() => null);

    await navigateToPage(page, CALENDAR_URL, ctx.stats);
    const response = await feedPromise;
    if (!response) throw new Error('Pride calendar feed did not load within 25 seconds');
    if (ctx.stats) ctx.stats.pagesCrawled++;
    if (!response.ok()) throw new Error(`Pride calendar feed returned HTTP ${response.status()}`);
    const body = await response.json();
    if (!Array.isArray(body.events)) throw new Error('Pride calendar feed has no events array');

    const events = body.events.map(mapCalendarEvent) as RawEvent[];
    const unique = [...new Map(events.map(event => [event.sourceEventId, event])).values()];
    logger.info(`Calendar feed returned ${unique.length} events with exact dates and times`);
    return ctx.jobData?.testMode ? unique.slice(0, 3) : unique;
  },
};

export default pgPrideModule;
