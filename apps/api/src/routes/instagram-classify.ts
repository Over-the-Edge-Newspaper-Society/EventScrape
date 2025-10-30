import type { FastifyPluginAsync } from 'fastify';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { eventsRaw, sources, instagramSettings } from '../db/schema.js';
import path from 'path';

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';
const DOWNLOAD_DIR = process.env.INSTAGRAM_IMAGES_DIR || './data/instagram_images';

export const instagramClassifyRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/instagram-classify/backlog - Classify all unclassified Instagram posts
  fastify.post('/backlog', async (request, reply) => {
    try {
      // Get Gemini API key
      const [settings] = await db
        .select({ geminiApiKey: instagramSettings.geminiApiKey })
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      const GEMINI_API_KEY = settings?.geminiApiKey || process.env.GEMINI_API_KEY;

      if (!GEMINI_API_KEY) {
        reply.status(400);
        return { error: 'Gemini API key not configured' };
      }

      // Get all unclassified Instagram posts that have local images
      const posts = await db
        .select({
          event: eventsRaw,
          source: sources,
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(
          and(
            eq(sources.sourceType, 'instagram'),
            isNull(eventsRaw.isEventPoster)
          )
        )
        .orderBy(desc(eventsRaw.scrapedAt))
        .limit(100); // Process in batches of 100

      if (posts.length === 0) {
        return {
          message: 'No unclassified posts found in backlog',
          processed: 0,
        };
      }

      const importPath = new URL(
        '../worker/src/modules/instagram/gemini-extractor.js',
        import.meta.url
      ).href;
      const { classifyEventFromImageFile } = await import(importPath);

      let successCount = 0;
      let failCount = 0;

      for (const { event: post } of posts) {
        try {
          if (!post.localImagePath) {
            fastify.log.warn(`Post ${post.id} has no local image, skipping`);
            failCount++;
            continue;
          }

          const fullImagePath = path.join(DOWNLOAD_DIR, post.localImagePath);

          let instagramTimestamp = post.scrapedAt;
          try {
            const existingRaw = post.raw ? JSON.parse(post.raw as string) : null;
            if (existingRaw?.instagram?.timestamp) {
              instagramTimestamp = new Date(existingRaw.instagram.timestamp);
            }
          } catch {
            // ignore raw parsing errors
          }

          const classification = await classifyEventFromImageFile(
            fullImagePath,
            GEMINI_API_KEY,
            {
              caption: post.instagramCaption || undefined,
              postTimestamp: instagramTimestamp || undefined,
            }
          );

          const updatePayload: Record<string, any> = {
            isEventPoster: classification.isEventPoster,
            classificationConfidence: classification.confidence ?? null,
          };

          try {
            const existingRaw = post.raw ? JSON.parse(post.raw as string) : null;
            const classificationRecord = {
              ...classification,
              decidedAt: new Date().toISOString(),
              method: 'gemini-backlog',
            };

            const mergedRaw =
              existingRaw && typeof existingRaw === 'object'
                ? {
                    ...existingRaw,
                    classification: {
                      ...(existingRaw.classification || {}),
                      gemini: classificationRecord,
                    },
                  }
                : {
                    classification: {
                      gemini: classificationRecord,
                    },
                  };

            updatePayload.raw = JSON.stringify(mergedRaw);
          } catch {
            // Leave raw untouched if parsing fails
          }

          await db
            .update(eventsRaw)
            .set(updatePayload)
            .where(eq(eventsRaw.id, post.id));

          successCount++;
          fastify.log.info(`Classified post ${post.id}: ${classification.isEventPoster ? 'event' : 'not event'}`);
        } catch (error: any) {
          fastify.log.error(`Failed to classify post ${post.id}:`, error);
          failCount++;
        }
      }

      return {
        message: `Processed ${successCount + failCount} posts from backlog`,
        processed: successCount + failCount,
        success: successCount,
        failed: failCount,
      };
    } catch (error: any) {
      fastify.log.error('Failed to classify backlog:', error);
      reply.status(500);
      return { error: error.message || 'Failed to classify backlog' };
    }
  });
};
