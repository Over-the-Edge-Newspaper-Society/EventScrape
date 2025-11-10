import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import type { CalendarEventLink } from './types.js';
import { navigateToMonth, extractEventsFromCurrentMonth } from './utils/calendar.js';
import { processEventDetails } from './utils/event-processor.js';
import { extractPrinceGeorgeDetailPageData, normalizeSeriesEntries, parseDateTimeRangeFromText } from './utils/detail-page.js';


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
    const events: CalendarEventLink[] = [];
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
      await navigateToMonth(page, logger, monthsToScrape[0].year, monthsToScrape[0].month);

      // Scrape each month
      for (const [index, monthInfo] of monthsToScrape.entries()) {
        logger.info(`Scraping month ${index + 1}/${monthsToScrape.length}: ${monthInfo.monthName}`);
        
        // Navigate to the specific month (if not already there)
        if (index > 0) {
          await navigateToMonth(page, logger, monthInfo.year, monthInfo.month);
        }

        // Extract events from this month
        const monthEvents = await extractEventsFromCurrentMonth(page, logger, targetStartDate, targetEndDate);
        events.push(...monthEvents);
        
        logger.info(`Found ${monthEvents.length} events in ${monthInfo.monthName}`);
      }

      logger.info(`Calendar pagination completed. Total events found: ${events.length}`);

      // Process events (visit detail pages for enhancement)
      const processedEvents = await processEventDetails(ctx, events, isTestMode, seriesCache);

      const pagesCrawledCount = ctx.stats?.pagesCrawled || 0;
      logger.info(`Scrape completed. Total events found: ${processedEvents.length}, Pages crawled: ${pagesCrawledCount}`);
      return processedEvents;

    } catch (error) {
      logger.error(`Scrape failed: ${error}`);
      throw error;
    }
  },

};

export const __testables = {
  extractPrinceGeorgeDetailPageData,
  normalizeSeriesEntries,
  parseDateTimeRangeFromText,
};

export default princeGeorgeModule;
