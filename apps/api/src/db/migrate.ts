import { readFile } from 'fs/promises';
import { join } from 'path';
import { migrationClient } from './connection.js';

async function runMigrations() {
  console.log('Running database migrations...');
  
  try {
    // Check if tables already exist
    const tableExists = await migrationClient`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'sources'
      ) as exists
    `;
    
    if (tableExists[0].exists) {
      console.log('✅ Database schema already exists, skipping migration');
      return;
    }
    
    const sqlPath = join(process.cwd(), 'src/db/migrations/0001_initial.sql');
    const sql = await readFile(sqlPath, 'utf-8');
    
    // Execute the entire SQL file at once to handle DO blocks properly
    await migrationClient.unsafe(sql);
    
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    // If migration fails due to objects already existing, that's ok
    if (error.code === '42P07' || error.code === '42710' || error.code === '42501') {
      console.log('✅ Database schema already exists, skipping migration');
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