const { chromium } = require('playwright');
const fs = require('fs');

async function testPrinceGeorgeScraper() {
  console.log('🔍 Testing Prince George scraper directly...');
  
  const browser = await chromium.launch({
    headless: false, // Run in visible mode for debugging
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-automation',
      '--no-sandbox',
    ]
  });

  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });

  try {
    console.log('📡 Navigating to Prince George events page...');
    
    await page.goto('https://www.princegeorge.ca/community-culture/events/events-calendar', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('✅ Page loaded successfully');
    
    // Wait for calendar to load
    console.log('⏳ Waiting for calendar container...');
    await page.waitForSelector('.fc-view-container', { timeout: 15000 });
    console.log('✅ Calendar container found');
    
    // Take a screenshot
    await page.screenshot({ path: 'prince-george-page.png', fullPage: true });
    console.log('📸 Screenshot saved as prince-george-page.png');
    
    // Check what's on the page
    const pageInfo = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        calendarExists: !!document.querySelector('.fc-view-container'),
        monthViewExists: !!document.querySelector('.fc-dayGridMonth-view'),
        listViewExists: !!document.querySelector('.fc-list-table'),
        eventElements: document.querySelectorAll('.fc-event').length,
        listItems: document.querySelectorAll('.fc-list-item').length,
        listButton: !!document.querySelector('.fc-listMonth-button'),
      };
    });
    
    console.log('📊 Page analysis:', JSON.stringify(pageInfo, null, 2));
    
    // Try to click list view button
    const listButton = await page.$('.fc-listMonth-button');
    if (listButton) {
      console.log('🔄 Switching to list view...');
      await listButton.click();
      await page.waitForTimeout(3000);
      
      // Take another screenshot
      await page.screenshot({ path: 'prince-george-list-view.png', fullPage: true });
      console.log('📸 List view screenshot saved');
      
      // Check list view
      const listViewInfo = await page.evaluate(() => {
        return {
          listTableExists: !!document.querySelector('.fc-list-table'),
          listItems: document.querySelectorAll('.fc-list-item').length,
          eventLinks: Array.from(document.querySelectorAll('.fc-list-item .fc-list-item-title a')).map(a => ({
            href: a.href,
            text: a.textContent?.trim()
          }))
        };
      });
      
      console.log('📋 List view analysis:', JSON.stringify(listViewInfo, null, 2));
    }
    
    // Extract events from month view
    console.log('🔍 Extracting events from month view...');
    const monthViewEvents = await page.evaluate(() => {
      const events = [];
      const eventElements = document.querySelectorAll('.fc-event');
      
      eventElements.forEach((eventEl, index) => {
        const linkEl = eventEl;
        if (!linkEl.href) return;
        
        const titleEl = linkEl.querySelector('.fc-title');
        const timeEl = linkEl.querySelector('.fc-time');
        
        if (titleEl) {
          // Get the date from the parent cell
          const dayCell = linkEl.closest('td[data-date]');
          const dateAttr = dayCell?.getAttribute('data-date') || '';
          
          events.push({
            index: index + 1,
            title: titleEl.textContent?.trim() || '',
            time: timeEl?.textContent?.trim() || '',
            date: dateAttr,
            url: linkEl.href
          });
        }
      });
      
      return events;
    });
    
    console.log(`🎯 Found ${monthViewEvents.length} events in month view:`);
    monthViewEvents.forEach((event, i) => {
      console.log(`  ${i + 1}. ${event.title} - ${event.time} on ${event.date}`);
    });
    
    if (monthViewEvents.length > 0) {
      console.log('🔗 Testing event detail page...');
      const firstEvent = monthViewEvents[0];
      
      await page.goto(firstEvent.url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.screenshot({ path: 'prince-george-event-detail.png', fullPage: true });
      console.log('📸 Event detail screenshot saved');
      
      const eventDetails = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          hasDateTimeField: !!document.querySelector('.field--name-field-when'),
          hasLocationField: !!document.querySelector('.field--name-field-contact-information'),
          hasDescriptionField: !!document.querySelector('.field--name-body'),
          hasImageField: !!document.querySelector('.field--name-field-media-image'),
          dateTimeElements: document.querySelectorAll('.field--name-field-when .field__item').length,
          timeElements: document.querySelectorAll('.field--name-field-when time[datetime]').length,
        };
      });
      
      console.log('📄 Event detail page analysis:', JSON.stringify(eventDetails, null, 2));
    }
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    
    // Take error screenshot
    try {
      await page.screenshot({ path: 'prince-george-error.png', fullPage: true });
      console.log('📸 Error screenshot saved');
    } catch (screenshotError) {
      console.log('Could not take error screenshot:', screenshotError.message);
    }
  } finally {
    console.log('🔄 Closing browser...');
    await browser.close();
  }
}

testPrinceGeorgeScraper().catch(console.error);