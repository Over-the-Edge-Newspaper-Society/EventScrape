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
import { db } from '../db/connection.js';
import { instagramSettings, instagramAccounts, eventsRaw } from '../db/schema.js';
import { createEnhancedApifyClient } from '../services/instagram-apify-client.js';
import { importInstagramPostsFromApify } from '../services/instagram-apify-import.js';
import { SETTINGS_ID } from './instagram-review/constants.js';

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
      const normalizedPosts = posts
        .filter(post => post.permalink) // Filter out posts without permalinks
        .map(post => {
          const timestamp = new Date(post.timestamp);
          const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
          return {
            id: post.id,
            username: post.username,
            caption: post.caption,
            imageUrl: post.imageUrl,
            permalink: post.permalink!,
            timestamp: safeTimestamp,
            isVideo: post.isVideo ?? false,
          };
        });

      const result = await importInstagramPostsFromApify(normalizedPosts, {
        metadata: { importMethod: 'manual_snapshot' },
        sourceLabel: 'Apify snapshot',
      });

      return {
        success: true,
        stats: result.stats,
        message: result.message,
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

        const client = await createEnhancedApifyClient(
          settings.apifyApiToken,
          settings.apifyActorId || undefined
        );

        const snapshot = await client.fetchRunSnapshot(runId, limit);

        const result = await importInstagramPostsFromApify(snapshot.posts ?? [], {
          apifyRunId: runId,
          metadata: snapshot.input ? { apifyRunInput: snapshot.input } : undefined,
          sourceLabel: `Apify run ${runId}`,
        });

        return {
          success: true,
          runId,
          stats: result.stats,
          message: result.message,
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

      const client = await createEnhancedApifyClient(
        settings.apifyApiToken,
        settings.apifyActorId || undefined
      );

      const runtimeInfo = client.getRuntimeInfo();

      return {
        configured: true,
        actorId: settings.apifyActorId || 'apify/instagram-post-scraper',
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
