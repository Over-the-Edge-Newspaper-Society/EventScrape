import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, sql, inArray, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { matches, eventsRaw, sources, eventsCanonical } from '../db/schema.js';

const querySchema = z.object({
  status: z.enum(['open', 'confirmed', 'rejected']).optional(),
  minScore: z.coerce.number().min(0).max(1).default(0.6),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const mergeSchema = z.object({
  rawIds: z.array(z.string().uuid()).min(2),
  decisions: z.record(z.string()).optional(),
  title: z.string().min(1),
  descriptionHtml: z.string().optional(),
  startDatetime: z.string().datetime(),
  endDatetime: z.string().datetime().optional(),
  timezone: z.string().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  organizer: z.string().optional(),
  category: z.string().optional(),
  price: z.string().optional(),
  tags: z.array(z.string()).optional(),
  urlPrimary: z.string().url(),
  imageUrl: z.string().url().optional(),
});

export const matchesRoutes: FastifyPluginAsync = async (fastify) => {
  // Get potential matches/duplicates
  fastify.get('/', async (request, reply) => {
    try {
      const query = querySchema.parse(request.query);
      
      const conditions = [];
      
      if (query.status) {
        conditions.push(eq(matches.status, query.status));
      }
      
      conditions.push(sql`${matches.score} >= ${query.minScore}`);
      
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const matchesWithEvents = await db
        .select({
          match: matches,
          eventA: {
            id: eventsRaw.id,
            title: eventsRaw.title,
            startDatetime: eventsRaw.startDatetime,
            city: eventsRaw.city,
            venueName: eventsRaw.venueName,
            url: eventsRaw.url,
          },
          eventB: sql<{
            id: string;
            title: string;
            startDatetime: Date;
            city: string;
            venueName: string;
            url: string;
          }>`(
            SELECT row_to_json(eb.*) FROM (
              SELECT id, title, start_datetime as "startDatetime", city, venue_name as "venueName", url
              FROM events_raw
              WHERE id = ${matches.rawIdB}
            ) eb
          )`,
          sourceA: {
            name: sources.name,
          },
        })
        .from(matches)
        .leftJoin(eventsRaw, eq(matches.rawIdA, eventsRaw.id))
        .leftJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(whereClause)
        .orderBy(desc(matches.score), desc(matches.createdAt))
        .limit(query.limit);

      return { matches: matchesWithEvents };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Get detailed match information
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid match ID' };
    }

    const [match] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, id));
    
    if (!match) {
      reply.status(404);
      return { error: 'Match not found' };
    }

    // Get both events with their source information
    const [eventA, eventB] = await Promise.all([
      db
        .select({
          event: eventsRaw,
          source: {
            id: sources.id,
            name: sources.name,
            baseUrl: sources.baseUrl,
          },
        })
        .from(eventsRaw)
        .leftJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(eq(eventsRaw.id, match.rawIdA)),
      db
        .select({
          event: eventsRaw,
          source: {
            id: sources.id,
            name: sources.name,
            baseUrl: sources.baseUrl,
          },
        })
        .from(eventsRaw)
        .leftJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(eq(eventsRaw.id, match.rawIdB)),
    ]);

    return {
      match,
      eventA: eventA[0] || null,
      eventB: eventB[0] || null,
    };
  });

  // Update match status (confirm/reject duplicate)
  fastify.put('/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: 'confirmed' | 'rejected' };
    
    if (!id || typeof id !== 'string') {
      reply.status(400);
      return { error: 'Invalid match ID' };
    }

    if (!status || !['confirmed', 'rejected'].includes(status)) {
      reply.status(400);
      return { error: 'Invalid status. Must be "confirmed" or "rejected"' };
    }

    const [updated] = await db
      .update(matches)
      .set({ status })
      .where(eq(matches.id, id))
      .returning();

    if (!updated) {
      reply.status(404);
      return { error: 'Match not found' };
    }

    return { match: updated };
  });

  // Merge events into canonical event
  fastify.post('/merge', async (request, reply) => {
    try {
      const data = mergeSchema.parse(request.body);

      // Start a database transaction
      const canonical = await db.transaction(async (tx) => {
        // Create canonical event
        const [newCanonical] = await tx
          .insert(eventsCanonical)
          .values({
            title: data.title,
            descriptionHtml: data.descriptionHtml,
            startDatetime: new Date(data.startDatetime),
            endDatetime: data.endDatetime ? new Date(data.endDatetime) : undefined,
            timezone: data.timezone,
            venueName: data.venueName,
            venueAddress: data.venueAddress,
            city: data.city,
            region: data.region,
            country: data.country,
            lat: data.lat,
            lon: data.lon,
            organizer: data.organizer,
            category: data.category,
            price: data.price,
            tags: data.tags || [],
            urlPrimary: data.urlPrimary,
            imageUrl: data.imageUrl,
            mergedFromRawIds: data.rawIds,
            status: 'ready',
          })
          .returning();

        // Update any matches involving these raw events to confirmed
        await tx
          .update(matches)
          .set({ status: 'confirmed' })
          .where(
            and(
              or(
                inArray(matches.rawIdA, data.rawIds),
                inArray(matches.rawIdB, data.rawIds)
              ),
              eq(matches.status, 'open')
            )
          );

        return newCanonical;
      });

      reply.status(201);
      return {
        message: 'Events merged successfully',
        canonicalId: canonical.id,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      throw error;
    }
  });

  // Trigger recomputation of matches
  fastify.post('/recompute', async (request, reply) => {
    try {
      const { enqueueMatchJob } = await import('../queue/queue.js');
      
      // Enqueue a job to find matches among all events
      const job = await enqueueMatchJob({
        // No filters = process all events
      });
      
      fastify.log.info(`Match recomputation job queued: ${job.id}`);
      
      reply.status(202);
      return {
        message: 'Match recomputation queued',
        jobId: job.id,
      };
    } catch (error: any) {
      fastify.log.error('Failed to queue match job:', error);
      reply.status(500);
      return { error: 'Failed to queue match recomputation' };
    }
  });
};