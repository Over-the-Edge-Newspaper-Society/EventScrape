import type { RawEvent } from '../../types.js';
import {
  createTribeModule,
  mapTribeEventToRawEvent as mapTribeShared,
  type TribeEvent,
  type TribeMapDefaults,
} from '../../lib/tribe-events.js';

/**
 * Caledonia Nordic Ski Club (caledonianordic.com)
 *
 * WordPress + "The Events Calendar". Built from the shared `createTribeModule`
 * factory — the only per-venue details are the URL and organizer. Tagged `api`.
 */

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

export default createTribeModule({
  key: 'caledonianordic_com',
  label: 'Caledonia Nordic Ski Club',
  baseUrl: 'https://caledonianordic.com',
  organizer: 'Caledonia Nordic Ski Club',
});
