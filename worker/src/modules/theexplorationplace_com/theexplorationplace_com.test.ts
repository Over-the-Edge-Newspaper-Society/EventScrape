import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import explorationPlaceModule, {
  mapTribeEventToRawEvent,
  parseEventsResponse,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/theexplorationplace_com/fixtures', file);

async function loadFixture() {
  const json = await readFile(fixturePath('events-page.json'), 'utf-8');
  return JSON.parse(json);
}

describe('The Exploration Place module', () => {
  it('has the correct metadata', () => {
    expect(explorationPlaceModule.key).toBe('theexplorationplace_com');
    expect(explorationPlaceModule.integrationTags).toContain('api');
    expect(explorationPlaceModule.startUrls).toContain('https://theexplorationplace.com/events/');
  });

  it('maps a representative event with venue, cost, and ISO dates', async () => {
    const { events } = parseEventsResponse(await loadFixture());
    const senior = events.find(e => e.id === 4821)!;
    const mapped = mapTribeEventToRawEvent(senior);

    expect(mapped.title).toBe('Senior Monday');
    expect(mapped.start).toBe('2026-06-29T10:00:00.000-07:00');
    expect(mapped.end).toBe('2026-06-29T17:00:00.000-07:00');
    expect(mapped.venueName).toBe('The Exploration Place');
    expect(mapped.venueAddress).toContain('333 Becott Pl');
    expect(mapped.price).toBe('$10');
    expect(mapped.category).toBe('Arts & Culture'); // entity-decoded
    expect(mapped.organizer).toBe('The Exploration Place');
  });

  it('falls back to the default organizer when none is set', async () => {
    const { events } = parseEventsResponse(await loadFixture());
    const daycare = events.find(e => e.id === 4822)!;
    const mapped = mapTribeEventToRawEvent(daycare);
    expect(mapped.organizer).toBe('The Exploration Place');
    expect(mapped.imageUrl).toBeUndefined(); // image:false handled
  });
});
