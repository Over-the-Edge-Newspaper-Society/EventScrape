#!/usr/bin/env tsx

import { chromium } from 'playwright';
import downtownPgModule from '../worker/src/modules/downtownpg_com/index.js';
import type { RunContext } from '../worker/src/types.js';

async function testDowntownPgScraper() {
  console.log('🚀 Testing Downtown Prince George scraper...\n');

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
    console.log(`   Key: ${downtownPgModule.key}`);
    console.log(`   Label: ${downtownPgModule.label}`);
    console.log(`   Start URLs: ${downtownPgModule.startUrls.join(', ')}`);
    console.log('');

    const startTime = Date.now();
    const events = await downtownPgModule.run(context);
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
        console.log(`   Source Event ID: ${event.sourceEventId}`);
        console.log(`   Has Structured Data: ${event.raw.structuredData ? 'Yes' : 'No'}`);
        console.log(`   Start Date: ${event.raw.startDate || 'N/A'}`);
        console.log(`   Start Time: ${event.raw.startTime || 'N/A'}`);
        console.log(`   End Time: ${event.raw.endTime || 'N/A'}`);
        
        if (event.raw.structuredData) {
          console.log(`   Structured Data Type: ${event.raw.structuredData['@type']}`);
          console.log(`   Location from JSON-LD: ${event.raw.structuredData.location?.name || 'N/A'}`);
        }
      }
      
      console.log('');
    }

    if (events.length === 0) {
      console.log('❌ No events found. This might indicate:');
      console.log('   - The MEC calendar structure has changed');
      console.log('   - The website is blocking scrapers');
      console.log('   - Network issues or timeouts');
      console.log('   - No events currently scheduled');
      console.log('   - JSON-LD structured data format changed');
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
testDowntownPgScraper()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });