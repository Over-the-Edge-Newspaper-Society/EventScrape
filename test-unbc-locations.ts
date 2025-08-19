import unbcTimberwolvesModule from './worker/src/modules/unbctimberwolves_com/index.ts';

// Create test CSV content with different locations
const testCSVContent = `Event,Start Date,Start Time,End Date,End Time,Location,Category,Description,Facility
Women's Soccer at Fraser Valley Cascades,8/29/2025,5:30PM,8/29/2025,8:30 PM,Abbotsford\\, BC,Women's Soccer,Women's Soccer at Fraser Valley Cascades Abbotsford\\, BC,MRC Sports Complex (UFV SOC)
Men's Soccer at Trinity Western Spartans,8/29/2025,7:15PM,8/29/2025,10:15 PM,Langley\\, B.C.,Men's Soccer,Men's Soccer at Trinity Western Spartans Langley\\, B.C.,North Field (TWU)
Women's Soccer vs Thompson Rivers WolfPack,8/24/2025,12:00PM,8/24/2025,3:00 PM,Prince George\\, BC,Women's Soccer,Women's Soccer vs Thompson Rivers WolfPack Prince George\\, BC,Masich Place Stadium
Men's Basketball at Calgary Dinos,11/15/2025,8:00PM,11/15/2025,10:00 PM,Calgary\\, AB,Men's Basketball,Men's Basketball at Calgary Dinos Calgary\\, AB,Olympic Oval`;

// Mock logger
const logger = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.log(`⚠️  ${msg}`),
  error: (msg: string) => console.log(`❌ ${msg}`),
  debug: (msg: string) => console.log(`🐛 ${msg}`)
};

async function testLocationParsing() {
  console.log('🚀 Testing UNBC Timberwolves CSV location parsing...\n');
  
  try {
    const events = await unbcTimberwolvesModule.parseCSVContent(testCSVContent, logger);
    
    console.log(`\n📊 Results:`);
    console.log(`   Events parsed: ${events.length}\n`);
    
    events.forEach((event, index) => {
      console.log(`📍 Event ${index + 1}:`);
      console.log(`   Title: ${event.title}`);
      console.log(`   City: ${event.city}`);
      console.log(`   Region: ${event.region}`);
      console.log(`   Country: ${event.country}`);
      console.log(`   Venue Name: ${event.venueName || 'N/A'}`);
      console.log(`   Venue Address: ${event.venueAddress || 'N/A'}`);
      console.log(`   Raw Location: ${event.raw.location || 'N/A'}`);
      console.log(`   Raw Facility: ${event.raw.facility || 'N/A'}`);
      console.log('');
    });
    
    // Verify specific expectations
    console.log('✅ Validation Results:');
    
    const event1 = events[0]; // Abbotsford event
    if (event1.city === 'Abbotsford' && event1.region === 'British Columbia') {
      console.log('   ✅ Abbotsford location parsed correctly');
    } else {
      console.log(`   ❌ Abbotsford location failed: ${event1.city}, ${event1.region}`);
    }
    
    const event2 = events[1]; // Langley event  
    if (event2.city === 'Langley' && event2.region === 'British Columbia') {
      console.log('   ✅ Langley location parsed correctly');
    } else {
      console.log(`   ❌ Langley location failed: ${event2.city}, ${event2.region}`);
    }
    
    const event3 = events[2]; // Prince George event
    if (event3.city === 'Prince George' && event3.venueName === 'Masich Place Stadium') {
      console.log('   ✅ Prince George location parsed correctly');
    } else {
      console.log(`   ❌ Prince George location failed: ${event3.city}, venue: ${event3.venueName}`);
    }
    
    const event4 = events[3]; // Calgary event (different province)
    if (event4.city === 'Calgary' && event4.region === 'AB') {
      console.log('   ✅ Calgary (AB) location parsed correctly');
    } else {
      console.log(`   ❌ Calgary location failed: ${event4.city}, ${event4.region}`);
    }
    
    console.log('\n✅ Location parsing test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testLocationParsing();