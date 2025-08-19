import princeGeorgeModule from './worker/src/modules/prince_george_ca/index.ts';
import { createMockRunContext } from './worker/src/lib/test-utils.ts';

async function testPrinceGeorgeModule() {
  console.log('🚀 Starting Prince George Events scraper test...');
  
  try {
    const ctx = await createMockRunContext({
      testMode: true // Only process first event
    });
    
    const events = await princeGeorgeModule.run(ctx);
    
    console.log(`\n📊 Results:`);
    console.log(`   Events found: ${events.length}`);
    console.log(`   Pages crawled: ${ctx.stats?.pagesCrawled || 0}\n`);
    
    // Display sample events with descriptions
    events.slice(0, 3).forEach((event, index) => {
      console.log(`📅 Event ${index + 1}:`);
      console.log(`   Title: ${event.title}`);
      console.log(`   Start: ${event.start}`);
      console.log(`   End: ${event.end || 'N/A'}`);
      console.log(`   Venue: ${event.venueName || 'N/A'}`);
      console.log(`   Address: ${event.venueAddress || 'N/A'}`);
      console.log(`   Description: ${event.descriptionHtml ? 'Present ✓' : 'Missing ✗'}`);
      if (event.descriptionHtml) {
        // Show first 200 characters of description
        const cleanDesc = event.descriptionHtml.replace(/<[^>]*>/g, '').substring(0, 200);
        console.log(`   Desc Preview: ${cleanDesc}${cleanDesc.length === 200 ? '...' : ''}`);
      }
      console.log(`   Category: ${event.category || 'N/A'}`);
      console.log(`   Tags: ${event.tags ? event.tags.join(', ') : 'N/A'}`);
      console.log(`   Enhanced: ${event.raw?.enhancedFromDetailPage ? 'Yes' : 'No'}`);
      console.log('');
    });
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testPrinceGeorgeModule();