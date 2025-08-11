#!/usr/bin/env tsx

import { chromium } from 'playwright';
import tourismPgModule from '../worker/src/modules/tourismpg_com/index.js';
import type { RunContext } from '../worker/src/types.js';

async function testTourismPgScraper() {
  console.log('🚀 Testing Tourism Prince George scraper...\n');

  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set up viewport and user agent
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });

    const stats = { pagesCrawled: 0 };
    
    const context: RunContext = {
      page,
      logger: {
        info: (msg: string, ...args: any[]) => console.log(`ℹ️  ${msg}`, ...args),
        warn: (msg: string, ...args: any[]) => console.log(`⚠️  ${msg}`, ...args),
        error: (msg: string, ...args: any[]) => console.log(`❌ ${msg}`, ...args),
      },
      jobData: { testMode: true }, // Test mode - only process first event
      stats,
    };

    console.log('📊 Scraper Info:');
    console.log(`   Key: ${tourismPgModule.key}`);
    console.log(`   Label: ${tourismPgModule.label}`);
    console.log(`   Start URLs: ${tourismPgModule.startUrls.join(', ')}`);
    console.log('');

    const startTime = Date.now();
    const events = await tourismPgModule.run(context);
    const endTime = Date.now();
    
    console.log('\n📈 Results:');
    console.log(`   Events found: ${events.length}`);
    console.log(`   Pages crawled: ${stats.pagesCrawled}`);
    console.log(`   Duration: ${((endTime - startTime) / 1000).toFixed(2)}s`);
    console.log('');

    if (events.length > 0) {
      console.log('📅 Sample Event:');
      const event = events[0];
      console.log(`   Title: ${event.title}`);
      console.log(`   Start: ${event.start}`);
      console.log(`   End: ${event.end || 'N/A'}`);
      console.log(`   Venue Name: ${event.venueName || 'N/A'}`);
      console.log(`   Venue Address: ${event.venueAddress || 'N/A'}`);
      console.log(`   URL: ${event.url}`);
      console.log(`   Organizer: ${event.organizer}`);
      console.log(`   Category: ${event.category}`);
      console.log(`   Ticket URL: ${event.ticketUrl || 'N/A'}`);
      console.log(`   Description: ${event.descriptionHtml ? 'Yes' : 'No'}`);
      
      if (event.raw) {
        console.log(`   Calendar Date: ${event.raw.calendarDate}`);
        console.log(`   Start Time: ${event.raw.startTime}`);
        console.log(`   End Time: ${event.raw.endTime}`);
        console.log(`   Location Parts: ${event.raw.locationParts?.length || 0} items`);
      }
      
      console.log('');
    }

    if (events.length === 0) {
      console.log('❌ No events found. This might indicate:');
      console.log('   - The JetEngine calendar structure has changed');
      console.log('   - The website is blocking scrapers');
      console.log('   - Network issues or timeouts');
      console.log('   - No events currently scheduled');
      console.log('');
    }

    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
testTourismPgScraper()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });