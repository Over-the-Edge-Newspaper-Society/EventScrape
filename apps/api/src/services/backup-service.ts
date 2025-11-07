import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { db } from '../db/connection.js';
import {
  eventsRaw,
  instagramAccounts,
  instagramSessions,
  runs,
  sources,
} from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';

const execAsync = promisify(exec);

export interface ParsedDatabaseConfig {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
}

export interface DatabaseBackupResult {
  filename: string;
  filepath: string;
}

export interface InstagramDataExport {
  sources: any[];
  accounts: any[];
  sessions: any[];
  runs: any[];
  events: any[];
}

export interface InstagramRestoreResult {
  sourcesCreated: number;
  accountsCreated: number;
  sessionsCreated: number;
  runsCreated: number;
  eventsCreated: number;
  imagesRestored: number;
}

export function parseDatabaseUrl(url: string): ParsedDatabaseConfig {
  const regex = /postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
  const match = url.match(regex);

  if (!match) {
    throw new Error('Invalid DATABASE_URL format');
  }

  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4],
    database: match[5],
  };
}

export async function ensureDir(path: string) {
  if (!existsSync(path)) {
    await fs.mkdir(path, { recursive: true });
  }
}

export async function createDatabaseBackup(
  backupDir: string,
  dbConfig: ParsedDatabaseConfig,
  filename?: string,
  excludeTables: string[] = [],
): Promise<DatabaseBackupResult> {
  await ensureDir(backupDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalFilename = filename ?? `backup-${timestamp}.sql`;
  const filepath = join(backupDir, finalFilename);

  const excludeArgs = excludeTables
    .map((table) => `--exclude-table=${table}`)
    .join(' ');

  const command = `PGPASSWORD="${dbConfig.password}" pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -F p ${excludeArgs} -f "${filepath}"`;

  await execAsync(command);

  return {
    filename: finalFilename,
    filepath,
  };
}

export async function dropAndRecreatePublicSchema(
  dbConfig: ParsedDatabaseConfig,
): Promise<void> {
  const dropCommand = `PGPASSWORD="${dbConfig.password}" psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${dbConfig.user}; GRANT ALL ON SCHEMA public TO public;"`;
  await execAsync(dropCommand);
}

export async function restoreDatabaseFromSql(
  sqlFilepath: string,
  dbConfig: ParsedDatabaseConfig,
): Promise<void> {
  const restoreCommand = `PGPASSWORD="${dbConfig.password}" psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${sqlFilepath}"`;
  await execAsync(restoreCommand);
}

export async function fetchInstagramData(): Promise<InstagramDataExport> {
  const sourcesData = await db
    .select()
    .from(sources)
    .where(eq(sources.sourceType, 'instagram'));

  const accountsData = await db.select().from(instagramAccounts);
  const sessionsData = await db.select().from(instagramSessions);
  const instagramSourceIds = sourcesData.map((source) => source.id);
  let runsData: any[] = [];
  if (instagramSourceIds.length > 0) {
    runsData = await db
      .select()
      .from(runs)
      .where(inArray(runs.sourceId, instagramSourceIds));
  }
  const eventsData = await db
    .select()
    .from(eventsRaw)
    .where(eq(eventsRaw.instagramPostId, eventsRaw.instagramPostId));

  return {
    sources: sourcesData,
    accounts: accountsData,
    sessions: sessionsData,
    runs: runsData,
    events: eventsData,
  };
}

export async function clearInstagramData(): Promise<void> {
  // Delete events first as they reference other tables
  await db.delete(eventsRaw).where(eq(eventsRaw.instagramPostId, eventsRaw.instagramPostId));

  // Delete runs associated with Instagram sources
  const instagramSourceIds = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.sourceType, 'instagram'));

  if (instagramSourceIds.length > 0) {
    for (const { id } of instagramSourceIds) {
      await db.delete(runs).where(eq(runs.sourceId, id));
    }
  }

  await db.delete(sources).where(eq(sources.sourceType, 'instagram'));
  await db.delete(instagramSessions);
  await db.delete(instagramAccounts);
}

export async function restoreInstagramData(
  data: InstagramDataExport,
): Promise<Omit<InstagramRestoreResult, 'imagesRestored'>> {
  const results = {
    sourcesCreated: 0,
    accountsCreated: 0,
    sessionsCreated: 0,
    runsCreated: 0,
    eventsCreated: 0,
  };

  for (const source of data.sources) {
    try {
      await db.insert(sources).values(source);
      results.sourcesCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore source ${source.name}:`, error.message);
    }
  }

  for (const account of data.accounts) {
    try {
      await db.insert(instagramAccounts).values(account);
      results.accountsCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore Instagram account ${account.instagramUsername}:`, error.message);
    }
  }

  for (const session of data.sessions) {
    try {
      await db.insert(instagramSessions).values(session);
      results.sessionsCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore session ${session.username}:`, error.message);
    }
  }

  for (const run of data.runs ?? []) {
    try {
      await db.insert(runs).values(run);
      results.runsCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore run ${run.id}:`, error.message);
    }
  }

  for (const event of data.events) {
    try {
      await db.insert(eventsRaw).values(event);
      results.eventsCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore event ${event.instagramPostId || event.id}:`, error.message);
    }
  }

  return results;
}

export async function copyInstagramImagesToDirectory(
  sourceDir: string,
  destinationDir: string,
): Promise<number> {
  try {
    await fs.access(sourceDir);
  } catch {
    return 0;
  }

  await ensureDir(destinationDir);

  const imageFiles = await fs.readdir(sourceDir);
  let copied = 0;

  for (const file of imageFiles) {
    const src = join(sourceDir, file);
    const dest = join(destinationDir, file);

    try {
      await fs.copyFile(src, dest);
      copied++;
    } catch (error: any) {
      console.warn(`Failed to copy Instagram image ${file}:`, error.message);
    }
  }

  return copied;
}

export async function restoreInstagramImagesFromDirectory(
  sourceDir: string,
  destinationDir: string,
): Promise<number> {
  try {
    await fs.access(sourceDir);
  } catch {
    return 0;
  }

  await ensureDir(destinationDir);

  const imageFiles = await fs.readdir(sourceDir);
  let restored = 0;

  for (const file of imageFiles) {
    const src = join(sourceDir, file);
    const dest = join(destinationDir, file);

    try {
      // Skip if already exists
      try {
        await fs.access(dest);
        continue;
      } catch {
        // File does not exist, copy
      }

      await fs.copyFile(src, dest);
      restored++;
    } catch (error: any) {
      console.warn(`Failed to restore Instagram image ${file}:`, error.message);
    }
  }

  return restored;
}
