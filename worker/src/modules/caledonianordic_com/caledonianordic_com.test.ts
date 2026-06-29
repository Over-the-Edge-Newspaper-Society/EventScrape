import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import caledoniaNordicModule, {
  decodeEntities,
  toIsoWithZone,
  buildVenueAddress,
  mapTribeEventToRawEvent,
  parseEventsResponse,
  type TribeEventsResponse,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/caledonianordic_com/fixtures', file);

async function loadFixture(): Promise<TribeEventsResponse> {
  const json = await readFile(fixturePath('events-page.json'), 'utf-8');
  return JSON.parse(json) as TribeEventsResponse;
}

describe('Caledonia Nordic module', () => {
  it('has the correct metadata', () => {
    expect(caledoniaNordicModule.key).toBe('caledonianordic_com');
    expect(caledoniaNordicModule.label).toBe('Caledonia Nordic Ski Club');
    expect(caledoniaNordicModule.integrationTags).toContain('api');
    expect(caledoniaNordicModule.startUrls).toContain('https://caledonianordic.com/events/');
  });

  describe('decodeEntities', () => {
    it('decodes named and numeric HTML entities', () => {
      expect(decodeEntities('Programs &amp; Lessons')).toBe('Programs & Lessons');
      expect(decodeEntities('We&#8217;re Closed!')).toBe('We’re Closed!');
      expect(decodeEntities('Support &#038; Fun')).toBe('Support & Fun');
      expect(decodeEntities(undefined)).toBe('');
    });
  });

  describe('toIsoWithZone', () => {
    it('converts a site-local datetime to an ISO string with offset', () => {
      // America/Vancouver is UTC-7 during the summer (PDT).
      expect(toIsoWithZone('2026-07-06 00:00:00', 'America/Vancouver')).toBe(
        '2026-07-06T00:00:00.000-07:00'
      );
    });

    it('returns undefined for missing/invalid input', () => {
      expect(toIsoWithZone(undefined)).toBeUndefined();
      expect(toIsoWithZone('not-a-date')).toBeUndefined();
    });
  });

  describe('buildVenueAddress', () => {
    it('joins available address parts', () => {
      expect(
        buildVenueAddress({ address: '7141 Otway Rd', city: 'Prince George', stateprovince: 'BC', zip: 'V2K 5J9' })
      ).toBe('7141 Otway Rd, Prince George, BC, V2K 5J9');
    });

    it('returns undefined when no parts are present', () => {
      expect(buildVenueAddress(undefined)).toBeUndefined();
      expect(buildVenueAddress({})).toBeUndefined();
    });
  });

  describe('parseEventsResponse', () => {
    it('reads events and pagination metadata from the fixture', async () => {
      const body = await loadFixture();
      const { events, totalPages, total } = parseEventsResponse(body);
      expect(events.length).toBeGreaterThan(0);
      expect(totalPages).toBeGreaterThanOrEqual(1);
      expect(total).toBeGreaterThanOrEqual(events.length);
    });

    it('defends against a malformed body', () => {
      expect(parseEventsResponse(null)).toEqual({ events: [], totalPages: 1, total: 0 });
      expect(parseEventsResponse({})).toEqual({ events: [], totalPages: 1, total: 0 });
    });
  });

  describe('mapTribeEventToRawEvent', () => {
    it('maps every fixture event into a well-formed RawEvent', async () => {
      const { events } = parseEventsResponse(await loadFixture());
      for (const apiEvent of events) {
        const mapped = mapTribeEventToRawEvent(apiEvent);
        expect(mapped.title.length).toBeGreaterThan(0);
        expect(mapped.url).toMatch(/^https:\/\/caledonianordic\.com\//);
        expect(mapped.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(mapped.sourceEventId).toBe(String(apiEvent.id));
        expect(mapped.country).toBe('Canada');
        expect(mapped.region).toBe('British Columbia');
      }
    });

    it('maps the first fixture event with decoded category and ISO dates', async () => {
      const { events } = parseEventsResponse(await loadFixture());
      const summerCamp = events.find(e => e.id === 12792);
      expect(summerCamp).toBeTruthy();

      const mapped = mapTribeEventToRawEvent(summerCamp!);
      expect(mapped.title).toBe('Summer Bike Camps (Youth 6-12 years)');
      expect(mapped.start).toBe('2026-07-06T00:00:00.000-07:00');
      expect(mapped.end).toBe('2026-08-21T23:59:59.000-07:00');
      expect(mapped.category).toBe('Programs & Lessons'); // entity-decoded
      expect(mapped.imageUrl).toContain('Summer-Bike-Camps.png');
      expect((mapped.raw as any).allDay).toBe(true);
      expect((mapped.raw as any).timezone).toBe('America/Vancouver');
    });
  });
});
