import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const unbcModule: ScraperModule = {
  key: 'unbc_ca',
  label: 'University of Northern British Columbia Events',
  startUrls: [
    'https://www.unbc.ca/events',
  ],
  paginationType: 'page',
  integrationTags: ['page-navigation'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    const isTestMode = jobData?.testMode === true;
    const scrapeMode = jobData?.scrapeMode || 'full';
    const paginationOptions = jobData?.paginationOptions;

    logger.info(`Starting ${isTestMode ? 'test ' : scrapeMode} scrape of ${this.label}`);

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
      let maxPagesToScrape = paginationOptions?.scrapeAllPages === false && paginationOptions?.maxPages 
        ? paginationOptions.maxPages 
        : Infinity;

      while (hasNextPage && !isTestMode && currentPage < maxPagesToScrape) {
        // Check if there's a next page and get pagination info
        const paginationInfo = await page.evaluate(() => {
          const nextLink = document.querySelector('.pager__item--next a') as HTMLAnchorElement;
          const lastLink = document.querySelector('.pager__item--last a') as HTMLAnchorElement;
          const currentPageEl = document.querySelector('.pager__item.is-active a');
          
          let currentPageNum = 1;
          let lastPageNum = 1;
          
          if (currentPageEl) {
            const currentText = currentPageEl.textContent?.trim();
            if (currentText) currentPageNum = parseInt(currentText, 10);
          }
          
          // Extract last page number from the "Last" link or from page numbers
          if (lastLink?.href) {
            const lastUrlMatch = lastLink.href.match(/[?&]page=(\d+)/);
            if (lastUrlMatch) {
              lastPageNum = parseInt(lastUrlMatch[1], 10) + 1; // Page param is 0-indexed
            }
          } else {
            // Fallback: find the highest page number in pagination
            const pageLinks = document.querySelectorAll('.pager__item a[href*="page="]:not(.pager__item--first):not(.pager__item--last):not(.pager__item--previous):not(.pager__item--next)');
            let maxPage = 1;
            pageLinks.forEach(link => {
              const pageText = link.textContent?.trim();
              if (pageText) {
                const pageNum = parseInt(pageText, 10);
                if (pageNum > maxPage) maxPage = pageNum;
              }
            });
            lastPageNum = maxPage;
          }
          
          return {
            hasNext: !!nextLink,
            nextUrl: nextLink?.href,
            currentPage: currentPageNum,
            lastPage: lastPageNum,
            isLastPage: currentPageNum >= lastPageNum
          };
        });

        const shouldStopAtMaxPages = maxPagesToScrape !== Infinity && currentPage >= maxPagesToScrape;
        logger.info(`Page ${paginationInfo.currentPage} of ${paginationInfo.lastPage} (next available: ${paginationInfo.hasNext}, max pages: ${maxPagesToScrape === Infinity ? 'unlimited' : maxPagesToScrape})`);

        // Stop if we're on the last page, there's no next button, or we've reached the max pages limit
        if (paginationInfo.isLastPage || !paginationInfo.hasNext || shouldStopAtMaxPages) {
          if (shouldStopAtMaxPages) {
            logger.info(`Reached maximum pages limit (${maxPagesToScrape}), stopping pagination`);
          }
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
                // All day event - use local format for normalizeEvent to handle timezone
                const dateObj = new Date(eventLink.date);
                if (!isNaN(dateObj.getTime())) {
                  const year = dateObj.getFullYear();
                  const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                  const day = dateObj.getDate().toString().padStart(2, '0');
                  eventStart = `${year}-${month}-${day} 09:00`;
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
                  // Use local format for normalizeEvent to handle timezone
                  const year = dateObj.getFullYear();
                  const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                  const day = dateObj.getDate().toString().padStart(2, '0');
                  const hours = dateObj.getHours().toString().padStart(2, '0');
                  const minutes = dateObj.getMinutes().toString().padStart(2, '0');
                  eventStart = `${year}-${month}-${day} ${hours}:${minutes}`;
                } else {
                  // Fallback to date only - use local format for normalizeEvent to handle timezone
                  const dateOnly = new Date(eventLink.date);
                  if (!isNaN(dateOnly.getTime())) {
                    const year = dateOnly.getFullYear();
                    const month = (dateOnly.getMonth() + 1).toString().padStart(2, '0');
                    const day = dateOnly.getDate().toString().padStart(2, '0');
                    eventStart = `${year}-${month}-${day} 09:00`;
                  }
                }
              }
            }
            
            if (!eventStart) {
              // Use a reasonable fallback time in local format for normalizeEvent to handle
              const now = new Date();
              eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 09:00`;
              logger.warn(`Using current date as fallback for event: ${eventLink.title}`);
            }
          } catch (dateError) {
            // Use a reasonable fallback time in local format for normalizeEvent to handle
            const now = new Date();
            eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 09:00`;
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
                // Look for .field__item containers to distinguish between:
                // 1. Single multi-day event (1 container with 2 <time> tags)
                // 2. Multiple separate occurrences (multiple containers)
                const fieldItems = document.querySelectorAll('.field--name-field-smart-date-ranges .field__item');
                const dateInstances: Array<{ start: string | null; end: string | null }> = [];

                fieldItems.forEach(item => {
                  const times = item.querySelectorAll('time[datetime]');
                  if (times.length >= 1) {
                    const start = times[0].getAttribute('datetime');
                    const end = times.length >= 2 ? times[1].getAttribute('datetime') : null;
                    dateInstances.push({ start, end });
                  }
                });

                // For backward compatibility, extract first occurrence's start/end
                let startDateTime = null;
                let endDateTime = null;
                if (dateInstances.length > 0) {
                  startDateTime = dateInstances[0].start;
                  endDateTime = dateInstances[0].end;
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
                  dateInstances,
                  location,
                  campus,
                  shortDescription,
                  fullContent,
                  imageUrl,
                  registrationUrl,
                };
              });

              // Check if we have multiple date instances (recurring events)
              const hasMultipleInstances = enhancementData.dateInstances && enhancementData.dateInstances.length > 1;

              if (hasMultipleInstances) {
                // Multiple occurrences - create separate events for each instance
                logger.info(`Found ${enhancementData.dateInstances.length} date instances for recurring event: ${eventLink.title}`);

                for (let i = 0; i < enhancementData.dateInstances.length; i++) {
                  const instance = enhancementData.dateInstances[i];
                  if (!instance.start) continue;

                  // Create a separate event for each occurrence
                  const instanceEvent: RawEvent = {
                    sourceEventId: `${eventLink.url}#instance-${i}`,
                    title: enhancementData.title || eventLink.title || 'Untitled Event',
                    start: instance.start,
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
                      detailPageTitle: enhancementData.title,
                      detailPageStartDateTime: instance.start,
                      detailPageEndDateTime: instance.end,
                      detailPageLocation: enhancementData.location,
                      detailPageCampus: enhancementData.campus,
                      detailPageShortDescription: enhancementData.shortDescription,
                      detailPageFullContent: enhancementData.fullContent,
                      detailPageRegistrationUrl: enhancementData.registrationUrl,
                      enhancedFromDetailPage: true,
                      isRecurringInstance: true,
                      instanceIndex: i,
                      totalInstances: enhancementData.dateInstances.length,
                    },
                  };

                  // Set end time if available
                  if (instance.end) {
                    instanceEvent.end = instance.end;
                  }

                  // Set location
                  if (enhancementData.location) {
                    instanceEvent.venueName = enhancementData.location;
                  }

                  // Set campus tags
                  if (enhancementData.campus) {
                    instanceEvent.tags = [enhancementData.campus];
                  }

                  // Set description
                  if (enhancementData.shortDescription) {
                    instanceEvent.descriptionHtml = enhancementData.shortDescription;
                  }

                  // Set image
                  if (enhancementData.imageUrl) {
                    instanceEvent.imageUrl = new URL(enhancementData.imageUrl, eventLink.url).href;
                  }

                  events.push(instanceEvent);
                  logger.info(`Created instance ${i + 1}/${enhancementData.dateInstances.length}: ${instance.start}${instance.end ? ` to ${instance.end}` : ''}`);
                }

                // Skip adding the base event since we've added all instances
                continue;
              } else {
                // Single occurrence or multi-day event - update the base event
                if (enhancementData.title) {
                  baseEvent.title = enhancementData.title;
                }

                if (enhancementData.startDateTime) {
                  // Use the ISO datetime directly - normalizeEvent will handle timezone conversion
                  baseEvent.start = enhancementData.startDateTime;
                  logger.info(`Updated event start time from detail page: ${baseEvent.start}`);
                }

                if (enhancementData.endDateTime) {
                  // Use the ISO datetime directly - normalizeEvent will handle timezone conversion
                  baseEvent.end = enhancementData.endDateTime;
                  logger.info(`Set event end time from detail page: ${baseEvent.end}`);
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

                // Note: Registration URL is stored in raw data, not as separate field

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
              }
              
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
            if (eventLink.date) {
              const dateObj = new Date(eventLink.date);
              if (!isNaN(dateObj.getTime())) {
                const year = dateObj.getFullYear();
                const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                const day = dateObj.getDate().toString().padStart(2, '0');
                
                if (!eventLink.time || eventLink.time === 'All day') {
                  fallbackStart = `${year}-${month}-${day} 09:00`;
                } else {
                  let normalizedTime = eventLink.time.replace(/\./g, '').toUpperCase();
                  if (normalizedTime.includes(' TO ')) {
                    normalizedTime = normalizedTime.split(' TO ')[0].trim();
                  }
                  
                  const timeMatch = normalizedTime.match(/(\d{1,2}):(\d{2})\s*(A|P)M?/i);
                  if (timeMatch) {
                    let hour = parseInt(timeMatch[1]);
                    const minute = parseInt(timeMatch[2]);
                    const isPM = timeMatch[3].toUpperCase() === 'P';
                    
                    if (isPM && hour !== 12) hour += 12;
                    else if (!isPM && hour === 12) hour = 0;
                    
                    fallbackStart = `${year}-${month}-${day} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                  } else {
                    fallbackStart = `${year}-${month}-${day} 09:00`;
                  }
                }
              }
            }
            if (!fallbackStart) {
              const now = new Date();
              fallbackStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 09:00`;
            }
          } catch (dateError) {
            const now = new Date();
            fallbackStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 09:00`;
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