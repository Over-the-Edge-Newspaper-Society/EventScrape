import { db } from './connection.js';
import { sources } from './schema.js';

async function seedDatabase() {
  console.log('Seeding database...');

  try {
    // Insert example sources
    await db.insert(sources).values([
      {
        name: 'City of Prince George Events',
        baseUrl: 'https://www.princegeorge.ca',
        moduleKey: 'prince_george_ca',
        active: true,
        defaultTimezone: 'America/Vancouver',
        notes: 'Official events from the City of Prince George, BC',
        rateLimitPerMin: 30,
      },
      {
        name: 'Example Events Site',
        baseUrl: 'https://example.com',
        moduleKey: 'example_com',
        active: false,
        defaultTimezone: 'America/New_York',
        notes: 'Example scraper module for testing',
        rateLimitPerMin: 30,
      },
      {
        name: 'Local Meetup Site',
        baseUrl: 'https://localmeetups.com',
        moduleKey: 'local_meetups',
        active: false,
        defaultTimezone: 'UTC',
        notes: 'Local meetup events - disabled by default',
        rateLimitPerMin: 60,
      },
    ]).onConflictDoNothing();

    console.log('✅ Database seeded successfully');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase();
}