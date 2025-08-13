import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const unbcTimberwolvesModule: ScraperModule = {
  key: 'unbctimberwolves_com',
  label: 'UNBC Timberwolves Athletics',
  startUrls: [
    'https://unbctimberwolves.com/calendar',
  ],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    const isTestMode = jobData?.testMode === true;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

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
      
      const maxMonths = isTestMode ? 1 : 3; // Scrape current + next 2 months
      
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
            // Look for next month navigation button
            const nextButton = await page.$('[data-bind*="nextMonth"], .sidearm-calendar-nav-next, .next-month');
            if (nextButton) {
              logger.info('Navigating to next month...');
              await nextButton.click();
              
              // Wait for calendar to update
              await page.waitForTimeout(3000);
              if (ctx.stats) ctx.stats.pagesCrawled++;
            } else {
              logger.warn('No next month button found, stopping navigation');
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
              const monthYear = `${dateParts[0]} ${dateParts[1]}`;
              const day = dateParts[2];
              
              if (eventData.time) {
                // Parse time like "5:30 PM"
                const combinedDateTime = `${monthYear} ${day} ${eventData.time}`;
                const dateObj = new Date(combinedDateTime);
                
                if (!isNaN(dateObj.getTime())) {
                  eventStart = dateObj.toISOString();
                }
              }
            }

            // Fallback if date parsing failed
            if (!eventStart) {
              eventStart = new Date().toISOString();
              logger.warn(`Date parsing failed for ${eventData.opponent}, using current date`);
            }
          } catch (dateError) {
            eventStart = new Date().toISOString();
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
          const fallbackEvent: RawEvent = {
            sourceEventId: `${eventData.date}#${eventData.opponent}#${eventData.time}`,
            title: `${eventData.sport} ${eventData.atVs} ${eventData.opponent}`,
            start: new Date().toISOString(),
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
};

export default unbcTimberwolvesModule;