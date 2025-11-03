import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import path from 'path';
import { ZodError } from 'zod';
import { db } from '../../db/connection.js';
import { eventsRaw, sources } from '../../db/schema.js';
import type { EventRaw } from '../../db/schema.js';
import { DOWNLOAD_DIR } from './constants.js';
import { InstagramExtractionError } from './errors.js';
import { parseEventRaw } from './raw-utils.js';
import { bulkAiClassifySchema } from './schemas.js';
import type { ExtractionService } from './extraction-service.js';
import type { InstagramPostWithSource } from './types.js';

type GeminiClassifierModule = {
  classifyEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: {
      caption?: string;
      postTimestamp?: Date | string;
    }
  ) => Promise<{
    isEventPoster: boolean;
    confidence?: number;
    [key: string]: unknown;
  }>;
};

const createClassifierLoader = () => {
  let classifierModule: GeminiClassifierModule | null = null;

  return async () => {
    if (classifierModule) {
      return classifierModule;
    }

    const importPath = new URL(
      '../../worker/src/modules/instagram/gemini-extractor.js',
      import.meta.url
    ).href;

    classifierModule = (await import(importPath)) as GeminiClassifierModule;
    return classifierModule;
  };
};

const getClassifierModule = createClassifierLoader();

type GeminiClassificationResult = Awaited<
  ReturnType<GeminiClassifierModule['classifyEventFromImageFile']>
>;

type BulkAiClassificationResult = {
  id: string;
  status: 'success' | 'error';
  isEventPoster?: boolean;
  confidence?: number | null;
  message?: string;
};

const resolveRawAndTimestamp = (post: EventRaw) => {
  const existingRaw = parseEventRaw(post.raw);
  let instagramTimestamp: Date | string | undefined = post.scrapedAt ?? undefined;

  const rawInstagramTimestamp =
    (existingRaw as { instagram?: { timestamp?: string } } | undefined)?.instagram?.timestamp;

  if (rawInstagramTimestamp) {
    const parsedTimestamp = new Date(rawInstagramTimestamp);
    if (!Number.isNaN(parsedTimestamp.getTime())) {
      instagramTimestamp = parsedTimestamp;
    }
  }

  return {
    existingRaw,
    instagramTimestamp,
  };
};

const mergeClassificationIntoRaw = (
  existingRaw: unknown,
  classification: GeminiClassificationResult
) => {
  try {
    const baseRaw: Record<string, unknown> =
      existingRaw && typeof existingRaw === 'object'
        ? { ...(existingRaw as Record<string, unknown>) }
        : {};

    const existingClassification =
      typeof baseRaw['classification'] === 'object' && baseRaw['classification'] !== null
        ? { ...(baseRaw['classification'] as Record<string, unknown>) }
        : {};

    const classificationRecord: Record<string, unknown> = {
      ...classification,
      decidedAt: new Date().toISOString(),
      method: 'gemini',
    };

    return {
      ...baseRaw,
      classification: {
        ...existingClassification,
        gemini: classificationRecord,
      },
    };
  } catch {
    return undefined;
  }
};

export const registerAiClassificationRoutes = (
  fastify: FastifyInstance,
  extractionService: ExtractionService
) => {
  fastify.post('/ai-classify/bulk', async (request, reply) => {
    try {
      const { accountId, limit } = bulkAiClassifySchema.parse(request.body ?? {});

      const whereConditions = [eq(sources.sourceType, 'instagram'), isNull(eventsRaw.isEventPoster)];
      if (accountId) {
        whereConditions.push(eq(eventsRaw.instagramAccountId, accountId));
      }

      const candidates = (await db
        .select({
          event: eventsRaw,
          source: sources,
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(...whereConditions))
        .orderBy(desc(eventsRaw.scrapedAt))) as InstagramPostWithSource[];

      const postsToProcess =
        typeof limit === 'number'
          ? candidates.slice(0, Math.max(limit, 0))
          : candidates;

      if (postsToProcess.length === 0) {
        return {
          success: true,
          message: 'No Instagram posts need AI classification',
          processed: 0,
          successful: 0,
          failed: 0,
          remaining: candidates.length,
          results: [] as BulkAiClassificationResult[],
        };
      }

      const geminiApiKey = await extractionService.getGeminiApiKey();
      const { classifyEventFromImageFile } = await getClassifierModule();

      const results: BulkAiClassificationResult[] = [];
      let successCount = 0;

      for (const { event } of postsToProcess) {
        if (!event.localImagePath) {
          results.push({
            id: event.id,
            status: 'error',
            message: 'Post does not have a local image. Image must be downloaded first.',
          });
          continue;
        }

        const fullImagePath = path.join(DOWNLOAD_DIR, event.localImagePath);
        const { existingRaw, instagramTimestamp } = resolveRawAndTimestamp(event);

        try {
          const classification = await classifyEventFromImageFile(fullImagePath, geminiApiKey, {
            caption: event.instagramCaption || undefined,
            postTimestamp: instagramTimestamp,
          });

          const updatePayload: Record<string, unknown> = {
            isEventPoster: classification.isEventPoster,
            classificationConfidence:
              typeof classification.confidence === 'number' ? classification.confidence : null,
          };

          const mergedRaw = mergeClassificationIntoRaw(existingRaw, classification);
          if (mergedRaw) {
            updatePayload.raw = mergedRaw;
          }

          await db.update(eventsRaw).set(updatePayload).where(eq(eventsRaw.id, event.id));

          successCount++;
          results.push({
            id: event.id,
            status: 'success',
            isEventPoster: classification.isEventPoster,
            confidence:
              typeof classification.confidence === 'number' ? classification.confidence : null,
          });
        } catch (error: any) {
          let message = error?.message || 'Failed to classify post with AI';

          if (error instanceof InstagramExtractionError) {
            message = error.message;
          } else {
            fastify.log.error(
              `Failed to AI-classify Instagram post ${event.id} during bulk classification:`,
              error
            );
          }

          results.push({
            id: event.id,
            status: 'error',
            message,
          });
        }
      }

      const failedCount = results.length - successCount;

      const remainingConditions = [eq(sources.sourceType, 'instagram'), isNull(eventsRaw.isEventPoster)];
      if (accountId) {
        remainingConditions.push(eq(eventsRaw.instagramAccountId, accountId));
      }

      const remainingResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(...remainingConditions));

      const remaining = remainingResult[0]?.count ?? 0;

      return {
        success: failedCount === 0,
        message: `AI classified ${successCount} of ${results.length} post(s)`,
        processed: results.length,
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

      fastify.log.error('Failed to bulk AI-classify Instagram posts:', error);
      reply.status(500);
      return { error: error.message || 'Failed to classify Instagram posts with AI' };
    }
  });

  fastify.post<{ Params: { id: string } }>('/:id/ai-classify', async (request, reply) => {
    const { id } = request.params;

    try {
      const geminiApiKey = await extractionService.getGeminiApiKey();

      const [result] = await db
        .select({
          event: eventsRaw,
          source: sources,
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(eq(eventsRaw.id, id), eq(sources.sourceType, 'instagram')));

      if (!result) {
        reply.status(404);
        return { error: 'Instagram post not found' };
      }

      const { event: post } = result;

      if (!post.localImagePath) {
        reply.status(400);
        return { error: 'Post does not have a local image. Image must be downloaded first.' };
      }

      const fullImagePath = path.join(DOWNLOAD_DIR, post.localImagePath);
      const { classifyEventFromImageFile } = await getClassifierModule();
      const { existingRaw, instagramTimestamp } = resolveRawAndTimestamp(post);

      const classification = await classifyEventFromImageFile(fullImagePath, geminiApiKey, {
        caption: post.instagramCaption || undefined,
        postTimestamp: instagramTimestamp,
      });

      const updatePayload: Record<string, unknown> = {
        isEventPoster: classification.isEventPoster,
        classificationConfidence:
          typeof classification.confidence === 'number' ? classification.confidence : null,
      };

      const mergedRaw = mergeClassificationIntoRaw(existingRaw, classification);
      if (mergedRaw) {
        updatePayload.raw = mergedRaw;
      }

      const [updated] = await db
        .update(eventsRaw)
        .set(updatePayload)
        .where(eq(eventsRaw.id, id))
        .returning();

      return {
        message: `AI marked post as ${classification.isEventPoster ? 'event' : 'not event'}`,
        classification,
        post: updated,
      };
    } catch (error: any) {
      if (error instanceof InstagramExtractionError) {
        reply.status(error.statusCode);
        return { error: error.message };
      }

      fastify.log.error(`Failed to AI-classify post ${id}:`, error);
      reply.status(500);
      return { error: error.message || 'Failed to classify post with AI' };
    }
  });
};
