#!/usr/bin/env node

/**
 * Cleanup script to remove duplicate Instagram posts
 * Keeps the most recent record for each instagram_post_id
 *
 * This script is useful when duplicates have been created in the database
 * (e.g., from re-extracting posts before the duplicate prevention fix was added).
 *
 * Usage:
 *   node scripts/cleanup-duplicate-instagram-posts.js
 *
 * What it does:
 *   - Finds all Instagram posts with duplicate records (same instagram_post_id)
 *   - Keeps the most recent record (by scraped_at date)
 *   - Deletes all older duplicate records
 *
 * Note: This is safe to run multiple times. If no duplicates exist, it will do nothing.
 */

import postgres from 'postgres';

const POSTGRES_URL = process.env.DATABASE_URL ||
  'postgres://eventscrape:eventscrape_dev@localhost:5432/eventscrape';

async function cleanupDuplicates() {
  console.log('🧹 Starting duplicate Instagram post cleanup...\n');

  const sql = postgres(POSTGRES_URL);

  try {
    // Find all Instagram posts with duplicates
    const duplicates = await sql`
      SELECT instagram_post_id, COUNT(*) as count
      FROM events_raw
      WHERE instagram_post_id IS NOT NULL
      GROUP BY instagram_post_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `;

    console.log(`Found ${duplicates.length} Instagram posts with duplicates\n`);

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!\n');
      return;
    }

    let totalDeleted = 0;

    for (const { instagram_post_id, count } of duplicates) {
      console.log(`\n📝 Processing ${instagram_post_id} (${count} records):`);

      // Get all records for this instagram_post_id, ordered by scraped_at DESC
      const records = await sql`
        SELECT id, title, scraped_at, is_event_poster
        FROM events_raw
        WHERE instagram_post_id = ${instagram_post_id}
        ORDER BY scraped_at DESC
      `;

      // Keep the most recent one, delete the rest
      const keepRecord = records[0];
      const deleteRecords = records.slice(1);

      console.log(`  ✅ Keeping: ${keepRecord.title} (scraped ${keepRecord.scraped_at.toISOString().split('T')[0]})`);

      for (const record of deleteRecords) {
        await sql`
          DELETE FROM events_raw
          WHERE id = ${record.id}
        `;
        console.log(`  🗑️  Deleted: ${record.title} (scraped ${record.scraped_at.toISOString().split('T')[0]})`);
        totalDeleted++;
      }
    }

    console.log('\n📊 Cleanup Summary:');
    console.log(`   🗑️  Total deleted: ${totalDeleted}`);
    console.log(`   ✅ Unique posts remaining: ${duplicates.length}`);
    console.log(`   📦 Duplicates cleaned: ${duplicates.length}\n`);

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  } finally {
    await sql.end();
  }
}

// Run cleanup
cleanupDuplicates()
  .then(() => {
    console.log('✅ Cleanup complete!');
    console.log('\n💡 Refresh the Instagram Review page to see the cleaned data.\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  });
