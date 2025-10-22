/**
 * Advanced Apify integration routes
 * - Test fetch
 * - Run snapshot import
 * - Runtime diagnostics
 * - Batch operations
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { v4 } from 'uuid';
import { db } from '../db/connection.js';
import { instagramSettings, instagramAccounts, eventsRaw } from '../db/schema.js';

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

// Validation schemas
const testFetchSchema = z.object({
  url: z.string().url(),
  limit: z.number().int().positive().max(100).optional().default(10),
});

const runSnapshotSchema = z.object({
  runId: z.string(),
  limit: z.number().int().positive().max(1000).optional().default(50),
});

const importSnapshotSchema = z.object({
  posts: z.array(z.object({
    id: z.string(),
    username: z.string(),
    caption: z.string().optional(),
    imageUrl: z.string().optional(),
    timestamp: z.string(),
    isVideo: z.boolean().optional(),
    permalink: z.string().optional(),
  })),
});

const batchFetchSchema = z.object({
  accountIds: z.array(z.string().uuid()).min(1).max(50),
  postLimit: z.number().int().positive().max(100).optional().default(10),
});

export const instagramApifyRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/instagram-apify/test-fetch
   * Test Apify fetch with a single Instagram URL
   */
  fastify.post('/test-fetch', async (request, reply) => {
    try {
      const { url, limit } = testFetchSchema.parse(request.body);

      // Get Apify settings
      const [settings] = await db
        .select()
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      if (!settings?.apifyApiToken) {
        reply.status(400);
        return { error: 'Apify API token not configured' };
      }

      // Dynamic import to avoid loading in non-worker context
      // @ts-ignore - Cross-package import, resolved at runtime
      const { createEnhancedApifyClient } = await import(
        '../../../../worker/src/modules/instagram/enhanced-apify-client.js'
      );

      const client = await createEnhancedApifyClient(
        settings.apifyApiToken,
        settings.apifyActorId || undefined
      );

      const result = await client.testFetch(url, limit);

      return {
        success: true,
        ...result,
        runtimeInfo: client.getRuntimeInfo(),
      };
    } catch (error: any) {
      fastify.log.error('Test fetch failed:', error);
      reply.status(500);
      return { error: error.message || 'Failed to test Apify fetch' };
    }
  });

  /**
   * GET /api/instagram-apify/run-snapshot/:runId
   * Fetch data from an existing Apify run
   */
  fastify.get<{ Params: { runId: string }; Querystring: { limit?: string } }>(
    '/run-snapshot/:runId',
    async (request, reply) => {
      try {
        const { runId } = request.params;
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

        if (!runId) {
          reply.status(400);
          return { error: 'Run ID is required' };
        }

        // Get Apify settings
        const [settings] = await db
          .select()
          .from(instagramSettings)
          .where(eq(instagramSettings.id, SETTINGS_ID));

        if (!settings?.apifyApiToken) {
          reply.status(400);
          return { error: 'Apify API token not configured' };
        }

        // @ts-ignore - Cross-package import, resolved at runtime
        const { createEnhancedApifyClient } = await import(
          '../../../../worker/src/modules/instagram/enhanced-apify-client.js'
        );

        const client = await createEnhancedApifyClient(
          settings.apifyApiToken,
          settings.apifyActorId || undefined
        );

        const result = await client.fetchRunSnapshot(runId, limit);

        return {
          success: true,
          runId,
          ...result,
        };
      } catch (error: any) {
        fastify.log.error('Failed to fetch run snapshot:', error);
        reply.status(500);
        return { error: error.message || 'Failed to fetch run snapshot' };
      }
    }
  );

  /**
   * POST /api/instagram-apify/import-snapshot
   * Import posts from an Apify run snapshot
   */
  fastify.post('/import-snapshot', async (request, reply) => {
    try {
      const { posts } = importSnapshotSchema.parse(request.body);

      // Get settings for Gemini extraction
      const [settings] = await db
        .select()
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      const stats = {
        attempted: posts.length,
        created: 0,
        skippedExisting: 0,
        missingAccounts: 0,
      };

      // Process each post
      for (const postData of posts) {
        // Find account by username
        const [account] = await db
          .select()
          .from(instagramAccounts)
          .where(eq(instagramAccounts.instagramUsername, postData.username));

        if (!account) {
          stats.missingAccounts++;
          continue;
        }

        // Check if post already exists
        const [existing] = await db
          .select()
          .from(eventsRaw)
          .where(eq(eventsRaw.instagramPostId, postData.id));

        if (existing) {
          stats.skippedExisting++;
          continue;
        }

        // Create event_raw record (without extraction for now)
        const timestamp = new Date(postData.timestamp);

        await db.insert(eventsRaw).values({
          sourceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', // Instagram source ID
          runId: v4(), // Generate new run ID for snapshot import
          sourceEventId: postData.id,
          title: postData.caption?.slice(0, 200) || 'Instagram Post',
          descriptionHtml: postData.caption || '',
          startDatetime: timestamp,
          timezone: account.defaultTimezone || 'America/Vancouver',
          url: postData.permalink || `https://instagram.com/p/${postData.id}/`,
          imageUrl: postData.imageUrl,
          raw: JSON.stringify(postData),
          contentHash: postData.id,
          instagramAccountId: account.id,
          instagramPostId: postData.id,
          instagramCaption: postData.caption,
        });

        stats.created++;
      }

      const message = stats.created > 0
        ? `Imported ${stats.created} new post(s) from Apify snapshot.`
        : stats.skippedExisting > 0
          ? 'No new posts imported; all posts already exist.'
          : stats.missingAccounts > 0
            ? 'Skipped posts because matching accounts were not found.'
            : 'No posts were imported.';

      return {
        success: true,
        stats,
        message,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error('Failed to import snapshot:', error);
      reply.status(500);
      return { error: error.message || 'Failed to import snapshot' };
    }
  });

  /**
   * POST /api/instagram-apify/batch-fetch
   * Fetch posts for multiple accounts in a single Apify run
   */
  fastify.post('/batch-fetch', async (request, reply) => {
    try {
      const { accountIds, postLimit } = batchFetchSchema.parse(request.body);

      // Get accounts
      const accounts = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.active, true));

      const requestedAccounts = accounts.filter(a => accountIds.includes(a.id));

      if (requestedAccounts.length === 0) {
        reply.status(400);
        return { error: 'No valid accounts found' };
      }

      // Get Apify settings
      const [settings] = await db
        .select()
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      if (!settings?.apifyApiToken) {
        reply.status(400);
        return { error: 'Apify API token not configured' };
      }

      // @ts-ignore - Cross-package import, resolved at runtime
      const { createEnhancedApifyClient } = await import(
        '../../../../worker/src/modules/instagram/enhanced-apify-client.js'
      );

      const client = await createEnhancedApifyClient(
        settings.apifyApiToken,
        settings.apifyActorId || undefined
      );

      // Get known post IDs for deduplication
      const knownIdsMap = new Map<string, Set<string>>();
      for (const account of requestedAccounts) {
        const knownPosts = await db
          .select({ instagramPostId: eventsRaw.instagramPostId })
          .from(eventsRaw)
          .where(eq(eventsRaw.instagramAccountId, account.id));

        knownIdsMap.set(
          account.instagramUsername,
          new Set(knownPosts.map(p => p.instagramPostId).filter(Boolean) as string[])
        );
      }

      // Batch fetch
      const usernames = requestedAccounts.map(a => a.instagramUsername);
      const postsByUser = await client.fetchPostsBatch(usernames, postLimit, knownIdsMap);

      const results = Array.from(postsByUser.entries()).map(([username, posts]) => ({
        username,
        postCount: posts.length,
        posts: posts.slice(0, 5), // Return first 5 for preview
      }));

      return {
        success: true,
        accountsProcessed: postsByUser.size,
        totalPosts: Array.from(postsByUser.values()).reduce((sum, posts) => sum + posts.length, 0),
        results,
        runtimeInfo: client.getRuntimeInfo(),
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error('Batch fetch failed:', error);
      reply.status(500);
      return { error: error.message || 'Failed to batch fetch' };
    }
  });

  /**
   * POST /api/instagram-apify/run/:runId/import
   * Fetch and import posts from an existing Apify run
   */
  fastify.post<{ Params: { runId: string }; Querystring: { limit?: string } }>(
    '/run/:runId/import',
    async (request, reply) => {
      try {
        const { runId } = request.params;
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

        if (!runId) {
          reply.status(400);
          return { error: 'Run ID is required' };
        }

        // Get Apify settings
        const [settings] = await db
          .select()
          .from(instagramSettings)
          .where(eq(instagramSettings.id, SETTINGS_ID));

        if (!settings?.apifyApiToken) {
          reply.status(400);
          return { error: 'Apify API token not configured' };
        }

        // @ts-ignore - Cross-package import, resolved at runtime
        const { createEnhancedApifyClient } = await import(
          '../../../../worker/src/modules/instagram/enhanced-apify-client.js'
        );

        const client = await createEnhancedApifyClient(
          settings.apifyApiToken,
          settings.apifyActorId || undefined
        );

        // Fetch run snapshot
        const snapshot = await client.fetchRunSnapshot(runId, limit);

        if (!snapshot.posts || snapshot.posts.length === 0) {
          return {
            success: true,
            stats: {
              attempted: 0,
              created: 0,
              skippedExisting: 0,
              missingAccounts: 0,
            },
            message: 'No posts found in the Apify run.',
          };
        }

        // Import posts
        const stats = {
          attempted: snapshot.posts.length,
          created: 0,
          skippedExisting: 0,
          missingAccounts: 0,
        };

        for (const postData of snapshot.posts) {
          // Skip posts without username
          if (!postData.username) {
            stats.missingAccounts++;
            continue;
          }

          // Find account by username
          const [account] = await db
            .select()
            .from(instagramAccounts)
            .where(eq(instagramAccounts.instagramUsername, postData.username));

          if (!account) {
            stats.missingAccounts++;
            continue;
          }

          // Check if post already exists
          const [existing] = await db
            .select()
            .from(eventsRaw)
            .where(eq(eventsRaw.instagramPostId, postData.id));

          if (existing) {
            stats.skippedExisting++;
            continue;
          }

          // Create event_raw record
          const timestamp = new Date(postData.timestamp);

          await db.insert(eventsRaw).values({
            sourceId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', // Instagram source ID
            runId: v4(), // Generate new run ID for snapshot import
            sourceEventId: postData.id,
            title: postData.caption?.slice(0, 200) || 'Instagram Post',
            descriptionHtml: postData.caption || '',
            startDatetime: timestamp,
            timezone: account.defaultTimezone || 'America/Vancouver',
            url: postData.permalink || `https://instagram.com/p/${postData.id}/`,
            imageUrl: postData.imageUrl,
            raw: JSON.stringify(postData),
            contentHash: postData.id,
            instagramAccountId: account.id,
            instagramPostId: postData.id,
            instagramCaption: postData.caption,
          });

          stats.created++;
        }

        const message = stats.created > 0
          ? `Imported ${stats.created} new post(s) from Apify run ${runId}.`
          : stats.skippedExisting > 0
            ? 'No new posts imported; all posts already exist.'
            : stats.missingAccounts > 0
              ? 'Skipped posts because matching accounts were not found.'
              : 'No posts were imported.';

        return {
          success: true,
          runId,
          stats,
          message,
        };
      } catch (error: any) {
        fastify.log.error('Failed to import from run:', error);
        reply.status(500);
        return { error: error.message || 'Failed to import from Apify run' };
      }
    }
  );

  /**
   * GET /api/instagram-apify/runtime-info
   * Get Apify runtime diagnostics
   */
  fastify.get('/runtime-info', async (request, reply) => {
    try {
      // Get Apify settings
      const [settings] = await db
        .select()
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      if (!settings?.apifyApiToken) {
        return {
          configured: false,
          message: 'Apify API token not configured',
        };
      }

      // @ts-ignore - Cross-package import, resolved at runtime
      const { createEnhancedApifyClient } = await import(
        '../../../../worker/src/modules/instagram/enhanced-apify-client.js'
      );

      const client = await createEnhancedApifyClient(
        settings.apifyApiToken,
        settings.apifyActorId || undefined
      );

      const runtimeInfo = client.getRuntimeInfo();

      return {
        configured: true,
        actorId: settings.apifyActorId || 'apify/instagram-profile-scraper',
        resultsLimit: settings.apifyResultsLimit || 30,
        ...runtimeInfo,
        nodeRunnerStatus: runtimeInfo.nodeAvailable
          ? runtimeInfo.nodeFailed
            ? 'failed'
            : 'available'
          : 'unavailable',
      };
    } catch (error: any) {
      fastify.log.error('Failed to get runtime info:', error);
      reply.status(500);
      return { error: error.message || 'Failed to get runtime info' };
    }
  });
};
