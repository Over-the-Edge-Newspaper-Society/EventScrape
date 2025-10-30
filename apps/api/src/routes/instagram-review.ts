import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { eventsRaw, sources, instagramSettings, instagramAccounts, runs } from '../db/schema.js';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const classifyPostSchema = z.object({
  isEventPoster: z.boolean(),
  classificationConfidence: z.number().min(0).max(1).optional(),
});

const extractOptionsSchema = z.object({
  overwrite: z.boolean().optional().default(false),
  createEvents: z.boolean().optional().default(true),
});

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';
const INSTAGRAM_SOURCE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const DOWNLOAD_DIR = process.env.INSTAGRAM_IMAGES_DIR || './data/instagram_images';

export const instagramReviewRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/instagram-review/queue - Get Instagram posts with optional filter
  fastify.get('/queue', async (request, reply) => {
    const { page = 1, limit = 20, filter = 'pending' } = request.query as {
      page?: number;
      limit?: number;
      filter?: 'pending' | 'event' | 'not-event' | 'all';
    };
    const offset = (Number(page) - 1) * Number(limit);

    try {
      // Build where condition based on filter
      let whereCondition;
      if (filter === 'pending') {
        whereCondition = and(
          eq(sources.sourceType, 'instagram'),
          isNull(eventsRaw.isEventPoster)
        );
      } else if (filter === 'event') {
        whereCondition = and(
          eq(sources.sourceType, 'instagram'),
          eq(eventsRaw.isEventPoster, true)
        );
      } else if (filter === 'not-event') {
        whereCondition = and(
          eq(sources.sourceType, 'instagram'),
          eq(eventsRaw.isEventPoster, false)
        );
      } else {
        // 'all' - just Instagram posts
        whereCondition = eq(sources.sourceType, 'instagram');
      }

      // Get posts
      const posts = await db
        .select({
          event: eventsRaw,
          source: {
            id: sources.id,
            name: sources.name,
            moduleKey: sources.moduleKey,
            instagramUsername: sources.instagramUsername,
          },
          account: {
            id: instagramAccounts.id,
            name: instagramAccounts.name,
            instagramUsername: instagramAccounts.instagramUsername,
            classificationMode: instagramAccounts.classificationMode,
            active: instagramAccounts.active,
          },
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .leftJoin(instagramAccounts, eq(eventsRaw.instagramAccountId, instagramAccounts.id))
        .where(whereCondition)
        .orderBy(desc(eventsRaw.scrapedAt))
        .limit(Number(limit))
        .offset(offset);

      // Get total count
      const totalResult = await db
        .select({ count: eventsRaw.id })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(whereCondition);

      const total = totalResult.length;
      const totalPages = Math.ceil(total / Number(limit));

      return {
        posts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages,
          hasNext: Number(page) < totalPages,
          hasPrev: Number(page) > 1,
        },
      };
    } catch (error: any) {
      fastify.log.error('Failed to fetch Instagram posts:', error);
      reply.status(500);
      return { error: 'Failed to fetch Instagram posts' };
    }
  });

  // POST /api/instagram-review/:id/classify - Classify a post as event/not event
  fastify.post('/:id/classify', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const data = classifyPostSchema.parse(request.body);

      // Check if post exists and is from Instagram
      const [post] = await db
        .select({
          event: eventsRaw,
          source: sources,
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(eq(eventsRaw.id, id), eq(sources.sourceType, 'instagram')));

      if (!post) {
        reply.status(404);
        return { error: 'Instagram post not found' };
      }

      // Update the classification
      const [updated] = await db
        .update(eventsRaw)
        .set({
          isEventPoster: data.isEventPoster,
          classificationConfidence: data.classificationConfidence || 1.0, // Manual classification = 100% confidence
        })
        .where(eq(eventsRaw.id, id))
        .returning();

      return {
        message: `Post marked as ${data.isEventPoster ? 'event' : 'not event'}`,
        post: updated,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error(`Failed to classify post ${id}:`, error);
      reply.status(500);
      return { error: 'Failed to classify post' };
    }
  });

  // POST /api/instagram-review/:id/ai-classify - Use Gemini to classify a post
  fastify.post<{ Params: { id: string } }>('/:id/ai-classify', async (request, reply) => {
    const { id } = request.params;

    try {
      const [settings] = await db
        .select({ geminiApiKey: instagramSettings.geminiApiKey })
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      const GEMINI_API_KEY = settings?.geminiApiKey || process.env.GEMINI_API_KEY;

      if (!GEMINI_API_KEY) {
        reply.status(400);
        return { error: 'Gemini API key not configured' };
      }

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
      try {
        const existingRaw = post.raw ? JSON.parse(post.raw as string) : null;
        if (existingRaw?.instagram?.timestamp) {
          instagramTimestamp = new Date(existingRaw.instagram.timestamp);
        }
      } catch {
        // ignore raw parsing errors
      }

      const importPath = new URL(
        '../worker/src/modules/instagram/gemini-extractor.js',
        import.meta.url
      ).href;
      const { classifyEventFromImageFile } = await import(importPath);

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
          method: 'gemini',
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
      fastify.log.error(`Failed to AI-classify post ${id}:`, error);
      reply.status(500);
      return { error: error.message || 'Failed to classify post with AI' };
    }
  });

  // POST /api/instagram-review/:id/extract - Extract event data with Gemini
  fastify.post<{ Params: { id: string } }>('/:id/extract', async (request, reply) => {
    const { id } = request.params;

    try {
      const options = extractOptionsSchema.parse(request.body);

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

      // Get post with source info
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

      const { event: post, source } = result;

      // Check if image exists
      if (!post.localImagePath) {
        reply.status(400);
        return { error: 'Post does not have a local image. Image must be downloaded first.' };
      }

      const fullImagePath = path.join(DOWNLOAD_DIR, post.localImagePath);

      // Check if already has extraction and overwrite is false
      if (post.raw && !options.overwrite) {
        try {
          const existingData = JSON.parse(post.raw as string);
          if (existingData.events && existingData.events.length > 0) {
            reply.status(400);
            return {
              error: 'Post already has extracted data. Set overwrite=true to re-extract.',
              existingData,
            };
          }
        } catch {
          // Invalid JSON, proceed with extraction
        }
      }

      // Dynamic import to avoid loading in non-worker context
      // Import path is constructed at runtime to work in both dev and production
      const importPath = new URL(
        '../worker/src/modules/instagram/gemini-extractor.js',
        import.meta.url
      ).href;
      const { extractEventFromImageFile } = await import(importPath);

      // Try to extract Instagram timestamp from existing raw data if available
      let instagramTimestamp = post.scrapedAt;
      try {
        const existingRaw = post.raw ? JSON.parse(post.raw as string) : null;
        if (existingRaw?.instagram?.timestamp) {
          instagramTimestamp = new Date(existingRaw.instagram.timestamp);
        }
      } catch {
        // Ignore parse errors
      }

      // Run Gemini extraction
      const geminiResult = await extractEventFromImageFile(
        fullImagePath,
        GEMINI_API_KEY,
        {
          caption: post.instagramCaption || undefined,
          postTimestamp: instagramTimestamp || undefined,
        }
      );

      // Combine Instagram post data with Gemini extraction result
      const rawData = {
        ...geminiResult,
        instagram: {
          timestamp: instagramTimestamp?.toISOString() || post.scrapedAt,
          postId: post.instagramPostId,
          caption: post.instagramCaption,
          imageUrl: post.imageUrl,
          localImagePath: post.localImagePath,
        }
      };

      // Update the post with extracted data
      await db
        .update(eventsRaw)
        .set({
          raw: JSON.stringify(rawData),
        })
        .where(eq(eventsRaw.id, id));

      let eventsCreated = 0;

      // Optionally create new event records
      if (options.createEvents && geminiResult.events && geminiResult.events.length > 0) {
        const timezone = source.defaultTimezone || 'America/Vancouver';

        // Delete existing event records with the same instagram_post_id to avoid duplicates
        // This happens when re-extracting a post that was previously extracted
        if (post.instagramPostId) {
          const deleteResult = await db
            .delete(eventsRaw)
            .where(eq(eventsRaw.instagramPostId, post.instagramPostId))
            .returning();

          if (deleteResult.length > 0) {
            fastify.log.info(`Deleted ${deleteResult.length} existing record(s) for Instagram post ${post.instagramPostId} to avoid duplicates`);
          }
        }

        // Create a manual extraction run for these events
        const [manualRun] = await db.insert(runs).values({
          sourceId: INSTAGRAM_SOURCE_ID,
          status: 'success',
          pagesCrawled: 1,
          eventsFound: geminiResult.events.length,
          finishedAt: new Date(),
        }).returning();

        for (const event of geminiResult.events) {
          // Parse date/time
          const startDateTime = new Date(`${event.startDate}T${event.startTime || '00:00:00'}`);
          const endDateTime = event.endDate
            ? new Date(`${event.endDate}T${event.endTime || '23:59:59'}`)
            : null;

          // Create new event record with Instagram metadata
          await db.insert(eventsRaw).values({
            sourceId: INSTAGRAM_SOURCE_ID,
            runId: manualRun.id, // Use the manual extraction run ID
            sourceEventId: `${post.instagramPostId}-${Date.now()}`, // Unique ID
            title: event.title,
            descriptionHtml: event.description || '',
            startDatetime: startDateTime,
            endDatetime: endDateTime,
            timezone: event.timezone || timezone,
            venueName: event.venue?.name || null,
            venueAddress: event.venue?.address || null,
            city: event.venue?.city || null,
            region: event.venue?.region || null,
            country: event.venue?.country || null,
            organizer: event.organizer || null,
            category: event.category || null,
            price: event.price || null,
            tags: event.tags ? JSON.stringify(event.tags) : null,
            url: post.url || `https://instagram.com/p/${post.instagramPostId}/`,
            imageUrl: post.imageUrl,
            raw: JSON.stringify(rawData),
            contentHash: `${post.instagramPostId}-extraction-${Date.now()}`,
            instagramAccountId: post.instagramAccountId,
            instagramPostId: post.instagramPostId,
            instagramCaption: post.instagramCaption,
            localImagePath: post.localImagePath,
            classificationConfidence: post.classificationConfidence,
            isEventPoster: true, // Mark as event since we're extracting
          });

          eventsCreated++;
        }
      }

      return {
        success: true,
        message: `Extracted ${geminiResult.events?.length || 0} event(s) from post`,
        extraction: geminiResult,
        eventsCreated,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error(`Failed to extract event from post ${id}:`, error);
      reply.status(500);
      return { error: error.message || 'Failed to extract event data' };
    }
  });

  // GET /api/instagram-review/stats - Get review queue statistics
  fastify.get('/stats', async (request, reply) => {
    try {
      // Count unclassified posts
      const unclassifiedResult = await db
        .select({ count: eventsRaw.id })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(
          and(
            eq(sources.sourceType, 'instagram'),
            isNull(eventsRaw.isEventPoster)
          )
        );

      // Count posts marked as events
      const eventsResult = await db
        .select({ count: eventsRaw.id })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(
          and(
            eq(sources.sourceType, 'instagram'),
            eq(eventsRaw.isEventPoster, true)
          )
        );

      // Count posts marked as not events
      const notEventsResult = await db
        .select({ count: eventsRaw.id })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(
          and(
            eq(sources.sourceType, 'instagram'),
            eq(eventsRaw.isEventPoster, false)
          )
        );

      return {
        unclassified: unclassifiedResult.length,
        markedAsEvent: eventsResult.length,
        markedAsNotEvent: notEventsResult.length,
        total: unclassifiedResult.length + eventsResult.length + notEventsResult.length,
      };
    } catch (error: any) {
      fastify.log.error('Failed to fetch review stats:', error);
      reply.status(500);
      return { error: 'Failed to fetch review stats' };
    }
  });
};
