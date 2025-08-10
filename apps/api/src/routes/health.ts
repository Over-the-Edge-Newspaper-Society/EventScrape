import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    try {
      // Test database connection
      await db.execute('SELECT 1');
      
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          api: 'running',
        },
      };
    } catch (error) {
      fastify.log.error('Health check failed:', error);
      reply.status(503);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'disconnected',
          api: 'running',
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Ready check endpoint (for k8s)
  fastify.get('/ready', async (request, reply) => {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  });
};