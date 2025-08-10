import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null, // Fix BullMQ deprecation warning
});

// Define job data schemas
export const scrapeJobSchema = z.object({
  sourceId: z.string().uuid(),
  runId: z.string().uuid(),
  moduleKey: z.string(),
  sourceName: z.string(),
});

export const matchJobSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  sourceIds: z.array(z.string().uuid()).optional(),
});

export type ScrapeJobData = z.infer<typeof scrapeJobSchema>;
export type MatchJobData = z.infer<typeof matchJobSchema>;

// Create queues
export const scrapeQueue = new Queue<ScrapeJobData>('scrape-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 24 * 3600, // Keep failed jobs for 24 hours
    },
  },
});

export const matchQueue = new Queue<MatchJobData>('match-queue', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 50,
    },
    removeOnFail: {
      age: 24 * 3600,
    },
  },
});

// Queue events for monitoring
export const scrapeQueueEvents = new QueueEvents('scrape-queue', { connection });
export const matchQueueEvents = new QueueEvents('match-queue', { connection });

// Helper functions
export async function enqueueScrapeJob(data: ScrapeJobData) {
  const job = await scrapeQueue.add('scrape', data, {
    jobId: `scrape-${data.sourceId}-${Date.now()}`,
  });
  return job;
}

export async function enqueueMatchJob(data: MatchJobData) {
  const job = await matchQueue.add('match', data, {
    jobId: `match-${Date.now()}`,
  });
  return job;
}

export async function getQueueStatus() {
  const [scrapeWaiting, scrapeActive, scrapeCompleted, scrapeFailed] = await Promise.all([
    scrapeQueue.getWaitingCount(),
    scrapeQueue.getActiveCount(),
    scrapeQueue.getCompletedCount(),
    scrapeQueue.getFailedCount(),
  ]);

  const [matchWaiting, matchActive, matchCompleted, matchFailed] = await Promise.all([
    matchQueue.getWaitingCount(),
    matchQueue.getActiveCount(),
    matchQueue.getCompletedCount(),
    matchQueue.getFailedCount(),
  ]);

  return {
    scrape: {
      waiting: scrapeWaiting,
      active: scrapeActive,
      completed: scrapeCompleted,
      failed: scrapeFailed,
    },
    match: {
      waiting: matchWaiting,
      active: matchActive,
      completed: matchCompleted,
      failed: matchFailed,
    },
  };
}

// Cleanup function for graceful shutdown
export async function closeQueues() {
  await scrapeQueue.close();
  await matchQueue.close();
  await scrapeQueueEvents.close();
  await matchQueueEvents.close();
  await connection.quit();
}