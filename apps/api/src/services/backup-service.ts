import { exec } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { readdir } from 'fs/promises';
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

// Helper function to load available module keys
async function getAvailableModuleKeys(): Promise<Set<string>> {
  const moduleKeys = new Set<string>();

  const isProduction = process.env.NODE_ENV === 'production';
  const modulesPath = isProduction
    ? resolve(process.cwd(), 'apps/api/dist/worker/src/modules')
    : resolve(process.cwd(), '../../worker/src/modules');

  try {
    const entries = await readdir(modulesPath, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory());

    for (const dir of moduleDirs) {
      moduleKeys.add(dir.name);
    }
  } catch (error: any) {
    console.warn('[getAvailableModuleKeys] Failed to read modules directory:', error.message);
  }

  return moduleKeys;
}

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

  // Load available modules to validate sources
  const availableModules = await getAvailableModuleKeys();

  for (const source of data.sources) {
    try {
      // Check if module exists
      const moduleExists = availableModules.has(source.moduleKey);

      // Convert date strings back to Date objects
      const sourceData = {
        ...source,
        // Deactivate source if module doesn't exist
        active: moduleExists ? source.active : false,
        // Add note if module is missing
        notes: !moduleExists
          ? (source.notes ? `${source.notes} (Module unavailable in current installation)` : 'Module unavailable in current installation')
          : source.notes,
        lastChecked: source.lastChecked ? new Date(source.lastChecked) : source.lastChecked,
        createdAt: source.createdAt ? new Date(source.createdAt) : source.createdAt,
        updatedAt: source.updatedAt ? new Date(source.updatedAt) : source.updatedAt,
      };
      await db.insert(sources).values(sourceData);
      results.sourcesCreated++;

      if (!moduleExists) {
        console.warn(`Restored source '${source.name}' as inactive - module '${source.moduleKey}' not found`);
      }
    } catch (error: any) {
      console.warn(`Failed to restore source ${source.name}:`, error.message);
    }
  }

  for (const account of data.accounts) {
    try {
      // Convert date strings back to Date objects
      const accountData = {
        ...account,
        lastChecked: account.lastChecked ? new Date(account.lastChecked) : account.lastChecked,
        createdAt: account.createdAt ? new Date(account.createdAt) : account.createdAt,
        updatedAt: account.updatedAt ? new Date(account.updatedAt) : account.updatedAt,
      };
      await db.insert(instagramAccounts).values(accountData);
      results.accountsCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore Instagram account ${account.instagramUsername}:`, error.message);
    }
  }

  for (const session of data.sessions) {
    try {
      // Convert date strings back to Date objects
      const sessionData = {
        ...session,
        uploadedAt: session.uploadedAt ? new Date(session.uploadedAt) : session.uploadedAt,
        expiresAt: session.expiresAt ? new Date(session.expiresAt) : session.expiresAt,
        lastUsedAt: session.lastUsedAt ? new Date(session.lastUsedAt) : session.lastUsedAt,
      };
      await db.insert(instagramSessions).values(sessionData);
      results.sessionsCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore session ${session.username}:`, error.message);
    }
  }

  for (const run of data.runs ?? []) {
    try {
      // Convert date strings back to Date objects
      const runData = {
        ...run,
        startedAt: run.startedAt ? new Date(run.startedAt) : run.startedAt,
        finishedAt: run.finishedAt ? new Date(run.finishedAt) : run.finishedAt,
      };
      await db.insert(runs).values(runData);
      results.runsCreated++;
    } catch (error: any) {
      console.warn(`Failed to restore run ${run.id}:`, error.message);
    }
  }

  for (const event of data.events) {
    try {
      // Convert date strings back to Date objects
      const eventData = {
        ...event,
        startDatetime: event.startDatetime ? new Date(event.startDatetime) : event.startDatetime,
        endDatetime: event.endDatetime ? new Date(event.endDatetime) : event.endDatetime,
        scrapedAt: event.scrapedAt ? new Date(event.scrapedAt) : event.scrapedAt,
        lastSeenAt: event.lastSeenAt ? new Date(event.lastSeenAt) : event.lastSeenAt,
      };
      await db.insert(eventsRaw).values(eventData);
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
