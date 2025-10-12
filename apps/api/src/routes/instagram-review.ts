import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { eventsRaw, sources } from '../db/schema.js';

const classifyPostSchema = z.object({
  isEventPoster: z.boolean(),
  classificationConfidence: z.number().min(0).max(1).optional(),
});

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
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
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
