import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import {
  fetchTribeEvents,
  mapTribeEventToRawEvent as mapTribeShared,
  type TribeEvent,
  type TribeMapDefaults,
} from '../../lib/tribe-events.js';

/**
 * Caledonia Nordic Ski Club (caledonianordic.com)
 *
 * WordPress + "The Events Calendar". We read the plugin's public REST API
 * (/wp-json/tribe/events/v1/events) via the shared `lib/tribe-events` client
 * rather than scraping HTML, so this module is tagged `api`.
 */

import { PG_TZ } from '../../lib/dates.js';

const BASE_URL = 'https://caledonianordic.com';
const DEFAULT_TZ = PG_TZ;
const DEFAULTS: TribeMapDefaults = { organizer: 'Caledonia Nordic Ski Club' };

// Re-export the shared helpers (and a defaults-bound mapper) for unit tests.
export {
  decodeEntities,
  toIsoWithZone,
  buildVenueAddress,
  parseEventsResponse,
} from '../../lib/tribe-events.js';
export type { TribeEvent, TribeEventsResponse, TribeVenue } from '../../lib/tribe-events.js';

/** Defaults-bound Caledonia Nordic mapper. */
export function mapTribeEventToRawEvent(ev: TribeEvent): RawEvent {
  return mapTribeShared(ev, DEFAULTS);
}

const caledoniaNordicModule: ScraperModule = {
  key: 'caledonianordic_com',
  label: 'Caledonia Nordic Ski Club',
  startUrls: [`${BASE_URL}/events/`],
  paginationType: 'calendar',
  integrationTags: ['api'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const paginationOptions = jobData?.paginationOptions;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label} via Events Calendar REST API`);

    const now = DateTime.now().setZone(DEFAULT_TZ);
    const startDate = paginationOptions?.startDate || now.toFormat('yyyy-MM-dd');
    const endDate = paginationOptions?.endDate
      || now.plus({ months: isTestMode ? 1 : 12 }).toFormat('yyyy-MM-dd');
    logger.info(`Requesting events from ${startDate} to ${endDate}`);

    const events = await fetchTribeEvents(page, BASE_URL, {
      startDate,
      endDate,
      perPage: isTestMode ? 10 : 50,
      maxPages: isTestMode ? 1 : 25,
      logger,
      defaults: DEFAULTS,
      onPage: () => { if (ctx.stats) ctx.stats.pagesCrawled++; },
    });

    logger.info(`Scrape completed. Total events: ${events.length}, pages crawled: ${ctx.stats?.pagesCrawled ?? 0}`);
    return events;
  },
};

export default caledoniaNordicModule;
