import type { RawEvent } from '../../types.js';
import {
  createTribeModule,
  mapTribeEventToRawEvent as mapTribeShared,
  type TribeEvent,
  type TribeMapDefaults,
} from '../../lib/tribe-events.js';

/**
 * The Exploration Place (theexplorationplace.com) — Prince George museum.
 *
 * WordPress + "The Events Calendar", built from the shared `createTribeModule`
 * factory.
 *
 * NOTE: the origin sits behind Cloudflare and returns HTTP 522 to datacenter
 * IP ranges, so this must run from an environment Cloudflare lets through (the
 * worker's real browser usually qualifies). When that is not possible, Fraser
 * Finds re-publishes Exploration Place events via its aggregator feed
 * (`fraserfinds_ca`) as a fallback — hence `cloudflareNote`.
 */

const DEFAULTS: TribeMapDefaults = { organizer: 'The Exploration Place' };

// Re-export shared helpers (and a defaults-bound mapper) for unit tests.
export { parseEventsResponse } from '../../lib/tribe-events.js';
export type { TribeEvent, TribeEventsResponse } from '../../lib/tribe-events.js';

export function mapTribeEventToRawEvent(ev: TribeEvent): RawEvent {
  return mapTribeShared(ev, DEFAULTS);
}

export default createTribeModule({
  key: 'theexplorationplace_com',
  label: 'The Exploration Place',
  baseUrl: 'https://theexplorationplace.com',
  organizer: 'The Exploration Place',
  fullMonths: 6,
  cloudflareNote: true,
});
