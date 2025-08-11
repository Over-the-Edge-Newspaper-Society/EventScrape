import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const unbcModule: ScraperModule = {
  key: 'unbc_ca',
  label: 'University of Northern British Columbia Events',
  startUrls: [
    'https://www.unbc.ca/events',
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

      logger.info('Page loaded, waiting for events to render...');

      // Wait for the events container to load
      try {
        await page.waitForSelector('.view-content', { timeout: 15000 });
        logger.info('Events container found');
      } catch (error) {
        logger.error('Events container not found within timeout');
        throw error;
      }

      // Check for events on current page
      const eventLinks = await page.evaluate(() => {
        const links: Array<{url: string, title: string, time: string, date: string, location: string}> = [];
        
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
            // Parse time from "Tuesday5:00 p.m. to 6:00 p.m." format
            const timeText = timeEl.textContent || '';
            const timeMatch = timeText.match(/(\d{1,2}:\d{2}\s*[ap]\.m\.(?:\s*to\s*\d{1,2}:\d{2}\s*[ap]\.m\.)?)/i);
            if (timeMatch) {
              timeStr = timeMatch[1];
            } else {
              // Check for "no time" events
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
            location: locationStr
          });
        });
        
        return links;
      });

      logger.info(`Found ${eventLinks.length} events on current page`);

      // Check for pagination and collect all events
      let allEventLinks = [...eventLinks];
      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage && !isTestMode) {
        // Check if there's a next page
        const nextPageExists = await page.evaluate(() => {
          const nextLink = document.querySelector('.pager__item--next a');
          return !!nextLink;
        });

        if (!nextPageExists) {
          hasNextPage = false;
          break;
        }

        logger.info(`Navigating to page ${currentPage + 1}...`);

        // Click next page
        await page.click('.pager__item--next a');
        await page.waitForSelector('.view-content', { timeout: 10000 });
        await delay(2000); // Give time for page to fully load
        
        if (ctx.stats) ctx.stats.pagesCrawled++;

        // Extract events from this page
        const pageEventLinks = await page.evaluate(() => {
          const links: Array<{url: string, title: string, time: string, date: string, location: string}> = [];
          
          const eventElements = document.querySelectorAll('.event-boxed');
          
          eventElements.forEach((eventEl) => {
            const titleLinkEl = eventEl.querySelector('.event-info h2 a') as HTMLAnchorElement;
            if (!titleLinkEl?.href) return;

            const dateSquares = eventEl.querySelectorAll('.datesquare');
            let dateStr = '';
            if (dateSquares.length === 1) {
              const dayEl = dateSquares[0].querySelector('p');
              const monthEl = dateSquares[0].childNodes[1];
              if (dayEl && monthEl) {
                const day = dayEl.textContent?.trim();
                const month = monthEl.textContent?.trim();
                const currentYear = new Date().getFullYear();
                dateStr = `${month} ${day}, ${currentYear}`;
              }
            } else if (dateSquares.length === 2) {
              const startDayEl = dateSquares[0].querySelector('p');
              const startMonthEl = dateSquares[0].childNodes[1];
              if (startDayEl && startMonthEl) {
                const day = startDayEl.textContent?.trim();
                const month = startMonthEl.textContent?.trim();
                const currentYear = new Date().getFullYear();
                dateStr = `${month} ${day}, ${currentYear}`;
              }
            }

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
              location: locationStr
            });
          });
          
          return links;
        });

        allEventLinks.push(...pageEventLinks);
        logger.info(`Found ${pageEventLinks.length} events on page ${currentPage + 1}, total: ${allEventLinks.length}`);
        
        currentPage++;
        
        // Safety limit to prevent infinite loops
        if (currentPage > 10) {
          logger.warn('Reached pagination limit, stopping');
          break;
        }
      }

      logger.info(`Total events found across all pages: ${allEventLinks.length}`);
      
      if (allEventLinks.length === 0) {
        logger.warn('No events found - this might indicate a scraping issue');
        try {
          await page.screenshot({ path: '/tmp/unbc-debug.png', fullPage: true });
          logger.info('Screenshot saved to /tmp/unbc-debug.png');
        } catch (screenshotError) {
          logger.warn('Could not take screenshot:', screenshotError);
        }
      }
      
      // In test mode, only process the first event
      const eventsToProcess = isTestMode ? allEventLinks.slice(0, 1) : allEventLinks;
      logger.info(`Processing ${eventsToProcess.length} event${eventsToProcess.length === 1 ? '' : 's'}${isTestMode ? ' (test mode)' : ''}`);

      // Visit each event detail page to get additional details
      const visitedUrls = new Set<string>();
      
      for (const [index, eventLink] of eventsToProcess.entries()) {
        try {
          logger.info(`Processing event ${index + 1}/${eventsToProcess.length}: ${eventLink.title}`);
          
          // Parse date and time
          let eventStart = '';
          try {
            if (eventLink.date && eventLink.time) {
              if (eventLink.time === 'All day') {
                // All day event
                const dateObj = new Date(eventLink.date);
                if (!isNaN(dateObj.getTime())) {
                  dateObj.setHours(9, 0, 0, 0); // Default to 9 AM
                  eventStart = dateObj.toISOString();
                }
              } else {
                // Parse specific time - convert "5:00 p.m." to "5:00 PM"
                let normalizedTime = eventLink.time.replace(/\./g, '').toUpperCase();
                if (normalizedTime.includes(' TO ')) {
                  normalizedTime = normalizedTime.split(' TO ')[0].trim();
                }
                
                const combinedDateTime = `${eventLink.date} ${normalizedTime}`;
                const dateObj = new Date(combinedDateTime);
                if (!isNaN(dateObj.getTime())) {
                  eventStart = dateObj.toISOString();
                } else {
                  // Fallback to date only
                  const dateOnly = new Date(eventLink.date);
                  if (!isNaN(dateOnly.getTime())) {
                    dateOnly.setHours(9, 0, 0, 0);
                    eventStart = dateOnly.toISOString();
                  }
                }
              }
            }
            
            if (!eventStart) {
              eventStart = new Date().toISOString();
              logger.warn(`Using current date as fallback for event: ${eventLink.title}`);
            }
          } catch (dateError) {
            eventStart = new Date().toISOString();
            logger.warn(`Date parsing failed for ${eventLink.title}, using current date`);
          }

          // Create base event
          const sourceEventId = `${eventLink.url}#${eventLink.date || new Date(eventStart).toDateString()}`;

          const baseEvent: RawEvent = {
            sourceEventId: sourceEventId,
            title: eventLink.title || 'Untitled Event',
            start: eventStart,
            city: 'Prince George',
            region: 'British Columbia', 
            country: 'Canada',
            organizer: 'University of Northern British Columbia',
            category: 'University Event',
            url: eventLink.url,
            raw: {
              listingTime: eventLink.time,
              listingDate: eventLink.date,
              listingLocation: eventLink.location,
              extractedAt: new Date().toISOString(),
              originalEventLink: eventLink,
              sourcePageUrl: eventLink.url,
            },
          };

          // Set initial location from listing if available
          if (eventLink.location) {
            const locationParts = eventLink.location.split(', ');
            if (locationParts.length >= 2) {
              baseEvent.venueName = locationParts[1]; // Second part is usually venue
              // First part is usually city/region
            } else {
              baseEvent.venueName = eventLink.location;
            }
          }

          // Only visit detail page if we haven't processed this URL before
          if (!visitedUrls.has(eventLink.url)) {
            logger.info(`Enhancing with details from: ${eventLink.url}`);
            visitedUrls.add(eventLink.url);
            
            // Rate limiting
            await delay(addJitter(2000, 50));
            
            try {
              // Navigate to event detail page
              await page.goto(eventLink.url, { 
                waitUntil: 'networkidle',
                timeout: 20000 
              });
              if (ctx.stats) ctx.stats.pagesCrawled++;

              // Extract enhancement data from detail page
              const enhancementData = await page.evaluate(() => {
                // Extract title
                const titleEl = document.querySelector('h1 .field--name-title');
                const title = titleEl?.textContent?.trim();

                // Extract date/time information
                const datetimeElements = document.querySelectorAll('.field--name-field-smart-date-ranges time[datetime]');
                let startDateTime = null;
                let endDateTime = null;

                if (datetimeElements.length >= 1) {
                  startDateTime = datetimeElements[0].getAttribute('datetime');
                }
                if (datetimeElements.length >= 2) {
                  endDateTime = datetimeElements[1].getAttribute('datetime');
                }

                // Extract location
                const locationEl = document.querySelector('.field--name-field-location .field__item');
                const location = locationEl?.textContent?.trim();

                // Extract campus
                const campusEl = document.querySelector('.field--name-field-campuses .field__item');
                const campus = campusEl?.textContent?.trim();

                // Extract short description
                const shortDescEl = document.querySelector('.field--name-field-short-description .featured-text');
                const shortDescription = shortDescEl?.innerHTML?.trim();

                // Extract full content/description
                const contentEl = document.querySelector('.field--name-field-content');
                const fullContent = contentEl?.innerHTML?.trim();

                // Extract image
                const imageEl = document.querySelector('.field--name-field-hero-image img') as HTMLImageElement;
                const imageUrl = imageEl?.src;

                // Extract registration link
                const regLinkEl = document.querySelector('.field--name-field-content a.btn') as HTMLAnchorElement;
                const registrationUrl = regLinkEl?.href;

                return {
                  title,
                  startDateTime,
                  endDateTime,
                  location,
                  campus,
                  shortDescription,
                  fullContent,
                  imageUrl,
                  registrationUrl,
                };
              });

              // Update event with detail page data
              if (enhancementData.title) {
                baseEvent.title = enhancementData.title;
              }

              if (enhancementData.startDateTime) {
                baseEvent.start = enhancementData.startDateTime;
                logger.info(`Updated event start time from detail page: ${enhancementData.startDateTime}`);
              }

              if (enhancementData.endDateTime) {
                baseEvent.end = enhancementData.endDateTime;
                logger.info(`Set event end time from detail page: ${enhancementData.endDateTime}`);
              }

              if (enhancementData.location) {
                baseEvent.venueName = enhancementData.location;
              }

              if (enhancementData.campus) {
                baseEvent.tags = [enhancementData.campus];
              }

              if (enhancementData.shortDescription) {
                baseEvent.descriptionHtml = enhancementData.shortDescription;
              }
              
              if (enhancementData.imageUrl) {
                baseEvent.imageUrl = new URL(enhancementData.imageUrl, eventLink.url).href;
              }

              if (enhancementData.registrationUrl) {
                baseEvent.ticketUrl = enhancementData.registrationUrl;
              }

              // Add enhancement data to raw
              baseEvent.raw = {
                ...baseEvent.raw,
                detailPageTitle: enhancementData.title,
                detailPageStartDateTime: enhancementData.startDateTime,
                detailPageEndDateTime: enhancementData.endDateTime,
                detailPageLocation: enhancementData.location,
                detailPageCampus: enhancementData.campus,
                detailPageShortDescription: enhancementData.shortDescription,
                detailPageFullContent: enhancementData.fullContent,
                detailPageRegistrationUrl: enhancementData.registrationUrl,
                enhancedFromDetailPage: true,
              };

              logger.info(`Enhanced event with details: ${eventLink.title}`);
              
            } catch (detailError) {
              logger.warn(`Failed to load detail page for ${eventLink.title}: ${detailError}`);
              baseEvent.raw = {
                ...baseEvent.raw,
                detailPageError: 'Failed to load detail page',
                enhancedFromDetailPage: false,
              };
            }
          } else {
            logger.info(`Detail page already processed, using listing data only: ${eventLink.url}`);
            baseEvent.raw = {
              ...baseEvent.raw,
              enhancedFromDetailPage: false,
              note: 'Detail page already processed for another listing entry',
            };
          }

          events.push(baseEvent);
          logger.info(`Created event: ${eventLink.title} on ${eventLink.date}`);

        } catch (eventError) {
          logger.warn(`Failed to process event ${eventLink.title}: ${eventError}`);
          
          // Create minimal fallback event
          let fallbackStart = '';
          try {
            if (eventLink.date && eventLink.time) {
              if (eventLink.time === 'All day') {
                const dateObj = new Date(eventLink.date);
                if (!isNaN(dateObj.getTime())) {
                  dateObj.setHours(9, 0, 0, 0);
                  fallbackStart = dateObj.toISOString();
                }
              } else {
                let normalizedTime = eventLink.time.replace(/\./g, '').toUpperCase();
                if (normalizedTime.includes(' TO ')) {
                  normalizedTime = normalizedTime.split(' TO ')[0].trim();
                }
                
                const combinedDateTime = `${eventLink.date} ${normalizedTime}`;
                const dateObj = new Date(combinedDateTime);
                if (!isNaN(dateObj.getTime())) {
                  fallbackStart = dateObj.toISOString();
                } else {
                  const dateOnly = new Date(eventLink.date);
                  if (!isNaN(dateOnly.getTime())) {
                    dateOnly.setHours(9, 0, 0, 0);
                    fallbackStart = dateOnly.toISOString();
                  }
                }
              }
            }
            if (!fallbackStart) {
              fallbackStart = new Date().toISOString();
            }
          } catch (dateError) {
            fallbackStart = new Date().toISOString();
          }
          
          const fallbackEvent: RawEvent = {
            sourceEventId: `${eventLink.url}#${eventLink.date || new Date(fallbackStart).toDateString()}`,
            title: eventLink.title || 'Untitled Event',
            start: fallbackStart,
            city: 'Prince George',
            region: 'British Columbia', 
            country: 'Canada',
            organizer: 'University of Northern British Columbia',
            url: eventLink.url,
            raw: {
              listingTime: eventLink.time,
              listingDate: eventLink.date,
              listingLocation: eventLink.location,
              error: 'Failed to process event',
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

export default unbcModule;