#!/usr/bin/env tsx

import { chromium } from 'playwright';
import unbcModule from '../worker/src/modules/unbc_ca/index.js';
import type { RunContext } from '../worker/src/types.js';

async function testUnbcScraper() {
  console.log('🚀 Testing UNBC scraper...\n');

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
    console.log(`   Key: ${unbcModule.key}`);
    console.log(`   Label: ${unbcModule.label}`);
    console.log(`   Start URLs: ${unbcModule.startUrls.join(', ')}`);
    console.log('');

    const startTime = Date.now();
    const events = await unbcModule.run(context);
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
      console.log(`   Location: ${event.venueName || 'N/A'}`);
      console.log(`   URL: ${event.url}`);
      console.log(`   Organizer: ${event.organizer}`);
      console.log(`   Category: ${event.category}`);
      console.log(`   Tags: ${event.tags?.join(', ') || 'N/A'}`);
      console.log(`   Image: ${event.imageUrl ? 'Yes' : 'No'}`);
      console.log(`   Registration: ${event.ticketUrl ? 'Yes' : 'No'}`);
      
      if (event.raw) {
        console.log(`   Enhanced from detail page: ${event.raw.enhancedFromDetailPage ? 'Yes' : 'No'}`);
      }
      
      console.log('');
    }

    if (events.length === 0) {
      console.log('❌ No events found. This might indicate:');
      console.log('   - The website structure has changed');
      console.log('   - The website is blocking scrapers');
      console.log('   - Network issues or timeouts');
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
testUnbcScraper()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });