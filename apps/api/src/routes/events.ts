import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, gte, lte, ilike, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { eventsRaw, eventsCanonical, sources } from '../db/schema.js';

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sourceId: z.string().uuid().optional(),
  city: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  hasDuplicates: z.coerce.boolean().optional(),
  missingFields: z.coerce.boolean().optional(),
});

export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get raw events with filtering and pagination
  fastify.get('/raw', async (request, reply) => {
    try {
      const query = querySchema.parse(request.query);
      const offset = (query.page - 1) * query.limit;

      // Build where conditions
      const conditions = [];
      
      if (query.sourceId) {
        conditions.push(eq(eventsRaw.sourceId, query.sourceId));
      }
      
      if (query.city) {
        conditions.push(ilike(eventsRaw.city, `%${query.city}%`));
      }
      
      if (query.startDate) {
        conditions.push(gte(eventsRaw.startDatetime, new Date(query.startDate)));
      }
      
      if (query.endDate) {
        conditions.push(lte(eventsRaw.startDatetime, new Date(query.endDate)));
      }
      
      if (query.search) {
        conditions.push(
          sql`${eventsRaw.title} ILIKE ${`%${query.search}%`} OR ${eventsRaw.descriptionHtml} ILIKE ${`%${query.search}%`}`
        );
      }

      // TODO: Add hasDuplicates and missingFields filters when match system is implemented

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get events with source information
      const events = await db
        .select({
          event: eventsRaw,
          source: {
            id: sources.id,
            name: sources.name,
            moduleKey: sources.moduleKey,
          },
        })
        .from(eventsRaw)
        .leftJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(whereClause)
        .orderBy(desc(eventsRaw.startDatetime))
        .limit(query.limit)
        .offset(offset);

      // Get total count for pagination
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(eventsRaw)
        .where(whereClause);

      const totalPages = Math.ceil(count / query.limit);

      return {
        events,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: count,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Get single raw event by ID
  fastify.get('/raw/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid event ID' };
    }

    const result = await db
      .select({
        event: eventsRaw,
        source: {
          id: sources.id,
          name: sources.name,
          moduleKey: sources.moduleKey,
          baseUrl: sources.baseUrl,
        },
      })
      .from(eventsRaw)
      .leftJoin(sources, eq(eventsRaw.sourceId, sources.id))
      .where(eq(eventsRaw.id, id));
    
    if (result.length === 0) {
      reply.status(404);
      return { error: 'Event not found' };
    }

    return { event: result[0] };
  });

  // Get canonical events
  fastify.get('/canonical', async (request, reply) => {
    try {
      const query = querySchema.parse(request.query);
      const offset = (query.page - 1) * query.limit;

      // Build where conditions (similar to raw events)
      const conditions = [];
      
      if (query.city) {
        conditions.push(ilike(eventsCanonical.city, `%${query.city}%`));
      }
      
      if (query.startDate) {
        conditions.push(gte(eventsCanonical.startDatetime, new Date(query.startDate)));
      }
      
      if (query.endDate) {
        conditions.push(lte(eventsCanonical.startDatetime, new Date(query.endDate)));
      }
      
      if (query.search) {
        conditions.push(
          sql`${eventsCanonical.title} ILIKE ${`%${query.search}%`} OR ${eventsCanonical.descriptionHtml} ILIKE ${`%${query.search}%`}`
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const events = await db
        .select()
        .from(eventsCanonical)
        .where(whereClause)
        .orderBy(desc(eventsCanonical.startDatetime))
        .limit(query.limit)
        .offset(offset);

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(eventsCanonical)
        .where(whereClause);

      const totalPages = Math.ceil(count / query.limit);

      return {
        events,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: count,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Get single canonical event by ID
  fastify.get('/canonical/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid event ID' };
    }

    const [event] = await db
      .select()
      .from(eventsCanonical)
      .where(eq(eventsCanonical.id, id));
    
    if (!event) {
      reply.status(404);
      return { error: 'Event not found' };
    }

    // Also get the raw events that were merged into this canonical event
    const rawEvents = await db
      .select({
        event: eventsRaw,
        source: {
          name: sources.name,
          baseUrl: sources.baseUrl,
        },
      })
      .from(eventsRaw)
      .leftJoin(sources, eq(eventsRaw.sourceId, sources.id))
      .where(sql`${eventsRaw.id} = ANY(${event.mergedFromRawIds})`);

    return {
      event,
      rawEvents,
    };
  });
};