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

    // Apply incremental migration 0008 (include_media setting)
    try {
      const sql8 = await readFile(migrationPath('0008_include_media_setting.sql'), 'utf-8');
      await migrationClient.unsafe(sql8);
      console.log('✅ Applied migration 0008 (include_media setting)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0008 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0008 not applied');
      }
    }

    // Apply incremental migration 0009 (event occurrences)
    try {
      const sql9 = await readFile(migrationPath('0009_event_occurrences.sql'), 'utf-8');
      await migrationClient.unsafe(sql9);
      console.log('✅ Applied migration 0009 (event occurrences)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0009 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0009 not applied');
      }
    }

    // Apply incremental migration 0010 (export processing status)
    try {
      const sql10 = await readFile(migrationPath('0010_export_processing_status.sql'), 'utf-8');
      await migrationClient.unsafe(sql10);
      console.log('✅ Applied migration 0010 (export processing status)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0010 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0010 not applied');
      }
    }

    // Apply incremental migration 0011 (Instagram integration)
    try {
      const sql11 = await readFile(migrationPath('0011_instagram_integration.sql'), 'utf-8');
      await migrationClient.unsafe(sql11);
      console.log('✅ Applied migration 0011 (Instagram integration)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0011 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0011 not applied');
      }
    }

    // Apply incremental migration 0012 (Instagram scraper type)
    try {
      const sql12 = await readFile(migrationPath('0012_instagram_scraper_type.sql'), 'utf-8');
      await migrationClient.unsafe(sql12);
      console.log('✅ Applied migration 0012 (Instagram scraper type)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0012 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0012 not applied');
      }
    }

    // Apply incremental migration 0013 (Instagram settings)
    try {
      const sql13 = await readFile(migrationPath('0013_instagram_settings.sql'), 'utf-8');
      await migrationClient.unsafe(sql13);
      console.log('✅ Applied migration 0013 (Instagram settings)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0013 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0013 not applied');
      }
    }

    // Apply incremental migration 0014 (Instagram accounts)
    try {
      const sql14 = await readFile(migrationPath('0014_instagram_accounts.sql'), 'utf-8');
      await migrationClient.unsafe(sql14);
      console.log('✅ Applied migration 0014 (Instagram accounts)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0014 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0014 not applied');
      }
    }

    // Apply incremental migration 0015 (Instagram global scraper settings)
    try {
      const sql15 = await readFile(migrationPath('0015_instagram_global_scraper_settings.sql'), 'utf-8');
      await migrationClient.unsafe(sql15);
      console.log('✅ Applied migration 0015 (Instagram global scraper settings)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0015 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0015 not applied');
      }
    }

    // Apply incremental migration 0016 (Add gemini prompt)
    try {
      const sql16 = await readFile(migrationPath('0016_add_gemini_prompt.sql'), 'utf-8');
      await migrationClient.unsafe(sql16);
      console.log('✅ Applied migration 0016 (Add gemini prompt)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0016 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0016 not applied');
      }
    }

    // Apply incremental migration 0017 (Fix Instagram account foreign key)
    try {
      const sql17 = await readFile(migrationPath('0017_fix_instagram_account_fkey.sql'), 'utf-8');
      await migrationClient.unsafe(sql17);
      console.log('✅ Applied migration 0017 (Fix Instagram account foreign key)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0017 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0017 not applied');
      }
    }

    // Apply incremental migration 0018 (Instagram parent runs)
    try {
      const sql18 = await readFile(migrationPath('0018_instagram_parent_runs.sql'), 'utf-8');
      await migrationClient.unsafe(sql18);
      console.log('✅ Applied migration 0018 (Instagram parent runs)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0018 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0018 not applied');
      }
    }

    // Apply incremental migration 0019 (Instagram auto classify)
    try {
      const sql19 = await readFile(migrationPath('0019_instagram_auto_classify.sql'), 'utf-8');
      await migrationClient.unsafe(sql19);
      console.log('✅ Applied migration 0019 (Instagram auto classify)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0019 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0019 not applied');
      }
    }

    // Apply incremental migration 0020 (Instagram schedule type)
    try {
      const sql20 = await readFile(migrationPath('0020_instagram_schedule_type.sql'), 'utf-8');
      await migrationClient.unsafe(sql20);
      console.log('✅ Applied migration 0020 (Instagram schedule type)');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Migration 0020 not applied:', e.code, e.message);
      } else {
        console.log('ℹ️ Migration 0020 not applied');
      }
    }

    // Ensure instagram_scrape schedule type and constraint exist even if older DB missed migration 0020
    try {
      const result = await migrationClient`
        SELECT EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'schedule_type'
            AND e.enumlabel = 'instagram_scrape'
        ) as exists
      `;
      const instagramScheduleExists = result[0]?.exists as boolean;

      if (!instagramScheduleExists) {
        await migrationClient.unsafe(`ALTER TYPE schedule_type ADD VALUE 'instagram_scrape';`);
        console.log('✅ Added instagram_scrape schedule type');
      } else {
        console.log('ℹ️ instagram_scrape schedule type already present');
      }

      await migrationClient.unsafe(`
        ALTER TABLE IF EXISTS schedules DROP CONSTRAINT IF EXISTS schedules_config_check;
      `);
      await migrationClient.unsafe(`
        ALTER TABLE IF EXISTS schedules
          ADD CONSTRAINT schedules_config_check
          CHECK (
            (schedule_type = 'scrape' AND source_id IS NOT NULL AND wordpress_settings_id IS NULL)
            OR (schedule_type = 'wordpress_export' AND wordpress_settings_id IS NOT NULL)
            OR (schedule_type = 'instagram_scrape' AND source_id IS NULL AND wordpress_settings_id IS NULL)
          );
      `);
      console.log('✅ Ensured schedules_config_check allows instagram_scrape');
    } catch (e: any) {
      if (e?.code) {
        console.log('ℹ️ Instagram schedule type check failed:', e.code, e.message);
      } else {
        console.log('ℹ️ Instagram schedule type check failed');
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
