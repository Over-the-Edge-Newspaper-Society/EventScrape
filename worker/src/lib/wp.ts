import type { Page } from 'playwright';

/**
 * Thin wrappers over Playwright's request context for the many modules that
 * pull JSON / text feeds, plus a generic WordPress REST paginator.
 *
 * Using `page.request` (rather than Node fetch) keeps requests on the worker's
 * browser network stack — consistent with how the scrapers reach the web.
 */

export interface JsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  headers: Record<string, string>;
}

/** GET a URL and parse JSON. `data` is null on a non-OK response or parse error. */
export async function fetchJson<T = unknown>(
  page: Page,
  url: string,
  opts?: { timeout?: number },
): Promise<JsonResult<T>> {
  const res = await page.request.get(url, { timeout: opts?.timeout ?? 30000 });
  let data: T | null = null;
  if (res.ok()) {
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
  }
  return { ok: res.ok(), status: res.status(), data, headers: res.headers() };
}

export interface TextResult {
  ok: boolean;
  status: number;
  text: string | null;
}

/** GET a URL as text (RSS / iCal / sitemap). `text` is null on a non-OK response. */
export async function fetchText(page: Page, url: string, opts?: { timeout?: number }): Promise<TextResult> {
  const res = await page.request.get(url, { timeout: opts?.timeout ?? 30000 });
  let text: string | null = null;
  if (res.ok()) {
    try {
      text = await res.text();
    } catch {
      text = null;
    }
  }
  return { ok: res.ok(), status: res.status(), text };
}

export interface PaginateOptions {
  perPage: number;
  maxPages: number;
  query?: Record<string, string>;
  timeout?: number;
  logger?: { info: (m: string) => void; warn: (m: string) => void };
  onPage?: () => void;
}

/**
 * Page through a WordPress REST collection endpoint (e.g.
 * `/wp-json/wp/v2/events`), concatenating each page's item array. Stops at the
 * `x-wp-totalpages` header, an empty page, a non-OK response, or `maxPages`.
 * WordPress returns HTTP 400 ("rest_post_invalid_page_number") past the last
 * page, which is treated as a clean end.
 */
export async function paginateWpRest<T = unknown>(
  page: Page,
  endpoint: string,
  opts: PaginateOptions,
): Promise<T[]> {
  const items: T[] = [];
  for (let pageNum = 1; pageNum <= opts.maxPages; pageNum++) {
    const params = new URLSearchParams({
      per_page: String(opts.perPage),
      page: String(pageNum),
      ...(opts.query ?? {}),
    });
    const url = `${endpoint}?${params.toString()}`;
    const { ok, status, data, headers } = await fetchJson<T[]>(page, url, { timeout: opts.timeout });
    opts.onPage?.();

    if (!ok) {
      if (status === 400 && pageNum > 1) {
        opts.logger?.info(`Reached end of ${endpoint} at page ${pageNum}`);
      } else {
        opts.logger?.warn(`WP REST ${endpoint} page ${pageNum} → HTTP ${status}`);
      }
      break;
    }
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...data);

    const totalPages = Number(headers['x-wp-totalpages'] || '1');
    if (pageNum >= totalPages) break;
  }
  return items;
}
