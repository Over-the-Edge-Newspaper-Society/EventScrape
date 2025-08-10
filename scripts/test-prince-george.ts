#!/usr/bin/env tsx
import { chromium } from 'playwright';
import princeGeorgeModule from '../worker/src/modules/prince_george_ca/index.js';
import type { RunContext } from '../worker/src/types.js';
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

async function testPrinceGeorgeScraper() {
  logger.info('🧪 Testing Prince George scraper module...');

  const browser = await chromium.launch({ 
    headless: false, // Set to true for headless mode
    slowMo: 1000     // Slow down actions to see what's happening
  });
  
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });

  // Mock run context
  const mockContext: RunContext = {
    browser,
    page,
    sourceId: 'test-source-id',
    runId: 'test-run-id',
    source: {
      id: 'test-source-id',
      name: 'City of Prince George Events',
      baseUrl: 'https://www.princegeorge.ca',
      moduleKey: 'prince_george_ca',
      defaultTimezone: 'America/Vancouver',
      rateLimitPerMin: 30,
    },
    logger,
  };

  try {
    logger.info('🚀 Running Prince George scraper...');
    const events = await princeGeorgeModule.run(mockContext);

    logger.info(`✅ Scraping completed! Found ${events.length} events`);

    // Log first few events for inspection
    events.slice(0, 3).forEach((event, index) => {
      logger.info(`📅 Event ${index + 1}:`, {
        title: event.title,
        start: event.start,
        end: event.end,
        location: event.venueName,
        category: event.category,
        url: event.url,
      });
    });

    // Save results to file for inspection
    const fs = await import('fs/promises');
    await fs.writeFile(
      './prince-george-events.json', 
      JSON.stringify(events, null, 2),
      'utf-8'
    );
    
    logger.info('💾 Results saved to prince-george-events.json');

  } catch (error) {
    logger.error('❌ Scraping failed:', error);
  } finally {
    await browser.close();
    logger.info('🏁 Test completed');
  }
}

// Run the test
testPrinceGeorgeScraper();