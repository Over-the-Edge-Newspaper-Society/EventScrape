import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { sources, NewSource } from '../db/schema.js';

const createSourceSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  moduleKey: z.string().min(1),
  active: z.boolean().default(true),
  defaultTimezone: z.string().default('UTC'),
  notes: z.string().optional(),
  rateLimitPerMin: z.number().int().positive().default(60),
});

const updateSourceSchema = createSourceSchema.partial();

export const sourcesRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all sources
  fastify.get('/', async (request, reply) => {
    const allSources = await db.select().from(sources);
    return { sources: allSources };
  });

  // Get source by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid source ID' };
    }

    const source = await db.select().from(sources).where(eq(sources.id, id));
    
    if (source.length === 0) {
      reply.status(404);
      return { error: 'Source not found' };
    }

    return { source: source[0] };
  });

  // Create new source
  fastify.post('/', async (request, reply) => {
    try {
      const data = createSourceSchema.parse(request.body);
      
      const newSource: NewSource = {
        ...data,
        updatedAt: new Date(),
      };

      const [created] = await db.insert(sources).values(newSource).returning();
      
      reply.status(201);
      return { source: created };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Update source
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid source ID' };
    }

    try {
      const data = updateSourceSchema.parse(request.body);
      
      const [updated] = await db
        .update(sources)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sources.id, id))
        .returning();

      if (!updated) {
        reply.status(404);
        return { error: 'Source not found' };
      }

      return { source: updated };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Delete source
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid source ID' };
    }

    const [deleted] = await db
      .delete(sources)
      .where(eq(sources.id, id))
      .returning();

    if (!deleted) {
      reply.status(404);
      return { error: 'Source not found' };
    }

    reply.status(204);
    return;
  });
};