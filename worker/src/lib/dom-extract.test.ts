import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { serializeExtractor } from './dom-extract.js';

// A representative self-contained extractor (the kind modules author).
const extractTitles = (doc: Document): string[] =>
  Array.from(doc.querySelectorAll('h2')).map(h => h.textContent?.trim() || '');

describe('lib/dom-extract', () => {
  describe('serializeExtractor', () => {
    it('produces a string that eval reconstructs into an equivalent function', () => {
      const src = serializeExtractor(extractTitles);
      expect(typeof src).toBe('string');
      expect(src.startsWith('(')).toBe(true);

      const doc = new JSDOM('<h2>Alpha</h2><h2> Beta </h2>').window.document;
      // eslint-disable-next-line no-eval
      const reconstructed = eval(src) as (d: Document) => string[];

      // Round-trip behaves identically to calling the original directly —
      // this is exactly the serialize→ship→eval path run() relies on.
      expect(reconstructed(doc)).toEqual(extractTitles(doc));
      expect(reconstructed(doc)).toEqual(['Alpha', 'Beta']);
    });

    it('round-trips an extractor returning structured objects', () => {
      const extractLinks = (doc: Document) =>
        Array.from(doc.querySelectorAll('a')).map(a => ({
          text: a.textContent,
          href: a.getAttribute('href'),
        }));
      const doc = new JSDOM('<a href="/x">X</a><a href="/y">Y</a>').window.document;
      // eslint-disable-next-line no-eval
      const fn = eval(serializeExtractor(extractLinks)) as typeof extractLinks;
      expect(fn(doc)).toEqual([
        { text: 'X', href: '/x' },
        { text: 'Y', href: '/y' },
      ]);
    });
  });
});
