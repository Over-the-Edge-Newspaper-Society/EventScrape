import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const exampleComModule: ScraperModule = {
  key: 'example_com',
  label: 'Example Events Site',
  startUrls: [
    'https://example.com/events',
    'https://example.com/calendar',
  ],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger } = ctx;
    const events: RawEvent[] = [];

    logger.info(`Starting scrape of ${this.label}`);

    try {
      for (const url of this.startUrls) {
        logger.info(`Scraping ${url}`);
        
        // Rate limiting with jitter
        await delay(addJitter(2000));
        
        await page.goto(url, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });

        // Wait for events to load
        try {
          await page.waitForSelector('.event-item', { timeout: 10000 });
        } catch (error) {
          logger.warn(`No events found on ${url}`);
          continue;
        }

        // Extract events from the page
        const pageEvents = await this.extractEvents(page, ctx);
        events.push(...pageEvents);
        
        logger.info(`Found ${pageEvents.length} events on ${url}`);

        // Handle pagination if it exists
        const hasNextPage = await page.$('.pagination .next:not(.disabled)');
        let pageNum = 1;
        
        while (hasNextPage && pageNum < 5) { // Limit to 5 pages
          logger.info(`Scraping page ${pageNum + 1}`);
          
          await delay(addJitter(3000));
          await page.click('.pagination .next');
          await page.waitForLoadState('networkidle');
          
          const moreEvents = await this.extractEvents(page, ctx);
          events.push(...moreEvents);
          
          logger.info(`Found ${moreEvents.length} events on page ${pageNum + 1}`);
          
          pageNum++;
          
          // Check if there's still a next page
          const stillHasNext = await page.$('.pagination .next:not(.disabled)');
          if (!stillHasNext) break;
        }
      }

      logger.info(`Scrape completed. Total events found: ${events.length}`);
      return events;

    } catch (error) {
      logger.error(`Scrape failed: ${error}`);
      throw error;
    }
  },

  async extractEvents(page: any, ctx: RunContext): Promise<RawEvent[]> {
    const { logger } = ctx;
    
    return await page.evaluate(() => {
      const eventElements = document.querySelectorAll('.event-item');
      const events: RawEvent[] = [];

      eventElements.forEach((element, index) => {
        try {
          // Extract basic event information
          const titleEl = element.querySelector('.event-title, h3, h2');
          const title = titleEl?.textContent?.trim();
          
          if (!title) {
            console.warn(`Skipping event ${index}: no title found`);
            return;
          }

          // Extract date and time
          const dateEl = element.querySelector('.event-date, .date');
          const timeEl = element.querySelector('.event-time, .time');
          
          const dateText = dateEl?.textContent?.trim() || '';
          const timeText = timeEl?.textContent?.trim() || '';
          const start = `${dateText} ${timeText}`.trim();

          // Extract venue information
          const venueEl = element.querySelector('.event-venue, .venue');
          const venueName = venueEl?.textContent?.trim();

          const addressEl = element.querySelector('.event-address, .address');
          const venueAddress = addressEl?.textContent?.trim();

          // Extract description
          const descEl = element.querySelector('.event-description, .description');
          const descriptionHtml = descEl?.innerHTML?.trim();

          // Extract URL
          const linkEl = element.querySelector('a[href]') as HTMLAnchorElement;
          const relativeUrl = linkEl?.href;
          const url = relativeUrl ? new URL(relativeUrl, window.location.origin).href : window.location.href;

          // Extract image
          const imgEl = element.querySelector('img[src]') as HTMLImageElement;
          const imageUrl = imgEl?.src;

          // Extract organizer
          const organizerEl = element.querySelector('.event-organizer, .organizer');
          const organizer = organizerEl?.textContent?.trim();

          // Extract price
          const priceEl = element.querySelector('.event-price, .price');
          const price = priceEl?.textContent?.trim();

          // Extract category/tags
          const categoryEl = element.querySelector('.event-category, .category');
          const category = categoryEl?.textContent?.trim();

          const tagEls = element.querySelectorAll('.event-tag, .tag');
          const tags = Array.from(tagEls).map(el => el.textContent?.trim()).filter(Boolean);

          const event: RawEvent = {
            title,
            start,
            descriptionHtml,
            venueName,
            venueAddress,
            url,
            imageUrl,
            organizer,
            price,
            category,
            tags: tags.length > 0 ? tags as string[] : undefined,
            raw: {
              elementIndex: index,
              innerHTML: element.innerHTML,
              extractedAt: new Date().toISOString(),
            },
          };

          events.push(event);
        } catch (error) {
          console.error(`Error extracting event ${index}:`, error);
        }
      });

      return events;
    });
  },
};

export default exampleComModule;