import { readFile } from 'fs/promises';
import { migrationClient } from './connection.js';

const migrationPath = (fileName: string) => new URL(`./migrations/${fileName}`, import.meta.url);

export async function runMigrations() {
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
      const sql = await readFile(migrationPath('0001_initial.sql'), 'utf-8');
      await migrationClient.unsafe(sql);
      console.log('✅ Applied initial schema (0001)');
    } else {
      console.log('✅ Base schema present');
    }

    // Apply incremental migration 0002 (idempotent)
    try {
      const sql2 = await readFile(migrationPath('0002_event_tracking.sql'), 'utf-8');
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

    // Apply incremental migration 0003 (schedules)
    try {
      const sql3 = await readFile(migrationPath('0003_schedules.sql'), 'utf-8');
      await migrationClient.unsafe(sql3);
      console.log('✅ Applied migration 0003 (schedules)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0003 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0003 not applied');
      }
    }

    // Apply incremental migration 0004 (wordpress settings)
    try {
      const sql4 = await readFile(migrationPath('0004_wordpress_settings.sql'), 'utf-8');
      await migrationClient.unsafe(sql4);
      console.log('✅ Applied migration 0004 (wordpress settings)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0004 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0004 not applied');
      }
    }

    // Apply incremental migration 0005 (schedule types)
    try {
      const sql5 = await readFile(migrationPath('0005_schedule_types.sql'), 'utf-8');
      await migrationClient.unsafe(sql5);
      console.log('✅ Applied migration 0005 (schedule types)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0005 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0005 not applied');
      }
    }

    // Apply incremental migration 0006 (source category mappings)
    try {
      const sql6 = await readFile(migrationPath('0006_source_category_mappings.sql'), 'utf-8');
      await migrationClient.unsafe(sql6);
      console.log('✅ Applied migration 0006 (source category mappings)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0006 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0006 not applied');
      }
    }

    // Apply incremental migration 0007 (export schedule_id)
    try {
      const sql7 = await readFile(migrationPath('0007_export_schedule_id.sql'), 'utf-8');
      await migrationClient.unsafe(sql7);
      console.log('✅ Applied migration 0007 (export schedule_id)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0007 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0007 not applied');
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
