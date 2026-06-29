import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import fraserFindsModule, {
  combineDateTime,
  sourceHost,
  mapAggregatedEvent,
  mapSaleToEvents,
  type FraserFindsEvent,
  type FraserFindsSale,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/fraserfinds_ca/fixtures', file);

const loadJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(fixturePath(file), 'utf-8')) as T;

describe('Fraser Finds module', () => {
  it('has the correct metadata', () => {
    expect(fraserFindsModule.key).toBe('fraserfinds_ca');
    expect(fraserFindsModule.integrationTags).toContain('api');
    expect(fraserFindsModule.startUrls).toContain('https://fraserfinds.ca/');
  });

  describe('combineDateTime', () => {
    it('combines date + 12h time into ISO with the PG offset', () => {
      expect(combineDateTime('2026-06-29', '10:00 AM')).toBe('2026-06-29T10:00:00.000-07:00');
      expect(combineDateTime('2026-06-29', '6:00 PM')).toBe('2026-06-29T18:00:00.000-07:00');
    });
    it('falls back to all-day midnight when time is missing', () => {
      expect(combineDateTime('2026-06-29', '')).toBe('2026-06-29T00:00:00.000-07:00');
      expect(combineDateTime('2026-06-29', undefined)).toBe('2026-06-29T00:00:00.000-07:00');
    });
    it('returns undefined for an empty date', () => {
      expect(combineDateTime('', '10:00 AM')).toBeUndefined();
    });
  });

  describe('sourceHost', () => {
    it('strips the www prefix', () => {
      expect(sourceHost('https://www.pgpl.ca/events/x')).toBe('pgpl.ca');
      expect(sourceHost('https://theexplorationplace.com/event/y')).toBe('theexplorationplace.com');
      expect(sourceHost(undefined)).toBeUndefined();
    });
  });

  describe('mapAggregatedEvent — attribution', () => {
    it('preserves the original source and link', async () => {
      const events = await loadJson<FraserFindsEvent[]>('events.json');
      const exploration = events.find(e => e.source === 'Exploration Place');
      expect(exploration).toBeTruthy();

      const mapped = mapAggregatedEvent(exploration!)!;
      expect(mapped).not.toBeNull();
      // URL points at the ORIGINAL source, not the aggregator.
      expect(mapped.url).toBe(exploration!.link);
      expect(mapped.organizer).toBe('Exploration Place');
      expect((mapped.raw as any).aggregatedVia).toBe('fraserfinds.ca');
      expect((mapped.raw as any).originalSource).toBe('Exploration Place');
      expect((mapped.raw as any).originalSourceHost).toBe('theexplorationplace.com');
      expect(mapped.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('maps every fixture event into a well-formed RawEvent', async () => {
      const events = await loadJson<FraserFindsEvent[]>('events.json');
      const mapped = events.map(e => mapAggregatedEvent(e)).filter(Boolean);
      expect(mapped.length).toBe(events.length);
      for (const e of mapped) {
        expect(e!.title.length).toBeGreaterThan(0);
        expect(e!.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(e!.raw).toHaveProperty('aggregatedVia', 'fraserfinds.ca');
      }
    });

    it('carries a start/end time when present', async () => {
      const events = await loadJson<FraserFindsEvent[]>('events.json');
      const timed = events.find(e => e.start && e.end);
      if (timed) {
        const mapped = mapAggregatedEvent(timed)!;
        expect(mapped.end).toBeTruthy();
      }
    });
  });

  describe('mapSaleToEvents', () => {
    it('expands a sale into one event per day with address + coords', async () => {
      const sales = await loadJson<FraserFindsSale[]>('sales.json');
      const sale = sales[0];
      const events = mapSaleToEvents(sale);
      expect(events.length).toBe((sale.days || []).length);

      const first = events[0];
      expect(first.category).toBe('Garage Sale');
      expect(first.title).toContain(sale.address!);
      expect(first.venueAddress).toBe(sale.address);
      expect(first.sourceEventId).toBe(`${sale.id}#${sale.days![0].date}`);
      expect(first.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof first.lat).toBe('number');
    });
  });
});
