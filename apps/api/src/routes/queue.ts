import { FastifyPluginAsync } from 'fastify';
import { getQueueStatus, scrapeQueue, matchQueue } from '../queue/queue.js';

export const queueRoutes: FastifyPluginAsync = async (fastify) => {
  // Get queue status
  fastify.get('/status', async (request, reply) => {
    try {
      const status = await getQueueStatus();
      return {
        status: 'healthy',
        queues: status,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      fastify.log.error('Failed to get queue status:', error);
      reply.status(503);
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  });

  // Get jobs from scrape queue
  fastify.get('/scrape/jobs', async (request, reply) => {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        scrapeQueue.getWaiting(0, 20),
        scrapeQueue.getActive(0, 20),
        scrapeQueue.getCompleted(0, 20),
        scrapeQueue.getFailed(0, 20),
      ]);

      return {
        waiting: waiting.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          opts: job.opts,
          timestamp: job.timestamp,
        })),
        active: active.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          progress: job.progress,
          timestamp: job.timestamp,
        })),
        completed: completed.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          returnvalue: job.returnvalue,
          finishedOn: job.finishedOn,
        })),
        failed: failed.map(job => ({
          id: job.id,
          name: job.name,
          data: job.data,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
        })),
      };
    } catch (error) {
      fastify.log.error('Failed to get scrape jobs:', error);
      reply.status(500);
      return { error: 'Failed to get scrape jobs' };
    }
  });

  // Retry a failed job
  fastify.post('/scrape/jobs/:jobId/retry', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    
    try {
      const job = await scrapeQueue.getJob(jobId);
      
      if (!job) {
        reply.status(404);
        return { error: 'Job not found' };
      }

      await job.retry();
      
      return {
        message: 'Job retry initiated',
        jobId: job.id,
      };
    } catch (error) {
      fastify.log.error('Failed to retry job:', error);
      reply.status(500);
      return { error: 'Failed to retry job' };
    }
  });

  // Clean completed/failed jobs
  fastify.post('/clean', async (request, reply) => {
    try {
      const [scrapeCompleted, scrapeFailed, matchCompleted, matchFailed] = await Promise.all([
        scrapeQueue.clean(1000, 1000, 'completed'),
        scrapeQueue.clean(1000, 1000, 'failed'),
        matchQueue.clean(1000, 1000, 'completed'),
        matchQueue.clean(1000, 1000, 'failed'),
      ]);

      return {
        message: 'Queues cleaned',
        removed: {
          scrape: {
            completed: scrapeCompleted.length,
            failed: scrapeFailed.length,
          },
          match: {
            completed: matchCompleted.length,
            failed: matchFailed.length,
          },
        },
      };
    } catch (error) {
      fastify.log.error('Failed to clean queues:', error);
      reply.status(500);
      return { error: 'Failed to clean queues' };
    }
  });
};