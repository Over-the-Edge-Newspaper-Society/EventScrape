import { chromium } from 'playwright';
import pino from 'pino';

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

async function simplePrinceGeorgeTest() {
  logger.info('🧪 Simple Prince George website test...');

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 2000
  });
  
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });

  try {
    logger.info('🌐 Navigating to Prince George events calendar...');
    
    const response = await page.goto('https://www.princegeorge.ca/community-culture/events/events-calendar', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });

    logger.info(`📡 Response status: ${response.status()}`);

    if (response.status() !== 200) {
      logger.warn('⚠️ Page returned non-200 status');
    }

    // Wait for page to settle
    await page.waitForTimeout(5000);

    logger.info('🔍 Checking page content...');

    // Check what's actually on the page
    const title = await page.title();
    logger.info(`📄 Page title: ${title}`);

    // Look for any calendar-related elements
    const calendarElements = await page.evaluate(() => {
      const elements = {
        fullcalendarElements: document.querySelectorAll('[class*="fc-"]').length,
        listElements: document.querySelectorAll('[class*="list"]').length,
        eventElements: document.querySelectorAll('[class*="event"]').length,
        calendarContainer: !!document.querySelector('.js-drupal-fullcalendar'),
        fcListTable: !!document.querySelector('.fc-list-table'),
        anyTable: document.querySelectorAll('table').length,
        hasJavaScript: !!document.querySelector('script'),
        bodyContent: document.body.textContent?.includes('event') || false
      };
      
      // Also get a sample of the body text
      const bodyText = document.body.textContent?.slice(0, 500) || 'No body text';
      
      return { ...elements, bodyText };
    });

    logger.info('🧩 Page analysis:', calendarElements);

    // Take a screenshot for debugging
    await page.screenshot({ path: 'prince-george-debug.png', fullPage: true });
    logger.info('📸 Screenshot saved as prince-george-debug.png');

    // Wait a bit more for JavaScript to load
    logger.info('⏳ Waiting for JavaScript to load...');
    await page.waitForTimeout(10000);

    // Check again
    const afterWait = await page.evaluate(() => {
      return {
        fullcalendarElements: document.querySelectorAll('[class*="fc-"]').length,
        fcListTable: !!document.querySelector('.fc-list-table'),
        listButton: !!document.querySelector('.fc-listMonth-button'),
        eventItems: document.querySelectorAll('.fc-list-item').length,
        allClasses: Array.from(document.querySelectorAll('*')).map(el => el.className).filter(c => c && c.includes('fc')).slice(0, 10)
      };
    });

    logger.info('🔄 After waiting:', afterWait);

    if (afterWait.fcListTable) {
      logger.info('✅ Found FullCalendar list table!');
      
      // Try to extract some events
      const events = await page.evaluate(() => {
        const eventRows = document.querySelectorAll('.fc-list-item');
        return Array.from(eventRows).slice(0, 3).map(row => {
          const linkEl = row.querySelector('.fc-list-item-title a');
          const timeEl = row.querySelector('.fc-list-item-time');
          return {
            title: linkEl?.textContent?.trim() || 'No title',
            time: timeEl?.textContent?.trim() || 'No time',
            url: linkEl?.href || 'No URL'
          };
        });
      });

      logger.info('🎯 Sample events found:', events);
    } else {
      logger.warn('❌ FullCalendar not found - site might use different structure or require interaction');
    }

  } catch (error) {
    logger.error('❌ Test failed:', error.message);
  } finally {
    await page.waitForTimeout(5000); // Keep browser open to see result
    await browser.close();
    logger.info('✅ Test completed');
  }
}

simplePrinceGeorgeTest().catch(console.error);