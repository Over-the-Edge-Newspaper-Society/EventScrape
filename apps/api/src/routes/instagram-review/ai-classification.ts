import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import path from 'path';
import { db } from '../../db/connection.js';
import { eventsRaw, sources } from '../../db/schema.js';
import { DOWNLOAD_DIR } from './constants.js';
import { InstagramExtractionError } from './errors.js';
import { parseEventRaw } from './raw-utils.js';
import type { ExtractionService } from './extraction-service.js';

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

export const registerAiClassificationRoutes = (
  fastify: FastifyInstance,
  extractionService: ExtractionService
) => {
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

      let instagramTimestamp = post.scrapedAt;

      const existingRaw = parseEventRaw(post.raw);
      const rawInstagramTimestamp = (existingRaw as { instagram?: { timestamp?: string } } | undefined)?.instagram
        ?.timestamp;

      if (rawInstagramTimestamp) {
        const parsedTimestamp = new Date(rawInstagramTimestamp);
        if (!Number.isNaN(parsedTimestamp.getTime())) {
          instagramTimestamp = parsedTimestamp;
        }
      }

      const { classifyEventFromImageFile } = await getClassifierModule();

      const classification = await classifyEventFromImageFile(fullImagePath, geminiApiKey, {
        caption: post.instagramCaption || undefined,
        postTimestamp: instagramTimestamp || undefined,
      });

      const updatePayload: Record<string, any> = {
        isEventPoster: classification.isEventPoster,
        classificationConfidence: classification.confidence ?? null,
      };

      try {
        const classificationRecord = {
          ...classification,
          decidedAt: new Date().toISOString(),
          method: 'gemini',
        };

        const mergedRaw =
          existingRaw && typeof existingRaw === 'object'
            ? {
                ...existingRaw,
                classification: {
                  ...(existingRaw.classification as Record<string, unknown> | undefined),
                  gemini: classificationRecord,
                },
              }
            : {
                classification: {
                  gemini: classificationRecord,
                },
              };

        updatePayload.raw = mergedRaw;
      } catch {
        // Leave raw untouched if parsing fails
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
