const Database = require('better-sqlite3');
const { Client } = require('pg');

const SQLITE_DB_PATH = '/Users/ahmadjalil/Downloads/event-monitor-backup-20251021-004825/instagram_monitor.db';

async function fixTimestamps() {
  // Open SQLite database
  const sqlite = new Database(SQLITE_DB_PATH, { readonly: true });

  // Connect to PostgreSQL
  const pgClient = new Client({
    host: 'localhost',
    port: 5432,
    database: 'eventscrape',
    user: 'eventscrape',
    password: 'eventscrape123',
  });

  await pgClient.connect();

  try {
    // Get all posts from SQLite
    const posts = sqlite.prepare('SELECT instagram_id, post_timestamp FROM posts').all();

    console.log(`Found ${posts.length} posts in SQLite database`);

    let updated = 0;
    let notFound = 0;

    for (const post of posts) {
      try {
        // Get current raw data from PostgreSQL
        const result = await pgClient.query(
          'SELECT raw FROM events_raw WHERE instagram_post_id = $1',
          [post.instagram_id]
        );

        if (result.rows.length > 0) {
          const currentRaw = result.rows[0].raw;

          // Add instagram timestamp to raw data
          const updatedRaw = {
            ...currentRaw,
            instagram: {
              ...(currentRaw.instagram || {}),
              timestamp: post.post_timestamp,
            },
          };

          // Update the record
          await pgClient.query(
            'UPDATE events_raw SET raw = $1 WHERE instagram_post_id = $2',
            [JSON.stringify(updatedRaw), post.instagram_id]
          );

          updated++;

          if (updated % 10 === 0) {
            console.log(`Updated ${updated} records...`);
          }
        } else {
          notFound++;
        }
      } catch (error) {
        console.error(`Error updating ${post.instagram_id}:`, error.message);
      }
    }

    console.log(`\nMigration complete!`);
    console.log(`Updated: ${updated}`);
    console.log(`Not found: ${notFound}`);

  } finally {
    sqlite.close();
    await pgClient.end();
  }
}

fixTimestamps().catch(console.error);
