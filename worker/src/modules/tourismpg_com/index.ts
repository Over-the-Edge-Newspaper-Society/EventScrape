import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const tourismPgModule: ScraperModule = {
  key: 'tourismpg_com',
  label: 'Tourism Prince George Events',
  startUrls: [
    'https://tourismpg.com/explore/events/',
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

      // Wait for the JetEngine calendar to load (may be hidden initially)
      try {
        await page.waitForSelector('.jet-calendar-grid', { timeout: 15000, state: 'attached' });
        logger.info('JetEngine calendar found');
        
        // Wait a bit more for the calendar to populate with events
        await page.waitForTimeout(3000);
      } catch (error) {
        logger.error('JetEngine calendar not found within timeout');
        throw error;
      }

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

      // Collect events from multiple months (respecting date range even in test mode)
      const allEventLinks: Array<{url: string, title: string, date: string}> = [];
      
      for (let monthIndex = 0; monthIndex < maxMonths; monthIndex++) {
        logger.info(`Processing month ${monthIndex + 1}/${maxMonths}`);
        
        // Get current month name for context
        const currentMonth = await page.$eval('.jet-calendar-caption__name', 
          el => el.textContent?.trim() || '');
        logger.info(`Current month: ${currentMonth}`);

        // Extract events from current month's calendar
        const monthEventLinks = await page.evaluate((currentMonth) => {
          const links: Array<{url: string, title: string, date: string}> = [];
          
          // Find all day cells with events
          const dayCells = document.querySelectorAll('.jet-calendar-week__day.has-events');
          
          dayCells.forEach(dayCell => {
            // Get the day number
            const dayNumberEl = dayCell.querySelector('.jet-calendar-week__day-date');
            const dayNumber = dayNumberEl?.textContent?.trim() || '';
            
            // Find all events in this day
            const eventElements = dayCell.querySelectorAll('.jet-calendar-week__day-event');
            
            eventElements.forEach(eventEl => {
              // Extract event title and link
              const titleLinkEl = eventEl.querySelector('.elementor-heading-title a') as HTMLAnchorElement;
              
              if (titleLinkEl?.href && titleLinkEl?.textContent) {
                // Create date string from current month and day
                // Convert "August 2025" + "27" to "August 27, 2025" format
                let eventDate;
                const monthYearMatch = currentMonth.match(/(\w+)\s+(\d{4})/);
                if (monthYearMatch) {
                  const [, month, year] = monthYearMatch;
                  eventDate = `${month} ${dayNumber}, ${year}`;
                } else {
                  eventDate = `${currentMonth} ${dayNumber}`;
                }
                
                links.push({
                  url: titleLinkEl.href,
                  title: titleLinkEl.textContent.trim(),
                  date: eventDate
                });
              }
            });
          });
          
          return links;
        }, currentMonth);

        logger.info(`Found ${monthEventLinks.length} events in ${currentMonth}`);
        allEventLinks.push(...monthEventLinks);

        // Navigate to next month if not the last iteration
        // Allow navigation in test mode when date range is specified
        const shouldNavigate = monthIndex < maxMonths - 1 && 
                              (!isTestMode || (paginationOptions?.type === 'calendar' && (targetStartDate || targetEndDate)));
        if (shouldNavigate) {
          try {
            // Wait for the next button to be present in DOM (may be hidden)
            await page.waitForSelector('.jet-calendar-nav__link.nav-link-next', { 
              state: 'attached', 
              timeout: 10000 
            });
            
            logger.info('Navigating to next month...');
            const currentMonthName = currentMonth;
            
            // Try clicking the next button - it may trigger JavaScript navigation even if hidden
            const clicked = await page.evaluate(() => {
              const nextButton = document.querySelector('.jet-calendar-nav__link.nav-link-next') as HTMLElement;
              if (nextButton) {
                // Try both click and triggering any data attributes
                nextButton.click();
                
                // Also try triggering based on data-month attribute if needed
                const targetMonth = nextButton.getAttribute('data-month');
                if (targetMonth) {
                  // Dispatch custom event that might trigger calendar navigation
                  nextButton.dispatchEvent(new Event('click', { bubbles: true }));
                }
                return true;
              }
              return false;
            });
            
            if (clicked) {
              // Wait for the calendar to update by checking month name changes
              try {
                await page.waitForFunction(
                  (expectedMonth) => {
                    const monthEl = document.querySelector('.jet-calendar-caption__name');
                    return monthEl && monthEl.textContent?.trim() !== expectedMonth;
                  },
                  currentMonthName,
                  { timeout: 15000 }
                );
                
                // Additional wait for events to load
                await page.waitForTimeout(3000);
                if (ctx.stats) ctx.stats.pagesCrawled++;
                
                // Verify we actually moved to next month
                const newMonth = await page.$eval('.jet-calendar-caption__name', 
                  el => el.textContent?.trim() || '');
                logger.info(`Successfully navigated to: ${newMonth}`);
                
              } catch (waitError) {
                logger.warn(`Month didn't change after click, trying alternative approach: ${waitError}`);
                
                // Try alternative: force reload with next month URL if possible
                const nextMonthData = await page.evaluate(() => {
                  const nextButton = document.querySelector('.jet-calendar-nav__link.nav-link-next');
                  return nextButton?.getAttribute('data-month') || null;
                });
                
                if (nextMonthData) {
                  logger.info(`Attempting to navigate to: ${nextMonthData}`);
                  // For now, break the loop since we can't reliably navigate
                  break;
                } else {
                  break;
                }
              }
            } else {
              logger.warn('Next month button not found or not clickable, stopping navigation');
              break;
            }
          } catch (navError) {
            logger.warn(`Navigation to next month failed: ${navError}`);
            break;
          }
        }
      }

      logger.info(`Total events found across all months: ${allEventLinks.length}`);
      
      if (allEventLinks.length === 0) {
        logger.warn('No events found - this might indicate a scraping issue');
        try {
          await page.screenshot({ path: '/tmp/tourismpg-debug.png', fullPage: true });
          logger.info('Screenshot saved to /tmp/tourismpg-debug.png');
        } catch (screenshotError) {
          logger.warn('Could not take screenshot:', screenshotError);
        }
      }
      
      // Filter events by date range if specified
      let filteredEventLinks = allEventLinks;
      
      if (paginationOptions?.type === 'calendar' && (targetStartDate || targetEndDate)) {
        filteredEventLinks = allEventLinks.filter(eventLink => {
          try {
            // Parse the event date from the calendar
            const eventDate = new Date(eventLink.date + ' ' + new Date().getFullYear());
            
            if (targetStartDate && eventDate < targetStartDate) {
              return false;
            }
            if (targetEndDate && eventDate > targetEndDate) {
              return false;
            }
            return true;
          } catch (error) {
            logger.warn(`Failed to parse date for filtering: ${eventLink.date}`);
            return true; // Include if date parsing fails
          }
        });
        
        logger.info(`Filtered ${allEventLinks.length} events to ${filteredEventLinks.length} based on date range`);
      }

      // In test mode, only process the first event
      const eventsToProcess = isTestMode ? filteredEventLinks.slice(0, 1) : filteredEventLinks;
      logger.info(`Processing ${eventsToProcess.length} event${eventsToProcess.length === 1 ? '' : 's'}${isTestMode ? ' (test mode)' : ''}`);

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
            // Extract title - try multiple selectors for better coverage
            let title = '';
            const titleSelectors = [
              '.elementor-heading-title',
              'h1.elementor-heading-title',
              '.elementor-widget-heading h1',
              '.entry-title',
              'h1'
            ];
            
            for (const selector of titleSelectors) {
              const titleEl = document.querySelector(selector);
              const titleText = titleEl?.textContent?.trim();
              if (titleText && titleText !== 'Events') {
                title = titleText;
                break;
              }
            }

            // Extract start date
            const startDateEl = document.querySelector('.event-start-date .jet-listing-dynamic-field__content');
            let startDateText = startDateEl?.textContent?.trim() || '';
            
            // Extract end date
            const endDateEl = document.querySelector('.event-end-date .jet-listing-dynamic-field__content');
            let endDateText = endDateEl?.textContent?.trim() || '';

            // Extract start and end times more specifically
            const startTimeElements = document.querySelectorAll('.jet-listing-dynamic-field__content');
            let startTime = '';
            let endTime = '';
            
            // Look for time patterns in the dynamic fields
            startTimeElements.forEach(el => {
              const text = el.textContent?.trim() || '';
              
              // Match time patterns like "7:30pm", "10:00pm"
              if (text.match(/^\d{1,2}:\d{2}[ap]m$/i)) {
                if (!startTime) {
                  startTime = text;
                } else if (!endTime && text !== startTime) {
                  endTime = text;
                }
              } 
              // Match patterns like "- 10:00pm" for end times
              else if (text.match(/^-\s*\d{1,2}:\d{2}[ap]m$/i)) {
                endTime = text.replace(/^-\s*/, '');
              }
            });
            
            // If we didn't find times in the dynamic fields, try alternative selectors
            if (!startTime || !endTime) {
              const allTimeElements = document.querySelectorAll('*');
              const timeTexts: string[] = [];
              
              allTimeElements.forEach(el => {
                const text = el.textContent?.trim() || '';
                const timeMatch = text.match(/\b\d{1,2}:\d{2}[ap]m\b/gi);
                if (timeMatch) {
                  timeTexts.push(...timeMatch);
                }
              });
              
              // Remove duplicates and assign times
              const uniqueTimes = [...new Set(timeTexts)];
              if (!startTime && uniqueTimes.length > 0) {
                startTime = uniqueTimes[0];
              }
              if (!endTime && uniqueTimes.length > 1) {
                endTime = uniqueTimes[1];
              }
            }

            // Extract location information
            const locationElements = document.querySelectorAll('.elementor-widget-text-editor .elementor-widget-container');
            const locationParts: string[] = [];
            
            locationElements.forEach(el => {
              const text = el.textContent?.trim();
              if (text && text.length > 0 && text.length < 100) { // Filter out long content
                locationParts.push(text);
              }
            });

            // Extract venue website
            const websiteButtonEl = document.querySelector('.elementor-button-link[href]') as HTMLAnchorElement;
            const venueWebsite = websiteButtonEl?.href;

            // Extract description from post content
            const contentEl = document.querySelector('.elementor-widget-theme-post-content .elementor-widget-container');
            const description = contentEl?.innerHTML?.trim();

            // Extract Google Maps iframe for location verification
            const mapIframe = document.querySelector('iframe[src*="maps.google.com"]') as HTMLIFrameElement;
            const mapSrc = mapIframe?.src;

            return {
              title,
              startDateText,
              endDateText,
              startTime,
              endTime,
              locationParts,
              venueWebsite,
              description,
              mapSrc,
            };
          });

          // Parse date and time information
          let eventStart = '';
          let eventEnd = '';
          
          try {
            if (eventDetails.startDateText) {
              // Parse "Happening September 5, 2025" or "September 5, 2025" format
              const dateMatch = eventDetails.startDateText.match(/(?:Happening\s+)?(\w+ \d+, \d+)/i);
              if (dateMatch) {
                const dateStr = dateMatch[1];
                
                if (eventDetails.startTime) {
                  // Parse date components manually to avoid timezone conversion
                  const dateParts = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
                  if (dateParts) {
                    const [, monthName, day, year] = dateParts;
                    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                      'July', 'August', 'September', 'October', 'November', 'December'];
                    const monthIndex = monthNames.indexOf(monthName);
                    
                    if (monthIndex !== -1) {
                      // Parse time
                      const timeMatch = eventDetails.startTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
                      if (timeMatch) {
                        let [, hours, minutes, ampm] = timeMatch;
                        let hourNum = parseInt(hours);
                        if (ampm.toLowerCase() === 'pm' && hourNum !== 12) {
                          hourNum += 12;
                        } else if (ampm.toLowerCase() === 'am' && hourNum === 12) {
                          hourNum = 0;
                        }
                        
                        // Create timezone-neutral date string format
                        const monthStr = String(monthIndex + 1).padStart(2, '0');
                        const dayStr = String(day).padStart(2, '0');
                        const hourStr = String(hourNum).padStart(2, '0');
                        const minuteStr = String(minutes).padStart(2, '0');
                        eventStart = `${year}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}`;
                        
                        // Set end time if available
                        if (eventDetails.endTime) {
                          const endTimeMatch = eventDetails.endTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
                          if (endTimeMatch) {
                            let [, endHours, endMinutes, endAmpm] = endTimeMatch;
                            let endHourNum = parseInt(endHours);
                            if (endAmpm.toLowerCase() === 'pm' && endHourNum !== 12) {
                              endHourNum += 12;
                            } else if (endAmpm.toLowerCase() === 'am' && endHourNum === 12) {
                              endHourNum = 0;
                            }
                            
                            // Handle next day if end time is earlier than start time
                            let endDay = parseInt(day);
                            let endMonth = monthIndex;
                            let endYear = parseInt(year);

                            if (endHourNum < hourNum) {
                              endDay += 1;

                              // Check if we've gone past the end of the month
                              const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
                              // Account for leap years
                              if (endMonth === 1 && endYear % 4 === 0 && (endYear % 100 !== 0 || endYear % 400 === 0)) {
                                daysInMonth[1] = 29;
                              }

                              if (endDay > daysInMonth[endMonth]) {
                                endDay = 1;
                                endMonth += 1;

                                // Handle year rollover
                                if (endMonth > 11) {
                                  endMonth = 0;
                                  endYear += 1;
                                }
                              }
                            }

                            // Create timezone-neutral end date string
                            const endMonthStr = String(endMonth + 1).padStart(2, '0');
                            const endDayStr = String(endDay).padStart(2, '0');
                            const endHourStr = String(endHourNum).padStart(2, '0');
                            const endMinuteStr = String(parseInt(endMinutes)).padStart(2, '0');
                            eventEnd = `${endYear}-${endMonthStr}-${endDayStr} ${endHourStr}:${endMinuteStr}`;
                          }
                        }
                      }
                    }
                  }
                } else {
                  // No specific time, use default 9 AM with manual date parsing
                  const dateParts = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
                  if (dateParts) {
                    const [, monthName, day, year] = dateParts;
                    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                      'July', 'August', 'September', 'October', 'November', 'December'];
                    const monthIndex = monthNames.indexOf(monthName);
                    
                    if (monthIndex !== -1) {
                      // Create timezone-neutral date string with default 9 AM
                      const monthStr = String(monthIndex + 1).padStart(2, '0');
                      const dayStr = String(day).padStart(2, '0');
                      eventStart = `${year}-${monthStr}-${dayStr} 09:00`;
                    }
                  }
                }
              }
            }

            // Fallback if date parsing failed
            if (!eventStart) {
              // Use current date in timezone-neutral format
              const now = new Date();
              const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 09:00`;
              eventStart = fallbackDate;
              logger.warn(`Date parsing failed for ${eventLink.title}, using current date`);
            }
            
            // Handle multi-day events (parse endDateText like "- September 1, 2025")
            if (!eventEnd && eventDetails.endDateText) {
              const endDateMatch = eventDetails.endDateText.match(/(?:-\s*)?(\w+ \d+, \d+)/i);
              if (endDateMatch) {
                const endDateStr = endDateMatch[1];
                const endDateParts = endDateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
                if (endDateParts) {
                  const [, endMonthName, endDay, endYear] = endDateParts;
                  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                    'July', 'August', 'September', 'October', 'November', 'December'];
                  const endMonthIndex = monthNames.indexOf(endMonthName);
                  
                  if (endMonthIndex !== -1) {
                    // Use end time if available, otherwise use end of day (11:59 PM)
                    let endHour = 23;
                    let endMinute = 59;
                    
                    if (eventDetails.endTime) {
                      const endTimeMatch = eventDetails.endTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
                      if (endTimeMatch) {
                        let [, hours, minutes, ampm] = endTimeMatch;
                        endHour = parseInt(hours);
                        endMinute = parseInt(minutes);
                        if (ampm.toLowerCase() === 'pm' && endHour !== 12) {
                          endHour += 12;
                        } else if (ampm.toLowerCase() === 'am' && endHour === 12) {
                          endHour = 0;
                        }
                      }
                    }
                    
                    // Create timezone-neutral date string for end date
                    const endMonthStr = String(endMonthIndex + 1).padStart(2, '0');
                    const endDayStr = String(endDay).padStart(2, '0');
                    const endHourStr = String(endHour).padStart(2, '0');
                    const endMinuteStr = String(endMinute).padStart(2, '0');
                    eventEnd = `${endYear}-${endMonthStr}-${endDayStr} ${endHourStr}:${endMinuteStr}`;
                  }
                }
              }
            }
          } catch (dateError) {
            // Use current date in timezone-neutral format
            const now = new Date();
            const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 09:00`;
            eventStart = fallbackDate;
            logger.warn(`Date parsing error for ${eventLink.title}: ${dateError}`);
          }

          // Process location information
          let venueName = '';
          let venueAddress = '';
          
          if (eventDetails.locationParts.length > 0) {
            // First non-empty part is usually the venue address
            const addressParts = eventDetails.locationParts.filter((part: string) =>
              part && !part.match(/^(Prince George|BC|V\d\w\s*\d\w\d)$/i)
            );
            
            if (addressParts.length > 0) {
              venueAddress = addressParts[0];
            }

            // Try to extract venue name from map source or use generic name
            if (eventDetails.mapSrc) {
              const mapQuery = eventDetails.mapSrc.match(/q=([^&]+)/);
              if (mapQuery) {
                const decodedQuery = decodeURIComponent(mapQuery[1]);
                // Extract venue name before address
                const parts = decodedQuery.split(',');
                if (parts.length > 0) {
                  venueName = parts[0].trim();
                }
              }
            }
          }

          // Create the event
          const sourceEventId = `${eventLink.url}#${eventLink.date}`;

          const event: RawEvent = {
            sourceEventId: sourceEventId,
            title: eventDetails.title || eventLink.title,
            start: eventStart,
            city: 'Prince George',
            region: 'British Columbia',
            country: 'Canada',
            organizer: 'Tourism Prince George',
            category: 'Community Event',
            url: eventLink.url,
            raw: {
              calendarDate: eventLink.date,
              startDateText: eventDetails.startDateText,
              endDateText: eventDetails.endDateText,
              startTime: eventDetails.startTime,
              endTime: eventDetails.endTime,
              locationParts: eventDetails.locationParts,
              extractedAt: new Date().toISOString(),
              originalEventLink: eventLink,
            },
          };

          if (eventEnd) {
            event.end = eventEnd;
          }

          if (venueName) {
            event.venueName = venueName;
          }

          if (venueAddress) {
            event.venueAddress = venueAddress;
          }

          if (eventDetails.description) {
            event.descriptionHtml = eventDetails.description;
          }

          // Store venue website in raw data for now since ticketUrl is not in RawEvent type
          if (eventDetails.venueWebsite && eventDetails.venueWebsite !== eventLink.url) {
            if (typeof event.raw === 'object' && event.raw !== null) {
              (event.raw as any).venueWebsite = eventDetails.venueWebsite;
            }
          }

          events.push(event);
          logger.info(`Created event: ${event.title} on ${eventLink.date}`);

        } catch (eventError) {
          logger.warn(`Failed to process event ${eventLink.title}: ${eventError}`);
          
          // Create minimal fallback event
          const fallbackEvent: RawEvent = {
            sourceEventId: `${eventLink.url}#${eventLink.date}`,
            title: eventLink.title,
            start: new Date().toISOString(),
            city: 'Prince George',
            region: 'British Columbia',
            country: 'Canada',
            organizer: 'Tourism Prince George',
            url: eventLink.url,
            raw: {
              calendarDate: eventLink.date,
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

export default tourismPgModule;