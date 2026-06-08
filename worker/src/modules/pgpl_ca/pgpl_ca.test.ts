import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import pgplModule, {
  extractListingEventsFromDocument,
  extractDetailDataFromDocument,
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
    expect(first.title).toBe('Seed Library');
    expect(first.relativeUrl).toBe('/events/seed-library');
    expect(first.dateLabel).toBe('08 June');
    expect(first.imageUrl).toContain('Seed%20Library.png');

    const lego = events.find(e => e.relativeUrl === '/events/legotime');
    expect(lego).toBeTruthy();
    expect(lego?.timeText).toContain('3:00 pm');
    expect(lego?.locationText).toContain('Bob Harkins Branch');
    expect(lego?.descriptionHtml).toContain('LEGO');
  });

  it('extracts detail dates from an event page', async () => {
    const html = await readFile(fixturePath('event-detail.html'), 'utf-8');
    const dom = new JSDOM(html);
    const detail = extractDetailDataFromDocument(dom.window.document);

    expect(detail.nodeId).toBe('534');
    expect(detail.title).toBe('LEGOtime!');
    expect(detail.locationText).toBe('Bob Harkins Branch');
    expect(detail.imageUrl).toContain('LegoTime');

    // Recurring weekly event — multiple upcoming occurrences, de-duplicated.
    expect(detail.dates.length).toBeGreaterThan(1);
    expect(detail.dates[0].start).toBe('2026-06-08T15:00:00-07:00');
    expect(detail.dates[0].end).toBe('2026-06-08T17:00:00-07:00');

    // Dates are sorted ascending and unique by start.
    const starts = detail.dates.map(d => d.start);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort()).toEqual(starts);
  });
});
