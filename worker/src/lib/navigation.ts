import type { Page } from 'playwright';

// A loaded error page is not a successfully loaded calendar. Check HTTP status
// before waiting for content, and avoid analytics-dependent networkidle waits.
export async function navigateToPage(page: Page, url: string, stats?: { pagesCrawled: number }) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (response) {
    if (stats) stats.pagesCrawled++;
    if (!response.ok()) throw new Error(`HTTP ${response.status()} loading ${url} (final URL: ${page.url()})`);
  } else {
    throw new Error(`No HTTP response loading ${url}`);
  }
  return response;
}
