import { chromium } from 'playwright';
import unbcTimberwolvesModule from './src/modules/unbctimberwolves_com/index.js';
async function testUnbcScraper() {
    const browser = await chromium.launch({ headless: false }); // Set to false to see what's happening
    const page = await browser.newPage();
    const context = {
        page,
        logger: {
            info: console.log,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        },
        jobData: { testMode: false }, // Full scrape, not test mode
        stats: { pagesCrawled: 0 },
    };
    try {
        console.log('🚀 Starting UNBC Timberwolves scraper test...');
        const events = await unbcTimberwolvesModule.run(context);
        console.log(`✅ Scraper completed! Found ${events.length} events`);
        if (events.length > 0) {
            console.log('\n📋 Sample events:');
            events.slice(0, 3).forEach((event, index) => {
                console.log(`${index + 1}. ${event.title} - ${event.start}`);
            });
        }
        console.log(`\n📊 Stats: ${context.stats.pagesCrawled} pages crawled`);
    }
    catch (error) {
        console.error('❌ Scraper failed:', error);
    }
    finally {
        await browser.close();
    }
}
testUnbcScraper();
