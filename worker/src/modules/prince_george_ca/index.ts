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
      if (ctx.stats) ctx.stats.pagesCrawled++; // Count the main calendar page

      logger.info('Page loaded, waiting for calendar to render...');

      // Wait for the calendar widget to load first
      try {
        await page.waitForSelector('.fc-view-container', { timeout: 15000 });
        logger.info('Calendar container found');
      } catch (error) {
        logger.error('Calendar container not found within timeout');
        throw error;
      }
      
      // Extract from month view first since it shows more events (35 vs 32)
      logger.info('Checking month view for events...');
      const monthViewEvents = await page.$$('.fc-event');
      logger.info(`Found ${monthViewEvents.length} events in month view`);
      
      let useListView = false;
      
      if (monthViewEvents.length === 0) {
        logger.info('No events in month view, trying list view...');
        const listButton = await page.$('.fc-listMonth-button');
        
        if (listButton) {
          logger.info('List button found, clicking to switch to list view...');
          await listButton.click();
          await page.waitForTimeout(5000); // Give it time to load
          
          try {
            await page.waitForSelector('.fc-list-table', { timeout: 10000 });
            useListView = true;
            logger.info('Successfully switched to list view');
          } catch (error) {
            logger.warn('List view did not load either');
            useListView = false;
          }
        }
      } else {
        logger.info(`Using month view with ${monthViewEvents.length} events`);
        useListView = false;
      }

      logger.info('Calendar loaded, extracting events...');

      // Extract all event links from the calendar
      const eventLinks = await page.evaluate((useListView) => {
        const links: Array<{url: string, title: string, time: string, date: string}> = [];
        
        if (useListView) {
          // Extract from list view
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
        } else {
          // Extract from month view
          const eventElements = document.querySelectorAll('.fc-event');
          
          eventElements.forEach((eventEl) => {
            const linkEl = eventEl as HTMLAnchorElement;
            
            // Check if this element itself is a link or contains a link
            let actualLink = linkEl;
            if (!linkEl.href) {
              const linkChild = linkEl.querySelector('a') as HTMLAnchorElement;
              if (linkChild?.href) {
                actualLink = linkChild;
              } else {
                return; // Skip if no href found
              }
            }
            
            // Get title and time from the fc-content div
            const contentDiv = linkEl.querySelector('.fc-content');
            const titleEl = contentDiv?.querySelector('.fc-title') || linkEl.querySelector('.fc-title');
            const timeEl = contentDiv?.querySelector('.fc-time') || linkEl.querySelector('.fc-time');
            
            if (titleEl && actualLink.href) {
              // Get the date from the parent cell
              let dayCell = linkEl.closest('td[data-date]');
              if (!dayCell) {
                // Try finding parent with data-date attribute
                let parent = linkEl.parentElement;
                while (parent && !dayCell) {
                  if (parent.hasAttribute && parent.hasAttribute('data-date')) {
                    dayCell = parent;
                    break;
                  }
                  if (parent.tagName === 'TD' && parent.closest('[data-date]')) {
                    dayCell = parent.closest('[data-date]');
                    break;
                  }
                  parent = parent.parentElement;
                }
              }
              
              const dateAttr = dayCell?.getAttribute('data-date') || '';
              
              // Format the date nicely
              let dateText = '';
              if (dateAttr) {
                const dateObj = new Date(dateAttr);
                dateText = dateObj.toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                });
              }
              
              links.push({
                url: new URL(actualLink.href, window.location.origin).href,
                title: titleEl.textContent?.trim() || '',
                time: timeEl?.textContent?.trim() || '',
                date: dateText
              });
            }
          });
        }
        
        return links;
      }, useListView);

      logger.info(`Found ${eventLinks.length} event links`);
      
      if (eventLinks.length === 0) {
        logger.warn('No events found on calendar page - this might indicate a scraping issue');
        logger.info('Attempting to take screenshot for debugging...');
        try {
          await page.screenshot({ path: '/tmp/prince-george-debug.png', fullPage: true });
          logger.info('Screenshot saved to /tmp/prince-george-debug.png');
        } catch (screenshotError) {
          logger.warn('Could not take screenshot:', screenshotError);
        }
        
        // Let's also log what we can see on the page
        const pageInfo = await page.evaluate(() => {
          return {
            url: window.location.href,
            title: document.title,
            calendarExists: !!document.querySelector('.fc-view-container'),
            monthViewExists: !!document.querySelector('.fc-dayGridMonth-view'),
            listViewExists: !!document.querySelector('.fc-list-table'),
            eventCount: document.querySelectorAll('.fc-event').length,
            listItemCount: document.querySelectorAll('.fc-list-item').length,
          };
        });
        logger.info('Page debug info:', JSON.stringify(pageInfo, null, 2));
      }
      
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
          if (ctx.stats) ctx.stats.pagesCrawled++; // Count each event detail page

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
          const validDates = eventDetails.dates.filter(d => d.start);
          
          if (validDates.length === 0) {
            // Fallback: create event from calendar data if no valid dates found on detail page
            let fallbackStart = '';
            try {
              // Try to construct date from calendar data
              if (eventLink.date && eventLink.time) {
                const dateObj = new Date(`${eventLink.date} ${eventLink.time}`);
                if (!isNaN(dateObj.getTime())) {
                  fallbackStart = dateObj.toISOString();
                }
              }
              
              // If still no valid date, use today as absolute fallback
              if (!fallbackStart) {
                fallbackStart = new Date().toISOString();
                logger.warn(`Using current date as fallback for event: ${eventDetails.title}`);
              }
            } catch (dateError) {
              fallbackStart = new Date().toISOString();
              logger.warn(`Date parsing failed for ${eventDetails.title}, using current date`);
            }
            
            validDates.push({ start: fallbackStart });
          }
          
          for (const dateInfo of validDates) {
            // Determine category from event types
            const categories = [eventDetails.eventType, eventDetails.communityType]
              .filter(Boolean) as string[];

            const event: RawEvent = {
              sourceEventId: eventDetails.url || eventLink.url, // Use URL as unique source event ID
              title: eventDetails.title || 'Untitled Event',
              start: dateInfo.start,
              end: dateInfo.end || undefined,
              city: 'Prince George',
              region: 'British Columbia', 
              country: 'Canada',
              organizer: 'City of Prince George',
              category: categories[0] || 'Community Event',
              url: eventDetails.url || eventLink.url,
              raw: {
                calendarTime: eventDetails.rawCalendarTime,
                calendarDate: eventDetails.rawCalendarDate,
                eventType: eventDetails.eventType,
                communityType: eventDetails.communityType,
                fullDescription: eventDetails.description,
                extractedAt: new Date().toISOString(),
                originalEventLink: eventLink,
                sourcePageUrl: eventDetails.url || eventLink.url,
              },
            };

            // Only set optional fields if they have actual values
            if (eventDetails.description) {
              event.descriptionHtml = eventDetails.description;
            }
            
            if (eventDetails.location) {
              // Parse location to separate venue name and address
              // Location comes as HTML with <br> tags, e.g.: "Studio 2880<br>2880 15th Avenue<br>Prince George, BC"
              let locationText = eventDetails.location.trim();
              
              // Convert HTML breaks to newlines and strip other HTML
              locationText = locationText
                .replace(/<br\s*\/?>/gi, '\n')  // Replace <br> tags with newlines
                .replace(/&nbsp;/gi, ' ')       // Replace &nbsp; with spaces
                .replace(/<[^>]*>/g, '')        // Strip remaining HTML tags
                .trim();
              
              const locationLines = locationText.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
              
              if (locationLines.length >= 2) {
                // Multi-line format: first line is venue, rest is address
                event.venueName = locationLines[0];
                event.venueAddress = locationLines.slice(1).join(', ').trim();
              } else if (locationLines.length === 1) {
                // Single line - try to separate venue name from address
                const singleLine = locationLines[0];
                
                // Look for patterns like "VenueName123Address" where venue ends before a number
                const match = singleLine.match(/^(.+?)(\d+.*)$/);
                if (match) {
                  event.venueName = match[1].trim();
                  event.venueAddress = match[2].trim();
                } else {
                  // Can't separate, put entire text as venue name
                  event.venueName = singleLine;
                }
              }
            }
            
            if (categories.length > 1) {
              event.tags = categories.slice(1);
            }
            
            if (eventDetails.imageUrl) {
              event.imageUrl = new URL(eventDetails.imageUrl, eventDetails.url).href;
            }

            events.push(event);
          }

          logger.info(`Extracted ${eventDetails.dates.length} event instance(s) for: ${eventLink.title}`);

        } catch (eventError) {
          logger.warn(`Failed to scrape event ${eventLink.title}: ${eventError}`);
          
          // Create a basic event from calendar data if detail page fails
          let fallbackStart = '';
          try {
            if (eventLink.date && eventLink.time) {
              const dateObj = new Date(`${eventLink.date} ${eventLink.time}`);
              if (!isNaN(dateObj.getTime())) {
                fallbackStart = dateObj.toISOString();
              }
            }
            // Fallback to current date if parsing fails
            if (!fallbackStart) {
              fallbackStart = new Date().toISOString();
            }
          } catch (dateError) {
            fallbackStart = new Date().toISOString();
          }
          
          const fallbackEvent: RawEvent = {
            sourceEventId: eventLink.url, // Use URL as unique source event ID
            title: eventLink.title || 'Untitled Event',
            start: fallbackStart,
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
              sourcePageUrl: eventLink.url,
            },
          };
          
          events.push(fallbackEvent);
        }
      }

      const pagesCrawledCount = ctx.stats?.pagesCrawled || 0;
      logger.info(`Scrape completed. Total events found: ${events.length}, Pages crawled: ${pagesCrawledCount}`);
      return events;

    } catch (error) {
      logger.error(`Scrape failed: ${error}`);
      throw error;
    }
  },
};

export default princeGeorgeModule;