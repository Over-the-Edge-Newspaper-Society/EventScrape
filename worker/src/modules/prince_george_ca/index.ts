import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const princeGeorgeModule: ScraperModule = {
  key: 'prince_george_ca',
  label: 'City of Prince George Events',
  startUrls: [
    'https://www.princegeorge.ca/community-culture/events/events-calendar',
  ],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    const isTestMode = jobData?.testMode === true;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

    try {
      // Navigate to the events calendar page
      await page.goto(this.startUrls[0], { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      logger.info('Page loaded, waiting for calendar to render...');

      // Wait for the calendar widget to load first
      await page.waitForSelector('.fc-view-container', { timeout: 15000 });
      
      // Switch to list view first
      const listButton = await page.$('.fc-listMonth-button');
      if (listButton) {
        const isActive = await page.evaluate(el => el.classList.contains('fc-button-active'), listButton);
        if (!isActive) {
          logger.info('Switching to list view...');
          await listButton.click();
          await page.waitForTimeout(3000); // Give it more time to load
        }
      }
      
      // Now wait for the list table to appear
      await page.waitForSelector('.fc-list-table', { timeout: 10000 });

      logger.info('Calendar loaded, extracting events...');

      // Extract all event links from the calendar
      const eventLinks = await page.evaluate(() => {
        const links: Array<{url: string, title: string, time: string, date: string}> = [];
        
        // Find all event rows in the calendar
        const eventRows = document.querySelectorAll('.fc-list-item');
        
        eventRows.forEach(row => {
          const linkEl = row.querySelector('.fc-list-item-title a') as HTMLAnchorElement;
          const timeEl = row.querySelector('.fc-list-item-time');
          
          if (linkEl && timeEl) {
            // Find the date heading for this event
            let dateHeading = row.previousElementSibling;
            while (dateHeading && !dateHeading.classList.contains('fc-list-heading')) {
              dateHeading = dateHeading.previousElementSibling;
            }
            
            const dateText = dateHeading?.querySelector('.fc-list-heading-main')?.textContent?.trim() || '';
            
            links.push({
              url: new URL(linkEl.href, window.location.origin).href,
              title: linkEl.textContent?.trim() || '',
              time: timeEl.textContent?.trim() || '',
              date: dateText
            });
          }
        });
        
        return links;
      });

      logger.info(`Found ${eventLinks.length} event links`);
      
      // In test mode, only process the first event
      const eventsToProcess = isTestMode ? eventLinks.slice(0, 1) : eventLinks;
      logger.info(`Processing ${eventsToProcess.length} event${eventsToProcess.length === 1 ? '' : 's'}${isTestMode ? ' (test mode)' : ''}`);

      // Visit each event detail page
      for (const [index, eventLink] of eventsToProcess.entries()) {
        try {
          logger.info(`Scraping event ${index + 1}/${eventsToProcess.length}: ${eventLink.title}`);
          
          // Rate limiting
          await delay(addJitter(2000, 50));
          
          // Navigate to event detail page
          await page.goto(eventLink.url, { 
            waitUntil: 'networkidle',
            timeout: 20000 
          });

          // Extract detailed event information
          const eventDetails = await page.evaluate((linkData) => {
            // Extract event dates and times
            const dateTimeElements = document.querySelectorAll('.field--name-field-when .field__item');
            const eventDates: Array<{start: string, end?: string}> = [];
            
            dateTimeElements.forEach(el => {
              const timeElements = el.querySelectorAll('time[datetime]');
              if (timeElements.length >= 1) {
                const startTime = timeElements[0].getAttribute('datetime');
                const endTime = timeElements[1]?.getAttribute('datetime');
                
                if (startTime) {
                  eventDates.push({
                    start: startTime,
                    end: endTime || undefined
                  });
                }
              }
            });

            // Extract event types
            const eventTypeEl = document.querySelector('.field--name-field-types .field__item');
            const communityTypeEl = document.querySelector('.field--name-field-types2 .field__item');
            const eventType = eventTypeEl?.textContent?.trim();
            const communityType = communityTypeEl?.textContent?.trim();

            // Extract location
            const locationEl = document.querySelector('.field--name-field-contact-information .field__item');
            const location = locationEl?.textContent?.trim();

            // Extract description
            const descriptionEl = document.querySelector('.field--name-body .field__item');
            const description = descriptionEl?.innerHTML?.trim();

            // Extract image
            const imageEl = document.querySelector('.field--name-field-media-image img') as HTMLImageElement;
            const imageUrl = imageEl?.src;

            return {
              title: linkData.title,
              dates: eventDates,
              eventType,
              communityType,
              location,
              description,
              imageUrl,
              url: window.location.href,
              rawCalendarTime: linkData.time,
              rawCalendarDate: linkData.date
            };
          }, eventLink);

          // Create events for each date (some events have multiple dates)
          for (const dateInfo of eventDetails.dates) {
            // Determine category from event types
            const categories = [eventDetails.eventType, eventDetails.communityType]
              .filter(Boolean) as string[];

            const event: RawEvent = {
              title: eventDetails.title,
              descriptionHtml: eventDetails.description,
              start: dateInfo.start,
              end: dateInfo.end,
              venueName: eventDetails.location,
              city: 'Prince George',
              region: 'British Columbia',
              country: 'Canada',
              organizer: 'City of Prince George',
              category: categories[0] || 'Community Event',
              tags: categories.length > 1 ? categories.slice(1) : undefined,
              url: eventDetails.url,
              imageUrl: eventDetails.imageUrl ? new URL(eventDetails.imageUrl, eventDetails.url).href : undefined,
              raw: {
                calendarTime: eventDetails.rawCalendarTime,
                calendarDate: eventDetails.rawCalendarDate,
                eventType: eventDetails.eventType,
                communityType: eventDetails.communityType,
                fullDescription: eventDetails.description,
                extractedAt: new Date().toISOString(),
              },
            };

            events.push(event);
          }

          logger.info(`Extracted ${eventDetails.dates.length} event instance(s) for: ${eventLink.title}`);

        } catch (eventError) {
          logger.warn(`Failed to scrape event ${eventLink.title}: ${eventError}`);
          
          // Create a basic event from calendar data if detail page fails
          const fallbackEvent: RawEvent = {
            title: eventLink.title,
            start: `${eventLink.date} ${eventLink.time}`,
            city: 'Prince George',
            region: 'British Columbia', 
            country: 'Canada',
            organizer: 'City of Prince George',
            url: eventLink.url,
            raw: {
              calendarTime: eventLink.time,
              calendarDate: eventLink.date,
              error: 'Failed to load detail page',
              extractedAt: new Date().toISOString(),
            },
          };
          
          events.push(fallbackEvent);
        }
      }

      logger.info(`Scrape completed. Total events found: ${events.length}`);
      return events;

    } catch (error) {
      logger.error(`Scrape failed: ${error}`);
      throw error;
    }
  },
};

export default princeGeorgeModule;