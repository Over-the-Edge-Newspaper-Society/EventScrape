import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { eventsRaw, sources } from '../../db/schema.js';
import { classifyPostSchema } from './schemas.js';
import { ZodError } from 'zod';

export const registerClassificationRoutes = (fastify: FastifyInstance) => {
  fastify.post('/:id/classify', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const data = classifyPostSchema.parse(request.body);

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

      const [updated] = await db
        .update(eventsRaw)
        .set({
          isEventPoster: data.isEventPoster,
          classificationConfidence: data.classificationConfidence || 1.0,
        })
        .where(eq(eventsRaw.id, id))
        .returning();

      return {
        message: `Post marked as ${data.isEventPoster ? 'event' : 'not event'}`,
        post: updated,
      };
    } catch (error: any) {
      if (error instanceof ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error(`Failed to classify post ${id}:`, error);
      reply.status(500);
      return { error: 'Failed to classify post' };
    }
  });
};
