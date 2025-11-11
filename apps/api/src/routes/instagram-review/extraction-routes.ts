import type { FastifyInstance } from 'fastify';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../../db/connection.js';
import { eventsRaw, sources } from '../../db/schema.js';
import { InstagramExtractionError } from './errors.js';
import { hasExtractedEvents } from './raw-utils.js';
import { bulkExtractSchema, extractOptionsSchema } from './schemas.js';
import type { ExtractionService } from './extraction-service.js';
import type { InstagramPostWithSource } from './types.js';

type BulkExtractionResult = {
  id: string;
  status: 'success' | 'error';
  message?: string;
  eventsCreated?: number;
};

export const registerExtractionRoutes = (
  fastify: FastifyInstance,
  extractionService: ExtractionService
) => {
  fastify.post<{ Params: { id: string } }>('/:id/extract', async (request, reply) => {
    const { id } = request.params;

    try {
      const options = extractOptionsSchema.parse(request.body);
      const result = await extractionService.extractPostById(id, options);
      return result;
    } catch (error: any) {
      if (error instanceof ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      if (error instanceof InstagramExtractionError) {
        reply.status(error.statusCode);
        if (error.details) {
          return { error: error.message, ...error.details };
        }
        return { error: error.message };
      }

      fastify.log.error(`Failed to extract event from post ${id}:`, error);
      reply.status(500);
      return { error: error.message || 'Failed to extract event data' };
    }
  });

  fastify.post('/extract-missing', async (request, reply) => {
    try {
      const { accountId, limit, overwrite } = bulkExtractSchema.parse(request.body ?? {});

      const { provider, apiKey } = await extractionService.getAISettings();

      const whereConditions = [
        eq(sources.sourceType, 'instagram'),
        eq(eventsRaw.isEventPoster, true),
        isNotNull(eventsRaw.localImagePath),
      ];

      if (accountId) {
        whereConditions.push(eq(eventsRaw.instagramAccountId, accountId));
      }

      const candidates = await db
        .select({
          event: eventsRaw,
          source: sources,
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(...whereConditions))
        .orderBy(desc(eventsRaw.scrapedAt));

      const postsRequiringExtraction = candidates.filter(({ event }) => !hasExtractedEvents(event.raw));
      const postsToProcess = (typeof limit === 'number'
        ? postsRequiringExtraction.slice(0, Math.max(limit, 0))
        : postsRequiringExtraction) as InstagramPostWithSource[];

      if (postsToProcess.length === 0) {
        return {
          success: true,
          message: 'No Instagram posts need extraction',
          processed: 0,
          successful: 0,
          failed: 0,
          remaining: postsRequiringExtraction.length,
          results: [] as BulkExtractionResult[],
        };
      }

      const results: BulkExtractionResult[] = [];
      let successCount = 0;

      for (const post of postsToProcess) {
        try {
          const extractionResult = await extractionService.performExtraction(post, {
            provider,
            apiKey,
            overwrite,
            createEvents: true,
          });

          successCount++;
          results.push({
            id: post.event.id,
            status: 'success',
            eventsCreated: extractionResult.eventsCreated,
          });
        } catch (error: any) {
          if (error instanceof InstagramExtractionError) {
            results.push({
              id: post.event.id,
              status: 'error',
              message: error.message,
            });
          } else {
            fastify.log.error(`Failed to extract post ${post.event.id} during bulk extraction:`, error);
            results.push({
              id: post.event.id,
              status: 'error',
              message: error?.message || 'Failed to extract event data',
            });
          }
        }
      }

      const failedCount = results.length - successCount;
      const remaining = Math.max(postsRequiringExtraction.length - successCount, 0);

      return {
        success: failedCount === 0,
        message: `Extracted event data for ${successCount} of ${postsToProcess.length} post(s)`,
        processed: postsToProcess.length,
        successful: successCount,
        failed: failedCount,
        remaining,
        results,
      };
    } catch (error: any) {
      if (error instanceof ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      if (error instanceof InstagramExtractionError) {
        reply.status(error.statusCode);
        return { error: error.message };
      }

      fastify.log.error('Failed to bulk extract Instagram posts:', error);
      reply.status(500);
      return { error: error.message || 'Failed to extract Instagram posts' };
    }
  });
};
