#!/usr/bin/env node
/**
 * Update imported Instagram events with their original Gemini extraction JSON
 * from the Event-Monitor backup database
 */

import postgres from 'postgres';
import Database from 'better-sqlite3';

const DB_URL = process.env.DATABASE_URL || 'postgres://eventscrape:eventscrape_dev@localhost:5432/eventscrape';
const SQLITE_PATH = process.argv[2] || '/tmp/event-monitor-backup/instagram_monitor.db';

async function updateImportedEventsJson() {
  console.log('🔄 Starting update of imported events JSON...');
  console.log(`📁 Using SQLite DB: ${SQLITE_PATH}`);

  // Connect to PostgreSQL
  const sql = postgres(DB_URL);

  // Connect to SQLite
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  try {
    // Get all extracted events from the old database
    const extractedEvents = sqlite.prepare(`
      SELECT
        p.instagram_id,
        p.id as post_id,
        e.event_data_json,
        e.extraction_confidence
      FROM extracted_events e
      JOIN posts p ON e.post_id = p.id
      WHERE e.event_data_json IS NOT NULL
    `).all();

    console.log(`📊 Found ${extractedEvents.length} extracted events in backup`);

    let updated = 0;
    let notFound = 0;

    for (const event of extractedEvents) {
      try {
        const result = await sql`
          UPDATE events_raw
          SET raw = ${event.event_data_json}::jsonb
          WHERE instagram_post_id = ${event.instagram_id}
            AND raw::text LIKE '%imported_from%'
        `;

        if (result.count > 0) {
          updated++;
          console.log(`✅ Updated ${event.instagram_id} (post_id: ${event.post_id})`);
        } else {
          notFound++;
          console.log(`⚠️  Not found in EventScrape: ${event.instagram_id}`);
        }
      } catch (error) {
        console.error(`❌ Error updating ${event.instagram_id}:`, error.message);
      }
    }

    console.log('\n📈 Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⚠️  Not found: ${notFound}`);
    console.log(`   📊 Total processed: ${extractedEvents.length}`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    sqlite.close();
    await sql.end();
  }

  console.log('\n✨ Update complete!');
}

updateImportedEventsJson();
