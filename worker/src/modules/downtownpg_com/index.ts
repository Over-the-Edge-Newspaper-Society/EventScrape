import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const downtownPgModule: ScraperModule = {
  key: 'downtownpg_com',
  label: 'Downtown Prince George Events',
  startUrls: [
    'https://downtownpg.com/events/',
  ],
  paginationType: 'calendar',
  integrationTags: ['calendar'],

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
        const maxPages = 20; // Increased limit to capture more events
        const targetDate = jobData?.endDate ? new Date(jobData.endDate) : null;

        while (hasMoreEvents && pageCount < maxPages) {
          // Look for MEC load more or pagination buttons
          const loadMoreButton = await page.$('.mec-load-more-button, .mec-next-month, .mec-next-events');
          
          if (loadMoreButton) {
            logger.info(`Loading more events (page ${pageCount + 2})...`);
            await loadMoreButton.click();
            await page.waitForTimeout(3000); // Wait for new events to load
            
            // Extract additional events with date checking
            const additionalEventData = await page.evaluate((targetDateStr) => {
              const moreEvents: Array<{url: string, title: string, eventId?: string, dateText?: string}> = [];
              const newEventElements = document.querySelectorAll('.mec-event-article:not([data-processed]), .mec-event-list-event:not([data-processed])');
              
              newEventElements.forEach(eventEl => {
                eventEl.setAttribute('data-processed', 'true');
                const titleLinkEl = eventEl.querySelector('.mec-event-title a, .mec-event-list-title a, h4 a') as HTMLAnchorElement;
                
                if (titleLinkEl?.href && titleLinkEl?.textContent) {
                  const eventId = eventEl.getAttribute('data-event-id') || eventEl.id;
                  
                  // Try to extract date from event element
                  const dateEl = eventEl.querySelector('.mec-event-date, .mec-start-date, [class*="date"]');
                  const dateText = dateEl?.textContent?.trim() || '';
                  
                  moreEvents.push({
                    url: titleLinkEl.href,
                    title: titleLinkEl.textContent.trim(),
                    eventId: eventId,
                    dateText: dateText
                  });
                }
              });
              
              return moreEvents;
            }, targetDate?.toISOString());

            if (additionalEventData.length > 0) {
              eventData.events.push(...additionalEventData);
              logger.info(`Found ${additionalEventData.length} additional events`);
              
              // Check if we've passed the target date
              if (targetDate) {
                const shouldStop = additionalEventData.some(event => {
                  if (event.dateText) {
                    try {
                      const eventDate = new Date(event.dateText);
                      return eventDate > targetDate;
                    } catch (e) {
                      // If we can't parse the date, continue
                      return false;
                    }
                  }
                  return false;
                });
                
                if (shouldStop) {
                  logger.info(`Reached target date ${targetDate.toDateString()}, stopping pagination`);
                  hasMoreEvents = false;
                }
              }
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

            // Extract MEC event details - be specific about date vs time sections
            const startDateEl = document.querySelector('.mec-single-event-date .mec-start-date-label') ||
                               document.querySelector('.mec-single-event-date .mec-events-abbr') ||
                               document.querySelector('.mec-start-date, .mec-event-date, .event-date');
            const endDateEl = document.querySelector('.mec-end-date, .mec-event-end-date');
            
            // Extract time specifically from the time section, not the date section
            let timeRangeEl = document.querySelector('.mec-single-event-time .mec-events-abbr') ||
                             document.querySelector('.mec-single-event-time dd abbr') ||
                             document.querySelector('.mec-single-event-time dd') ||
                             document.querySelector('.mec-event-info-desktop .mec-single-event-time .mec-events-abbr');
            
            let startTimeText = '';
            let endTimeText = '';
            
            if (timeRangeEl) {
              const timeText = timeRangeEl.textContent?.trim() || '';
              // Check if it's a time range like "5:00 pm - 11:00 pm"
              if (timeText.includes(' - ')) {
                const [start, end] = timeText.split(' - ').map(t => t.trim());
                startTimeText = start;
                endTimeText = end;
              } else {
                startTimeText = timeText;
              }
            } else {
              // Fallback to individual time elements
              const startTimeEl = document.querySelector('.mec-start-time, .mec-event-time, .event-time');
              const endTimeEl = document.querySelector('.mec-end-time, .mec-event-end-time');
              startTimeText = startTimeEl?.textContent?.trim() || '';
              endTimeText = endTimeEl?.textContent?.trim() || '';
            }
            
            // Extract location - Downtown PG uses specific structure
            const locationEl = document.querySelector('.mec-single-event-location .author, .mec-event-location, .mec-location, .event-location') ||
                              document.querySelector('.mec-single-event-location dd.author');
            const addressEl = document.querySelector('.mec-single-event-location .mec-address, .mec-event-address, .mec-address, .event-address') ||
                             document.querySelector('.mec-single-event-location address .mec-address');
            
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
              startTime: startTimeText,
              endTime: endTimeText,
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
            // Use structured data for dates but avoid timezone conversion
            // Parse date components manually to prevent timezone shifting
            const startDateMatch = eventInfo.startDate.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (startDateMatch) {
              const [, year, month, day] = startDateMatch;

              // Validate date components
              const yearNum = parseInt(year);
              const monthNum = parseInt(month);
              const dayNum = parseInt(day);

              // Check if the date is valid
              if (monthNum < 1 || monthNum > 12) {
                throw new Error(`Invalid month: ${monthNum} in date ${eventInfo.startDate}`);
              }

              // Check if day is valid for the given month/year
              const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
              if (dayNum < 1 || dayNum > daysInMonth) {
                throw new Error(`Could not parse date: ${yearNum}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')} ${String(9).padStart(2, '0')}:${String(0).padStart(2, '0')}`);
              }

              // Create the date string that represents the local time in Pacific timezone
              // Instead of creating a Date object (which uses system timezone), create a string
              let hour = 9; // Default hour
              let minute = 0; // Default minute

              if (eventDetails.startTime) {
                const timeMatch = eventDetails.startTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
                if (timeMatch) {
                  let [, hours, minutes, ampm] = timeMatch;
                  hour = parseInt(hours);
                  minute = parseInt(minutes);
                  if (ampm.toLowerCase() === 'pm' && hour !== 12) {
                    hour += 12;
                  } else if (ampm.toLowerCase() === 'am' && hour === 12) {
                    hour = 0;
                  }
                }
              }

              // Create a date string in "YYYY-MM-DD HH:mm" format
              // The normalizeEvent function will parse this with the defaultTimezone
              // Note: month from ISO date format is already 1-based (01-12)
              const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
              eventStart = dateStr;
              
              // Handle end time
              if (eventDetails.endTime) {
                const endTimeMatch = eventDetails.endTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
                if (endTimeMatch) {
                  let [, endHours, endMinutes, endAmpm] = endTimeMatch;
                  let endHour = parseInt(endHours);
                  let endMinute = parseInt(endMinutes);
                  if (endAmpm.toLowerCase() === 'pm' && endHour !== 12) {
                    endHour += 12;
                  } else if (endAmpm.toLowerCase() === 'am' && endHour === 12) {
                    endHour = 0;
                  }
                  
                  // Handle midnight crossing (e.g., 9:00 pm - 12:00 am)
                  let endDay = dayNum;
                  let endMonth = monthNum;
                  let endYear = yearNum;
                  if (endHour < hour) {
                    endDay += 1;
                    // Check if we've gone past the end of the month
                    const daysInCurrentMonth = new Date(endYear, endMonth, 0).getDate();
                    if (endDay > daysInCurrentMonth) {
                      endDay = 1;
                      endMonth += 1;
                      if (endMonth > 12) {
                        endMonth = 1;
                        endYear += 1;
                      }
                    }
                  }

                  // Create end date string
                  // Note: month from ISO date format is already 1-based (01-12)
                  const endDateStr = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')} ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
                  eventEnd = endDateStr;
                }
              } else if (eventInfo.endDate && eventInfo.endDate !== eventInfo.startDate) {
                // Handle multi-day events from structured data
                const endDateMatch = eventInfo.endDate.match(/(\d{4})-(\d{2})-(\d{2})/);
                if (endDateMatch) {
                  const [, endYear, endMonth, endDay] = endDateMatch;
                  // Create end of day string
                  const multiDayEndStr = `${endYear}-${endMonth}-${endDay} 23:59`;
                  eventEnd = multiDayEndStr;
                }
              }
            }
          } else {
            // Fallback to parsed dates from HTML
            try {
              if (eventDetails.startDate) {
                const startDateStr = eventDetails.startDate;
                const startTimeStr = eventDetails.startTime || '9:00 AM';
                
                // Parse date and time separately to handle timezone correctly
                // Prince George is in Pacific Time (UTC-8/UTC-7)
                // Handle both "Aug 27 2025" and "Oct 25 2025" formats
                const dateMatch = startDateStr.match(/(\w{3})\s+(\d{1,2})\s+(\d{4})/); // e.g., "Aug 27 2025" or "Oct 25 2025"
                
                if (dateMatch) {
                  const [, month, day, year] = dateMatch;
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const monthIndex = monthNames.indexOf(month);
                  
                  if (monthIndex !== -1) {
                    // Create date in Pacific timezone
                    const startDate = new Date(parseInt(year), monthIndex, parseInt(day));
                    
                    // Parse time if available (don't use default 9:00 AM if we have real time)
                    if (startTimeStr && startTimeStr.trim() !== '') {
                      const timeMatch = startTimeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
                      if (timeMatch) {
                        let [, hours, minutes, ampm] = timeMatch;
                        let hourNum = parseInt(hours);
                        if (ampm.toLowerCase() === 'pm' && hourNum !== 12) {
                          hourNum += 12;
                        } else if (ampm.toLowerCase() === 'am' && hourNum === 12) {
                          hourNum = 0;
                        }
                        startDate.setHours(hourNum, parseInt(minutes), 0, 0);
                      }
                    } else {
                      // Only use default 9:00 AM if no time was found at all
                      startDate.setHours(9, 0, 0, 0);
                    }
                    
                    eventStart = startDate.toISOString();
                    
                    // Handle end time
                    if (eventDetails.endTime) {
                      const endDate = new Date(startDate);
                      const endTimeMatch = eventDetails.endTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
                      if (endTimeMatch) {
                        let [, hours, minutes, ampm] = endTimeMatch;
                        let hourNum = parseInt(hours);
                        if (ampm.toLowerCase() === 'pm' && hourNum !== 12) {
                          hourNum += 12;
                        } else if (ampm.toLowerCase() === 'am' && hourNum === 12) {
                          hourNum = 0;
                        }
                        
                        // Handle midnight crossing (e.g., 9:00 pm - 12:00 am)
                        if (hourNum < startDate.getHours()) {
                          endDate.setDate(endDate.getDate() + 1);
                        }
                        
                        endDate.setHours(hourNum, parseInt(minutes), 0, 0);
                        
                        eventEnd = endDate.toISOString();
                      }
                    }
                  }
                }
                
                // Fallback to original parsing if the new method fails
                if (!eventStart) {
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