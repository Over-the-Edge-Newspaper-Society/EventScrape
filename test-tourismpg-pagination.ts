#!/usr/bin/env node

import { chromium } from 'playwright';
import tourismPgModule from './worker/src/modules/tourismpg_com/index.js';

async function testTourismPgPagination() {
  console.log('🚀 Testing Tourism PG with multi-month date range...');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Create mock context with date range spanning 3 months
  const ctx = {
    browser,
    page,
    sourceId: 'test-source-id',
    runId: 'test-run-id',
    source: {
      id: 'test-source-id',
      name: 'Tourism Prince George Events',
      baseUrl: 'https://tourismpg.com',
      moduleKey: 'tourismpg_com',
      defaultTimezone: 'America/Vancouver',
      rateLimitPerMin: 30,
    },
    logger: {
      info: (msg: string) => console.log(`ℹ️  ${msg}`),
      error: (msg: string) => console.log(`❌ ${msg}`),
      warn: (msg: string) => console.log(`⚠️  ${msg}`),
      debug: (msg: string) => console.log(`🐛 ${msg}`)
    },
    jobData: {
      testMode: false, // Important: set to false to test real pagination
      scrapeMode: 'full',
      paginationOptions: {
        type: 'calendar',
        startDate: '2025-08-18T07:00:00.000Z', // August 18, 2025
        endDate: '2025-11-18T07:59:59.999Z'     // November 18, 2025
      },
      sourceId: 'test-source-id',
      runId: 'test-run-id'
    },
    stats: {
      pagesCrawled: 0
    }
  };

  try {
    console.log('📊 Testing with date range: August 18, 2025 to November 18, 2025');
    
    const events = await tourismPgModule.run(ctx);
    
    console.log('\\n📈 Results:');
    console.log(`   Events found: ${events.length}`);
    console.log(`   Pages crawled: ${ctx.stats.pagesCrawled}`);
    
    if (events.length > 0) {
      console.log('\\n📅 Sample Events:');
      events.slice(0, 3).forEach((event, index) => {
        console.log(`   ${index + 1}. ${event.title}`);
        console.log(`      Start: ${event.start}`);
        console.log(`      Calendar Date: ${event.raw?.calendarDate}`);
      });
    }
    
    console.log('\\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testTourismPgPagination().catch(console.error);