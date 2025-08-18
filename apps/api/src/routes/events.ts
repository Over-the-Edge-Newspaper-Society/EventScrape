import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, gte, lte, ilike, sql, inArray, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { eventsRaw, eventsCanonical, sources, matches } from '../db/schema.js';

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
    } catch (error: any) {
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
    } catch (error: any) {
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

  // Delete raw events (bulk delete)
  fastify.delete('/raw', async (request, reply) => {
    try {
      const { ids } = request.body as { ids: string[] };
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        reply.status(400);
        return { error: 'Event IDs are required' };
      }

      // Validate all IDs are UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const invalidIds = ids.filter(id => !uuidRegex.test(id));
      if (invalidIds.length > 0) {
        reply.status(400);
        return { error: 'Invalid UUID format', invalidIds };
      }

      // First, delete any matches that reference these events
      await db
        .delete(matches)
        .where(
          or(
            inArray(matches.rawIdA, ids),
            inArray(matches.rawIdB, ids)
          )
        );

      // Then delete the events themselves
      await db
        .delete(eventsRaw)
        .where(inArray(eventsRaw.id, ids));

      return { message: `Deleted ${ids.length} events`, deletedIds: ids };
    } catch (error: any) {
      console.error('Delete events error:', error);
      reply.status(500);
      return { error: 'Failed to delete events', details: error instanceof Error ? error.message : String(error) };
    }
  });

  // Delete single raw event by ID
  fastify.delete('/raw/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid event ID' };
    }

    try {
      // First, delete any matches that reference this event
      await db
        .delete(matches)
        .where(
          or(
            eq(matches.rawIdA, id),
            eq(matches.rawIdB, id)
          )
        );

      // Then delete the event itself
      await db
        .delete(eventsRaw)
        .where(eq(eventsRaw.id, id));

      return { message: 'Event deleted successfully', deletedId: id };
    } catch (error: any) {
      console.error('Delete event error:', error);
      reply.status(500);
      return { error: 'Failed to delete event', details: error instanceof Error ? error.message : String(error) };
    }
  });

  // Delete canonical events (bulk delete)
  fastify.delete('/canonical', async (request, reply) => {
    try {
      const { ids } = request.body as { ids: string[] };
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        reply.status(400);
        return { error: 'Event IDs are required' };
      }

      // Validate all IDs are UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const invalidIds = ids.filter(id => !uuidRegex.test(id));
      if (invalidIds.length > 0) {
        reply.status(400);
        return { error: 'Invalid UUID format', invalidIds };
      }

      // Delete the canonical events
      await db
        .delete(eventsCanonical)
        .where(inArray(eventsCanonical.id, ids));

      return { message: `Deleted ${ids.length} canonical events`, deletedIds: ids };
    } catch (error: any) {
      console.error('Delete canonical events error:', error);
      reply.status(500);
      return { error: 'Failed to delete canonical events', details: error instanceof Error ? error.message : String(error) };
    }
  });

  // Delete single canonical event by ID
  fastify.delete('/canonical/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid event ID' };
    }

    try {
      // Delete the canonical event
      await db
        .delete(eventsCanonical)
        .where(eq(eventsCanonical.id, id));

      return { message: 'Canonical event deleted successfully', deletedId: id };
    } catch (error: any) {
      console.error('Delete canonical event error:', error);
      reply.status(500);
      return { error: 'Failed to delete canonical event', details: error instanceof Error ? error.message : String(error) };
    }
  });
};