import { FastifyPluginAsync } from 'fastify';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { z } from 'zod';

const execAsync = promisify(exec);

// Parse DATABASE_URL to extract connection details
function parseDatabaseUrl(url: string) {
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

export const databaseRoutes: FastifyPluginAsync = async (fastify) => {
  const backupDir = process.env.BACKUP_DIR || '/data/backups';

  // Ensure backup directory exists
  if (!existsSync(backupDir)) {
    try {
      await mkdir(backupDir, { recursive: true });
    } catch (error: any) {
      fastify.log.error('Failed to create backup directory:', error);
    }
  }

  // Export database
  fastify.post('/export', async (request, reply) => {
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        reply.status(500);
        return { error: 'DATABASE_URL not configured' };
      }

      const dbConfig = parseDatabaseUrl(databaseUrl);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.sql`;
      const filepath = join(backupDir, filename);

      // Run pg_dump to create backup
      const command = `PGPASSWORD="${dbConfig.password}" pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -F p -f "${filepath}"`;

      await execAsync(command);

      fastify.log.info(`Database backup created: ${filename}`);

      reply.status(200);
      return {
        success: true,
        message: 'Database backup created successfully',
        filename,
        filepath,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      fastify.log.error('Database export failed:', error);
      reply.status(500);
      return {
        error: 'Database export failed',
        message: error.message,
      };
    }
  });

  // Download backup file
  fastify.get('/export/:filename', async (request, reply) => {
    try {
      const { filename } = request.params as { filename: string };

      // Validate filename to prevent directory traversal
      if (!filename || filename.includes('..') || filename.includes('/')) {
        reply.status(400);
        return { error: 'Invalid filename' };
      }

      const filepath = join(backupDir, filename);

      if (!existsSync(filepath)) {
        reply.status(404);
        return { error: 'Backup file not found' };
      }

      const fileContent = await readFile(filepath);

      reply.header('Content-Type', 'application/sql');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);

      return fileContent;
    } catch (error: any) {
      fastify.log.error('Backup download failed:', error);
      reply.status(500);
      return { error: 'Failed to download backup file' };
    }
  });

  // Import database
  fastify.post('/import', async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        reply.status(400);
        return { error: 'No file uploaded' };
      }

      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        reply.status(500);
        return { error: 'DATABASE_URL not configured' };
      }

      const dbConfig = parseDatabaseUrl(databaseUrl);

      // Save uploaded file temporarily
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tempFilename = `temp-import-${timestamp}.sql`;
      const tempFilepath = join(backupDir, tempFilename);

      const buffer = await data.toBuffer();
      await writeFile(tempFilepath, buffer);

      fastify.log.info(`Restoring database from uploaded file: ${data.filename}`);

      // First, drop all tables and recreate the schema
      // This ensures a clean restore without conflicts
      const dropCommand = `PGPASSWORD="${dbConfig.password}" psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${dbConfig.user}; GRANT ALL ON SCHEMA public TO public;"`;

      await execAsync(dropCommand);
      fastify.log.info('Dropped existing schema');

      // Now restore from backup
      const restoreCommand = `PGPASSWORD="${dbConfig.password}" psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${tempFilepath}"`;

      const result = await execAsync(restoreCommand);

      // Clean up temporary file
      await unlink(tempFilepath);

      fastify.log.info('Database restore completed successfully');

      // Trigger server restart to refresh database connections and enum type cache
      // This prevents "cache lookup failed for type" errors
      fastify.log.info('Restarting server in 2 seconds to refresh database connections...');
      setTimeout(() => {
        fastify.log.info('Triggering restart after database restore');
        process.exit(0); // Docker will automatically restart the container
      }, 2000);

      reply.status(200);
      return {
        success: true,
        message: 'Database restored successfully. Server restarting to refresh connections...',
        timestamp: new Date().toISOString(),
        output: result.stdout || 'Restore completed',
        restarting: true,
      };
    } catch (error: any) {
      fastify.log.error('Database import failed:', error);
      reply.status(500);
      return {
        error: 'Database import failed',
        message: error.message,
      };
    }
  });

  // List available backups
  fastify.get('/backups', async (request, reply) => {
    try {
      const { readdir, stat } = await import('fs/promises');

      if (!existsSync(backupDir)) {
        return { backups: [] };
      }

      const files = await readdir(backupDir);
      const backups = await Promise.all(
        files
          .filter(f => f.endsWith('.sql'))
          .map(async (filename) => {
            const filepath = join(backupDir, filename);
            const stats = await stat(filepath);
            return {
              filename,
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
            };
          })
      );

      // Sort by creation date, newest first
      backups.sort((a, b) => b.created.getTime() - a.created.getTime());

      return { backups };
    } catch (error: any) {
      fastify.log.error('Failed to list backups:', error);
      reply.status(500);
      return { error: 'Failed to list backups', message: error.message };
    }
  });

  // Delete a backup
  fastify.delete('/backups/:filename', async (request, reply) => {
    try {
      const { filename } = request.params as { filename: string };

      // Validate filename to prevent directory traversal
      if (!filename || filename.includes('..') || filename.includes('/')) {
        reply.status(400);
        return { error: 'Invalid filename' };
      }

      const filepath = join(backupDir, filename);

      if (!existsSync(filepath)) {
        reply.status(404);
        return { error: 'Backup file not found' };
      }

      await unlink(filepath);

      fastify.log.info(`Backup deleted: ${filename}`);

      return {
        success: true,
        message: 'Backup deleted successfully',
      };
    } catch (error: any) {
      fastify.log.error('Failed to delete backup:', error);
      reply.status(500);
      return { error: 'Failed to delete backup', message: error.message };
    }
  });
};
