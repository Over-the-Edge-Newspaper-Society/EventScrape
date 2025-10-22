import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { instagramAccounts, instagramSessions } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import { enqueueInstagramScrapeJob } from '../queue/queue.js';

const createSourceSchema = z.object({
  name: z.string().min(1),
  instagramUsername: z.string().min(1),
  classificationMode: z.enum(['manual', 'auto']).default('manual'),
  instagramScraperType: z.enum(['apify', 'instagram-private-api']).default('instagram-private-api'),
  active: z.boolean().default(true),
  defaultTimezone: z.string().default('America/Vancouver'),
  notes: z.string().optional(),
});

const updateSourceSchema = z.object({
  name: z.string().min(1).optional(),
  instagramUsername: z.string().min(1).optional(),
  classificationMode: z.enum(['manual', 'auto']).optional(),
  instagramScraperType: z.enum(['apify', 'instagram-private-api']).optional(),
  active: z.boolean().optional(),
  notes: z.string().optional(),
});

const uploadSessionSchema = z.object({
  username: z.string().min(1),
  sessionData: z.object({
    cookies: z.string(),
    state: z.any().optional(),
  }),
});

export const instagramSourcesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/instagram-sources - List all Instagram accounts
  fastify.get('/', async (request, reply) => {
    try {
      const accounts = await db
        .select()
        .from(instagramAccounts)
        .orderBy(instagramAccounts.createdAt);

      return { sources: accounts };
    } catch (error: any) {
      fastify.log.error('Failed to fetch Instagram accounts:', error);
      reply.status(500);
      return { error: 'Failed to fetch Instagram accounts' };
    }
  });

  // GET /api/instagram-sources/:id - Get single Instagram account
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const [account] = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.id, id));

      if (!account) {
        reply.status(404);
        return { error: 'Instagram account not found' };
      }

      return { source: account };
    } catch (error: any) {
      fastify.log.error(`Failed to fetch Instagram account ${id}:`, error);
      reply.status(500);
      return { error: 'Failed to fetch Instagram account' };
    }
  });

  // POST /api/instagram-sources - Create new Instagram account
  fastify.post('/', async (request, reply) => {
    try {
      const data = createSourceSchema.parse(request.body);

      // Check if username already exists
      const [existing] = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.instagramUsername, data.instagramUsername));

      if (existing) {
        reply.status(400);
        return { error: 'An Instagram account for this username already exists' };
      }

      const [newAccount] = await db
        .insert(instagramAccounts)
        .values({
          name: data.name,
          instagramUsername: data.instagramUsername,
          classificationMode: data.classificationMode,
          instagramScraperType: data.instagramScraperType,
          active: data.active,
          defaultTimezone: data.defaultTimezone,
          notes: data.notes,
        })
        .returning();

      return { source: newAccount };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error('Failed to create Instagram account:', error);
      reply.status(500);
      return { error: 'Failed to create Instagram account' };
    }
  });

  // PATCH /api/instagram-sources/:id - Update Instagram account
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const data = updateSourceSchema.parse(request.body);

      // Check if account exists
      const [existing] = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.id, id));

      if (!existing) {
        reply.status(404);
        return { error: 'Instagram account not found' };
      }

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (data.name !== undefined) updateData.name = data.name;
      if (data.instagramUsername !== undefined) updateData.instagramUsername = data.instagramUsername;
      if (data.classificationMode !== undefined) updateData.classificationMode = data.classificationMode;
      if (data.instagramScraperType !== undefined) updateData.instagramScraperType = data.instagramScraperType;
      if (data.active !== undefined) updateData.active = data.active;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const [updated] = await db
        .update(instagramAccounts)
        .set(updateData)
        .where(eq(instagramAccounts.id, id))
        .returning();

      return { source: updated };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error(`Failed to update Instagram account ${id}:`, error);
      reply.status(500);
      return { error: 'Failed to update Instagram account' };
    }
  });

  // DELETE /api/instagram-sources/:id - Delete Instagram account
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const [deleted] = await db
        .delete(instagramAccounts)
        .where(eq(instagramAccounts.id, id))
        .returning();

      if (!deleted) {
        reply.status(404);
        return { error: 'Instagram account not found' };
      }

      return { message: 'Instagram account deleted successfully', source: deleted };
    } catch (error: any) {
      fastify.log.error(`Failed to delete Instagram account ${id}:`, error);
      reply.status(500);
      return { error: 'Failed to delete Instagram account' };
    }
  });

  // POST /api/instagram-sources/:id/trigger - Manually trigger fetch for an account
  fastify.post('/:id/trigger', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const [account] = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.id, id));

      if (!account) {
        reply.status(404);
        return { error: 'Instagram account not found' };
      }

      // Queue Instagram scrape job via BullMQ
      const job = await enqueueInstagramScrapeJob({
        accountId: account.id,
        postLimit: 10
      });

      return {
        message: 'Instagram scrape job queued',
        accountId: account.id,
        username: account.instagramUsername,
        jobId: job.id,
      };
    } catch (error: any) {
      fastify.log.error(`Failed to trigger scrape for Instagram account ${id}:`, error);
      reply.status(500);
      return { error: 'Failed to trigger Instagram scrape' };
    }
  });

  // POST /api/instagram-sources/trigger-all-active - Trigger scrape for all active accounts
  fastify.post('/trigger-all-active', async (request, reply) => {
    try {
      // Fetch all active accounts
      const accounts = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.active, true));

      if (accounts.length === 0) {
        reply.status(400);
        return { error: 'No active Instagram accounts found' };
      }

      // Enqueue jobs for each account
      const jobs = [];
      for (const account of accounts) {
        const job = await enqueueInstagramScrapeJob({
          accountId: account.id,
          postLimit: 10
        });
        jobs.push({
          accountId: account.id,
          username: account.instagramUsername,
          jobId: job.id,
        });
      }

      return {
        message: `Queued ${accounts.length} scrape jobs for active accounts`,
        accountsQueued: accounts.length,
        jobs,
      };
    } catch (error: any) {
      fastify.log.error('Failed to scrape all active accounts:', error);
      reply.status(500);
      return { error: 'Failed to scrape all active accounts' };
    }
  });

  // POST /api/instagram-sessions - Upload Instagram session
  fastify.post('/sessions', async (request, reply) => {
    try {
      const data = uploadSessionSchema.parse(request.body);

      // Check if session already exists for this username
      const [existing] = await db
        .select()
        .from(instagramSessions)
        .where(eq(instagramSessions.username, data.username));

      if (existing) {
        // Update existing session
        const [updated] = await db
          .update(instagramSessions)
          .set({
            sessionData: data.sessionData,
            uploadedAt: new Date(),
            isValid: true,
          })
          .where(eq(instagramSessions.username, data.username))
          .returning();

        return { message: 'Session updated successfully', session: updated };
      } else {
        // Create new session
        const [newSession] = await db
          .insert(instagramSessions)
          .values({
            username: data.username,
            sessionData: data.sessionData,
          })
          .returning();

        return { message: 'Session created successfully', session: newSession };
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error('Failed to upload Instagram session:', error);
      reply.status(500);
      return { error: 'Failed to upload Instagram session' };
    }
  });

  // GET /api/instagram-sessions/:username - Get session status
  fastify.get('/sessions/:username', async (request, reply) => {
    const { username } = request.params as { username: string };

    try {
      const [session] = await db
        .select({
          id: instagramSessions.id,
          username: instagramSessions.username,
          uploadedAt: instagramSessions.uploadedAt,
          expiresAt: instagramSessions.expiresAt,
          lastUsedAt: instagramSessions.lastUsedAt,
          isValid: instagramSessions.isValid,
          // Don't return actual session data for security
        })
        .from(instagramSessions)
        .where(eq(instagramSessions.username, username));

      if (!session) {
        reply.status(404);
        return { error: 'Session not found for this username' };
      }

      return { session };
    } catch (error: any) {
      fastify.log.error(`Failed to fetch session for ${username}:`, error);
      reply.status(500);
      return { error: 'Failed to fetch session' };
    }
  });

  // DELETE /api/instagram-sessions/:username - Delete session
  fastify.delete('/sessions/:username', async (request, reply) => {
    const { username } = request.params as { username: string };

    try {
      const [deleted] = await db
        .delete(instagramSessions)
        .where(eq(instagramSessions.username, username))
        .returning();

      if (!deleted) {
        reply.status(404);
        return { error: 'Session not found' };
      }

      return { message: 'Session deleted successfully' };
    } catch (error: any) {
      fastify.log.error(`Failed to delete session for ${username}:`, error);
      reply.status(500);
      return { error: 'Failed to delete session' };
    }
  });

  // POST /api/instagram-sources/bulk-import - Bulk import sources from CSV
  fastify.post('/bulk-import', async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        reply.status(400);
        return { error: 'No file uploaded' };
      }

      // Read CSV content
      const buffer = await data.toBuffer();
      const csvContent = buffer.toString('utf-8');

      // Parse CSV (simple implementation)
      const lines = csvContent.split('\n').filter(line => line.trim());
      if (lines.length === 0) {
        reply.status(400);
        return { error: 'CSV file is empty' };
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const nameIdx = headers.indexOf('name');
      const usernameIdx = headers.indexOf('username');
      const activeIdx = headers.indexOf('active');
      const classificationModeIdx = headers.indexOf('classification_mode');

      if (nameIdx === -1 || usernameIdx === -1) {
        reply.status(400);
        return { error: 'CSV must include "name" and "username" columns' };
      }

      const results = {
        created: 0,
        skipped: 0,
        errors: [] as string[],
      };

      // Process each row
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());

        const name = values[nameIdx];
        const username = values[usernameIdx];
        const active = activeIdx !== -1 ? values[activeIdx].toLowerCase() === 'true' : true;
        const classificationMode = classificationModeIdx !== -1 && values[classificationModeIdx]
          ? values[classificationModeIdx].toLowerCase() as 'manual' | 'auto'
          : 'manual';

        if (!name || !username) {
          results.errors.push(`Row ${i + 1}: Missing name or username`);
          continue;
        }

        try {
          // Check if already exists
          const [existing] = await db
            .select()
            .from(instagramAccounts)
            .where(eq(instagramAccounts.instagramUsername, username));

          if (existing) {
            results.skipped++;
            continue;
          }

          // Create account
          await db.insert(instagramAccounts).values({
            name,
            instagramUsername: username,
            classificationMode,
            active,
            defaultTimezone: 'America/Vancouver',
          });

          results.created++;
        } catch (error: any) {
          results.errors.push(`Row ${i + 1}: ${error.message}`);
        }
      }

      return {
        message: 'Bulk import completed',
        ...results,
      };
    } catch (error: any) {
      fastify.log.error('Failed to bulk import sources:', error);
      reply.status(500);
      return { error: 'Failed to bulk import sources' };
    }
  });
};
