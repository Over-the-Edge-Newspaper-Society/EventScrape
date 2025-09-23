import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

type CalendarEventLink = {
  url: string
  title: string
  time: string
  date: string
  dataStart?: string | null
  dataEnd?: string | null
  rawDateText?: string | null
};

const MONTH_PATTERN = /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)/i;

const toYMD = (date: Date): string => {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
};

const parseDateTimeRangeFromText = (text: string): { start?: string; end?: string } | null => {
  if (!text) return null;
  const normalized = text.replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  const monthMatch = normalized.match(new RegExp(`${MONTH_PATTERN.source}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`, 'i'));
  if (!monthMatch) {
    return null;
  }

  const datePartRaw = monthMatch[0].replace(/(\d)(st|nd|rd|th)/gi, '$1').replace(/\s{2,}/g, ' ').trim();
  const dateObj = new Date(datePartRaw);
  if (isNaN(dateObj.getTime())) {
    return null;
  }
  const dateYMD = toYMD(dateObj);

  const remainder = normalized.slice(normalized.indexOf(monthMatch[0]) + monthMatch[0].length).replace(/^[,\s-]+/, '');
  const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s*(?:[ap]\.??m\.?)?)(?:\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.??m\.?)?))?/i;
  const timeMatch = remainder.match(timeRangeRegex);

  const extractMeridiem = (value: string | null | undefined): 'am' | 'pm' | null => {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower.includes('am')) return 'am';
    if (lower.includes('pm')) return 'pm';
    return null;
  };

  const parseTime = (value: string | null | undefined, hint?: 'am' | 'pm'): string | null => {
    if (!value) return null;
    const cleaned = value.toLowerCase().replace(/\./g, '').trim();
    const meridiem = extractMeridiem(cleaned) || hint || null;
    const numbers = cleaned.replace(/[^0-9:]/g, '');
    if (!numbers) return null;
    const [h, m] = numbers.split(':');
    let hour = parseInt(h ?? '0', 10);
    const minute = parseInt(m ?? '0', 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  let startTime: string | null = null;
  let endTime: string | null = null;

  if (timeMatch) {
    const startRaw = timeMatch[1];
    const endRaw = timeMatch[2];
    const endMeridiem = extractMeridiem(endRaw);
    startTime = parseTime(startRaw, endMeridiem || extractMeridiem(startRaw));
    endTime = parseTime(endRaw, extractMeridiem(endRaw) || extractMeridiem(startRaw));
  }

  if (!startTime) {
    const singleTimeMatch = remainder.match(/(\d{1,2}(?::\d{2})?\s*(?:[ap]\.??m\.?))/i);
    if (singleTimeMatch) {
      startTime = parseTime(singleTimeMatch[1]);
    }
  }

  const result: { start?: string; end?: string } = {};
  if (startTime) {
    result.start = `${dateYMD} ${startTime}`;
  }
  if (endTime) {
    result.end = `${dateYMD} ${endTime}`;
  }

  if (!result.start) {
    // Default to noon if no time info is present
    result.start = `${dateYMD} 12:00`;
  }

  return result;
};

const princeGeorgeModule: ScraperModule = {
  key: 'prince_george_ca',
  label: 'City of Prince George Events',
  startUrls: [
    'https://www.princegeorge.ca/community-culture/events/events-calendar',
  ],
  paginationType: 'calendar',
  integrationTags: ['calendar'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    // Cache all series dates per URL so we can reuse for repeated calendar entries
    const seriesCache: Record<string, Array<{ start: string, end?: string }>> = {};
    const isTestMode = jobData?.testMode === true;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

    // Get date range from pagination options
    const { startDate, endDate } = ctx.jobData?.paginationOptions || {};
    let targetStartDate: Date;
    let targetEndDate: Date;

    if (startDate && endDate) {
      targetStartDate = new Date(startDate);
      targetEndDate = new Date(endDate);
      logger.info(`Scraping events from ${targetStartDate.toDateString()} to ${targetEndDate.toDateString()}`);
    } else {
      // Default to current month if no date range specified
      targetStartDate = new Date();
      targetStartDate.setDate(1); // First day of current month
      targetEndDate = new Date(targetStartDate);
      targetEndDate.setMonth(targetEndDate.getMonth() + 1);
      targetEndDate.setDate(0); // Last day of current month
      logger.info(`No date range specified, using current month: ${targetStartDate.toDateString()} to ${targetEndDate.toDateString()}`);
    }

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

      // Navigate through months to collect events in the specified date range
      const monthsToScrape = [];
      const currentDate = new Date(targetStartDate);
      currentDate.setDate(1); // Set to first day of month
      
      while (currentDate <= targetEndDate) {
        monthsToScrape.push({
          year: currentDate.getFullYear(),
          month: currentDate.getMonth(),
          monthName: currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        });
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      logger.info(`Need to scrape ${monthsToScrape.length} months: ${monthsToScrape.map(m => m.monthName).join(', ')}`);

      // Navigate to the start month first
      await this.navigateToMonth(page, logger, monthsToScrape[0].year, monthsToScrape[0].month);

      // Scrape each month
      for (const [index, monthInfo] of monthsToScrape.entries()) {
        logger.info(`Scraping month ${index + 1}/${monthsToScrape.length}: ${monthInfo.monthName}`);
        
        // Navigate to the specific month (if not already there)
        if (index > 0) {
          await this.navigateToMonth(page, logger, monthInfo.year, monthInfo.month);
        }

        // Extract events from this month
        const monthEvents = await this.extractEventsFromCurrentMonth(page, logger, targetStartDate, targetEndDate);
        events.push(...monthEvents);
        
        logger.info(`Found ${monthEvents.length} events in ${monthInfo.monthName}`);
      }

      logger.info(`Calendar pagination completed. Total events found: ${events.length}`);

      // Process events (visit detail pages for enhancement)
      const processedEvents = await this.processEventDetails(ctx, events, isTestMode, seriesCache);

      const pagesCrawledCount = ctx.stats?.pagesCrawled || 0;
      logger.info(`Scrape completed. Total events found: ${processedEvents.length}, Pages crawled: ${pagesCrawledCount}`);
      return processedEvents;

    } catch (error) {
      logger.error(`Scrape failed: ${error}`);
      throw error;
    }
  },

  async navigateToMonth(page: any, logger: any, targetYear: number, targetMonth: number): Promise<void> {
    // Get current month from calendar header
    const currentMonthText = await page.$eval('.fc-center h2', (el: HTMLElement) => el.textContent?.trim() || '');
    logger.info(`Current calendar month: ${currentMonthText}`);
    
    // Parse current month and year
    const currentDate = new Date(currentMonthText + ' 1');
    const currentYear = currentDate.getFullYear();
    const currentMonthIndex = currentDate.getMonth();
    
    const targetDate = new Date(targetYear, targetMonth, 1);
    logger.info(`Navigating from ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} to ${targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
    
    // Calculate how many months to navigate
    const monthsToNavigate = (targetYear - currentYear) * 12 + (targetMonth - currentMonthIndex);
    
    if (monthsToNavigate === 0) {
      logger.info('Already at target month');
      return;
    }
    
    const isForward = monthsToNavigate > 0;
    const buttonSelector = isForward ? '.fc-next-button' : '.fc-prev-button';
    const clicks = Math.abs(monthsToNavigate);
    
    logger.info(`Need to ${isForward ? 'forward' : 'backward'} navigate ${clicks} month${clicks === 1 ? '' : 's'}`);
    
    for (let i = 0; i < clicks; i++) {
      logger.info(`Navigation click ${i + 1}/${clicks}`);
      
      await page.waitForSelector(buttonSelector, { timeout: 5000 });
      await page.click(buttonSelector);
      await page.waitForTimeout(1000); // Wait for calendar to update
      
      // Verify navigation worked
      const newMonthText = await page.$eval('.fc-center h2', (el: HTMLElement) => el.textContent?.trim() || '');
      logger.info(`After click ${i + 1}: ${newMonthText}`);
    }
    
    // Final verification
    const finalMonthText = await page.$eval('.fc-center h2', (el: HTMLElement) => el.textContent?.trim() || '');
    const finalDate = new Date(finalMonthText + ' 1');
    
    if (finalDate.getFullYear() === targetYear && finalDate.getMonth() === targetMonth) {
      logger.info(`Successfully navigated to ${finalMonthText}`);
    } else {
      logger.warn(`Navigation may have failed. Expected: ${targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}, Got: ${finalMonthText}`);
    }
  },

  async extractEventsFromCurrentMonth(page: any, logger: any, startDate: Date, endDate: Date): Promise<CalendarEventLink[]> {
    // Check if events exist in month view first
    const monthViewEvents = await page.$$('.fc-event');
    logger.info(`Found ${monthViewEvents.length} events in month view`);
    
    let useListView = false;
    
    if (monthViewEvents.length === 0) {
      logger.info('No events in month view, trying list view...');
      const listButton = await page.$('.fc-listMonth-button');
      
      if (listButton) {
        logger.info('Switching to list view...');
        await listButton.click();
        await page.waitForTimeout(3000);
        
        try {
          await page.waitForSelector('.fc-list-table', { timeout: 10000 });
          useListView = true;
          logger.info('Successfully switched to list view');
        } catch (error) {
          logger.warn('List view did not load');
          useListView = false;
        }
      }
    }

    // Extract event links from current month
    const eventLinks = await page.evaluate((useListView) => {
      const links: any[] = [];
        
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
            
            const dataStart = (row as HTMLElement).getAttribute('data-start') || (linkEl as HTMLElement | null)?.getAttribute?.('data-start') || null;
            const dataEnd = (row as HTMLElement).getAttribute('data-end') || (linkEl as HTMLElement | null)?.getAttribute?.('data-end') || null;

            links.push({
              url: new URL(linkEl.href, window.location.origin).href,
              title: linkEl.textContent?.trim() || '',
              time: timeEl.textContent?.trim() || '',
              date: dateText,
              dataStart,
              dataEnd,
              rawDateText: dateHeading?.textContent?.trim() || null,
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
            const dayCell = actualLink.closest('[data-date]') || linkEl.closest('[data-date]');
            
            const dateAttr = dayCell?.getAttribute('data-date') || '';
            const rawDateText = (dayCell as HTMLElement | null)?.textContent?.trim() || null;
            
            // Use the raw date attribute for easier parsing
            let dateText = dateAttr;
            const dataStart = (actualLink as HTMLElement).getAttribute('data-start') || (actualLink as HTMLElement).getAttribute('data-date') || null;
            const dataEnd = (actualLink as HTMLElement).getAttribute('data-end') || null;

            if (!dateText && dateAttr) {
              // Fallback to formatted date if data-date is empty but attribute exists
              const dateObj = new Date(dateAttr);
              if (!isNaN(dateObj.getTime())) {
                dateText = dateObj.toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                });
              }
            }
            if (!dateText && dataStart) {
              const startObj = new Date(dataStart);
              if (!isNaN(startObj.getTime())) {
                dateText = `${startObj.getFullYear()}-${(startObj.getMonth() + 1).toString().padStart(2, '0')}-${startObj.getDate().toString().padStart(2, '0')}`;
              }
            }
            
            // Debug: log what we found
            if (!dateText) {
              console.log(`DEBUG: No date for event ${titleEl.textContent?.trim()}, dateAttr: "${dateAttr}", dayCell:`, dayCell);
            }
            
            links.push({
              url: new URL(actualLink.href, window.location.origin).href,
              title: titleEl.textContent?.trim() || '',
              time: timeEl?.textContent?.trim() || '',
              date: dateText,
              dataStart,
              dataEnd,
              rawDateText,
            });
          }
        });
      }
      
      return links;
    }, useListView);

    // Filter events by date range if specified (more lenient filtering)
    const filteredEvents = eventLinks.filter(event => {
      if (!startDate || !endDate) return true;
      
      try {
        let eventDate: Date;
        if (event.date) {
          // Parse the date from the event - handle various formats
          if (event.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // ISO format: "2025-11-15"
            eventDate = new Date(event.date + 'T00:00:00');
          } else {
            // Try parsing as natural language date
            eventDate = new Date(event.date);
          }
          
          if (isNaN(eventDate.getTime())) {
            logger.warn(`Could not parse date for event: ${event.title}, date: ${event.date}`);
            return true; // Include events we can't parse rather than exclude them
          }
        } else {
          logger.warn(`Event has no date: ${event.title}`);
          return true; // Include events without dates rather than exclude them
        }
        
        // Create date-only comparison (ignore time)
        const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        
        const isInRange = eventDateOnly >= startDateOnly && eventDateOnly <= endDateOnly;
        
        if (!isInRange) {
          logger.debug(`Event ${event.title} (${event.date}) is outside date range ${startDate.toDateString()} - ${endDate.toDateString()}`);
        }
        
        return isInRange;
      } catch (error) {
        logger.warn(`Error filtering event: ${event.title}, date: ${event.date}, error: ${error}`);
        return true; // Include problematic events rather than exclude them
      }
    });

    logger.info(`Extracted ${eventLinks.length} events, ${filteredEvents.length} within date range (${startDate.toDateString()} - ${endDate.toDateString()})`);
    return filteredEvents;
  },

  async processEventDetails(ctx: RunContext, eventLinks: CalendarEventLink[], isTestMode: boolean, seriesCache: Record<string, Array<{ start: string, end?: string }>>): Promise<RawEvent[]> {
    const { page, logger } = ctx;
    const events: RawEvent[] = [];
    
    // In test mode, only process the first event
    const eventsToProcess = isTestMode ? eventLinks.slice(0, 1) : eventLinks;
    logger.info(`Processing ${eventsToProcess.length} event${eventsToProcess.length === 1 ? '' : 's'}${isTestMode ? ' (test mode)' : ''}`);

    // Track visited URLs to avoid duplicates
    const visitedUrls = new Set<string>();
    
    for (const [index, eventLink] of eventsToProcess.entries()) {
      try {
        logger.info(`Processing calendar event ${index + 1}/${eventsToProcess.length}: ${eventLink.title}`);
        
        // Create base event from calendar data first
        let eventStart = '';
        let eventEnd: string | undefined;
        try {
          if (eventLink.dataStart) {
            eventStart = eventLink.dataStart;
            logger.info(`Using data-start attribute for event start: ${eventStart}`);
            if (eventLink.dataEnd) {
              eventEnd = eventLink.dataEnd;
            }
          } else if (eventLink.date && eventLink.time) {
            // Parse the date and time properly
            const dateStr = eventLink.date; // e.g., "2025-11-15" or "Sunday, November 15, 2025"
            const timeStr = eventLink.time; // e.g., "11a" or "4:00pm - 7:00pm"
            
            // Extract the start time from time ranges like "4:00pm - 7:00pm"
            let startTime = timeStr;
            let endTime = null;
            if (timeStr.includes(' - ')) {
              const parts = timeStr.split(' - ');
              startTime = parts[0].trim();
              endTime = parts[1]?.trim();
            }
            
            // Normalize time format: "11a" -> "11:00", "4:00pm" -> "16:00"
            const normalizeTimeToString = (time: string): string => {
              if (/^\d+[ap]$/i.test(time)) {
                // Handle "11a" format
                const hour = parseInt(time.slice(0, -1));
                const isPM = time.slice(-1).toLowerCase() === 'p';
                const hour24 = isPM && hour !== 12 ? hour + 12 : (!isPM && hour === 12 ? 0 : hour);
                return `${hour24.toString().padStart(2, '0')}:00`;
              } else if (/^\d+:\d+\s*[ap]m?$/i.test(time)) {
                // Handle "4:00pm" format
                const match = time.match(/(\d+):(\d+)\s*([ap])m?/i);
                if (match) {
                  const hour = parseInt(match[1]);
                  const min = match[2];
                  const isPM = match[3].toLowerCase() === 'p';
                  const hour24 = isPM && hour !== 12 ? hour + 12 : (!isPM && hour === 12 ? 0 : hour);
                  return `${hour24.toString().padStart(2, '0')}:${min}`;
                }
              }
              return '19:00'; // Default to 7 PM if parsing fails
            };
            
            const startTimeNormalized = normalizeTimeToString(startTime);
            
            // Parse the date
            let dateOnlyStr = dateStr;
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
              // Already in YYYY-MM-DD format
              dateOnlyStr = dateStr;
            } else {
              // Try to parse natural language date
              const tempDate = new Date(dateStr);
              if (!isNaN(tempDate.getTime())) {
                dateOnlyStr = `${tempDate.getFullYear()}-${(tempDate.getMonth() + 1).toString().padStart(2, '0')}-${tempDate.getDate().toString().padStart(2, '0')}`;
              }
            }
            
            // Create date string in format that normalizeEvent will parse correctly
            // This will be parsed as Pacific time by normalizeEvent
            eventStart = `${dateOnlyStr} ${startTimeNormalized}`;
            logger.info(`Created event start time: ${eventStart} from date: "${dateStr}" and time: "${timeStr}"`);
            
            // Handle end time if available
            if (endTime) {
              const endTimeNormalized = normalizeTimeToString(endTime);
              eventEnd = `${dateOnlyStr} ${endTimeNormalized}`;
              logger.info(`Created event end time: ${eventEnd}`);
            }
          }
          // Fallback to current date if parsing fails
          if (!eventStart && eventLink.dataStart) {
            eventStart = eventLink.dataStart;
          }

          if (!eventStart) {
            const now = new Date();
            eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
            logger.warn(`Using current date as fallback for event: ${eventLink.title}`);
          }
        } catch (dateError) {
          const now = new Date();
          eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
          logger.warn(`Date parsing failed for ${eventLink.title}, using current date`);
        }

        // Create unique sourceEventId combining URL and calendar date
        const calendarDateString = eventLink.date || new Date(eventStart).toDateString();
        const sourceEventId = `${eventLink.url}#${calendarDateString}`;

        // Base event from calendar data
        const baseEvent: RawEvent = {
          sourceEventId: sourceEventId,
          title: eventLink.title || 'Untitled Event',
          start: eventStart,
          end: eventEnd,
          city: 'Prince George',
          region: 'British Columbia', 
          country: 'Canada',
          organizer: 'City of Prince George',
          category: 'Community Event',
          url: eventLink.url,
          raw: {
            calendarTime: eventLink.time,
            calendarDate: eventLink.date,
            extractedAt: new Date().toISOString(),
            originalEventLink: eventLink,
            sourcePageUrl: eventLink.url,
          },
        };

        // Helper to normalize a calendar date string to YYYY-MM-DD
        const normalizeToYMD = (d: string): string | null => {
          try {
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
            const tmp = new Date(d);
            if (isNaN(tmp.getTime())) return null;
            return `${tmp.getFullYear()}-${(tmp.getMonth() + 1).toString().padStart(2, '0')}-${tmp.getDate().toString().padStart(2, '0')}`;
          } catch {
            return null;
          }
        };

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
            if (ctx.stats) ctx.stats.pagesCrawled++; // Count each event detail page

            // Extract enhancement data from detail page
            const enhancementData = await page.evaluate(() => {
              // Extract event types
              const eventTypeEl = document.querySelector('.field--name-field-types .field__item');
              const communityTypeEl = document.querySelector('.field--name-field-types2 .field__item');
              const eventType = eventTypeEl?.textContent?.trim();
              const communityType = communityTypeEl?.textContent?.trim();

              // Extract location
              const locationEl = document.querySelector('.field--name-field-contact-information .field__item');
              const location = locationEl?.textContent?.trim();

              // Extract description from the main body field
              // Try multiple selectors to handle different page structures
              const descriptionEl = document.querySelector('.field--name-body.field--type-text-with-summary .field__item') || 
                                  document.querySelector('.field--name-body .field__item') ||
                                  document.querySelector('.field--name-body.field--type-text-with-summary') ||
                                  document.querySelector('.field--name-body');
              const description = descriptionEl?.innerHTML?.trim();

              // Extract image
              const imageEl = document.querySelector('.field--name-field-media-image img') as HTMLImageElement;
              const imageUrl = imageEl?.src;

              // Extract ALL date instances (series) from the when field
              const dateItems = Array.from(document.querySelectorAll('.field--name-field-when .field__item')) as HTMLElement[];
              const dates: Array<{ start?: string | null; end?: string | null; rawText?: string | null }> = [];
              dateItems.forEach(item => {
                const times = item.querySelectorAll('time[datetime]');
                const textContent = item.textContent?.replace(/\s+/g, ' ').trim() || null;
                if (times.length >= 1) {
                  const start = times[0].getAttribute('datetime');
                  const endAttr = times[1]?.getAttribute('datetime') || null;
                  dates.push({ start: start || null, end: endAttr, rawText: textContent });
                } else if (textContent) {
                  dates.push({ start: null, end: null, rawText: textContent });
                }
              });

              return {
                eventType,
                communityType,
                location,
                description,
                imageUrl,
                // Backward compatibility fields
                startDateTime: dates.find(d => d.start)?.start || null,
                endDateTime: dates.find(d => d.end)?.end || null,
                dates,
              };
            });
            const rawSeries = Array.isArray(enhancementData.dates)
              ? (enhancementData.dates as Array<{ start?: string | null; end?: string | null; rawText?: string | null }>)
              : [];

            const normalizedSeries = rawSeries.map(entry => {
              if (entry?.start) {
                return { start: entry.start, end: entry.end ?? undefined, rawText: entry.rawText ?? null };
              }
              if (entry?.rawText) {
                const parsed = parseDateTimeRangeFromText(entry.rawText);
                if (parsed?.start) {
                  return { start: parsed.start, end: parsed.end, rawText: entry.rawText };
                }
              }
              return { start: null, end: null, rawText: entry?.rawText ?? null };
            });

            const validSeries = normalizedSeries.filter(item => Boolean(item.start)) as Array<{ start: string; end?: string; rawText?: string | null }>;

            if (validSeries.length) {
              seriesCache[eventLink.url] = validSeries.map(({ start, end }) => ({ start, end }));
            }

            // Prefer matching the series instance to the calendar date
            const eventDateYMD = normalizeToYMD(eventLink.date) || normalizeToYMD(eventLink.dataStart || '');
            if (eventDateYMD && validSeries.length) {
              const match = validSeries.find(d => {
                const datePart = d.start.includes('T') ? d.start.split('T')[0] : d.start.split(' ')[0];
                return datePart === eventDateYMD;
              });
              if (match) {
                baseEvent.start = match.start;
                baseEvent.end = match.end;
                logger.info(`Matched series date ${eventDateYMD} from detail page for ${eventLink.title}`);
              } else if (!enhancementData.startDateTime && validSeries[0]) {
                baseEvent.start = validSeries[0].start;
                baseEvent.end = validSeries[0].end;
                logger.info(`No exact series match; using first series instance for ${eventLink.title}`);
              }
            } else {
              // Fallback: single start/end override
              if (enhancementData.startDateTime) baseEvent.start = enhancementData.startDateTime;
              if (enhancementData.endDateTime) baseEvent.end = enhancementData.endDateTime;
            }

            // Enhance the base event with detail page data
            const categories = [enhancementData.eventType, enhancementData.communityType]
              .filter(Boolean) as string[];

            if (categories.length > 0) {
              baseEvent.category = categories[0];
            }
            
            if (categories.length > 1) {
              baseEvent.tags = categories.slice(1);
            }

            if (enhancementData.description) {
              baseEvent.descriptionHtml = enhancementData.description;
            }
            
            if (enhancementData.location) {
              // Parse location to separate venue name and address
              let locationText = enhancementData.location.trim();
              
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
                baseEvent.venueName = locationLines[0];
                baseEvent.venueAddress = locationLines.slice(1).join(', ').trim();
              } else if (locationLines.length === 1) {
                // Single line - try to separate venue name from address
                const singleLine = locationLines[0];
                
                // Look for patterns like "VenueName123Address" where venue ends before a number
                const match = singleLine.match(/^(.+?)(\d+.*)$/);
                if (match) {
                  baseEvent.venueName = match[1].trim();
                  baseEvent.venueAddress = match[2].trim();
                } else {
                  // Can't separate, put entire text as venue name
                  baseEvent.venueName = singleLine;
                }
              }
            }
            
            if (enhancementData.imageUrl) {
              baseEvent.imageUrl = new URL(enhancementData.imageUrl, eventLink.url).href;
            }

            // Add enhancement data to raw
            baseEvent.raw = {
              ...baseEvent.raw,
              eventType: enhancementData.eventType,
              communityType: enhancementData.communityType,
              fullDescription: enhancementData.description,
              detailPageStartDateTime: enhancementData.startDateTime,
              detailPageEndDateTime: enhancementData.endDateTime,
              seriesDates: validSeries,
              seriesDatesRaw: rawSeries,
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
          logger.info(`Detail page already processed, using calendar data only: ${eventLink.url}`);
          // If we cached series dates for this URL, align this instance to the correct date
          const eventDateYMD = normalizeToYMD(eventLink.date) || normalizeToYMD(eventLink.dataStart || '');
          const series = seriesCache[eventLink.url];
          if (eventDateYMD && series?.length) {
            const match = series.find(d => {
              const datePart = d.start.includes('T') ? d.start.split('T')[0] : d.start.split(' ')[0];
              return datePart === eventDateYMD;
            });
            if (match) {
              baseEvent.start = match.start;
              baseEvent.end = match.end;
              logger.info(`Applied cached series match for ${eventLink.title} on ${eventDateYMD}`);
            }
            baseEvent.raw.seriesDates = series;
          }
          baseEvent.raw = {
            ...baseEvent.raw,
            enhancedFromDetailPage: false,
            note: 'Detail page already processed for another calendar entry',
          };
        }

        events.push(baseEvent);
        logger.info(`Created calendar event: ${eventLink.title} on ${eventLink.date}`);

      } catch (eventError) {
        logger.warn(`Failed to process calendar event ${eventLink.title}: ${eventError}`);
        
        // Create minimal fallback event
        const now = new Date();
        const fallbackStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
        const fallbackEvent: RawEvent = {
          sourceEventId: `${eventLink.url}#${eventLink.date || new Date().toDateString()}`,
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
            error: 'Failed to process calendar event',
            extractedAt: new Date().toISOString(),
            sourcePageUrl: eventLink.url,
          },
        };
        
        events.push(fallbackEvent);
      }
    }

    return events;
  },
};

export default princeGeorgeModule;
