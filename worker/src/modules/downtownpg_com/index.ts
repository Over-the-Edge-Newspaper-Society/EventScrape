import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const downtownPgModule: ScraperModule = {
  key: 'downtownpg_com',
  label: 'Downtown Prince George Events',
  startUrls: [
    'https://downtownpg.com/events/',
  ],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    const isTestMode = jobData?.testMode === true;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

    try {
      // Navigate to the events page
      await page.goto(this.startUrls[0], { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      if (ctx.stats) ctx.stats.pagesCrawled++;

      logger.info('Page loaded, waiting for MEC calendar to render...');

      // Wait for the events content to load - try multiple selectors
      let eventsFound = false;
      const possibleSelectors = [
        '.mec-events-calendar',
        '.mec-calendar',
        '.mec-events',
        '.events-calendar',
        '.event-calendar',
        '[class*="mec"]',
        '[class*="event"]',
        '[class*="calendar"]'
      ];

      for (const selector of possibleSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 3000 });
          logger.info(`Events container found with selector: ${selector}`);
          eventsFound = true;
          break;
        } catch (e) {
          // Continue trying other selectors
        }
      }

      if (!eventsFound) {
        logger.warn('No specific events container found, will try to extract from page anyway');
        // Take a screenshot for debugging
        try {
          await page.screenshot({ path: '/tmp/downtownpg-no-container.png', fullPage: true });
          logger.info('Screenshot saved to /tmp/downtownpg-no-container.png');
        } catch (screenshotError) {
          logger.warn('Could not take screenshot:', screenshotError);
        }
      }

      // Wait for any events to populate
      await page.waitForTimeout(3000);

      // Extract JSON-LD structured data and event links
      const eventData = await page.evaluate(() => {
        const events: Array<{
          url: string;
          title: string;
          jsonLd?: any;
          eventId?: string;
        }> = [];

        // First, try to extract JSON-LD structured data
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        const structuredData: any[] = [];
        
        jsonLdScripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent || '');
            if (data && (data['@type'] === 'Event' || (Array.isArray(data) && data.some(item => item['@type'] === 'Event')))) {
              structuredData.push(data);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        });

        // Try multiple selectors to find event elements
        const eventSelectors = [
          '.mec-event-article',
          '.mec-event-list-event', 
          '.mec-calendar-event',
          '.event-item',
          '.event',
          '[class*="event"]',
          'article[class*="event"]'
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
            // Try different link selectors
            const linkSelectors = [
              '.mec-event-title a',
              '.mec-event-list-title a',
              'h4 a',
              'h3 a',
              'h2 a',
              'a[href*="/event"]',
              'a'
            ];
            
            let titleLinkEl: HTMLAnchorElement | null = null;
            
            for (const linkSel of linkSelectors) {
              const link = eventEl.querySelector(linkSel) as HTMLAnchorElement;
              if (link?.href && link?.textContent) {
                titleLinkEl = link;
                break;
              }
            }
            
            if (titleLinkEl?.href && titleLinkEl?.textContent) {
              const eventId = eventEl.getAttribute('data-event-id') || eventEl.id;
              
              // Try to match with structured data
              let matchingJsonLd = null;
              for (const data of structuredData) {
                const eventArray = Array.isArray(data) ? data : [data];
                for (const event of eventArray) {
                  if (event['@type'] === 'Event' && 
                      (event.name === titleLinkEl.textContent.trim() || 
                       event.url === titleLinkEl.href)) {
                    matchingJsonLd = event;
                    break;
                  }
                }
                if (matchingJsonLd) break;
              }
              
              events.push({
                url: titleLinkEl.href,
                title: titleLinkEl.textContent.trim(),
                jsonLd: matchingJsonLd,
                eventId: eventId
              });
            }
          });
        }

        // If no events found, try generic link search
        if (events.length === 0) {
          const alternativeSelectors = [
            'a[href*="/event/"]',
            'a[href*="/events/"]',
            'a[href*="downtownpg.com"][href*="event"]'
          ];
          
          for (const selector of alternativeSelectors) {
            const links = document.querySelectorAll(selector);
            if (links.length > 0) {
              links.forEach(link => {
                const linkEl = link as HTMLAnchorElement;
                if (linkEl.href && linkEl.textContent && linkEl.textContent.trim().length > 3) {
                  events.push({
                    url: linkEl.href,
                    title: linkEl.textContent.trim()
                  });
                }
              });
              break;
            }
          }
        }

        return {
          events: events,
          structuredDataCount: structuredData.length
        };
      });

      logger.info(`Found ${eventData.events.length} events, ${eventData.structuredDataCount} structured data entries`);

      if (eventData.events.length === 0) {
        logger.warn('No events found - this might indicate a scraping issue');
        try {
          await page.screenshot({ path: '/tmp/downtownpg-debug.png', fullPage: true });
          logger.info('Screenshot saved to /tmp/downtownpg-debug.png');
        } catch (screenshotError) {
          logger.warn('Could not take screenshot:', screenshotError);
        }
      }

      // In test mode, only process the first event
      const eventsToProcess = isTestMode ? eventData.events.slice(0, 1) : eventData.events;
      logger.info(`Processing ${eventsToProcess.length} event${eventsToProcess.length === 1 ? '' : 's'}${isTestMode ? ' (test mode)' : ''}`);

      // Handle pagination - look for "Load More" or "Next" buttons
      if (!isTestMode && eventData.events.length > 0) {
        let hasMoreEvents = true;
        let pageCount = 0;
        const maxPages = 3; // Limit to prevent infinite loops

        while (hasMoreEvents && pageCount < maxPages) {
          // Look for MEC load more or pagination buttons
          const loadMoreButton = await page.$('.mec-load-more-button, .mec-next-month, .mec-next-events');
          
          if (loadMoreButton) {
            logger.info(`Loading more events (page ${pageCount + 2})...`);
            await loadMoreButton.click();
            await page.waitForTimeout(3000); // Wait for new events to load
            
            // Extract additional events
            const additionalEventData = await page.evaluate(() => {
              const moreEvents: Array<{url: string, title: string, eventId?: string}> = [];
              const newEventElements = document.querySelectorAll('.mec-event-article:not([data-processed]), .mec-event-list-event:not([data-processed])');
              
              newEventElements.forEach(eventEl => {
                eventEl.setAttribute('data-processed', 'true');
                const titleLinkEl = eventEl.querySelector('.mec-event-title a, .mec-event-list-title a, h4 a') as HTMLAnchorElement;
                
                if (titleLinkEl?.href && titleLinkEl?.textContent) {
                  const eventId = eventEl.getAttribute('data-event-id') || eventEl.id;
                  moreEvents.push({
                    url: titleLinkEl.href,
                    title: titleLinkEl.textContent.trim(),
                    eventId: eventId
                  });
                }
              });
              
              return moreEvents;
            });

            if (additionalEventData.length > 0) {
              eventData.events.push(...additionalEventData);
              logger.info(`Found ${additionalEventData.length} additional events`);
            } else {
              hasMoreEvents = false;
            }
            
            pageCount++;
          } else {
            hasMoreEvents = false;
          }
        }
      }

      // Remove duplicates based on URL
      const uniqueEventLinks = eventsToProcess.filter((event, index, array) => 
        array.findIndex(e => e.url === event.url) === index
      );
      
      logger.info(`Unique events after deduplication: ${uniqueEventLinks.length}`);

      // Visit each event detail page
      for (const [index, eventLink] of uniqueEventLinks.entries()) {
        try {
          logger.info(`Processing event ${index + 1}/${uniqueEventLinks.length}: ${eventLink.title}`);
          
          // Rate limiting
          await delay(addJitter(2000, 50));
          
          // Navigate to event detail page
          await page.goto(eventLink.url, { 
            waitUntil: 'networkidle',
            timeout: 20000 
          });
          if (ctx.stats) ctx.stats.pagesCrawled++;

          // Extract detailed event information
          const eventDetails = await page.evaluate(() => {
            // Extract title
            const titleEl = document.querySelector('.mec-single-title, h1.entry-title, h1, .event-title');
            const title = titleEl?.textContent?.trim();

            // Look for JSON-LD structured data on detail page
            let structuredEventData = null;
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            
            jsonLdScripts.forEach(script => {
              try {
                const data = JSON.parse(script.textContent || '');
                if (data && data['@type'] === 'Event') {
                  structuredEventData = data;
                } else if (Array.isArray(data)) {
                  const eventData = data.find(item => item['@type'] === 'Event');
                  if (eventData) {
                    structuredEventData = eventData;
                  }
                }
              } catch (e) {
                // Skip invalid JSON
              }
            });

            // Extract MEC event details
            const startDateEl = document.querySelector('.mec-start-date, .mec-event-date, .event-date');
            const endDateEl = document.querySelector('.mec-end-date, .mec-event-end-date');
            const startTimeEl = document.querySelector('.mec-start-time, .mec-event-time, .event-time');
            const endTimeEl = document.querySelector('.mec-end-time, .mec-event-end-time');
            
            // Extract location
            const locationEl = document.querySelector('.mec-event-location, .mec-location, .event-location');
            const addressEl = document.querySelector('.mec-event-address, .mec-address, .event-address');
            
            // Extract description
            const descriptionEl = document.querySelector('.mec-single-event-description, .mec-event-content, .event-description, .entry-content');
            
            // Extract additional details
            const organizerEl = document.querySelector('.mec-event-organizer, .event-organizer');
            const websiteEl = document.querySelector('.mec-event-website a, .event-website a') as HTMLAnchorElement;
            const ticketEl = document.querySelector('.mec-event-ticket a, .mec-ticket a, .event-tickets a') as HTMLAnchorElement;

            return {
              title,
              structuredEventData,
              startDate: startDateEl?.textContent?.trim(),
              endDate: endDateEl?.textContent?.trim(),
              startTime: startTimeEl?.textContent?.trim(),
              endTime: endTimeEl?.textContent?.trim(),
              location: locationEl?.textContent?.trim(),
              address: addressEl?.textContent?.trim(),
              description: descriptionEl?.innerHTML?.trim(),
              organizer: organizerEl?.textContent?.trim(),
              website: websiteEl?.href,
              ticketUrl: ticketEl?.href,
            };
          });

          // Process event data - prefer JSON-LD structured data if available
          const eventInfo = eventDetails.structuredEventData || eventLink.jsonLd;
          
          let eventStart = '';
          let eventEnd = '';
          
          if (eventInfo && eventInfo.startDate) {
            // Use structured data for dates
            eventStart = new Date(eventInfo.startDate).toISOString();
            if (eventInfo.endDate) {
              eventEnd = new Date(eventInfo.endDate).toISOString();
            }
          } else {
            // Fallback to parsed dates from HTML
            try {
              if (eventDetails.startDate) {
                const startDateStr = eventDetails.startDate;
                const startTimeStr = eventDetails.startTime || '9:00 AM';
                const combinedStart = `${startDateStr} ${startTimeStr}`;
                const startDate = new Date(combinedStart);
                
                if (!isNaN(startDate.getTime())) {
                  eventStart = startDate.toISOString();
                  
                  if (eventDetails.endDate || eventDetails.endTime) {
                    const endDateStr = eventDetails.endDate || startDateStr;
                    const endTimeStr = eventDetails.endTime || startTimeStr;
                    const combinedEnd = `${endDateStr} ${endTimeStr}`;
                    const endDate = new Date(combinedEnd);
                    
                    if (!isNaN(endDate.getTime())) {
                      eventEnd = endDate.toISOString();
                    }
                  }
                }
              }
              
              if (!eventStart) {
                eventStart = new Date().toISOString();
                logger.warn(`Date parsing failed for ${eventLink.title}, using current date`);
              }
            } catch (dateError) {
              eventStart = new Date().toISOString();
              logger.warn(`Date parsing error for ${eventLink.title}: ${dateError}`);
            }
          }

          // Create the event
          const sourceEventId = eventLink.eventId || `${eventLink.url}#${eventLink.title}`;

          const event: RawEvent = {
            sourceEventId: sourceEventId,
            title: eventDetails.title || eventLink.title,
            start: eventStart,
            city: 'Prince George',
            region: 'British Columbia',
            country: 'Canada',
            organizer: eventDetails.organizer || 'Downtown Prince George',
            category: 'Community Event',
            url: eventLink.url,
            raw: {
              structuredData: eventInfo,
              startDate: eventDetails.startDate,
              endDate: eventDetails.endDate,
              startTime: eventDetails.startTime,
              endTime: eventDetails.endTime,
              extractedAt: new Date().toISOString(),
              originalEventLink: eventLink,
            },
          };

          if (eventEnd) {
            event.end = eventEnd;
          }

          if (eventInfo && eventInfo.location && eventInfo.location.name) {
            event.venueName = eventInfo.location.name;
            if (eventInfo.location.address) {
              event.venueAddress = typeof eventInfo.location.address === 'string' 
                ? eventInfo.location.address 
                : eventInfo.location.address.streetAddress || eventInfo.location.address.name;
            }
          } else if (eventDetails.location) {
            event.venueName = eventDetails.location;
            if (eventDetails.address) {
              event.venueAddress = eventDetails.address;
            }
          }

          if (eventDetails.description) {
            event.descriptionHtml = eventDetails.description;
          }

          if (eventDetails.ticketUrl) {
            event.ticketUrl = eventDetails.ticketUrl;
          } else if (eventDetails.website && eventDetails.website !== eventLink.url) {
            event.ticketUrl = eventDetails.website;
          }

          events.push(event);
          logger.info(`Created event: ${event.title} on ${eventStart.split('T')[0]}`);

        } catch (eventError) {
          logger.warn(`Failed to process event ${eventLink.title}: ${eventError}`);
          
          // Create minimal fallback event
          const fallbackEvent: RawEvent = {
            sourceEventId: eventLink.eventId || `${eventLink.url}#${eventLink.title}`,
            title: eventLink.title,
            start: new Date().toISOString(),
            city: 'Prince George',
            region: 'British Columbia',
            country: 'Canada',
            organizer: 'Downtown Prince George',
            url: eventLink.url,
            raw: {
              error: 'Failed to process event detail page',
              extractedAt: new Date().toISOString(),
              originalEventLink: eventLink,
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

export default downtownPgModule;