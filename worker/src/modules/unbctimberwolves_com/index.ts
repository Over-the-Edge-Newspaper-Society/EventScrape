import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const unbcTimberwolvesModule: ScraperModule = {
  key: 'unbctimberwolves_com',
  label: 'UNBC Timberwolves Athletics',
  mode: 'hybrid', // Support both scraping and upload
  paginationType: 'calendar',
  integrationTags: ['calendar', 'csv'],
  startUrls: [
    'https://unbctimberwolves.com/calendar',
  ],
  uploadConfig: {
    supportedFormats: ['csv'],
    downloadUrl: 'https://unbctimberwolves.com/calendar',
    instructions: `To download events manually:
1. Go to https://unbctimberwolves.com/calendar
2. Click the "Sync/Download" button (calendar icon)
3. Select "Excel" as the export format
4. Click "Download Now"
5. Upload the downloaded CSV file here`,
  },

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    const isTestMode = jobData?.testMode === true;
    const scrapeMode = jobData?.scrapeMode || 'full';
    const paginationOptions = jobData?.paginationOptions;

    // Check if file was uploaded
    if (jobData?.uploadedFile) {
      logger.info(`Processing uploaded ${jobData.uploadedFile.format} file for ${this.label}`);
      
      if (jobData.uploadedFile.format === 'csv' && jobData.uploadedFile.content) {
        return this.processUpload(jobData.uploadedFile.content, 'csv', logger);
      } else {
        logger.error(`Unsupported file format: ${jobData.uploadedFile.format}`);
        throw new Error(`Unsupported file format: ${jobData.uploadedFile.format}`);
      }
    }

    logger.info(`Starting ${isTestMode ? 'test ' : scrapeMode} scrape of ${this.label}`);
    
    if (paginationOptions?.type === 'page') {
      if (paginationOptions.scrapeAllPages) {
        logger.info('Page pagination: scraping all pages until the end');
      } else {
        logger.info(`Page pagination: scraping maximum ${paginationOptions.maxPages || 10} pages`);
      }
    }

    try {
      // Navigate to the calendar page
      await page.goto(this.startUrls[0], { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      if (ctx.stats) ctx.stats.pagesCrawled++;

      logger.info('Page loaded, waiting for Sidearm calendar to render...');

      // Wait for the Sidearm calendar to load
      try {
        await page.waitForSelector('.sidearm-calendar-table', { timeout: 15000, state: 'attached' });
        logger.info('Sidearm calendar found');
        
        // Wait for events to populate (Knockout.js binding)
        await page.waitForTimeout(5000);
      } catch (error) {
        logger.error('Sidearm calendar not found within timeout');
        throw error;
      }

      // Try to use direct CSV endpoint first using page.evaluate to fetch with cookies
      try {
        logger.info('Attempting to download CSV from direct endpoint...');
        
        // Generate a random cache buster similar to the site's pattern
        const cacheBuster = Math.random().toString(36).substring(2, 15);
        const csvUrl = `https://unbctimberwolves.com/calendar.ashx/calendar.csv?sport_id=0&_=${cacheBuster}`;
        
        logger.info(`Fetching CSV from: ${csvUrl}`);
        
        // Use fetch within the page context to maintain cookies/session
        const csvResponse = await page.evaluate(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) {
              const text = await response.text();
              return { success: true, content: text };
            }
            return { success: false, error: `HTTP ${response.status}` };
          } catch (error) {
            return { success: false, error: error.message };
          }
        }, csvUrl);
        
        if (csvResponse.success && csvResponse.content && csvResponse.content.length > 0) {
          logger.info('CSV content retrieved successfully via fetch');
          const csvEvents = await this.parseCSVContent(csvResponse.content, logger);
          
          if (csvEvents.length > 0) {
            logger.info(`Successfully parsed ${csvEvents.length} events from direct CSV endpoint`);
            return csvEvents;
          }
        } else {
          logger.warn(`CSV fetch failed: ${csvResponse.error || 'No content'}`);
        }
        
        logger.info('Direct CSV endpoint failed, trying interactive download...');
        
        // Look for various possible selectors for the download/subscribe button
        const possibleSelectors = [
          '.sidearm-calendar-subscribe__sync',
          'button[aria-label*="Sync"]',
          'button[aria-label*="download"]',
          '.sidearm-calendar-subscribe button',
          '[data-bind*="subscribe"]',
          'button:has-text("Download")',
          'button:has-text("Sync")'
        ];
        
        let subscribeButton = null;
        for (const selector of possibleSelectors) {
          try {
            subscribeButton = await page.$(selector);
            if (subscribeButton) {
              logger.info(`Found download button using selector: ${selector}`);
              break;
            }
          } catch (selectorError) {
            // Continue to next selector
          }
        }
        
        if (!subscribeButton) {
          // Try to look for any button with text related to download/sync
          subscribeButton = await page.$('button:has([class*="sync"]), button:has([class*="download"])');
        }
        
        if (subscribeButton) {
          // Check if button is visible, if not try to make it visible
          const isVisible = await subscribeButton.isVisible();
          if (!isVisible) {
            logger.info('Download button not visible, trying to scroll it into view...');
            await subscribeButton.scrollIntoViewIfNeeded();
            await page.waitForTimeout(1000);
          }
          
          logger.info('Clicking download button...');
          await subscribeButton.click({ force: true });
          
          // Wait for modal to appear and check for multiple possible states
          await page.waitForTimeout(3000);
          
          // Look for Excel export option with multiple selectors
          const excelSelectors = [
            '#sidearm-calendar-subscribe-download-0',
            'input[value="excel"]',
            'input[type="radio"][name*="service"]',
            'input[value*="excel" i]'
          ];
          
          let excelRadio = null;
          for (const selector of excelSelectors) {
            try {
              excelRadio = await page.$(selector);
              if (excelRadio) {
                logger.info(`Found Excel option using selector: ${selector}`);
                break;
              }
            } catch (selectorError) {
              // Continue to next selector
            }
          }
          
          if (excelRadio) {
            logger.info('Selecting Excel export option...');
            await excelRadio.click({ force: true });
            await page.waitForTimeout(1000);
            
            // Set up download promise before clicking
            const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
            
            // Look for download button with multiple selectors
            const downloadSelectors = [
              'button[aria-label="Sync or download calendar"]',
              'button:has-text("Download Now")',
              'button:has-text("Download")',
              '.sidearm-calendar-subscribe__sync',
              'button[type="submit"]'
            ];
            
            let downloadButton = null;
            for (const selector of downloadSelectors) {
              try {
                downloadButton = await page.$(selector);
                if (downloadButton) {
                  logger.info(`Found download button using selector: ${selector}`);
                  break;
                }
              } catch (selectorError) {
                // Continue to next selector
              }
            }
            
            if (downloadButton) {
              logger.info('Clicking final download button...');
              await downloadButton.click({ force: true });
              
              try {
                // Wait for download to complete
                const download = await downloadPromise;
                const downloadPath = await download.path();
                
                if (downloadPath) {
                  logger.info(`CSV downloaded to: ${downloadPath}`);
                  
                  // Read and parse the CSV file
                  const fs = await import('fs');
                  const csvContent = fs.readFileSync(downloadPath, 'utf-8');
                  
                  logger.info('Parsing CSV content...');
                  const csvEvents = await this.parseCSVContent(csvContent, logger);
                  
                  if (csvEvents.length > 0) {
                    logger.info(`Successfully parsed ${csvEvents.length} events from CSV`);
                    
                    // Clean up download file
                    try {
                      fs.unlinkSync(downloadPath);
                    } catch (cleanupError) {
                      logger.warn(`Could not clean up download file: ${cleanupError}`);
                    }
                    
                    return csvEvents;
                  }
                }
              } catch (downloadError) {
                logger.warn(`Download wait failed: ${downloadError}`);
              }
            } else {
              logger.warn('Could not find final download button');
            }
          } else {
            logger.warn('Could not find Excel export option');
          }
        } else {
          logger.warn('Could not find download/subscribe button');
        }
        
        logger.info('CSV download method failed or no events found, falling back to calendar scraping...');
      } catch (csvError) {
        logger.warn(`CSV download failed: ${csvError}, falling back to calendar scraping...`);
      }

      // Collect events from multiple months if not in test mode
      const allEvents: Array<{
        date: string,
        dayOfMonth: string,
        sport: string,
        opponent: string,
        location: string,
        time: string,
        atVs: string,
        ticketUrl?: string,
        isHome: boolean
      }> = [];
      
      // Determine how many months to scrape based on pagination options
      let maxMonths = isTestMode ? 1 : 12; // Default: current + next 11 months
      
      if (paginationOptions?.type === 'page') {
        if (paginationOptions.scrapeAllPages) {
          maxMonths = 12; // Scrape all available pages (up to 12 months)
        } else if (paginationOptions.maxPages) {
          maxMonths = Math.min(paginationOptions.maxPages, 12);
        }
      }
      
      for (let monthIndex = 0; monthIndex < maxMonths; monthIndex++) {
        logger.info(`Processing month ${monthIndex + 1}/${maxMonths}`);
        
        // Get current month name for context
        const currentMonth = await page.$eval('[data-bind*="selectedDate"]', 
          el => el.textContent?.trim() || '');
        logger.info(`Current month: ${currentMonth}`);

        // Extract events from current month's calendar
        const monthEvents = await page.evaluate((currentMonth) => {
          const events: Array<{
            date: string,
            dayOfMonth: string,
            sport: string,
            opponent: string,
            location: string,
            time: string,
            atVs: string,
            ticketUrl?: string,
            isHome: boolean
          }> = [];
          
          // Find all calendar cells with events
          const eventCells = document.querySelectorAll('.sidearm-calendar-table-cell-container');
          
          eventCells.forEach(cell => {
            // Get the day number from the parent cell
            const dayElement = cell.closest('.sidearm-calendar-table-cell')?.querySelector('time');
            const dayOfMonth = dayElement?.textContent?.trim() || '';
            
            // Skip if no day number or if it's from another month
            if (!dayOfMonth || cell.closest('.sidearm-table-cell-other-month')) {
              return;
            }
            
            // Find event list
            const eventsList = cell.querySelector('.sidearm-calendar-table-cell-events');
            if (!eventsList) return;
            
            // Extract each event
            const eventElements = eventsList.querySelectorAll('.sidearm-calendar-table-cell-event');
            
            eventElements.forEach(eventEl => {
              try {
                // Extract sport
                const sportEl = eventEl.querySelector('[data-bind*="sport.short_display"]');
                const sport = sportEl?.textContent?.trim() || 'Athletic Event';
                
                // Extract at/vs indicator
                const atVsEl = eventEl.querySelector('[data-bind*="at_vs"]');
                const atVs = atVsEl?.textContent?.trim() || '';
                
                // Extract opponent
                const opponentEl = eventEl.querySelector('[data-bind*="opponent.title"]');
                const opponent = opponentEl?.textContent?.trim() || '';
                
                // Extract location
                const locationEl = eventEl.querySelector('[data-bind*="location"]:not([data-bind*="location_indicator"])');
                const location = locationEl?.textContent?.trim() || '';
                
                // Extract time
                const timeEl = eventEl.querySelector('[data-bind*="time"]:not([aria-label])');
                const time = timeEl?.textContent?.trim() || '';
                
                // Check if home game
                const isHome = eventEl.classList.contains('sidearm-calendar-table-cell-event-home');
                
                // Extract ticket URL if available
                let ticketUrl = '';
                const ticketLink = eventEl.querySelector('[data-bind*="media.tickets"] a') as HTMLAnchorElement;
                if (ticketLink?.href) {
                  ticketUrl = ticketLink.href;
                }
                
                if (opponent && time) {
                  events.push({
                    date: `${currentMonth} ${dayOfMonth}`,
                    dayOfMonth,
                    sport,
                    opponent,
                    location,
                    time,
                    atVs,
                    ticketUrl,
                    isHome
                  });
                }
              } catch (err) {
                console.warn('Error extracting event:', err);
              }
            });
          });
          
          return events;
        }, currentMonth);

        logger.info(`Found ${monthEvents.length} events in ${currentMonth}`);
        allEvents.push(...monthEvents);

        // Navigate to next month if not the last iteration and not in test mode
        if (monthIndex < maxMonths - 1 && !isTestMode) {
          try {
            // Look for next month navigation button with multiple selectors
            const nextSelectors = [
              '[data-bind*="nextMonth"]',
              '.sidearm-calendar-nav-next',
              '.next-month',
              'button[aria-label*="next"]',
              'button[aria-label*="Next"]',
              '.sidearm-calendar-navigation-next',
              '.calendar-next',
              'button:has-text("Next")',
              'button:has-text(">")',
              '.fa-chevron-right',
              '.fa-arrow-right'
            ];
            
            let nextButton = null;
            for (const selector of nextSelectors) {
              try {
                nextButton = await page.$(selector);
                if (nextButton) {
                  logger.info(`Found next button using selector: ${selector}`);
                  break;
                }
              } catch (selectorError) {
                // Continue to next selector
              }
            }
            
            if (nextButton) {
              // Check if button is visible and enabled
              const isVisible = await nextButton.isVisible();
              const isEnabled = await nextButton.isEnabled();
              
              if (!isVisible) {
                logger.info('Next button not visible, scrolling into view...');
                await nextButton.scrollIntoViewIfNeeded();
                await page.waitForTimeout(1000);
              }
              
              if (!isEnabled) {
                logger.warn('Next button is disabled, reached end of calendar');
                if (paginationOptions?.scrapeAllPages) {
                  logger.info('Scrape all pages enabled: stopping at natural end of calendar');
                }
                break;
              }
              
              logger.info('Navigating to next month...');
              await nextButton.click({ force: true });
              
              // Wait for calendar to update and verify month changed
              await page.waitForTimeout(4000);
              
              // Verify the month actually changed
              try {
                const newMonth = await page.$eval('[data-bind*="selectedDate"]', 
                  el => el.textContent?.trim() || '');
                if (newMonth === currentMonth) {
                  logger.warn('Month did not change after clicking next, reached end of calendar');
                  if (paginationOptions?.scrapeAllPages) {
                    logger.info('Scrape all pages enabled: stopping at natural end of calendar');
                  }
                  break;
                }
                logger.info(`Successfully navigated to: ${newMonth}`);
              } catch (monthCheckError) {
                logger.warn('Could not verify month change');
              }
              
              if (ctx.stats) ctx.stats.pagesCrawled++;
            } else {
              logger.warn('No next month button found, stopping navigation');
              if (paginationOptions?.scrapeAllPages) {
                logger.info('Scrape all pages enabled: natural end of pagination reached');
              }
              break;
            }
          } catch (navError) {
            logger.warn(`Navigation to next month failed: ${navError}`);
            break;
          }
        }
      }

      logger.info(`Total events found across all months: ${allEvents.length}`);
      
      if (allEvents.length === 0) {
        logger.warn('No events found - this might indicate a scraping issue');
        try {
          await page.screenshot({ path: '/tmp/unbc-debug.png', fullPage: true });
          logger.info('Screenshot saved to /tmp/unbc-debug.png');
        } catch (screenshotError) {
          logger.warn('Could not take screenshot:', screenshotError);
        }
      }
      
      // In test mode, only process the first event
      const eventsToProcess = isTestMode ? allEvents.slice(0, 1) : allEvents;
      logger.info(`Processing ${eventsToProcess.length} event${eventsToProcess.length === 1 ? '' : 's'}${isTestMode ? ' (test mode)' : ''}`);

      // Remove duplicates based on date + opponent + time
      const uniqueEvents = eventsToProcess.filter((event, index, array) => 
        array.findIndex(e => e.date === event.date && e.opponent === event.opponent && e.time === event.time) === index
      );
      
      logger.info(`Unique events after deduplication: ${uniqueEvents.length}`);

      // Process each event
      for (const [index, eventData] of uniqueEvents.entries()) {
        try {
          logger.info(`Processing event ${index + 1}/${uniqueEvents.length}: ${eventData.sport} ${eventData.atVs} ${eventData.opponent}`);
          
          // Parse date and time information
          let eventStart = '';
          
          try {
            // Parse date like "August 2025 22"
            const dateParts = eventData.date.split(' ');
            if (dateParts.length >= 3) {
              const monthName = dateParts[0];
              const year = dateParts[1];
              const day = dateParts[2];
              
              // Convert month name to number
              const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                'July', 'August', 'September', 'October', 'November', 'December'];
              const monthIndex = monthNames.indexOf(monthName);
              
              if (monthIndex !== -1) {
                const monthStr = (monthIndex + 1).toString().padStart(2, '0');
                const dayStr = day.padStart(2, '0');
                
                if (eventData.time) {
                  // Parse time like "5:30 PM"
                  const timeMatch = eventData.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                  if (timeMatch) {
                    let hour = parseInt(timeMatch[1]);
                    const minute = timeMatch[2];
                    const isPM = timeMatch[3].toUpperCase() === 'PM';
                    
                    if (isPM && hour !== 12) hour += 12;
                    else if (!isPM && hour === 12) hour = 0;
                    
                    eventStart = `${year}-${monthStr}-${dayStr} ${hour.toString().padStart(2, '0')}:${minute}`;
                  } else {
                    // Default time if parsing fails
                    eventStart = `${year}-${monthStr}-${dayStr} 19:00`;
                  }
                } else {
                  // No time specified, default to 7 PM
                  eventStart = `${year}-${monthStr}-${dayStr} 19:00`;
                }
              }
            }

            // Fallback if date parsing failed
            if (!eventStart) {
              const now = new Date();
              eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
              logger.warn(`Date parsing failed for ${eventData.opponent}, using current date`);
            }
          } catch (dateError) {
            const now = new Date();
            eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
            logger.warn(`Date parsing error for ${eventData.opponent}: ${dateError}`);
          }

          // Create the event
          const sourceEventId = `${eventData.date}#${eventData.opponent}#${eventData.time}`;

          const event: RawEvent = {
            sourceEventId: sourceEventId,
            title: `${eventData.sport} ${eventData.atVs} ${eventData.opponent}`,
            start: eventStart,
            city: 'Prince George',
            region: 'British Columbia',
            country: 'Canada',
            organizer: 'UNBC Timberwolves Athletics',
            category: 'Sports',
            url: this.startUrls[0],
            raw: {
              sport: eventData.sport,
              opponent: eventData.opponent,
              atVs: eventData.atVs,
              location: eventData.location,
              time: eventData.time,
              isHome: eventData.isHome,
              extractedAt: new Date().toISOString(),
            },
          };

          if (eventData.location) {
            if (eventData.isHome) {
              event.venueName = 'UNBC Campus';
              event.venueAddress = 'Prince George, BC';
            } else {
              event.venueName = eventData.location;
              event.venueAddress = eventData.location;
            }
          }

          if (eventData.ticketUrl) {
            event.ticketUrl = eventData.ticketUrl;
          }

          events.push(event);
          logger.info(`Created event: ${event.title} on ${eventData.date}`);

        } catch (eventError) {
          logger.warn(`Failed to process event ${eventData.opponent}: ${eventError}`);
          
          // Create minimal fallback event
          const now = new Date();
          const fallbackStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
          const fallbackEvent: RawEvent = {
            sourceEventId: `${eventData.date}#${eventData.opponent}#${eventData.time}`,
            title: `${eventData.sport} ${eventData.atVs} ${eventData.opponent}`,
            start: fallbackStart,
            city: 'Prince George',
            region: 'British Columbia',
            country: 'Canada',
            organizer: 'UNBC Timberwolves Athletics',
            url: this.startUrls[0],
            raw: {
              error: 'Failed to process event details',
              extractedAt: new Date().toISOString(),
              originalEventData: eventData,
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

  async parseCSVContent(csvContent: string, logger: any): Promise<RawEvent[]> {
    const events: RawEvent[] = [];
    
    try {
      // Split CSV into lines and skip header
      const lines = csvContent.split('\n').filter(line => line.trim());
      if (lines.length <= 1) {
        logger.warn('CSV appears to be empty or only contains header');
        return events;
      }
      
      // Skip header row
      const dataLines = lines.slice(1);
      
      for (const line of dataLines) {
        try {
          // Parse CSV line - handle quoted fields
          const fields = this.parseCSVLine(line);
          
          if (fields.length < 8) {
            logger.warn(`Skipping malformed CSV line: ${line}`);
            continue;
          }
          
          // Map CSV fields based on the format you described:
          // Event, Start Date, Start Time, End Date, End Time, Location, Category, Description, Facility
          const [eventTitle, startDate, startTime, endDate, endTime, location, category, description, facility] = fields;
          
          if (!eventTitle || !startDate) {
            continue;
          }
          
          // Parse start date and time - preserve local time without timezone conversion
          let eventStart = '';
          let eventEnd = '';
          
          try {
            // Parse start date and time by constructing explicit UTC date that preserves the local time
            if (startDate && startTime) {
              const parsedDate = new Date(startDate);
              if (!isNaN(parsedDate.getTime())) {
                // Parse time string (e.g., "7:00PM", "10:00 PM")
                let hours = 0;
                let minutes = 0;
                
                const timeMatch = startTime.match(/^(\d+):?(\d*)\s*(AM|PM)$/i);
                if (timeMatch) {
                  hours = parseInt(timeMatch[1]);
                  minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                  const isPM = timeMatch[3].toUpperCase() === 'PM';
                  
                  // Convert to 24-hour format
                  if (isPM && hours !== 12) hours += 12;
                  if (!isPM && hours === 12) hours = 0;
                }
                
                // Create UTC date with the exact local time values (no timezone conversion)
                const eventDate = new Date(Date.UTC(
                  parsedDate.getFullYear(),
                  parsedDate.getMonth(),
                  parsedDate.getDate(),
                  hours,
                  minutes,
                  0,
                  0
                ));
                
                eventStart = eventDate.toISOString();
                logger.debug(`Parsed start time for ${eventTitle}: ${startDate} ${startTime} -> ${eventStart}`);
              }
            }
            
            if (!eventStart && startDate) {
              // Fallback to date-only
              const dateOnly = new Date(startDate);
              if (!isNaN(dateOnly.getTime())) {
                eventStart = new Date(Date.UTC(
                  dateOnly.getFullYear(),
                  dateOnly.getMonth(),
                  dateOnly.getDate(),
                  0, 0, 0, 0
                )).toISOString();
                logger.warn(`Using date-only for ${eventTitle}: ${startDate}`);
              }
            }
            
            if (!eventStart) {
              logger.warn(`Could not parse start date for event: ${eventTitle}`);
              continue;
            }
            
            // Parse end date and time if provided
            if (endDate && endTime) {
              const parsedEndDate = new Date(endDate);
              if (!isNaN(parsedEndDate.getTime())) {
                const endYear = parsedEndDate.getFullYear();
                const endMonth = (parsedEndDate.getMonth() + 1).toString().padStart(2, '0');
                const endDay = parsedEndDate.getDate().toString().padStart(2, '0');
                
                const endTimeMatch = endTime.match(/^(\d+):?(\d*)\s*(AM|PM)$/i);
                if (endTimeMatch) {
                  let endHours = parseInt(endTimeMatch[1]);
                  const endMinutes = endTimeMatch[2] ? parseInt(endTimeMatch[2]) : 0;
                  const isEndPM = endTimeMatch[3].toUpperCase() === 'PM';
                  
                  // Convert to 24-hour format
                  if (isEndPM && endHours !== 12) endHours += 12;
                  if (!isEndPM && endHours === 12) endHours = 0;
                  
                  eventEnd = `${endYear}-${endMonth}-${endDay} ${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
                  logger.debug(`Parsed end time for ${eventTitle}: ${endDate} ${endTime} -> ${eventEnd}`);
                }
              }
            } else if (endTime && startDate) {
              // Use start date with end time
              const parsedDate = new Date(startDate);
              if (!isNaN(parsedDate.getTime())) {
                const year = parsedDate.getFullYear();
                const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
                const day = parsedDate.getDate().toString().padStart(2, '0');
                
                const endTimeMatch = endTime.match(/^(\d+):?(\d*)\s*(AM|PM)$/i);
                if (endTimeMatch) {
                  let endHours = parseInt(endTimeMatch[1]);
                  const endMinutes = endTimeMatch[2] ? parseInt(endTimeMatch[2]) : 0;
                  const isEndPM = endTimeMatch[3].toUpperCase() === 'PM';
                  
                  if (isEndPM && endHours !== 12) endHours += 12;
                  if (!isEndPM && endHours === 12) endHours = 0;
                  
                  // Check if end time is before start time (indicates next day)
                  if (startTime) {
                    const startTimeMatch = startTime.match(/^(\d+):?(\d*)\s*(AM|PM)$/i);
                    if (startTimeMatch) {
                      let startHours = parseInt(startTimeMatch[1]);
                      const isStartPM = startTimeMatch[3].toUpperCase() === 'PM';
                      if (isStartPM && startHours !== 12) startHours += 12;
                      if (!isStartPM && startHours === 12) startHours = 0;
                      
                      if (endHours < startHours) {
                        // End time is next day
                        const nextDay = new Date(parsedDate);
                        nextDay.setDate(nextDay.getDate() + 1);
                        const nextDayNum = nextDay.getDate().toString().padStart(2, '0');
                        const nextMonth = (nextDay.getMonth() + 1).toString().padStart(2, '0');
                        const nextYear = nextDay.getFullYear();
                        eventEnd = `${nextYear}-${nextMonth}-${nextDayNum} ${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
                        logger.debug(`Parsed end time (next day) for ${eventTitle}`);
                      } else {
                        eventEnd = `${year}-${month}-${day} ${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
                        logger.debug(`Parsed end time (same day) for ${eventTitle}`);
                      }
                    } else {
                      eventEnd = `${year}-${month}-${day} ${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
                    }
                  } else {
                    eventEnd = `${year}-${month}-${day} ${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
                  }
                }
              }
            }
          } catch (dateError) {
            logger.warn(`Date parsing error for ${eventTitle}: ${dateError}`);
            continue;
          }
          
          // Extract sport and opponent from event title
          let sport = category || 'Athletic Event';
          let opponent = '';
          let atVs = '';
          
          // Try to parse "Sport vs/@ Opponent" pattern
          const vsMatch = eventTitle.match(/^(.+?)\s+(vs|@|at)\s+(.+)$/i);
          if (vsMatch) {
            sport = vsMatch[1].trim();
            atVs = vsMatch[2].toLowerCase() === 'vs' ? 'vs' : 'at';
            opponent = vsMatch[3].trim();
          } else {
            opponent = eventTitle;
          }
          
          const sourceEventId = `csv_${startDate}_${eventTitle.replace(/[^a-zA-Z0-9]/g, '_')}`;
          
          // Parse city and region from location using regex pattern
          // Matches patterns like "City, Province" or "City Name, AB" or "Multi Word City, B.C."
          let eventCity = 'Prince George'; // Default fallback
          let eventRegion = 'British Columbia';
          
          if (location) {
            // Regex to match "City, Province/State" format with optional periods and spaces
            const locationMatch = location.match(/^(.+?),\s*([A-Z]{2}\.?|[A-Z][a-z\s]+)$/);
            
            if (locationMatch) {
              eventCity = locationMatch[1].trim();
              const regionPart = locationMatch[2].trim();
              
              // Map common Canadian province abbreviations to full names
              const provinceMap: Record<string, string> = {
                'BC': 'British Columbia',
                'B.C.': 'British Columbia', 
                'AB': 'Alberta',
                'ON': 'Ontario',
                'QC': 'Quebec',
                'SK': 'Saskatchewan',
                'MB': 'Manitoba',
                'NB': 'New Brunswick',
                'NS': 'Nova Scotia',
                'PE': 'Prince Edward Island',
                'NL': 'Newfoundland and Labrador',
                'YT': 'Yukon',
                'NT': 'Northwest Territories',
                'NU': 'Nunavut'
              };
              
              eventRegion = provinceMap[regionPart] || regionPart;
            } else {
              // If regex doesn't match, assume the entire location is the city
              eventCity = location.trim();
            }
          }

          const event: RawEvent = {
            sourceEventId,
            title: eventTitle,
            start: eventStart,
            city: eventCity,
            region: eventRegion, 
            country: 'Canada',
            organizer: 'UNBC Timberwolves Athletics',
            category: 'Sports',
            url: this.startUrls[0],
            raw: {
              sport,
              opponent,
              atVs,
              location,
              startDate,
              startTime,
              endDate,
              endTime,
              category,
              description,
              facility,
              extractedAt: new Date().toISOString(),
              source: 'csv_export'
            },
          };
          
          // Add end time if parsed successfully
          if (eventEnd) {
            event.end = eventEnd;
            logger.debug(`Set end time for ${eventTitle}: ${eventEnd}`);
          }
          
          // Set venue information using facility as venue name and location as address
          if (facility) {
            event.venueName = facility;
            event.venueAddress = location || `${eventCity}, ${eventRegion}`;
          } else if (location) {
            // If no facility specified, use location as venue name
            event.venueName = location;
            event.venueAddress = location;
          }
          
          events.push(event);
          logger.debug(`Parsed CSV event: ${eventTitle} on ${startDate}`);
          
        } catch (lineError) {
          logger.warn(`Error parsing CSV line: ${line} - ${lineError}`);
        }
      }
      
      logger.info(`Successfully parsed ${events.length} events from CSV`);
      return events;
      
    } catch (error) {
      logger.error(`Failed to parse CSV content: ${error}`);
      return events;
    }
  },
  
  async processUpload(content: string, format: 'csv' | 'json' | 'xlsx', logger: any): Promise<RawEvent[]> {
    if (format !== 'csv') {
      throw new Error(`Unsupported format: ${format}. Only CSV is supported.`);
    }
    
    logger.info('Processing uploaded CSV file for UNBC Timberwolves');
    const events = await this.parseCSVContent(content, logger);
    logger.info(`Processed ${events.length} events from uploaded CSV`);
    
    return events;
  },
  
  parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add final field
    result.push(current.trim());
    
    return result;
  },
};

export default unbcTimberwolvesModule;