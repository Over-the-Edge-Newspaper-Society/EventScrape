import { chromium } from 'playwright';

async function testSpookyChicken() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Testing Spooky Chicken event...');
    
    // Navigate directly to the event page
    await page.goto('https://downtownpg.com/events/3rd-annual-spooky-chicken-soiree/', { 
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
        startTime: startTimeText,
        endTime: endTimeText,
        timeElementFound: !!timeRangeEl,
        timeElementHtml: timeRangeEl?.outerHTML || 'Not found',
        pageUrl: window.location.href,
        // Get all the date/time content for debugging
        fullDateTimeHTML: document.querySelector('.mec-event-info-desktop')?.innerHTML || 'Not found'
      };
    });

    console.log('\n=== Spooky Chicken Event Details ===');
    console.log(JSON.stringify(eventDetails, null, 2));
    
    // Create the date string like our scraper would
    if (eventDetails.structuredEventData && eventDetails.structuredEventData.startDate) {
      const { startDate } = eventDetails.structuredEventData;
      const startDateMatch = startDate.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (startDateMatch) {
        const [, year, month, day] = startDateMatch;
        
        let hour = 9, minute = 0; // Default
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
        
        const eventStartString = `${year}-${String(parseInt(month)).padStart(2, '0')}-${String(parseInt(day)).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        console.log('\n=== Generated Event Start String ===');
        console.log('Event Start:', eventStartString);
        
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
            
            let endDay = parseInt(day);
            if (endHour < hour) {
              endDay += 1;
            }
            
            const eventEndString = `${year}-${String(parseInt(month)).padStart(2, '0')}-${String(endDay).padStart(2, '0')} ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
            console.log('Event End:', eventEndString);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

testSpookyChicken();