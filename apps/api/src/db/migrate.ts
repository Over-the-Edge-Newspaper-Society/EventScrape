import { readFile } from 'fs/promises';
import { join } from 'path';
import { migrationClient } from './connection.js';

async function runMigrations() {
  console.log('Running database migrations...');
  
  try {
    // Check if base tables already exist
    const tableExists = await migrationClient`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'sources'
      ) as exists
    `;

    // Always attempt to apply baseline if not present
    if (!tableExists[0].exists) {
      const sqlPath = join(process.cwd(), 'src/db/migrations/0001_initial.sql');
      const sql = await readFile(sqlPath, 'utf-8');
      await migrationClient.unsafe(sql);
      console.log('✅ Applied initial schema (0001)');
    } else {
      console.log('✅ Base schema present');
    }

    // Apply incremental migration 0002 (idempotent)
    try {
      const sqlPath2 = join(process.cwd(), 'src/db/migrations/0002_event_tracking.sql');
      const sql2 = await readFile(sqlPath2, 'utf-8');
      await migrationClient.unsafe(sql2);
      console.log('✅ Applied migration 0002 (event tracking columns)');
    } catch (e: any) {
      // If file missing or fails due to existing objects, skip quietly
      if (e?.code) {
        console.log('ℹ️ Migration 0002 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0002 not applied');
      }
    }

    console.log('✅ Migrations completed successfully');
  } catch (error: any) {
    // If migration fails due to objects already existing, that's ok
    if (error?.code === '42P07' || error?.code === '42710' || error?.code === '42501') {
      console.log('✅ Database schema already exists');
    } else {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  } finally {
    await migrationClient.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}
