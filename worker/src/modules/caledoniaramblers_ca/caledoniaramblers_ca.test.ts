import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import ramblersModule, {
  extractHikesFromDocument,
  hikeStartIso,
  mapHikeToRawEvent,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/caledoniaramblers_ca/fixtures', file);

async function loadDoc(): Promise<Document> {
  const html = await readFile(fixturePath('schedule.html'), 'utf-8');
  return new JSDOM(html).window.document;
}

describe('Caledonia Ramblers module', () => {
  it('has the correct metadata', () => {
    expect(ramblersModule.key).toBe('caledoniaramblers_ca');
    expect(ramblersModule.integrationTags).toContain('page-navigation');
  });

  describe('extractHikesFromDocument', () => {
    it('extracts hike rows with title, link, and metadata', async () => {
      const hikes = extractHikesFromDocument(await loadDoc());
      expect(hikes.length).toBeGreaterThanOrEqual(10);

      const tabor = hikes.find(h => h.relativeUrl === '/hike-details/tabor-mountaintroll-crossover')!;
      expect(tabor).toBeTruthy();
      expect(tabor.title).toBe('Tabor Mountain/Troll Crossover');
      expect(tabor.meetingAttr).toBe('2026-07-01T08:45:00Z');
      expect(tabor.cost).toBe('$5');
      expect(tabor.difficulty).toBe('Moderate');
      expect(tabor.duration).toContain('hours');
    });
  });

  describe('hikeStartIso', () => {
    it('interprets the meeting time as PG local (not UTC)', () => {
      const iso = hikeStartIso({
        meetingAttr: '2026-07-01T08:45:00Z',
        dateAttr: null,
      } as any);
      expect(iso).toBe('2026-07-01T08:45:00.000-07:00');
    });
  });

  describe('mapHikeToRawEvent', () => {
    it('maps a hike into a RawEvent with absolute URL and raw metadata', async () => {
      const hikes = extractHikesFromDocument(await loadDoc());
      const tabor = hikes.find(h => h.relativeUrl === '/hike-details/tabor-mountaintroll-crossover')!;
      const mapped = mapHikeToRawEvent(tabor)!;

      expect(mapped.url).toBe('https://www.caledoniaramblers.ca/hike-details/tabor-mountaintroll-crossover');
      expect(mapped.start).toBe('2026-07-01T08:45:00.000-07:00');
      expect(mapped.organizer).toBe('Caledonia Ramblers Hiking Club');
      expect(mapped.category).toBe('Outdoors / Hiking');
      expect((mapped.raw as any).difficulty).toBe('Moderate');
      expect((mapped.raw as any).tripLeader).toContain('Tim');
    });

    it('maps every fixture hike into a well-formed RawEvent', async () => {
      const hikes = extractHikesFromDocument(await loadDoc());
      const mapped = hikes.map(h => mapHikeToRawEvent(h)).filter(Boolean);
      expect(mapped.length).toBeGreaterThanOrEqual(10);
      for (const e of mapped) {
        expect(e!.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(e!.url).toMatch(/^https:\/\/www\.caledoniaramblers\.ca\/hike-details\//);
      }
    });
  });
});
