import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import legionModule, {
  extractMecEventFromDocument,
  splitTimeRange,
  mapMecEvent,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/legion43pg_ca/fixtures', file);

describe('Legion Branch 43 module', () => {
  it('has the correct metadata', () => {
    expect(legionModule.key).toBe('legion43pg_ca');
    expect(legionModule.integrationTags).toContain('page-navigation');
  });

  describe('splitTimeRange', () => {
    it('splits a MEC time range', () => {
      expect(splitTimeRange('6:00 pm - 9:00 pm')).toEqual(['6:00 pm', '9:00 pm']);
      expect(splitTimeRange('10:00 am')).toEqual(['10:00 am', null]);
      expect(splitTimeRange(null)).toEqual([null, null]);
    });
  });

  describe('extractMecEventFromDocument + mapMecEvent', () => {
    it('parses the Bingo Night page into a dated RawEvent', async () => {
      const html = await readFile(fixturePath('event-detail.html'), 'utf-8');
      const doc = new JSDOM(html).window.document;
      const raw = extractMecEventFromDocument(doc);

      expect(raw.title).toBe('Bingo Night');
      expect(raw.startDateLabel).toBe('Jul 01 2026');
      expect(raw.timeText).toBe('6:00 pm - 9:00 pm');

      const url = 'https://legion43pg.ca/events/1427/';
      const mapped = mapMecEvent(raw, url)!;
      expect(mapped).not.toBeNull();
      expect(mapped.title).toBe('Bingo Night');
      expect(mapped.start).toBe('2026-07-01T18:00:00.000-07:00');
      expect(mapped.end).toBe('2026-07-01T21:00:00.000-07:00');
      expect(mapped.venueName).toContain('Legion');
      expect(mapped.sourceEventId).toBe('1427');
    });

    it('returns null when there is no start date label', () => {
      const raw = { title: 'x', startDateLabel: null, endDateLabel: null, timeText: '6:00 pm', descriptionHtml: null, imageUrl: null };
      expect(mapMecEvent(raw, 'https://legion43pg.ca/events/9/')).toBeNull();
    });
  });
});
