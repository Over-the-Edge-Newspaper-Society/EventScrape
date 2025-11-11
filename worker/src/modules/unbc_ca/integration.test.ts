import { describe, it, expect } from 'vitest';
import { chromium, Browser, Page } from 'playwright';

/**
 * Integration tests for UNBC scraper against the LIVE website.
 *
 * Usage:
 *   # Test specific event URL
 *   TEST_EVENT_URL="https://www.unbc.ca/events/104126/sgu-clothing-swap" ./scripts/playwright-test.sh "pnpm --filter @eventscrape/worker exec vitest run src/modules/unbc_ca/integration.test.ts -t 'specific event'"
 */

describe('UNBC Integration Tests (Live Website)', () => {
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

      // Extract data from the detail page
      const eventData = await page.evaluate(() => {
        // Extract title
        const titleEl = document.querySelector('h1 .field--name-title');
        const title = titleEl?.textContent?.trim() || '';

        // Extract date/time information
        const datetimeElements = document.querySelectorAll('.field--name-field-smart-date-ranges time[datetime]');
        const dates: Array<{ start: string; end?: string }> = [];

        if (datetimeElements.length >= 1) {
          const startDateTime = datetimeElements[0].getAttribute('datetime');
          const endDateTime = datetimeElements.length >= 2
            ? datetimeElements[1].getAttribute('datetime')
            : null;

          if (startDateTime) {
            dates.push({
              start: startDateTime,
              end: endDateTime || undefined,
            });
          }
        }

        // Extract location
        const locationEl = document.querySelector('.field--name-field-location .field__item');
        const location = locationEl?.textContent?.trim() || '';

        // Extract campus
        const campusEl = document.querySelector('.field--name-field-campuses .field__item');
        const campus = campusEl?.textContent?.trim() || '';

        // Extract short description
        const shortDescEl = document.querySelector('.field--name-field-short-description .featured-text');
        const shortDescription = shortDescEl?.innerHTML?.trim() || '';

        // Extract full content/description
        const contentEl = document.querySelector('.field--name-field-content');
        const fullContent = contentEl?.innerHTML?.trim() || '';

        // Extract image
        const imageEl = document.querySelector('.field--name-field-hero-image img') as HTMLImageElement;
        const imageUrl = imageEl?.src || '';

        // Extract registration link
        const regLinkEl = document.querySelector('.field--name-field-content a.btn') as HTMLAnchorElement;
        const registrationUrl = regLinkEl?.href || '';

        // Extract event type/category if available
        const categoryEl = document.querySelector('.field--name-field-event-type .field__item');
        const category = categoryEl?.textContent?.trim() || '';

        return {
          title,
          dates,
          location,
          campus,
          shortDescription,
          fullContent,
          imageUrl,
          registrationUrl,
          category,
          url: window.location.href,
        };
      });

      console.log('\n✓ Successfully extracted event data:');
      console.log(`  Title: ${eventData.title}`);
      console.log(`  Location: ${eventData.location || 'N/A'}`);
      console.log(`  Campus: ${eventData.campus || 'N/A'}`);
      console.log(`  Category: ${eventData.category || 'N/A'}`);
      console.log(`  Dates found: ${eventData.dates.length}`);
      console.log(`  Image URL: ${eventData.imageUrl ? '✓ Present' : '✗ Missing'}`);
      console.log(`  Short Description: ${eventData.shortDescription ? '✓ Present' : '✗ Missing'}`);
      console.log(`  Full Content: ${eventData.fullContent ? '✓ Present' : '✗ Missing'}`);
      console.log(`  Registration URL: ${eventData.registrationUrl ? '✓ Present' : '✗ Missing'}`);

      if (eventData.dates.length > 0) {
        console.log('\n  Date/Time instances:');
        eventData.dates.forEach((date, idx) => {
          console.log(`    ${idx + 1}. Start: ${date.start}${date.end ? `, End: ${date.end}` : ''}`);
        });
      }

      // Validations
      expect(eventData.title).toBeTruthy();
      expect(eventData.dates.length).toBeGreaterThan(0);

      // Accept both full ISO datetime and date-only formats
      if (eventData.dates[0].start) {
        expect(eventData.dates[0].start).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/);
      }

    } finally {
      await teardownBrowser();
    }
  }, 30000); // 30 second timeout

  it('should scrape events from calendar listing', async () => {
    await setupBrowser();

    try {
      console.log('\nTesting calendar listing extraction...');

      await page.goto('https://www.unbc.ca/events', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for events container to load
      await page.waitForSelector('.view-content', { timeout: 15000 });
      console.log('✓ Calendar page loaded');

      // Extract event links from listing
      const eventLinks = await page.evaluate(() => {
        const links: Array<{ url: string; title: string; date: string; time: string; location: string }> = [];

        const eventElements = document.querySelectorAll('.event-boxed');

        eventElements.forEach((eventEl) => {
          // Extract title and link
          const titleLinkEl = eventEl.querySelector('.event-info h2 a') as HTMLAnchorElement;
          if (!titleLinkEl?.href) return;

          // Extract date from the date squares
          const dateSquares = eventEl.querySelectorAll('.datesquare');
          let dateStr = '';
          if (dateSquares.length === 1) {
            // Single date event
            const dayEl = dateSquares[0].querySelector('p');
            const monthEl = dateSquares[0].childNodes[1]; // Text node after <p>
            if (dayEl && monthEl) {
              const day = dayEl.textContent?.trim();
              const month = monthEl.textContent?.trim();
              const currentYear = new Date().getFullYear();
              dateStr = `${month} ${day}, ${currentYear}`;
            }
          } else if (dateSquares.length === 2) {
            // Date range event - use start date
            const startDayEl = dateSquares[0].querySelector('p');
            const startMonthEl = dateSquares[0].childNodes[1];
            if (startDayEl && startMonthEl) {
              const day = startDayEl.textContent?.trim();
              const month = startMonthEl.textContent?.trim();
              const currentYear = new Date().getFullYear();
              dateStr = `${month} ${day}, ${currentYear}`;
            }
          }

          // Extract time
          const timeEl = eventEl.querySelector('.day-and-time');
          let timeStr = '';
          if (timeEl) {
            const timeText = timeEl.textContent || '';
            const timeMatch = timeText.match(/(\d{1,2}:\d{2}\s*[ap]\.m\.(?:\s*to\s*\d{1,2}:\d{2}\s*[ap]\.m\.)?)/i);
            if (timeMatch) {
              timeStr = timeMatch[1];
            } else {
              const noTimeMatch = timeText.match(/to\s+\w+$/);
              if (noTimeMatch) {
                timeStr = 'All day';
              }
            }
          }

          // Extract location
          const locationEl = eventEl.querySelector('.event-info p:last-child');
          let locationStr = '';
          if (locationEl) {
            const locationSpans = locationEl.querySelectorAll('span');
            if (locationSpans.length >= 2) {
              locationStr = Array.from(locationSpans)
                .map(span => span.textContent?.trim())
                .filter(Boolean)
                .join(', ');
            }
          }

          links.push({
            url: new URL(titleLinkEl.href, window.location.origin).href,
            title: titleLinkEl.textContent?.trim() || '',
            time: timeStr,
            date: dateStr,
            location: locationStr,
          });
        });

        return links;
      });

      console.log(`✓ Found ${eventLinks.length} events in calendar listing`);

      // Sanity checks
      expect(eventLinks.length).toBeGreaterThan(0);

      if (eventLinks.length > 0) {
        const firstEvent = eventLinks[0];
        console.log('\nFirst event sample:');
        console.log(`  Title: ${firstEvent.title}`);
        console.log(`  URL: ${firstEvent.url}`);
        console.log(`  Date: ${firstEvent.date || 'N/A'}`);
        console.log(`  Time: ${firstEvent.time || 'N/A'}`);
        console.log(`  Location: ${firstEvent.location || 'N/A'}`);

        expect(firstEvent.title).toBeTruthy();
        expect(firstEvent.url).toMatch(/^https:\/\/www\.unbc\.ca\/events\//);
      }

    } finally {
      await teardownBrowser();
    }
  }, 30000);
});
