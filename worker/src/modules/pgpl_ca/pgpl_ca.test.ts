import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import pgplModule, {
  extractListingEventsFromDocument,
  extractDetailDataFromDocument,
  parseDateRangeText,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/pgpl_ca/fixtures', file);

describe('PGPL Module', () => {
  it('has the correct metadata', () => {
    expect(pgplModule.key).toBe('pgpl_ca');
    expect(pgplModule.label).toBe('Prince George Public Library');
    expect(pgplModule.startUrls).toContain('https://www.pgpl.ca/events');
  });

  it('extracts listing events from the fixtures', async () => {
    const html = await readFile(fixturePath('events-page.html'), 'utf-8');
    const dom = new JSDOM(html);
    const events = extractListingEventsFromDocument(dom.window.document);

    expect(events.length).toBeGreaterThan(5);

    const first = events[0];
    expect(first.title).toBe('Full STEAM Ahead - NID');
    expect(first.dateLabel).toBe('Monday November 10');
    expect(first.timeText).toContain('1:00 pm');
    expect(first.locationText).toContain('Bob Harkins Branch');
    expect(first.relativeUrl).toBe('/events/full-steam-ahead-nid');
  });

  it('extracts detail data from an event page', async () => {
    const html = await readFile(fixturePath('event-detail.html'), 'utf-8');
    const dom = new JSDOM(html);
    const detail = extractDetailDataFromDocument(dom.window.document);

    expect(detail.dateItems[0]).toContain('Monday, November 10, 2025');
    expect(detail.locationText).toBe('Bob Harkins Branch');
    expect(detail.audienceText).toBe('Families');
    expect(detail.registrationText).toBe('Free Drop In');
    expect(detail.heroImage).toContain('Full%20Steam%20Ahead.png');
    expect(detail.sourceEventId).toBe('/node/8057');
    expect(detail.descriptionHtml).toContain('special STEAM Build and Play');
  });

  it('parses date range text correctly', () => {
    const parsed = parseDateRangeText('Monday, November 10, 2025 - 1:00pm to 2:00pm');
    expect(parsed?.start).toBe('2025-11-10T13:00:00.000-08:00');
    expect(parsed?.end).toBe('2025-11-10T14:00:00.000-08:00');

    const allDay = parseDateRangeText('Tuesday, December 2, 2025 - All Day');
    expect(allDay?.start).toBe('2025-12-02T09:00:00.000-08:00');
    expect(allDay?.end).toBe('2025-12-02T17:00:00.000-08:00');
  });
});
