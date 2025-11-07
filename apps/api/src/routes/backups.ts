import type { FastifyPluginAsync } from 'fastify';
import { tmpdir } from 'os';
import path, { join } from 'path';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import archiver from 'archiver';
import extract from 'extract-zip';
import { createReadStream, createWriteStream } from 'fs';
import { z } from 'zod';
import {
  copyInstagramImagesToDirectory,
  createDatabaseBackup,
  dropAndRecreatePublicSchema,
  ensureDir,
  fetchInstagramData,
  parseDatabaseUrl,
  restoreDatabaseFromSql,
  clearInstagramData,
  restoreInstagramData,
  restoreInstagramImagesFromDirectory,
} from '../services/backup-service.js';

const BACKUP_DIR = process.env.BACKUP_DIR || '/data/backups';
const IMAGES_DIR = process.env.INSTAGRAM_IMAGES_DIR || '/data/instagram_images';
const BUNDLE_PREFIX = 'bundle-backup';

interface Manifest {
  createdAt: string;
  includeDatabase: boolean;
  includeInstagramData: boolean;
  includeImages: boolean;
  counts: {
    instagramSources?: number;
    instagramAccounts?: number;
    instagramSessions?: number;
    instagramRuns?: number;
    instagramEvents?: number;
    instagramImages?: number;
  };
}

function manifestFilename(bundleFilename: string) {
  return bundleFilename.replace(/\.zip$/, '.json');
}

function synthesizeRunsFromEvents(events: any[]) {
  const fallbackRuns = new Map<string, any>();
  const nowIso = new Date().toISOString();

  for (const event of events) {
    const ensureRun = (maybeRunId?: string | null) => {
      if (!maybeRunId || fallbackRuns.has(maybeRunId)) return;
      const timestamp = event?.scrapedAt ?? event?.startDatetime ?? nowIso;
      fallbackRuns.set(maybeRunId, {
        id: maybeRunId,
        sourceId: event?.sourceId,
        startedAt: timestamp,
        finishedAt: event?.scrapedAt ?? event?.endDatetime ?? null,
        status: 'success',
        pagesCrawled: 0,
        eventsFound: 0,
        errorsJsonb: null,
        parentRunId: null,
        metadata: null,
      });
    };

    ensureRun(event?.runId);
    ensureRun(event?.lastUpdatedByRunId);
  }

  return Array.from(fallbackRuns.values());
}

export const backupBundleRoutes: FastifyPluginAsync = async (fastify) => {
  await ensureDir(BACKUP_DIR);

  const exportBodySchema = z
    .object({
      includeDatabase: z.boolean().default(true),
      includeInstagramData: z.boolean().default(false),
      includeImages: z.boolean().default(false),
    })
    .default({
      includeDatabase: true,
      includeInstagramData: false,
      includeImages: false,
    });

  const importOptionsSchema = z.object({
    applyDatabase: z.boolean().default(false),
    applyInstagramData: z.boolean().default(false),
    applyImages: z.boolean().default(false),
  });

  fastify.post('/export', async (request, reply) => {
    try {
      const body = exportBodySchema.parse(request.body ?? {});

      if (!body.includeDatabase && !body.includeInstagramData && !body.includeImages) {
        reply.status(400);
        return { error: 'Select at least one component to include in the backup' };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const bundleFilename = `${BUNDLE_PREFIX}-${timestamp}.zip`;
      const bundleFilepath = join(BACKUP_DIR, bundleFilename);
      const tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'bundle-'));

      const manifest: Manifest = {
        createdAt: new Date().toISOString(),
        includeDatabase: body.includeDatabase,
        includeInstagramData: body.includeInstagramData,
        includeImages: body.includeImages,
        counts: {},
      };

      try {
        if (body.includeDatabase) {
          const databaseUrl = process.env.DATABASE_URL;
          if (!databaseUrl) {
            throw new Error('DATABASE_URL not configured');
          }
          const dbConfig = parseDatabaseUrl(databaseUrl);
          await createDatabaseBackup(tempRoot, dbConfig, 'database.sql');
        }

        if (body.includeInstagramData) {
          const data = await fetchInstagramData();
          manifest.counts.instagramSources = data.sources.length;
          manifest.counts.instagramAccounts = data.accounts.length;
          manifest.counts.instagramSessions = data.sessions.length;
          manifest.counts.instagramRuns = data.runs.length;
          manifest.counts.instagramEvents = data.events.length;

          const instagramDir = join(tempRoot, 'instagram');
          await ensureDir(instagramDir);
          await fs.writeFile(join(instagramDir, 'sources.json'), JSON.stringify(data.sources, null, 2));
          await fs.writeFile(join(instagramDir, 'accounts.json'), JSON.stringify(data.accounts, null, 2));
          await fs.writeFile(join(instagramDir, 'sessions.json'), JSON.stringify(data.sessions, null, 2));
          await fs.writeFile(join(instagramDir, 'runs.json'), JSON.stringify(data.runs, null, 2));
          await fs.writeFile(join(instagramDir, 'events.json'), JSON.stringify(data.events, null, 2));
        }

        if (body.includeImages) {
          const imagesDir = join(tempRoot, 'instagram_images');
          const copied = await copyInstagramImagesToDirectory(IMAGES_DIR, imagesDir);
          manifest.counts.instagramImages = copied;
        }

        await fs.writeFile(join(tempRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(bundleFilepath);
          const archive = archiver('zip', { zlib: { level: 9 } });

          output.on('close', resolve);
          output.on('error', reject);
          archive.on('error', reject);

          archive.pipe(output);
          archive.directory(tempRoot, false);
          archive.finalize();
        });

        await fs.writeFile(
          join(BACKUP_DIR, manifestFilename(bundleFilename)),
          JSON.stringify(manifest, null, 2),
        );
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }

      reply.status(200);
      return {
        success: true,
        filename: bundleFilename,
        manifest,
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Failed to export backup bundle');
      reply.status(500);
      return { error: 'Failed to export backup bundle', message: error.message };
    }
  });

  fastify.get('/download/:filename', async (request, reply) => {
    try {
      const { filename } = request.params as { filename: string };
      if (!filename.endsWith('.zip') || !filename.startsWith(`${BUNDLE_PREFIX}-`)) {
        reply.status(400);
        return { error: 'Invalid backup filename' };
      }

      const filepath = join(BACKUP_DIR, filename);
      if (!existsSync(filepath)) {
        reply.status(404);
        return { error: 'Backup bundle not found' };
      }

      const stat = await fs.stat(filepath);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', stat.size);
      return reply.send(createReadStream(filepath));
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Failed to download backup bundle');
      reply.status(500);
      return { error: 'Failed to download backup bundle', message: error.message };
    }
  });

  fastify.get('/list', async (_request, reply) => {
    try {
      await ensureDir(BACKUP_DIR);
      const files = await fs.readdir(BACKUP_DIR);
      const bundles = await Promise.all(
        files
          .filter((file) => file.endsWith('.zip') && file.startsWith(`${BUNDLE_PREFIX}-`))
          .map(async (filename) => {
            const filepath = join(BACKUP_DIR, filename);
            const stats = await fs.stat(filepath);
            const manifestPath = join(BACKUP_DIR, manifestFilename(filename));
            let manifest: Manifest | null = null;
            try {
              const manifestContent = await fs.readFile(manifestPath, 'utf-8');
              manifest = JSON.parse(manifestContent) as Manifest;
            } catch {
              manifest = null;
            }

            return {
              filename,
              size: stats.size,
              createdAt: stats.birthtime,
              manifest,
            };
          }),
      );

      bundles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      reply.status(200);
      return {
        backups: bundles,
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Failed to list backup bundles');
      reply.status(500);
      return { error: 'Failed to list backup bundles', message: error.message };
    }
  });

  fastify.delete('/:filename', async (request, reply) => {
    try {
      const { filename } = request.params as { filename: string };
      if (!filename.endsWith('.zip') || !filename.startsWith(`${BUNDLE_PREFIX}-`)) {
        reply.status(400);
        return { error: 'Invalid backup filename' };
      }

      const filepath = join(BACKUP_DIR, filename);
      if (!existsSync(filepath)) {
        reply.status(404);
        return { error: 'Backup bundle not found' };
      }

      await fs.unlink(filepath);
      const manifestPath = join(BACKUP_DIR, manifestFilename(filename));
      try {
        await fs.unlink(manifestPath);
      } catch {
        // Ignore missing manifest
      }

      return { success: true };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Failed to delete backup bundle');
      reply.status(500);
      return { error: 'Failed to delete backup bundle', message: error.message };
    }
  });

  fastify.post('/import', async (request, reply) => {
    let restartScheduled = false;
    let tempDir: string | null = null;

    try {
      const file = await request.file();
      if (!file) {
        reply.status(400);
        return { error: 'No backup file uploaded' };
      }

      const fieldsRaw = file.fields ?? {};

      const getFieldValue = (field: any): string | undefined => {
        if (!field) return undefined;
        const entry = Array.isArray(field) ? field[0] : field;
        if (entry == null) return undefined;

        if (typeof entry === 'string') {
          return entry;
        }

        if (typeof entry === 'object' && 'value' in entry) {
          const value = entry.value;
          if (typeof value === 'string') {
            return value;
          }
          if (Buffer.isBuffer(value)) {
            return value.toString();
          }
          return value != null ? String(value) : undefined;
        }

        if (typeof entry === 'boolean' || typeof entry === 'number') {
          return String(entry);
        }

        return undefined;
      };

      const parseBooleanField = (value: string | undefined): boolean => {
        if (!value) return false;
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'on';
      };

      fastify.log.info({ fieldsRaw }, 'Import request fields');

      const applyDatabase = parseBooleanField(getFieldValue(fieldsRaw.applyDatabase));
      const applyInstagramData = parseBooleanField(getFieldValue(fieldsRaw.applyInstagramData));
      const applyImages = parseBooleanField(getFieldValue(fieldsRaw.applyImages));

      fastify.log.info({ applyDatabase, applyInstagramData, applyImages }, 'Parsed import options');

      const options = importOptionsSchema.parse({
        applyDatabase,
        applyInstagramData,
        applyImages,
      });

      if (!options.applyDatabase && !options.applyInstagramData && !options.applyImages) {
        reply.status(400);
        return { error: 'Select at least one component to restore' };
      }

      tempDir = await fs.mkdtemp(path.join(tmpdir(), 'bundle-import-'));
      const zipPath = join(tempDir, file.filename ?? `bundle-${Date.now()}.zip`);
      await fs.writeFile(zipPath, await file.toBuffer());

      const extractDir = join(tempDir, 'extracted');
      await fs.mkdir(extractDir, { recursive: true });
      await extract(zipPath, { dir: path.resolve(extractDir) });

      const manifestPath = join(extractDir, 'manifest.json');
      let manifest: Manifest | null = null;
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(manifestContent) as Manifest;
      } catch {
        manifest = null;
      }

      const response: any = {
        success: true,
        restored: {
          database: false,
          instagramData: false,
          images: false,
        },
      };

      if (options.applyDatabase) {
        if (!existsSync(join(extractDir, 'database.sql'))) {
          throw new Error('Backup is missing database.sql');
        }
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          throw new Error('DATABASE_URL not configured');
        }
        const dbConfig = parseDatabaseUrl(databaseUrl);
        await dropAndRecreatePublicSchema(dbConfig);
        await restoreDatabaseFromSql(join(extractDir, 'database.sql'), dbConfig);
        response.restored.database = true;
        restartScheduled = true;
      }

      if (options.applyInstagramData) {
        const instagramDir = join(extractDir, 'instagram');
        if (!existsSync(instagramDir)) {
          throw new Error('Backup is missing Instagram data');
        }

        const sourcesJson = await fs.readFile(join(instagramDir, 'sources.json'), 'utf-8');
        const sessionsJson = await fs.readFile(join(instagramDir, 'sessions.json'), 'utf-8');
        const eventsJson = await fs.readFile(join(instagramDir, 'events.json'), 'utf-8');

        let accountsJson = '[]';
        try {
          accountsJson = await fs.readFile(join(instagramDir, 'accounts.json'), 'utf-8');
        } catch {
          // accounts.json is optional
        }

        let runsJson = '[]';
        let runsFileMissing = false;
        try {
          runsJson = await fs.readFile(join(instagramDir, 'runs.json'), 'utf-8');
        } catch {
          runsFileMissing = true;
        }

        const sourcesData = JSON.parse(sourcesJson);
        const sessionsData = JSON.parse(sessionsJson);
        const eventsData = JSON.parse(eventsJson);
        const accountsData = JSON.parse(accountsJson);
        let runsData: any[] = [];
        try {
          runsData = JSON.parse(runsJson);
        } catch {
          runsData = [];
        }

        if ((runsFileMissing || runsData.length === 0) && eventsData.length > 0) {
          const synthesizedRuns = synthesizeRunsFromEvents(eventsData);
          if (synthesizedRuns.length > 0) {
            fastify.log.warn(
              { synthesizedRuns: synthesizedRuns.length },
              'runs.json missing from bundle; synthesized fallback run records',
            );
            runsData = synthesizedRuns;
          }
        }

        await clearInstagramData();
        const restoreResults = await restoreInstagramData({
          sources: sourcesData,
          accounts: accountsData,
          sessions: sessionsData,
          runs: runsData,
          events: eventsData,
        });

        response.restored.instagramData = true;
        response.instagramRestore = restoreResults;
      }

      if (options.applyImages) {
        const imagesDir = join(extractDir, 'instagram_images');
        if (!existsSync(imagesDir)) {
          throw new Error('Backup is missing Instagram images directory');
        }

        const restoredCount = await restoreInstagramImagesFromDirectory(imagesDir, IMAGES_DIR);
        response.restored.images = true;
        response.instagramImagesRestored = restoredCount;
      }

      if (restartScheduled) {
        response.restarting = true;
        fastify.log.info('Restarting server in 2 seconds after database restore');
        setTimeout(() => {
          fastify.log.info('Triggering restart after backup bundle import');
          process.exit(0);
        }, 2000);
      }

      return response;
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Failed to import backup bundle');
      reply.status(500);
      return { error: 'Failed to import backup bundle', message: error.message };
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
    }
  });
};
