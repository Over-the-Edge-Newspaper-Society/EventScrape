import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import twoRiversModule, {
  decodeEntities,
  acfDateTime,
  mapPostToRawEvent,
  type WpPost,
} from './index.js';

const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/tworiversgallery_com/fixtures', file);

const loadPosts = async (file: string): Promise<WpPost[]> =>
  JSON.parse(await readFile(fixturePath(file), 'utf-8')) as WpPost[];

describe('Two Rivers Gallery module', () => {
  it('has the correct metadata', () => {
    expect(twoRiversModule.key).toBe('tworiversgallery_com');
    expect(twoRiversModule.integrationTags).toContain('api');
  });

  describe('acfDateTime', () => {
    it('builds ISO from yyyyMMdd + HH:mm:ss', () => {
      expect(acfDateTime('20260924', '15:00:00')).toBe('2026-09-24T15:00:00.000-07:00');
    });
    it('treats missing time as all-day midnight', () => {
      expect(acfDateTime('20260924', '')).toBe('2026-09-24T00:00:00.000-07:00');
    });
    it('rejects malformed dates', () => {
      expect(acfDateTime('2026-09-24', '15:00:00')).toBeUndefined();
      expect(acfDateTime('', '15:00:00')).toBeUndefined();
    });
  });

  describe('decodeEntities', () => {
    it('decodes ampersand entities in titles', () => {
      expect(decodeEntities('Janice Baker &amp; Les')).toBe('Janice Baker & Les');
    });
  });

  describe('mapPostToRawEvent — events', () => {
    it('maps the first event with correct dates, venue, and image', async () => {
      const posts = await loadPosts('events.json');
      const mapped = mapPostToRawEvent(posts[0], 'events')!;
      expect(mapped).not.toBeNull();
      expect(mapped.title).toBe('Blank Canvas Art Club Open House');
      expect(mapped.start).toBe('2026-09-24T15:00:00.000-07:00');
      expect(mapped.end).toBe('2026-09-24T16:30:00.000-07:00');
      expect(mapped.venueName).toBe('Two Rivers Gallery');
      expect(mapped.category).toBe('Arts & Culture');
      expect(mapped.sourceEventId).toBe(`events-${posts[0].id}`);
      expect(mapped.imageUrl).toMatch(/^https:\/\/tworiversgallery\.ca\/.+\.jpg/);
    });

    it('maps every fixture event into a well-formed RawEvent', async () => {
      const posts = await loadPosts('events.json');
      for (const post of posts) {
        const mapped = mapPostToRawEvent(post, 'events')!;
        expect(mapped.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(mapped.url).toMatch(/^https:\/\/tworiversgallery\.ca\//);
      }
    });
  });

  describe('mapPostToRawEvent — programs', () => {
    it('labels programs distinctly and spans multi-day end dates', async () => {
      const posts = await loadPosts('programs.json');
      const multiDay = posts.find(p => p.acf?.end_date?.value !== p.acf?.start_date?.value);
      const mapped = mapPostToRawEvent((multiDay || posts[0]), 'programs')!;
      expect(mapped.category).toBe('Workshop / Program');
      expect(mapped.sourceEventId).toMatch(/^programs-/);
      if (multiDay) {
        expect(mapped.end!.slice(0, 10)).not.toBe(mapped.start.slice(0, 10));
      }
    });
  });
});
