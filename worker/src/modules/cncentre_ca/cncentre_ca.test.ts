import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import cnCentreModule, {
  extractEventUrlsFromSitemap,
  extractEventFromDocument,
  mapCnEvent,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/cncentre_ca/fixtures', file);

describe('CN Centre module', () => {
  it('has the correct metadata', () => {
    expect(cnCentreModule.key).toBe('cncentre_ca');
    expect(cnCentreModule.integrationTags).toContain('page-navigation');
  });

  describe('extractEventUrlsFromSitemap', () => {
    it('pulls event-calendar URLs but excludes the listing page', () => {
      const xml = `<urlset>
        <url><loc>https://www.cncentre.ca/events-tickets/events-calendar</loc></url>
        <url><loc>https://www.cncentre.ca/events-tickets/events-calendar/virsa-2026</loc></url>
        <url><loc>https://www.cncentre.ca/events-tickets/events-calendar/bryan-adams</loc></url>
        <url><loc>https://www.cncentre.ca/about</loc></url>
      </urlset>`;
      const urls = extractEventUrlsFromSitemap(xml);
      expect(urls).toContain('https://www.cncentre.ca/events-tickets/events-calendar/virsa-2026');
      expect(urls).toContain('https://www.cncentre.ca/events-tickets/events-calendar/bryan-adams');
      expect(urls).not.toContain('https://www.cncentre.ca/events-tickets/events-calendar');
      expect(urls.some(u => u.endsWith('/about'))).toBe(false);
    });
  });

  describe('extractEventFromDocument + mapCnEvent', () => {
    it('parses the VIRSA detail page with start/end ISO and title', async () => {
      const html = await readFile(fixturePath('event-detail.html'), 'utf-8');
      const doc = new JSDOM(html).window.document;
      const raw = extractEventFromDocument(doc);

      expect(raw.title).toBe('VIRSA 2026');
      expect(raw.startAttr).toBe('2026-06-27T18:00:00-07:00');
      expect(raw.endAttr).toBe('2026-06-27T22:00:00-07:00');

      const url = 'https://www.cncentre.ca/events-tickets/events-calendar/virsa-2026';
      const mapped = mapCnEvent(raw, url)!;
      expect(mapped).not.toBeNull();
      expect(mapped.title).toBe('VIRSA 2026');
      expect(mapped.start).toBe('2026-06-27T18:00:00.000-07:00');
      expect(mapped.end).toBe('2026-06-27T22:00:00.000-07:00');
      expect(mapped.venueName).toBe('CN Centre');
      expect(mapped.sourceEventId).toBe('virsa-2026');
      expect(mapped.descriptionHtml).toBeTruthy();
    });

    it('returns null when there is no start time', () => {
      const raw = { title: 'x', startAttr: null, endAttr: null, descriptionHtml: null, imageUrl: null };
      expect(mapCnEvent(raw, 'https://www.cncentre.ca/events-tickets/events-calendar/x')).toBeNull();
    });
  });
});
