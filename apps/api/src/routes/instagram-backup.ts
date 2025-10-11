import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { sources, instagramSessions, eventsRaw } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import archiver from 'archiver';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import extract from 'extract-zip';
import Database from 'better-sqlite3';

const BACKUP_DIR = process.env.BACKUP_DIR || '/data/backups';
const IMAGES_DIR = process.env.INSTAGRAM_IMAGES_DIR || '/data/instagram_images';

export const instagramBackupRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/instagram-backup/create - Create backup zip
  fastify.post('/create', async (request, reply) => {
    try {
      await fs.mkdir(BACKUP_DIR, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `instagram-backup-${timestamp}.zip`;
      const backupPath = path.join(BACKUP_DIR, backupFilename);

      // Create zip archive
      const output = createWriteStream(backupPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.pipe(output);

      // Add database export (JSON format)
      const sourcesData = await db.select().from(sources).where(eq(sources.sourceType, 'instagram'));
      const sessionsData = await db.select().from(instagramSessions);
      const eventsData = await db
        .select()
        .from(eventsRaw)
        .where(eq(eventsRaw.instagramPostId, eventsRaw.instagramPostId)); // Filter Instagram events

      archive.append(JSON.stringify(sourcesData, null, 2), { name: 'sources.json' });
      archive.append(JSON.stringify(sessionsData, null, 2), { name: 'sessions.json' });
      archive.append(JSON.stringify(eventsData, null, 2), { name: 'events.json' });

      // Add Instagram images directory
      try {
        await fs.access(IMAGES_DIR);
        archive.directory(IMAGES_DIR, 'images');
      } catch {
        fastify.log.warn('Instagram images directory not found, skipping');
      }

      await archive.finalize();

      await new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve());
        output.on('error', reject);
      });

      return {
        message: 'Backup created successfully',
        filename: backupFilename,
        size: archive.pointer(),
      };
    } catch (error: any) {
      fastify.log.error('Failed to create backup:', error);
      reply.status(500);
      return { error: 'Failed to create backup', details: error.message };
    }
  });

  // GET /api/instagram-backup/download/:filename - Download backup
  fastify.get('/download/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };

    try {
      // Security: only allow files in backup directory
      if (filename.includes('..') || filename.includes('/')) {
        reply.status(400);
        return { error: 'Invalid filename' };
      }

      const backupPath = path.join(BACKUP_DIR, filename);

      // Check if file exists
      await fs.access(backupPath);

      const stat = await fs.stat(backupPath);

      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', stat.size);

      return reply.send(createReadStream(backupPath));
    } catch (error: any) {
      fastify.log.error('Failed to download backup:', error);
      reply.status(404);
      return { error: 'Backup file not found' };
    }
  });

  // GET /api/instagram-backup/list - List available backups
  fastify.get('/list', async (request, reply) => {
    try {
      await fs.mkdir(BACKUP_DIR, { recursive: true });

      const files = await fs.readdir(BACKUP_DIR);
      const backups = await Promise.all(
        files
          .filter(file => file.endsWith('.zip'))
          .map(async file => {
            const filePath = path.join(BACKUP_DIR, file);
            const stat = await fs.stat(filePath);
            return {
              filename: file,
              size: stat.size,
              createdAt: stat.birthtime,
            };
          })
      );

      return { backups: backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) };
    } catch (error: any) {
      fastify.log.error('Failed to list backups:', error);
      reply.status(500);
      return { error: 'Failed to list backups' };
    }
  });

  // POST /api/instagram-backup/restore - Restore from backup zip
  fastify.post('/restore', async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        reply.status(400);
        return { error: 'No file uploaded' };
      }

      // Save uploaded file temporarily
      const tempDir = path.join(BACKUP_DIR, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const timestamp = Date.now();
      const tempZipPath = path.join(tempDir, `restore-${timestamp}.zip`);
      const extractDir = path.join(tempDir, `extract-${timestamp}`);

      await pipeline(data.file, createWriteStream(tempZipPath));

      // Extract zip (extract-zip requires absolute path)
      await extract(tempZipPath, { dir: path.resolve(extractDir) });

      // Check if required files exist
      const requiredFiles = ['sources.json', 'sessions.json', 'events.json'];
      for (const file of requiredFiles) {
        try {
          await fs.access(path.join(extractDir, file));
        } catch {
          throw new Error(`Invalid backup format: missing ${file}. Please create a backup using the "Download Backup ZIP" button.`);
        }
      }

      // Read JSON files
      const sourcesJson = await fs.readFile(path.join(extractDir, 'sources.json'), 'utf-8');
      const sessionsJson = await fs.readFile(path.join(extractDir, 'sessions.json'), 'utf-8');
      const eventsJson = await fs.readFile(path.join(extractDir, 'events.json'), 'utf-8');

      const sourcesData = JSON.parse(sourcesJson);
      const sessionsData = JSON.parse(sessionsJson);
      const eventsData = JSON.parse(eventsJson);

      const results = {
        sourcesCreated: 0,
        sessionsCreated: 0,
        eventsCreated: 0,
        imagesRestored: 0,
      };

      // Restore sources
      for (const source of sourcesData) {
        try {
          // Check if already exists
          const [existing] = await db
            .select()
            .from(sources)
            .where(eq(sources.moduleKey, source.moduleKey));

          if (!existing) {
            await db.insert(sources).values(source);
            results.sourcesCreated++;
          }
        } catch (error: any) {
          fastify.log.warn(`Failed to restore source ${source.name}:`, error.message);
        }
      }

      // Restore sessions
      for (const session of sessionsData) {
        try {
          const [existing] = await db
            .select()
            .from(instagramSessions)
            .where(eq(instagramSessions.username, session.username));

          if (!existing) {
            await db.insert(instagramSessions).values(session);
            results.sessionsCreated++;
          }
        } catch (error: any) {
          fastify.log.warn(`Failed to restore session ${session.username}:`, error.message);
        }
      }

      // Restore events
      for (const event of eventsData) {
        try {
          const [existing] = await db
            .select()
            .from(eventsRaw)
            .where(eq(eventsRaw.id, event.id));

          if (!existing) {
            await db.insert(eventsRaw).values(event);
            results.eventsCreated++;
          }
        } catch (error: any) {
          fastify.log.warn(`Failed to restore event ${event.id}:`, error.message);
        }
      }

      // Restore images
      const imagesSourceDir = path.join(extractDir, 'images');
      try {
        await fs.access(imagesSourceDir);
        await fs.mkdir(IMAGES_DIR, { recursive: true });

        const imageFiles = await fs.readdir(imagesSourceDir);
        for (const file of imageFiles) {
          try {
            const sourcePath = path.join(imagesSourceDir, file);
            const destPath = path.join(IMAGES_DIR, file);

            // Check if file already exists
            try {
              await fs.access(destPath);
            } catch {
              await fs.copyFile(sourcePath, destPath);
              results.imagesRestored++;
            }
          } catch (error: any) {
            fastify.log.warn(`Failed to restore image ${file}:`, error.message);
          }
        }
      } catch {
        fastify.log.warn('No images directory found in backup');
      }

      // Cleanup temp files
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error: any) {
        fastify.log.warn('Failed to cleanup temp files:', error.message);
      }

      return {
        message: 'Restore completed',
        ...results,
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Failed to restore backup');
      console.error('Restore backup error:', error);
      reply.status(500);
      return { error: 'Failed to restore backup', details: error.message, stack: error.stack };
    }
  });

  // POST /api/instagram-backup/import-sqlite - Import from old Event-Monitor SQLite
  fastify.post('/import-sqlite', async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        reply.status(400);
        return { error: 'No file uploaded' };
      }

      // Save uploaded file temporarily
      const tempDir = path.join(BACKUP_DIR, 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const timestamp = Date.now();
      let tempDbPath: string;
      let extractDir: string | null = null;

      // Check if it's a ZIP file (full backup) or SQLite file
      const filename = data.filename || '';
      if (filename.endsWith('.zip')) {
        // It's a ZIP backup - extract it
        const tempZipPath = path.join(tempDir, `import-${timestamp}.zip`);
        extractDir = path.join(tempDir, `extract-${timestamp}`);

        await pipeline(data.file, createWriteStream(tempZipPath));
        await extract(tempZipPath, { dir: path.resolve(extractDir) });

        // Look for .db file in the extracted directory
        const files = await fs.readdir(extractDir);
        const dbFile = files.find(f => f.endsWith('.db') || f.endsWith('.sqlite') || f.endsWith('.sqlite3'));

        if (!dbFile) {
          throw new Error('No SQLite database file found in the backup ZIP');
        }

        tempDbPath = path.join(extractDir, dbFile);
      } else {
        // It's a direct SQLite file
        tempDbPath = path.join(tempDir, `import-${timestamp}.db`);
        await pipeline(data.file, createWriteStream(tempDbPath));
      }

      // Open SQLite database
      const sqlite = new Database(tempDbPath, { readonly: true });

      const results = {
        clubsImported: 0,
        postsImported: 0,
        eventsImported: 0,
        errors: [] as string[],
      };

      try {
        // Import clubs as sources
        const clubs = sqlite.prepare('SELECT * FROM clubs').all() as any[];

        for (const club of clubs) {
          try {
            const moduleKey = `instagram_${club.username.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

            // Check if already exists
            const [existing] = await db
              .select()
              .from(sources)
              .where(eq(sources.moduleKey, moduleKey));

            if (!existing) {
              await db.insert(sources).values({
                name: club.name,
                baseUrl: `https://instagram.com/${club.username}`,
                moduleKey,
                sourceType: 'instagram',
                instagramUsername: club.username,
                classificationMode: club.classification_mode === 'ai' ? 'auto' : 'manual',
                active: club.active === 1,
                defaultTimezone: 'America/Vancouver',
              });
              results.clubsImported++;
            }
          } catch (error: any) {
            results.errors.push(`Club ${club.name}: ${error.message}`);
          }
        }

        // Note: Posts and events would need more complex mapping
        // This is a simplified version - you may need to customize based on your old schema

      } catch (error: any) {
        results.errors.push(`Database error: ${error.message}`);
      } finally {
        sqlite.close();
      }

      // Import images if this was a ZIP backup
      if (extractDir) {
        const oldImagesDir = path.join(extractDir, 'static', 'images');
        try {
          await fs.access(oldImagesDir);
          await fs.mkdir(IMAGES_DIR, { recursive: true });

          const imageFiles = await fs.readdir(oldImagesDir);
          let imagesImported = 0;

          for (const file of imageFiles) {
            try {
              const sourcePath = path.join(oldImagesDir, file);
              const destPath = path.join(IMAGES_DIR, file);

              // Check if file already exists
              try {
                await fs.access(destPath);
              } catch {
                await fs.copyFile(sourcePath, destPath);
                imagesImported++;
              }
            } catch (error: any) {
              fastify.log.warn(`Failed to import image ${file}:`, error.message);
            }
          }

          results.errors.push(`Imported ${imagesImported} images`);
        } catch {
          fastify.log.info('No static/images directory found in old backup');
        }
      }

      // Cleanup temp files
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error: any) {
        fastify.log.warn('Failed to cleanup temp files:', error.message);
      }

      return {
        message: 'SQLite import completed',
        ...results,
      };
    } catch (error: any) {
      fastify.log.error('Failed to import SQLite:', error);
      reply.status(500);
      return { error: 'Failed to import SQLite database', details: error.message };
    }
  });
};
