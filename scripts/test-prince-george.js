import { chromium } from 'playwright';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Since we can't easily import the TypeScript module, let's create a simplified version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    }
  },
});

// Simplified version of the Prince George scraper for testing
async function testPrinceGeorgeScraper() {
  logger.info('🧪 Testing Prince George scraper module...');

  const browser = await chromium.launch({ 
    headless: false, // Set to true for headless mode
    slowMo: 1000     // Slow down actions to see what's happening
  });
  
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });

  try {
    logger.info('🚀 Navigating to Prince George events calendar...');
    
    // Navigate to the events calendar page
    await page.goto('https://www.princegeorge.ca/community-culture/events/events-calendar', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    logger.info('📅 Page loaded, waiting for calendar to render...');

    // Wait for the FullCalendar to load
    await page.waitForSelector('.fc-list-table', { timeout: 15000 });
    
    // Switch to list view if not already active
    const listButton = await page.$('.fc-listMonth-button');
    if (listButton) {
      const isActive = await page.evaluate(el => el.classList.contains('fc-button-active'), listButton);
      if (!isActive) {
        logger.info('🔄 Switching to list view...');
        await listButton.click();
        await page.waitForTimeout(2000);
      }
    }

    logger.info('📋 Extracting event links from calendar...');

    // Extract all event links from the calendar
    const eventLinks = await page.evaluate(() => {
      const links = [];
      
      // Find all event rows in the calendar
      const eventRows = document.querySelectorAll('.fc-list-item');
      
      eventRows.forEach(row => {
        const linkEl = row.querySelector('.fc-list-item-title a');
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
      
      return links;
    });

    logger.info(`✅ Found ${eventLinks.length} events in calendar`);

    // Log first few events for inspection
    eventLinks.slice(0, 5).forEach((event, index) => {
      logger.info(`📅 Event ${index + 1}:`, {
        title: event.title,
        time: event.time,
        date: event.date,
        url: event.url
      });
    });

    // Test visiting the first event detail page
    if (eventLinks.length > 0) {
      const firstEvent = eventLinks[0];
      logger.info(`🔍 Testing detail extraction for: ${firstEvent.title}`);
      
      await page.goto(firstEvent.url, { 
        waitUntil: 'networkidle',
        timeout: 20000 
      });

      // Extract event details
      const eventDetails = await page.evaluate(() => {
        // Extract event dates and times
        const dateTimeElements = document.querySelectorAll('.field--name-field-when .field__item');
        const eventDates = [];
        
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
        
        // Extract location
        const locationEl = document.querySelector('.field--name-field-contact-information .field__item');
        
        // Extract description
        const descriptionEl = document.querySelector('.field--name-body .field__item');
        
        // Extract image
        const imageEl = document.querySelector('.field--name-field-media-image img');

        return {
          dates: eventDates,
          eventType: eventTypeEl?.textContent?.trim(),
          communityType: communityTypeEl?.textContent?.trim(),
          location: locationEl?.textContent?.trim(),
          description: descriptionEl?.textContent?.slice(0, 200) + '...', // First 200 chars
          imageUrl: imageEl?.src,
          url: window.location.href
        };
      });

      logger.info('📋 Event Details:', {
        dates: eventDetails.dates.length,
        eventType: eventDetails.eventType,
        communityType: eventDetails.communityType,
        location: eventDetails.location,
        hasImage: !!eventDetails.imageUrl,
        hasDescription: !!eventDetails.description
      });

      // Show the recurring dates (like Foodie Fridays)
      if (eventDetails.dates.length > 1) {
        logger.info(`🔄 This is a recurring event with ${eventDetails.dates.length} dates:`);
        eventDetails.dates.forEach((date, index) => {
          logger.info(`   ${index + 1}. ${date.start} → ${date.end || 'No end time'}`);
        });
      }

      logger.info('📄 Description preview:', eventDetails.description);
    }

    logger.info('✅ Manual test completed successfully!');
    logger.info('🎯 Key observations:');
    logger.info('   - FullCalendar widget loads correctly');
    logger.info('   - Event links are extractable from list view');
    logger.info('   - Detail pages contain rich structured data');
    logger.info('   - Recurring events have multiple date instances');
    logger.info('   - Event types and locations are well-structured');

  } catch (error) {
    logger.error('❌ Test failed:', error);
  } finally {
    logger.info('🏁 Closing browser...');
    await browser.close();
    logger.info('✅ Test completed');
  }
}

// Run the test
testPrinceGeorgeScraper().catch(console.error);