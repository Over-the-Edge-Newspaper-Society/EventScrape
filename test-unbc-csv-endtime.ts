import unbcTimberwolvesModule from './worker/src/modules/unbctimberwolves_com/index.ts';

// Create test CSV content with end times
const testCSVContent = `Event,Start Date,Start Time,End Date,End Time,Location,Category,Description,Facility
Women's Soccer vs Thompson Rivers WolfPack,8/22/2025,5:30PM,8/22/2025,8:30 PM,Prince George\\, BC,Women's Soccer,Women's Soccer vs Thompson Rivers WolfPack Prince George\\, BC,Masich Place Stadium
Men's Soccer vs Thompson Rivers WolfPack,8/22/2025,8:00PM,8/22/2025,11:00 PM,Prince George\\, B.C.,Men's Soccer,Men's Soccer vs Thompson Rivers WolfPack Prince George\\, B.C.,Masich Place Stadium
Basketball Game,8/25/2025,7:00 PM,,9:00 PM,UNBC Gym,Basketball,Exhibition basketball game,Charles Jago Northern Sport Centre`;

// Mock logger
const logger = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.log(`⚠️  ${msg}`),
  error: (msg: string) => console.log(`❌ ${msg}`),
  debug: (msg: string) => console.log(`🐛 ${msg}`)
};

async function testCSVParser() {
  console.log('🚀 Testing UNBC Timberwolves CSV parser with end times...\n');
  
  try {
    const events = await unbcTimberwolvesModule.parseCSVContent(testCSVContent, logger);
    
    console.log(`\n📊 Results:`);
    console.log(`   Events parsed: ${events.length}\n`);
    
    events.forEach((event, index) => {
      console.log(`📅 Event ${index + 1}:`);
      console.log(`   Title: ${event.title}`);
      console.log(`   Start: ${event.start}`);
      console.log(`   End: ${event.end || 'N/A'}`);
      console.log(`   Venue: ${event.venueName || 'N/A'}`);
      console.log(`   Address: ${event.venueAddress || 'N/A'}`);
      console.log(`   Raw Start Date: ${event.raw.startDate}`);
      console.log(`   Raw Start Time: ${event.raw.startTime}`);
      console.log(`   Raw End Date: ${event.raw.endDate || 'N/A'}`);
      console.log(`   Raw End Time: ${event.raw.endTime || 'N/A'}`);
      
      // Calculate duration if both start and end are present
      if (event.start && event.end) {
        const startTime = new Date(event.start);
        const endTime = new Date(event.end);
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationHours = Math.round(durationMs / (1000 * 60 * 60) * 100) / 100;
        console.log(`   Duration: ${durationHours} hours`);
      }
      
      console.log('');
    });
    
    console.log('✅ CSV parsing test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testCSVParser();