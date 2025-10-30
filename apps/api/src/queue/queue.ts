import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null, // Fix BullMQ deprecation warning
});

const INSTAGRAM_CANCEL_KEY_PREFIX = 'instagram-scrape:cancel:';

const instagramCancelKey = (jobId: string) => `${INSTAGRAM_CANCEL_KEY_PREFIX}${jobId}`;

// Define job data schemas
export const scrapeJobSchema = z.object({
  sourceId: z.string().uuid(),
  runId: z.string().uuid(),
  moduleKey: z.string(),
  sourceName: z.string(),
  testMode: z.boolean().optional(),
  scrapeMode: z.enum(['full', 'incremental']).optional(),
  paginationOptions: z.object({
    type: z.enum(['page', 'calendar']),
    scrapeAllPages: z.boolean().optional(),
    maxPages: z.number().positive().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }).optional(),
  uploadedFile: z.object({
    path: z.string(),
    format: z.enum(['csv', 'json', 'xlsx']),
    content: z.string().optional(),
  }).optional(),
});

export const matchJobSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  sourceIds: z.array(z.string().uuid()).optional(),
});

export const instagramScrapeJobSchema = z.object({
  accountId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  postLimit: z.number().positive().optional(),
});

export type ScrapeJobData = z.infer<typeof scrapeJobSchema>;
export type MatchJobData = z.infer<typeof matchJobSchema>;
export type InstagramScrapeJobData = z.infer<typeof instagramScrapeJobSchema>;

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

export const instagramScrapeQueue = new Queue<InstagramScrapeJobData>('instagram-scrape-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // Longer delay for Instagram rate limits
    },
    removeOnComplete: {
      age: 3600,
      count: 100,
    },
    removeOnFail: {
      age: 24 * 3600,
    },
  },
});

// Queue events for monitoring
export const scrapeQueueEvents = new QueueEvents('scrape-queue', { connection });
export const matchQueueEvents = new QueueEvents('match-queue', { connection });
export const instagramScrapeQueueEvents = new QueueEvents('instagram-scrape-queue', { connection });

export async function markInstagramJobCancelRequested(jobId: string, ttlSeconds: number = 3600) {
  await connection.set(instagramCancelKey(jobId), 'requested', 'EX', ttlSeconds);
}

export async function markInstagramJobCancelled(jobId: string, ttlSeconds: number = 3600) {
  await connection.set(instagramCancelKey(jobId), 'cancelled', 'EX', ttlSeconds);
}

export async function clearInstagramJobCancelState(jobId: string) {
  await connection.del(instagramCancelKey(jobId));
}

export async function getInstagramJobCancelState(jobId: string): Promise<'requested' | 'cancelled' | null> {
  const value = await connection.get(instagramCancelKey(jobId));
  if (value === 'requested' || value === 'cancelled') {
    return value;
  }
  return null;
}

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

export async function enqueueInstagramScrapeJob(data: InstagramScrapeJobData) {
  const job = await instagramScrapeQueue.add('instagram-scrape', data, {
    jobId: `instagram-scrape-${data.accountId}-${Date.now()}`,
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

  const [instagramWaiting, instagramActive, instagramCompleted, instagramFailed] = await Promise.all([
    instagramScrapeQueue.getWaitingCount(),
    instagramScrapeQueue.getActiveCount(),
    instagramScrapeQueue.getCompletedCount(),
    instagramScrapeQueue.getFailedCount(),
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
    instagram: {
      waiting: instagramWaiting,
      active: instagramActive,
      completed: instagramCompleted,
      failed: instagramFailed,
    },
  };
}

// Cleanup function for graceful shutdown
export async function closeQueues() {
  await scrapeQueue.close();
  await matchQueue.close();
  await instagramScrapeQueue.close();
  await scrapeQueueEvents.close();
  await matchQueueEvents.close();
  await instagramScrapeQueueEvents.close();
  await connection.quit();
}
