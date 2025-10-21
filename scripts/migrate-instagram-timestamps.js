#!/usr/bin/env node

/**
 * Migration script to import Instagram post timestamps from SQLite backup
 * into PostgreSQL events_raw table
 *
 * This script is useful when migrating from the old Instagram monitor system
 * to preserve the actual Instagram post publication dates.
 *
 * Usage:
 *   1. First, export timestamps from SQLite backup:
 *      sqlite3 "/path/to/instagram_monitor.db" \
 *        "SELECT instagram_id, post_timestamp FROM posts ORDER BY post_timestamp DESC;" \
 *        -json > /tmp/instagram_timestamps.json
 *
 *   2. Then run this script:
 *      node scripts/migrate-instagram-timestamps.js
 *
 *   Or specify a custom JSON file path:
 *      TIMESTAMPS_JSON_PATH=/path/to/timestamps.json node scripts/migrate-instagram-timestamps.js
 *
 * Note: This script has already been run once. Only run again if you have a new backup
 * or need to re-import timestamps.
 */

import postgres from 'postgres';
import { readFileSync } from 'fs';

// Configuration
const TIMESTAMPS_JSON_PATH = process.env.TIMESTAMPS_JSON_PATH || '/tmp/instagram_timestamps.json';
const POSTGRES_URL = process.env.DATABASE_URL ||
  'postgres://eventscrape:eventscrape_dev@localhost:5432/eventscrape';

async function migrateTimestamps() {
  console.log('📦 Starting Instagram timestamp migration...\n');

  // Read timestamps from JSON file
  console.log(`Reading timestamps from: ${TIMESTAMPS_JSON_PATH}`);
  const timestampsData = JSON.parse(readFileSync(TIMESTAMPS_JSON_PATH, 'utf8'));

  console.log(`Found ${timestampsData.length} posts with timestamps\n`);

  // Connect to PostgreSQL
  console.log('Connecting to PostgreSQL...');
  const sql = postgres(POSTGRES_URL);

  try {
    let updated = 0;
    let notFound = 0;
    let failed = 0;
    let noRawData = 0;

    for (const { instagram_id, post_timestamp } of timestampsData) {
      try {
        // Find matching records in PostgreSQL
        const pgRecords = await sql`
          SELECT id, instagram_post_id, raw, scraped_at
          FROM events_raw
          WHERE instagram_post_id = ${instagram_id}
        `;

        if (pgRecords.length === 0) {
          notFound++;
          continue;
        }

        // Update each matching record
        for (const pgRecord of pgRecords) {
          try {
            let rawData;

            // Check if raw data exists
            if (!pgRecord.raw) {
              noRawData++;
              console.log(`⚠️  Post ${instagram_id} has no raw data, skipping`);
              continue;
            }

            // Parse existing raw data
            if (typeof pgRecord.raw === 'string') {
              // Handle double-escaped JSON
              try {
                rawData = JSON.parse(JSON.parse(pgRecord.raw));
              } catch {
                rawData = JSON.parse(pgRecord.raw);
              }
            } else {
              rawData = pgRecord.raw;
            }

            // Add Instagram metadata
            if (!rawData.instagram) {
              rawData.instagram = {};
            }

            rawData.instagram.timestamp = post_timestamp;
            rawData.instagram.postId = instagram_id;

            // Update the record
            await sql`
              UPDATE events_raw
              SET raw = ${JSON.stringify(rawData)}
              WHERE id = ${pgRecord.id}
            `;

            updated++;
            console.log(`✅ Updated ${instagram_id}: ${post_timestamp} (was showing scraped: ${pgRecord.scraped_at.toISOString().split('T')[0]})`);
          } catch (error) {
            console.error(`❌ Failed to update record ${pgRecord.id}:`, error.message);
            failed++;
          }
        }
      } catch (error) {
        console.error(`❌ Failed to process post ${instagram_id}:`, error.message);
        failed++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⚠️  Not found in PostgreSQL: ${notFound}`);
    console.log(`   ⚠️  No raw data: ${noRawData}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📦 Total in backup: ${timestampsData.length}\n`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

// Run migration
migrateTimestamps()
  .then(() => {
    console.log('✅ Migration complete!');
    console.log('\n💡 Refresh the Instagram Review page to see the actual post dates.\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
