import { chromium } from 'playwright';

async function debugPrinceGeorge() {
  console.log('🧪 Debugging Prince George website...');

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000
  });
  
  const page = await browser.newPage();

  try {
    console.log('🌐 Navigating to Prince George events calendar...');
    
    const response = await page.goto('https://www.princegeorge.ca/community-culture/events/events-calendar', { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });

    console.log(`📡 Response status: ${response.status()}`);

    // Wait for page to load
    await page.waitForTimeout(3000);

    const title = await page.title();
    console.log(`📄 Page title: ${title}`);

    // Check for calendar elements more thoroughly
    const analysis = await page.evaluate(() => {
      const results = {
        hasFullCalendar: document.querySelectorAll('[class*="fc-"]').length > 0,
        hasCalendarWidget: !!document.querySelector('.js-drupal-fullcalendar'),
        hasListTable: !!document.querySelector('.fc-list-table'),
        hasListItems: document.querySelectorAll('.fc-list-item').length,
        hasEventItems: document.querySelectorAll('[class*="event"]').length,
        allCalendarClasses: [],
        eventLinks: [],
        bodyTextSample: document.body.textContent?.slice(0, 200) || 'No text'
      };

      // Get all classes that contain 'fc' or 'event' or 'calendar'
      const allElements = document.querySelectorAll('*');
      const relevantClasses = new Set();
      allElements.forEach(el => {
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.split(' ');
          classes.forEach(cls => {
            if (cls.includes('fc') || cls.includes('event') || cls.includes('calendar')) {
              relevantClasses.add(cls);
            }
          });
        }
      });
      results.allCalendarClasses = Array.from(relevantClasses).slice(0, 20);

      // Look for any event links
      const links = document.querySelectorAll('a[href*="event"]');
      results.eventLinks = Array.from(links).slice(0, 5).map(a => ({
        text: a.textContent?.trim().slice(0, 50),
        href: a.href
      }));

      return results;
    });

    console.log('🔍 Initial analysis:', analysis);

    // If no calendar found yet, wait more and check for dynamic loading
    if (!analysis.hasFullCalendar && !analysis.hasListTable) {
      console.log('⏳ No calendar found, waiting for dynamic content...');
      
      // Wait for network to settle
      await page.waitForLoadState('networkidle');
      
      // Wait a bit more
      await page.waitForTimeout(10000);

      // Check again
      const secondAnalysis = await page.evaluate(() => {
        return {
          hasFullCalendar: document.querySelectorAll('[class*="fc-"]').length > 0,
          hasListTable: !!document.querySelector('.fc-list-table'),
          hasListItems: document.querySelectorAll('.fc-list-item').length,
          eventCount: document.querySelectorAll('.fc-list-item').length,
          viewButtons: !!document.querySelector('.fc-button-group'),
          monthButton: !!document.querySelector('.fc-dayGridMonth-button'),
          listButton: !!document.querySelector('.fc-listMonth-button'),
          scripts: document.querySelectorAll('script').length
        };
      });

      console.log('🔄 After waiting:', secondAnalysis);

      if (secondAnalysis.hasFullCalendar) {
        console.log('✅ FullCalendar found after waiting!');
        
        // Try clicking the list view button if needed
        if (secondAnalysis.listButton) {
          console.log('🔘 Clicking list view button...');
          await page.click('.fc-listMonth-button');
          await page.waitForTimeout(3000);
          
          const finalCheck = await page.evaluate(() => {
            const items = document.querySelectorAll('.fc-list-item');
            return {
              eventCount: items.length,
              sampleEvents: Array.from(items).slice(0, 3).map(item => {
                const title = item.querySelector('.fc-list-item-title')?.textContent?.trim();
                const time = item.querySelector('.fc-list-item-time')?.textContent?.trim();
                return { title, time };
              })
            };
          });
          
          console.log('🎯 Events found:', finalCheck);
          
          if (finalCheck.eventCount > 0) {
            console.log('🎉 SUCCESS! Found events in list view');
          }
        }
      } else {
        console.log('❌ Still no FullCalendar found');
        
        // Check if there might be an error or different structure
        const errorCheck = await page.evaluate(() => {
          return {
            hasErrorMessages: document.body.textContent?.toLowerCase().includes('error') || false,
            hasMaintenanceMessage: document.body.textContent?.toLowerCase().includes('maintenance') || false,
            hasAccessDenied: document.body.textContent?.toLowerCase().includes('access denied') || false,
            pageStructure: {
              hasMain: !!document.querySelector('main'),
              hasContent: !!document.querySelector('[class*="content"]'),
              hasRegions: document.querySelectorAll('[class*="region"]').length
            }
          };
        });
        
        console.log('🚨 Error check:', errorCheck);
      }
    }

    // Take final screenshot
    await page.screenshot({ path: 'prince-george-final-debug.png', fullPage: true });
    console.log('📸 Final screenshot saved');

    // Keep browser open for manual inspection
    console.log('🔍 Keeping browser open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
    console.log('✅ Debug completed');
  }
}

debugPrinceGeorge().catch(console.error);