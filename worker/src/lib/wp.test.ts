import { describe, it, expect } from 'vitest';
import { fetchJson, fetchText, paginateWpRest } from './wp.js';

interface CannedResponse {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

/** Build a fake Playwright Page whose request.get returns canned responses in order. */
function mockPage(responses: CannedResponse[]) {
  const calls: string[] = [];
  let i = 0;
  const page = {
    request: {
      get: async (url: string) => {
        const r = responses[Math.min(i, responses.length - 1)];
        i += 1;
        calls.push(url);
        const status = r.status ?? 200;
        return {
          ok: () => status >= 200 && status < 300,
          status: () => status,
          json: async () => {
            if (r.json === undefined) throw new Error('not json');
            return r.json;
          },
          text: async () => r.text ?? '',
          headers: () => r.headers ?? {},
        };
      },
    },
  };
  return { page: page as any, calls };
}

describe('lib/wp', () => {
  describe('fetchJson', () => {
    it('returns parsed data on 200', async () => {
      const { page } = mockPage([{ status: 200, json: { a: 1 }, headers: { 'x-foo': 'bar' } }]);
      const r = await fetchJson<{ a: number }>(page, 'https://x/api');
      expect(r.ok).toBe(true);
      expect(r.status).toBe(200);
      expect(r.data).toEqual({ a: 1 });
      expect(r.headers['x-foo']).toBe('bar');
    });

    it('returns null data on non-OK', async () => {
      const { page } = mockPage([{ status: 404 }]);
      const r = await fetchJson(page, 'https://x/api');
      expect(r.ok).toBe(false);
      expect(r.status).toBe(404);
      expect(r.data).toBeNull();
    });

    it('returns null data when the body is not JSON', async () => {
      const { page } = mockPage([{ status: 200 }]); // json undefined → throws
      const r = await fetchJson(page, 'https://x/api');
      expect(r.ok).toBe(true);
      expect(r.data).toBeNull();
    });
  });

  describe('fetchText', () => {
    it('returns text on 200 and null on failure', async () => {
      const ok = mockPage([{ status: 200, text: 'BEGIN:VCALENDAR' }]);
      expect((await fetchText(ok.page, 'https://x/ical')).text).toBe('BEGIN:VCALENDAR');
      const bad = mockPage([{ status: 500 }]);
      const r = await fetchText(bad.page, 'https://x/ical');
      expect(r.ok).toBe(false);
      expect(r.text).toBeNull();
    });
  });

  describe('paginateWpRest', () => {
    it('concatenates pages and stops at x-wp-totalpages', async () => {
      const { page, calls } = mockPage([
        { status: 200, json: [{ id: 1 }, { id: 2 }], headers: { 'x-wp-totalpages': '2' } },
        { status: 200, json: [{ id: 3 }], headers: { 'x-wp-totalpages': '2' } },
        { status: 200, json: [{ id: 99 }], headers: { 'x-wp-totalpages': '2' } }, // should never be fetched
      ]);
      const items = await paginateWpRest<{ id: number }>(page, 'https://x/wp-json/wp/v2/events', {
        perPage: 100,
        maxPages: 10,
      });
      expect(items.map(i => i.id)).toEqual([1, 2, 3]);
      expect(calls.length).toBe(2); // stopped after page 2
    });

    it('treats HTTP 400 past page 1 as a clean end', async () => {
      const { page } = mockPage([
        { status: 200, json: [{ id: 1 }], headers: { 'x-wp-totalpages': '9' } },
        { status: 400 },
      ]);
      const items = await paginateWpRest<{ id: number }>(page, 'https://x/wp-json/wp/v2/events', {
        perPage: 100,
        maxPages: 10,
      });
      expect(items.map(i => i.id)).toEqual([1]);
    });

    it('stops on an empty page', async () => {
      const { page } = mockPage([{ status: 200, json: [], headers: {} }]);
      const items = await paginateWpRest(page, 'https://x/wp-json/wp/v2/events', { perPage: 100, maxPages: 10 });
      expect(items).toEqual([]);
    });

    it('respects maxPages', async () => {
      const { page, calls } = mockPage([
        { status: 200, json: [{ id: 1 }], headers: { 'x-wp-totalpages': '10' } },
      ]);
      const items = await paginateWpRest<{ id: number }>(page, 'https://x/wp-json/wp/v2/events', {
        perPage: 100,
        maxPages: 1,
      });
      expect(items.length).toBe(1);
      expect(calls.length).toBe(1);
    });

    it('forwards query params into the request URL', async () => {
      const { page, calls } = mockPage([{ status: 200, json: [{ id: 1 }], headers: { 'x-wp-totalpages': '1' } }]);
      await paginateWpRest(page, 'https://x/wp-json/wp/v2/programs', {
        perPage: 50,
        maxPages: 1,
        query: { _embed: '1', orderby: 'date' },
      });
      expect(calls[0]).toContain('per_page=50');
      expect(calls[0]).toContain('_embed=1');
      expect(calls[0]).toContain('orderby=date');
    });
  });
});
