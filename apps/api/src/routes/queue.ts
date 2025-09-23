import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getQueueStatus, scrapeQueue, matchQueue, enqueueMatchJob } from '../queue/queue.js';

export const queueRoutes: FastifyPluginAsync = async (fastify) => {
  // Get queue status
  fastify.get('/status', async (_request, reply) => {
    try {
      const status = await getQueueStatus();
      return {
        status: 'healthy',
        queues: status,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
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
  fastify.get('/scrape/jobs', async (_request, reply) => {
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
    } catch (error: any) {
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
    } catch (error: any) {
      fastify.log.error('Failed to retry job:', error);
      reply.status(500);
      return { error: 'Failed to retry job' };
    }
  });

  // Clean completed/failed jobs
  fastify.post('/clean', async (_request, reply) => {
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
    } catch (error: any) {
      fastify.log.error('Failed to clean queues:', error);
      reply.status(500);
      return { error: 'Failed to clean queues' };
    }
  });

  // Trigger manual match job
  fastify.post('/match/trigger', async (request, reply) => {
    try {
      const matchJobSchema = z.object({
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        sourceIds: z.array(z.string().uuid()).optional(),
      });

      const body = matchJobSchema.parse(request.body);

      // If no date range specified, use last 30 days
      const matchJobData = {
        ...body,
        startDate: body.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const job = await enqueueMatchJob(matchJobData);

      return {
        message: 'Match job triggered successfully',
        jobId: job.id,
        data: matchJobData,
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }
      
      fastify.log.error('Failed to trigger match job:', error);
      reply.status(500);
      return { error: 'Failed to trigger match job' };
    }
  });
};
