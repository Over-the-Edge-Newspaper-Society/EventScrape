import type { FastifyPluginAsync } from 'fastify';
import { registerAccountsRoute } from './instagram-review/accounts.js';
import { registerAiClassificationRoutes } from './instagram-review/ai-classification.js';
import { registerClassificationRoutes } from './instagram-review/classification.js';
import { createExtractionService } from './instagram-review/extraction-service.js';
import { registerExtractionRoutes } from './instagram-review/extraction-routes.js';
import { registerQueueRoutes } from './instagram-review/queue.js';
import { registerStatsRoute } from './instagram-review/stats.js';

export const instagramReviewRoutes: FastifyPluginAsync = async (fastify) => {
  const extractionService = createExtractionService(fastify.log);

  registerQueueRoutes(fastify);
  registerClassificationRoutes(fastify);
  registerAiClassificationRoutes(fastify, extractionService);
  registerExtractionRoutes(fastify, extractionService);
  registerStatsRoute(fastify);
  registerAccountsRoute(fastify);
};
