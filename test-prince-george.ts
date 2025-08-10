#!/usr/bin/env tsx

import puppeteer from 'puppeteer';
import princeGeorgeModule from './worker/src/modules/prince_george_ca/index.js';

async function testPrinceGeorgeScraper() {
  console.log('Testing Prince George scraper...');
  
  const browser = await puppeteer.launch({
    headless: false, // Set to false to see what's happening
    devtools: true,
  });

  try {
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    
    const context = {
      page,
      logger: {
        info: (msg: string) => console.log(`[INFO] ${msg}`),
        warn: (msg: string) => console.warn(`[WARN] ${msg}`),
        error: (msg: string) => console.error(`[ERROR] ${msg}`)
      },
      jobData: { testMode: true }
    };

    const events = await princeGeorgeModule.run(context);
    
    console.log(`Scraper completed. Found ${events.length} events:`);
    events.forEach((event, i) => {
      console.log(`${i + 1}. ${event.title} - ${event.start}`);
    });
    
  } catch (error) {
    console.error('Error during scraping:', error);
  } finally {
    await browser.close();
  }
}

testPrinceGeorgeScraper();