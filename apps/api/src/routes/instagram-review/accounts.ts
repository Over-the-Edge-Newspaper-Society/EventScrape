import type { FastifyInstance } from 'fastify';
import { db } from '../../db/connection.js';
import { instagramAccounts } from '../../db/schema.js';

export const registerAccountsRoute = (fastify: FastifyInstance) => {
  fastify.get('/accounts', async (_request, reply) => {
    try {
      const accounts = await db
        .select({
          id: instagramAccounts.id,
          name: instagramAccounts.name,
          instagramUsername: instagramAccounts.instagramUsername,
          active: instagramAccounts.active,
        })
        .from(instagramAccounts)
        .orderBy(instagramAccounts.name);

      return { accounts };
    } catch (error: any) {
      fastify.log.error('Failed to fetch Instagram accounts:', error);
      reply.status(500);
      return { error: 'Failed to fetch Instagram accounts' };
    }
  });
};
