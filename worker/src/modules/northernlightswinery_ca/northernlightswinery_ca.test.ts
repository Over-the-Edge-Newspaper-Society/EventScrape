import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import wineryModule, {
  decodeEntities,
  msToIso,
  mapSquarespaceItem,
  type SqsEventItem,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/northernlightswinery_ca/fixtures', file);

const loadItems = async (): Promise<SqsEventItem[]> =>
  JSON.parse(await readFile(fixturePath('events.json'), 'utf-8')) as SqsEventItem[];

describe('Northern Lights Winery module', () => {
  it('has the correct metadata', () => {
    expect(wineryModule.key).toBe('northernlightswinery_ca');
    expect(wineryModule.integrationTags).toContain('api');
  });

  describe('msToIso', () => {
    it('converts epoch ms to ISO in PG time, floored to the minute', () => {
      expect(msToIso(1778868000976)).toBe('2026-05-15T11:00:00.000-07:00');
    });
    it('returns undefined for non-numbers', () => {
      expect(msToIso(undefined)).toBeUndefined();
      expect(msToIso(NaN)).toBeUndefined();
    });
  });

  describe('decodeEntities', () => {
    it('decodes ampersands in titles', () => {
      expect(decodeEntities('Bricks &amp; Sips')).toBe('Bricks & Sips');
    });
  });

  describe('mapSquarespaceItem', () => {
    it('maps the first item with venue, coords, image and ticket link', async () => {
      const items = await loadItems();
      const mapped = mapSquarespaceItem(items[0])!;
      expect(mapped).not.toBeNull();
      expect(mapped.title).toBe('Bricks & Sips');
      expect(mapped.start).toBe('2026-05-15T11:00:00.000-07:00');
      expect(mapped.url).toMatch(/^https:\/\/www\.northernlightswinery\.ca\/events-calendar\//);
      expect(mapped.venueName).toContain('Northern Lights');
      expect(typeof mapped.lat).toBe('number');
      expect(mapped.imageUrl).toContain('squarespace-cdn.com');
      expect((mapped.raw as any).ticketUrl).toContain('buynorthernlightswines.com');
    });

    it('drops an implausibly long (recurring) end date but keeps it in raw', async () => {
      const items = await loadItems();
      const first = items[0];
      // fixture item spans months → end should be omitted, raw keeps the ms.
      const mapped = mapSquarespaceItem(first)!;
      expect(mapped.end).toBeUndefined();
      expect((mapped.raw as any).endMs).toBe(first.endDate);
    });

    it('maps every fixture item into a well-formed RawEvent', async () => {
      const items = await loadItems();
      for (const item of items) {
        const mapped = mapSquarespaceItem(item)!;
        expect(mapped.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(mapped.country).toBe('Canada');
      }
    });
  });
});
