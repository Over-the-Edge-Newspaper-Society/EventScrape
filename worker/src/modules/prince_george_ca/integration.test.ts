import { describe, it, expect } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import princeGeorgeModule from './index.js';
import type { RunContext, RawEvent } from '../../types.js';

/**
 * Integration tests for Prince George scraper against the LIVE website.
 *
 * Usage:
 *   # Test full scraper (current month)
 *   pnpm --filter @eventscrape/worker exec vitest run src/modules/prince_george_ca/integration.test.ts
 *
 *   # Test specific event URL (set via environment)
 *   TEST_EVENT_URL="https://www.princegeorge.ca/..." pnpm --filter @eventscrape/worker exec vitest run src/modules/prince_george_ca/integration.test.ts -t "specific event"
 */

describe('Prince George Integration Tests (Live Website)', () => {
  let browser: Browser;
  let page: Page;

  const setupBrowser = async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  };

  const teardownBrowser = async () => {
    if (page) await page.close();
    if (browser) await browser.close();
  };

  it('should scrape current month events from live website', async () => {
    await setupBrowser();

    const logs: string[] = [];
    const mockLogger = {
      info: (msg: string) => {
        console.log(`[INFO] ${msg}`);
        logs.push(msg);
      },
      error: (msg: string) => {
        console.error(`[ERROR] ${msg}`);
        logs.push(msg);
      },
      warn: (msg: string) => {
        console.warn(`[WARN] ${msg}`);
        logs.push(msg);
      },
      debug: (msg: string) => {
        console.debug(`[DEBUG] ${msg}`);
        logs.push(msg);
      },
    };

    const stats = { pagesCrawled: 0 };

    const ctx: RunContext = {
      page,
      logger: mockLogger,
      jobData: {
        testMode: true, // Limit to first 3 events for faster testing
        paginationOptions: {
          // Use current month
          startDate: new Date(new Date().setDate(1)).toISOString(),
          endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString(),
        },
      },
      stats,
    };

    try {
      const events = await princeGeorgeModule.run(ctx);

      console.log(`\n✓ Successfully scraped ${events.length} events`);
      console.log(`✓ Pages crawled: ${stats.pagesCrawled}`);

      // Basic validations
      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);

      if (events.length > 0) {
        const firstEvent = events[0];
        console.log('\nFirst event sample:');
        console.log(`  Title: ${firstEvent.title}`);
        console.log(`  URL: ${firstEvent.url}`);
        console.log(`  Start: ${firstEvent.start}`);
        console.log(`  End: ${firstEvent.end || 'N/A'}`);
        console.log(`  Venue: ${firstEvent.venueName || 'N/A'}`);
        console.log(`  Category: ${firstEvent.category || 'N/A'}`);
        console.log(`  Tags: ${firstEvent.tags?.join(', ') || 'N/A'}`);

        // Validate event structure
        expect(firstEvent.title).toBeTruthy();
        expect(firstEvent.url).toBeTruthy();
        expect(firstEvent.start).toBeTruthy();
        expect(firstEvent.start).toMatch(/^\d{4}-\d{2}-\d{2}/);
      } else {
        console.log('\n⚠ No events found in current month (may be expected if calendar is empty)');
      }

    } finally {
      await teardownBrowser();
    }
  }, 60000); // 60 second timeout

  it('should scrape a specific event URL when provided', async () => {
    const testEventUrl = process.env.TEST_EVENT_URL;

    if (!testEventUrl) {
      console.log('⊘ Skipping specific event test (no TEST_EVENT_URL provided)');
      return;
    }

    await setupBrowser();

    const logs: string[] = [];
    const mockLogger = {
      info: (msg: string) => {
        console.log(`[INFO] ${msg}`);
        logs.push(msg);
      },
      error: (msg: string) => {
        console.error(`[ERROR] ${msg}`);
        logs.push(msg);
      },
      warn: (msg: string) => {
        console.warn(`[WARN] ${msg}`);
        logs.push(msg);
      },
      debug: (msg: string) => {
        console.debug(`[DEBUG] ${msg}`);
        logs.push(msg);
      },
    };

    try {
      console.log(`\nTesting specific event: ${testEventUrl}`);

      // Navigate directly to the event detail page
      await page.goto(testEventUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // Import the detail page extraction function
      const { extractPrinceGeorgeDetailPageData, normalizeSeriesEntries } = await import('./utils/detail-page.js');

      // Extract data from the detail page using the actual scraper function
      const rawData = await page.evaluate(extractPrinceGeorgeDetailPageData);

      // Normalize the dates
      const normalizedDates = normalizeSeriesEntries(rawData.dates);

      // Get the title from the page
      const title = await page.$eval('h1.page-title', el => el.textContent?.trim() || '').catch(() => '');

      const detailData = {
        title,
        dates: normalizedDates,
        eventType: rawData.eventType,
        communityType: rawData.communityType,
        location: rawData.location,
        description: rawData.description,
        imageUrl: rawData.imageUrl,
        url: testEventUrl,
      };

      console.log('\n✓ Successfully extracted event data:');
      console.log(`  Title: ${detailData.title}`);
      console.log(`  Location: ${detailData.location}`);
      console.log(`  Event Type: ${detailData.eventType}`);
      console.log(`  Community Type: ${detailData.communityType}`);
      console.log(`  Dates found: ${detailData.dates.length}`);
      console.log(`  Image URL: ${detailData.imageUrl ? '✓ Present' : '✗ Missing'}`);
      console.log(`  Description: ${detailData.description ? '✓ Present' : '✗ Missing'}`);

      if (detailData.dates.length > 0) {
        console.log('\n  Date/Time instances:');
        detailData.dates.slice(0, 5).forEach((date, idx) => {
          console.log(`    ${idx + 1}. Start: ${date.start}${date.end ? `, End: ${date.end}` : ''}`);
        });
        if (detailData.dates.length > 5) {
          console.log(`    ... and ${detailData.dates.length - 5} more`);
        }
      }

      // Validations
      expect(detailData.title).toBeTruthy();
      expect(detailData.dates.length).toBeGreaterThan(0);
      // Accept both date-only (2025-11-26) and datetime (2025-11-26T09:00:00) formats
      expect(detailData.dates[0].start).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/);

    } finally {
      await teardownBrowser();
    }
  }, 30000); // 30 second timeout

  it('should handle calendar navigation correctly', async () => {
    await setupBrowser();

    try {
      console.log('\nTesting calendar navigation...');

      await page.goto('https://www.princegeorge.ca/community-culture/events/events-calendar', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for calendar to load
      await page.waitForSelector('.fc-view-container', { timeout: 15000 });
      console.log('✓ Calendar loaded');

      // Check if list view is available
      const listItems = await page.$$('.fc-list-item');
      console.log(`✓ Found ${listItems.length} events in current view`);

      // Test navigation buttons exist
      const prevButton = await page.$('.fc-prev-button');
      const nextButton = await page.$('.fc-next-button');

      expect(prevButton).toBeTruthy();
      expect(nextButton).toBeTruthy();
      console.log('✓ Navigation buttons present (prev and next)');

      // Try to get current month title (may not exist in all views)
      const titleEl = await page.$('.fc-toolbar-title');
      if (titleEl) {
        const titleBefore = await titleEl.textContent();
        console.log(`✓ Current month: ${titleBefore}`);

        // Click next month
        if (nextButton) {
          await nextButton.click();
          await page.waitForTimeout(1000); // Wait for calendar to update

          const titleAfter = await page.$eval('.fc-toolbar-title', el => el.textContent);
          console.log(`✓ After clicking next: ${titleAfter}`);

          expect(titleAfter).not.toBe(titleBefore);
        }
      } else {
        console.log('⚠ Title element not found (calendar may be in list view)');
        // Just verify clicking next button works
        if (nextButton) {
          await nextButton.click();
          await page.waitForTimeout(1000);
          console.log('✓ Successfully clicked next button');
        }
      }

    } finally {
      await teardownBrowser();
    }
  }, 30000);
});
