import { chromium } from 'playwright';
import downtownPgModule from './worker/src/modules/downtownpg_com/index.js';
import type { RunContext } from './worker/src/types.js';

async function testDowntownPgCrucible() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Testing Downtown PG scraper with Crucible event...');
    
    const ctx: RunContext = {
      page,
      logger: {
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
      },
      jobData: {
        testMode: true
      }
    };

    // Test by directly visiting the event page and extracting details
    console.log('Navigating to event page...');
    await page.goto('https://downtownpg.com/events/crucible-of-scorn-15th-anniversary-spooktacular/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    // Extract event details like the scraper does
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
        console.log('Found time text:', timeText);
        // Check if it's a time range like "5:00 pm - 11:00 pm"
        if (timeText.includes(' - ')) {
          const [start, end] = timeText.split(' - ').map(t => t.trim());
          startTimeText = start;
          endTimeText = end;
        } else {
          startTimeText = timeText;
        }
      }

      return {
        title,
        structuredEventData,
        startDate: startDateEl?.textContent?.trim(),
        endDate: endDateEl?.textContent?.trim(),
        startTime: startTimeText,
        endTime: endTimeText,
        timeElementFound: !!timeRangeEl,
        timeElementHtml: timeRangeEl?.outerHTML || 'Not found'
      };
    });

    console.log('\nExtracted event details:');
    console.log(JSON.stringify(eventDetails, null, 2));
    
    const events = []; // We'll create a mock event for testing
    
    console.log('\n=== Test Results ===');
    console.log(`Found ${events.length} events`);
    
    events.forEach((event, index) => {
      console.log(`\nEvent ${index + 1}:`);
      console.log(`Title: ${event.title}`);
      console.log(`Start: ${event.start}`);
      console.log(`End: ${event.end || 'No end time'}`);
      console.log(`Raw data:`, JSON.stringify(event.raw, null, 2));
    });
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

testDowntownPgCrucible();