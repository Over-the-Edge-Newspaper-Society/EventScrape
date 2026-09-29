import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const thirstyMoosePubModule: ScraperModule = {
  key: 'thirstymoosepub_events',
  label: 'Thirsty Moose Pub Events',
  startUrls: [
    // TODO: Verify the correct URL - the original URL provided (nugss.ca) does not resolve
    // Possible alternatives:
    // - https://mynugss.ca/thirstymoosepub-events
    // - https://www.unbc.ca/nugss/events/thirstymoosepub
    // - https://thirstymoosepub.ca/events
    'https://www.example.com/thirstymoosepub-events', // Placeholder - needs verification
  ],
  paginationType: 'calendar',
  integrationTags: ['calendar'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    const isTestMode = jobData?.testMode === true;
    const scrapeMode = jobData?.scrapeMode || 'full';
    const paginationOptions = jobData?.paginationOptions;

    logger.info(`Starting ${isTestMode ? 'test ' : scrapeMode} scrape of ${this.label}`);
    
    if (paginationOptions?.type === 'calendar' && (paginationOptions.startDate || paginationOptions.endDate)) {
      logger.info(`Calendar pagination: ${paginationOptions.startDate || 'no start'} to ${paginationOptions.endDate || 'no end'}`);
    }

    try {
      // Navigate to the events page
      await page.goto(this.startUrls[0], { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      if (ctx.stats) ctx.stats.pagesCrawled++;

      logger.info('Page loaded, waiting for calendar to render...');

      // Wait for the calendar/events container to load
      // Try multiple possible selectors based on common calendar implementations
      let calendarFound = false;
      const possibleSelectors = [
        '.event-calendar',
        '.calendar-container',
        '.events-list',
        '[class*="calendar"]',
        '[class*="event"]',
        '.fc-view-container', // FullCalendar
        '.jet-calendar-grid', // JetEngine
        '.mec-calendar', // Modern Events Calendar
      ];

      for (const selector of possibleSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000, state: 'attached' });
          logger.info(`Events container found with selector: ${selector}`);
          calendarFound = true;
          break;
        } catch (error) {
          // Continue trying other selectors
        }
      }

      if (!calendarFound) {
        logger.warn('No specific calendar container found, will try to extract from page anyway');
        // Take a screenshot for debugging
        try {
          await page.screenshot({ path: '/tmp/thirstymoosepub-no-container.png', fullPage: true });
          logger.info('Screenshot saved to /tmp/thirstymoosepub-no-container.png');
        } catch (screenshotError) {
          logger.warn('Could not take screenshot:', screenshotError);
        }
      }

      // Wait for any events to populate
      await page.waitForTimeout(3000);

      // Determine date range for scraping
      let maxMonths = isTestMode ? 1 : 3; // Default: current + next 2 months
      let targetStartDate: Date | null = null;
      let targetEndDate: Date | null = null;

      if (paginationOptions?.type === 'calendar') {
        if (paginationOptions.startDate) {
          targetStartDate = new Date(paginationOptions.startDate);
        }
        if (paginationOptions.endDate) {
          targetEndDate = new Date(paginationOptions.endDate);
        }
        
        // If we have date range, calculate months to scrape
        if (targetStartDate && targetEndDate) {
          const monthsDiff = (targetEndDate.getFullYear() - targetStartDate.getFullYear()) * 12 + 
                           (targetEndDate.getMonth() - targetStartDate.getMonth()) + 1;
          maxMonths = Math.min(Math.max(monthsDiff, 1), 12); // Cap at 12 months
          logger.info(`Date range specified: scraping ${maxMonths} months from ${paginationOptions.startDate} to ${paginationOptions.endDate}`);
        }
      }

      // Extract event links from the calendar
      const eventLinks = await page.evaluate(() => {
        const links: Array<{url: string, title: string, date?: string}> = [];
        
        // Try multiple selectors to find event elements
        const eventSelectors = [
          '.event-item a',
          '.calendar-event a',
          '.fc-event-title a',
          '.jet-calendar-week__day-event a',
          '.mec-event-article a',
          'article[class*="event"] a',
          '[class*="event"] a[href*="/event"]',
        ];

        let eventElements: NodeListOf<Element> | null = null;
        
        for (const selector of eventSelectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            eventElements = elements;
            break;
          }
        }
        
        if (eventElements) {
          eventElements.forEach(eventEl => {
            const linkEl = eventEl as HTMLAnchorElement;
            
            if (linkEl?.href && linkEl?.textContent) {
              // Try to find associated date
              let dateStr = '';
              const parent = linkEl.closest('.event-item, .calendar-event, .fc-event, article');
              if (parent) {
                const dateEl = parent.querySelector('.event-date, .date, time[datetime]');
                if (dateEl) {
                  dateStr = (dateEl as HTMLElement).getAttribute('datetime') || 
                           dateEl.textContent?.trim() || '';
                }
              }
              
              links.push({
                url: linkEl.href,
                title: linkEl.textContent.trim(),
                date: dateStr || undefined,
              });
            }
          });
        } else {
          // Fallback: try to find any links that might be events
          const allLinks = document.querySelectorAll('a[href]');
          allLinks.forEach(linkEl => {
            const link = linkEl as HTMLAnchorElement;
            const href = link.href;
            const text = link.textContent?.trim();
            
            // Only include links that look like event pages
            if (text && href && 
                (href.includes('/event') || href.includes('/events') || 
                 link.closest('[class*="event"]') || link.closest('.calendar'))) {
              links.push({
                url: href,
                title: text,
              });
            }
          });
        }
        
        return links;
      });

      logger.info(`Found ${eventLinks.length} event links`);

      // Deduplicate event links by URL
      const uniqueEventLinks = Array.from(
        new Map(eventLinks.map(link => [link.url, link])).values()
      );

      logger.info(`Processing ${uniqueEventLinks.length} unique event URLs`);

      // Visit each event detail page
      for (const eventLink of uniqueEventLinks) {
        if (isTestMode && events.length >= 5) {
          logger.info('Test mode: stopping after 5 events');
          break;
        }

        try {
          logger.info(`Processing: ${eventLink.title} (${eventLink.url})`);

          await delay(addJitter(2000, 50)); // Rate limiting with jitter

          await page.goto(eventLink.url, {
            waitUntil: 'networkidle',
            timeout: 20000,
          });
          if (ctx.stats) ctx.stats.pagesCrawled++;

          // Extract event details from the page
          const eventData = await page.evaluate(() => {
            const dates: Array<{ start: string; end?: string }> = [];

            // Try to find structured date/time data
            const timeElements = document.querySelectorAll('time[datetime]');
            if (timeElements.length > 0) {
              timeElements.forEach((el, idx) => {
                const datetime = el.getAttribute('datetime');
                if (!datetime) return;

                // Pair start and end times
                if (idx % 2 === 0) {
                  const nextEl = timeElements[idx + 1];
                  const endDatetime = nextEl?.getAttribute('datetime');
                  dates.push({
                    start: datetime,
                    end: endDatetime || undefined,
                  });
                }
              });
            } else {
              // Fallback: try to find date text in common locations
              const dateSelectors = [
                '.event-date',
                '.date',
                '.event-time',
                '.datetime',
                '[class*="date"]',
                '[class*="time"]',
              ];

              for (const selector of dateSelectors) {
                const dateEl = document.querySelector(selector);
                if (dateEl?.textContent) {
                  const dateText = dateEl.textContent.trim();
                  if (dateText) {
                    // Store as text - will be parsed by the backend
                    dates.push({ start: dateText });
                    break;
                  }
                }
              }
            }

            // Extract other event details
            const title = document.querySelector('h1, .event-title, .entry-title')?.textContent?.trim();
            
            const locationSelectors = [
              '.event-location',
              '.location',
              '.venue',
              '.event-venue',
              '[class*="location"]',
              '[class*="venue"]',
            ];
            let venueName = '';
            for (const selector of locationSelectors) {
              const locEl = document.querySelector(selector);
              if (locEl?.textContent) {
                venueName = locEl.textContent.trim();
                break;
              }
            }

            const descSelectors = [
              '.event-description',
              '.description',
              '.entry-content',
              '.event-content',
              'article .content',
            ];
            let descriptionHtml = '';
            for (const selector of descSelectors) {
              const descEl = document.querySelector(selector);
              if (descEl?.innerHTML) {
                descriptionHtml = descEl.innerHTML.trim();
                break;
              }
            }

            const imageEl = document.querySelector('.event-image img, .featured-image img, article img') as HTMLImageElement;
            const imageUrl = imageEl?.src;

            const categoryEl = document.querySelector('.event-category, .category, .event-type');
            const category = categoryEl?.textContent?.trim();

            const priceEl = document.querySelector('.event-price, .price, .cost');
            const price = priceEl?.textContent?.trim();

            const organizerEl = document.querySelector('.event-organizer, .organizer, .hosted-by');
            const organizer = organizerEl?.textContent?.trim();

            return {
              dates,
              title,
              venueName,
              descriptionHtml,
              imageUrl,
              category,
              price,
              organizer,
            };
          });

          // Create event entries for each date instance
          if (eventData.dates.length === 0) {
            logger.warn(`No dates found for event: ${eventLink.title}`);
            // Still create an event entry with the link date if available
            eventData.dates.push({ 
              start: eventLink.date || new Date().toISOString() 
            });
          }

          for (const dateInfo of eventData.dates) {
            const event: RawEvent = {
              sourceEventId: `${eventLink.url}#${dateInfo.start}`,
              title: eventData.title || eventLink.title,
              start: dateInfo.start,
              end: dateInfo.end,
              url: eventLink.url,
              venueName: eventData.venueName,
              descriptionHtml: eventData.descriptionHtml,
              imageUrl: eventData.imageUrl,
              category: eventData.category,
              price: eventData.price,
              organizer: eventData.organizer,
              city: 'Prince George', // Assuming Prince George based on NUGSS/UNBC context
              region: 'British Columbia',
              country: 'Canada',
              raw: {
                extractedFrom: eventLink.url,
                extractedAt: new Date().toISOString(),
                eventData: eventData,
              },
            };

            events.push(event);
          }

          logger.info(`Extracted ${eventData.dates.length} date instance(s) for: ${eventLink.title}`);

        } catch (error) {
          logger.error(`Failed to process event ${eventLink.url}: ${error}`);
          // Continue with next event
        }
      }

      logger.info(`Successfully scraped ${events.length} event instances from ${uniqueEventLinks.length} unique events`);
      return events;

    } catch (error) {
      logger.error(`Scraper failed: ${error}`);
      throw error;
    }
  },
};

export default thirstyMoosePubModule;
