import { readFile } from 'fs/promises';
import { join } from 'path';
import { migrationClient } from './connection.js';

async function runMigrations() {
  console.log('Running database migrations...');
  
  try {
    const sqlPath = join(process.cwd(), 'src/db/migrations/0001_initial.sql');
    const sql = await readFile(sqlPath, 'utf-8');
    
    // Split by statements and execute each one
    const statements = sql.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await migrationClient.unsafe(statement.trim());
      }
    }
    
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}