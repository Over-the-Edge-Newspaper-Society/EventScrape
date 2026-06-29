import type { Page } from 'playwright';

/**
 * Helpers for the "author a DOM extractor once, run it in the browser" pattern.
 *
 * A module writes a self-contained extractor `(doc: Document) => T` using only
 * DOM APIs. It can be unit-tested directly against a jsdom Document, and run in
 * the real browser by serializing it (`fn.toString()`), shipping the source
 * into `page.evaluate`, and `eval`-ing it there against the page document or a
 * DOMParser-parsed response. These helpers encapsulate that plumbing so each
 * module stops re-implementing the `eval(...)` dance.
 */

/** Serialize an extractor function to an eval-able source string. */
export function serializeExtractor(fn: (...args: any[]) => any): string {
  return `(${fn.toString()})`;
}

/** Run a DOM extractor against the page's current `document`, in the browser. */
export async function extractFromPage<T>(page: Page, extractor: (doc: Document) => T): Promise<T> {
  const source = serializeExtractor(extractor);
  return (await page.evaluate((src: string) => {
    // eslint-disable-next-line no-eval
    return (eval(src) as (doc: Document) => unknown)(document);
  }, source)) as T;
}

/**
 * Fetch a URL from within the browser context, parse the HTML, and run a DOM
 * extractor against it. Returns null on a non-OK response or any error (so the
 * caller can skip and continue). Useful for crawling many detail pages.
 */
export async function fetchAndExtract<T>(
  page: Page,
  url: string,
  extractor: (doc: Document) => T,
): Promise<T | null> {
  const source = serializeExtractor(extractor);
  return (await page.evaluate(
    async ({ url, src }: { url: string; src: string }) => {
      try {
        const resp = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) return null;
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // eslint-disable-next-line no-eval
        return (eval(src) as (d: Document) => unknown)(doc);
      } catch {
        return null;
      }
    },
    { url, src: source },
  )) as T | null;
}
