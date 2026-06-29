import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import {
  fetchTribeEvents,
  mapTribeEventToRawEvent as mapTribeShared,
  type TribeEvent,
  type TribeMapDefaults,
} from '../../lib/tribe-events.js';

/**
 * The Exploration Place (theexplorationplace.com) — Prince George museum.
 *
 * WordPress + "The Events Calendar", so it exposes the same
 * /wp-json/tribe/events/v1/events REST API consumed via `lib/tribe-events`.
 *
 * NOTE: the origin sits behind Cloudflare and returns HTTP 522 to datacenter
 * IP ranges, so this module must be run from an environment Cloudflare lets
 * through (the worker's real Playwright browser usually qualifies). When that
 * is not possible, Fraser Finds re-publishes Exploration Place events via its
 * aggregator feed (`fraserfinds_ca`) as a fallback.
 */

import { PG_TZ } from '../../lib/dates.js';

const BASE_URL = 'https://theexplorationplace.com';
const DEFAULT_TZ = PG_TZ;
const DEFAULTS: TribeMapDefaults = { organizer: 'The Exploration Place' };

// Re-export a defaults-bound mapper for unit tests.
export function mapTribeEventToRawEvent(ev: TribeEvent): RawEvent {
  return mapTribeShared(ev, DEFAULTS);
}
export { parseEventsResponse } from '../../lib/tribe-events.js';
export type { TribeEvent, TribeEventsResponse } from '../../lib/tribe-events.js';

const explorationPlaceModule: ScraperModule = {
  key: 'theexplorationplace_com',
  label: 'The Exploration Place',
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
      || now.plus({ months: isTestMode ? 1 : 6 }).toFormat('yyyy-MM-dd');
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

    if (events.length === 0) {
      logger.warn('No events returned — the origin may be blocking this IP (Cloudflare 522). Consider the fraserfinds_ca aggregator as a fallback.');
    }
    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default explorationPlaceModule;
