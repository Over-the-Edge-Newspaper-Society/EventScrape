import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { eventsRaw, sources } from '../../db/schema.js';
import { hasExtractedEvents } from './raw-utils.js';

export const registerStatsRoute = (fastify: FastifyInstance) => {
  fastify.get('/stats', async (_request, reply) => {
    try {
      const unclassifiedResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(eq(sources.sourceType, 'instagram'), isNull(eventsRaw.isEventPoster)));

      const eventsResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(eq(sources.sourceType, 'instagram'), eq(eventsRaw.isEventPoster, true)));

      const notEventsResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(and(eq(sources.sourceType, 'instagram'), eq(eventsRaw.isEventPoster, false)));

      const needsExtractionCandidates = await db
        .select({
          id: eventsRaw.id,
          raw: eventsRaw.raw,
        })
        .from(eventsRaw)
        .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
        .where(
          and(
            eq(sources.sourceType, 'instagram'),
            eq(eventsRaw.isEventPoster, true),
            isNotNull(eventsRaw.localImagePath)
          )
        );

      const needsExtraction = needsExtractionCandidates.reduce((count, candidate) => {
        return count + (hasExtractedEvents(candidate.raw) ? 0 : 1);
      }, 0);

      const toNumber = (value: unknown): number => {
        if (typeof value === 'number') return value;
        if (typeof value === 'bigint') return Number(value);
        if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
        return 0;
      };

      const unclassified = toNumber(unclassifiedResult[0]?.count);
      const markedAsEvent = toNumber(eventsResult[0]?.count);
      const markedAsNotEvent = toNumber(notEventsResult[0]?.count);

      return {
        unclassified,
        markedAsEvent,
        markedAsNotEvent,
        needsExtraction,
        total: unclassified + markedAsEvent + markedAsNotEvent,
      };
    } catch (error: any) {
      fastify.log.error('Failed to fetch review stats:', error);
      reply.status(500);
      return { error: 'Failed to fetch review stats' };
    }
  });
};
