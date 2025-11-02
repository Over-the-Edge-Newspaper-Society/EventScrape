import type { FastifyInstance } from 'fastify';
import { eq, and, isNull, isNotNull, desc, sql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { eventsRaw, sources, instagramAccounts } from '../../db/schema.js';
import { hasExtractedEvents } from './raw-utils.js';

type QueueFilter = 'pending' | 'event' | 'not-event' | 'needs-extraction' | 'all';

export const registerQueueRoutes = (fastify: FastifyInstance) => {
  fastify.get('/queue', async (request, reply) => {
    const { page = 1, limit = 20, filter = 'pending', accountId } = request.query as {
      page?: number;
      limit?: number;
      filter?: QueueFilter;
      accountId?: string;
    };
    const offset = (Number(page) - 1) * Number(limit);

    try {
      const needsExtractionFilter = filter === 'needs-extraction';

      const whereConditions = [eq(sources.sourceType, 'instagram')];

      if (accountId) {
        whereConditions.push(eq(eventsRaw.instagramAccountId, accountId));
      }

      if (filter === 'pending') {
        whereConditions.push(isNull(eventsRaw.isEventPoster));
      } else if (filter === 'event') {
        whereConditions.push(eq(eventsRaw.isEventPoster, true));
      } else if (filter === 'not-event') {
        whereConditions.push(eq(eventsRaw.isEventPoster, false));
      } else if (needsExtractionFilter) {
        whereConditions.push(eq(eventsRaw.isEventPoster, true), isNotNull(eventsRaw.localImagePath));
      }

      const whereCondition = and(...whereConditions);

      const baseQuery = db
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
        .orderBy(desc(eventsRaw.scrapedAt));

      let posts;
      let total = 0;

      if (needsExtractionFilter) {
        const allPosts = await baseQuery;
        const filteredPosts = allPosts.filter(({ event }) => !hasExtractedEvents(event.raw));
        posts = filteredPosts.slice(offset, offset + Number(limit));
        total = filteredPosts.length;
      } else {
        posts = await baseQuery.limit(Number(limit)).offset(offset);

        const totalResult = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(eventsRaw)
          .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
          .where(whereCondition);

        total = totalResult[0]?.count ?? 0;
      }

      const totalPages = Number(limit) ? Math.ceil(total / Number(limit)) : 0;

      return {
        posts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages,
          hasNext: Number(page) < totalPages,
          hasPrev: Number(page) > 1 && totalPages > 0,
        },
      };
    } catch (error: any) {
      fastify.log.error('Failed to fetch Instagram posts:', error);
      reply.status(500);
      return { error: 'Failed to fetch Instagram posts' };
    }
  });
};
