import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import pgPrideModule, {
  parseDateText,
  parseTimeText,
  buildStartIso,
  extractEventsFromDocument,
  mapScrapedEvent,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/pgpride_com/fixtures', file);

describe('PG Pride module (brittle GoDaddy scraper)', () => {
  it('has the correct metadata', () => {
    expect(pgPrideModule.key).toBe('pgpride_com');
    expect(pgPrideModule.integrationTags).toContain('page-navigation');
  });

  describe('parseDateText', () => {
    it('parses long, short, and year-less month formats', () => {
      expect(parseDateText('February 20, 2026', 2026)!.toISODate()).toBe('2026-02-20');
      expect(parseDateText('Feb 20 2026', 2026)!.toISODate()).toBe('2026-02-20');
      expect(parseDateText('March 8', 2026)!.toISODate()).toBe('2026-03-08'); // uses fallback year
      expect(parseDateText('2026-02-20', 2026)!.toISODate()).toBe('2026-02-20');
    });
    it('returns null for junk', () => {
      expect(parseDateText('see you soon', 2026)).toBeNull();
      expect(parseDateText(null, 2026)).toBeNull();
    });
  });

  describe('parseTimeText', () => {
    it('parses 12h and 24h times', () => {
      expect(parseTimeText('7:00 PM')).toEqual({ hour: 19, minute: 0 });
      expect(parseTimeText('11:00 AM')).toEqual({ hour: 11, minute: 0 });
      expect(parseTimeText('12:00 AM')).toEqual({ hour: 0, minute: 0 });
      expect(parseTimeText('19:30')).toEqual({ hour: 19, minute: 30 });
    });
  });

  describe('buildStartIso', () => {
    it('combines date and time into ISO with PG offset', () => {
      expect(buildStartIso('February 20, 2026', '7:00 PM', 2026)).toBe('2026-02-20T19:00:00.000-08:00');
    });
  });

  describe('extractEventsFromDocument (representative render)', () => {
    it('pulls event cards out of the rendered calendar section', async () => {
      const html = await readFile(fixturePath('rendered-calendar.html'), 'utf-8');
      const doc = new JSDOM(html).window.document;
      const events = extractEventsFromDocument(doc);

      expect(events.length).toBe(2);
      const movie = events.find(e => e.title === 'Pride Movie Night')!;
      expect(movie).toBeTruthy();
      expect(movie.dateText).toMatch(/February 20/);
      expect(movie.timeText).toMatch(/7:00 PM/);
      expect(movie.url).toBe('/event-calendar/pride-movie-night');
    });

    it('maps a scraped card into a RawEvent', async () => {
      const html = await readFile(fixturePath('rendered-calendar.html'), 'utf-8');
      const doc = new JSDOM(html).window.document;
      const [first] = extractEventsFromDocument(doc);
      const mapped = mapScrapedEvent(first, 2026)!;
      expect(mapped.title).toBe('Pride Movie Night');
      expect(mapped.start).toBe('2026-02-20T19:00:00.000-08:00');
      expect(mapped.url).toBe('https://pgpride.com/event-calendar/pride-movie-night');
      expect(mapped.organizer).toBe('Prince George Pride Society');
    });
  });
});
