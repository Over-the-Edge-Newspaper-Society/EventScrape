import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { instagramAccounts } from '../db/schema.js';
import {
  enqueueInstagramScrapeJob,
  instagramScrapeQueue,
  markInstagramJobCancelRequested,
  markInstagramJobCancelled,
  getInstagramJobCancelState,
  clearInstagramJobCancelState,
} from '../queue/queue.js';

export class NoActiveInstagramAccountsError extends Error {
  constructor(message = 'No active Instagram accounts found') {
    super(message);
    this.name = 'NoActiveInstagramAccountsError';
  }
}

export async function triggerAllActiveInstagramScrapes(postLimit = 10) {
  const accounts = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.active, true));

  if (accounts.length === 0) {
    throw new NoActiveInstagramAccountsError();
  }

  const jobs = [];
  for (const account of accounts) {
    const job = await enqueueInstagramScrapeJob({
      accountId: account.id,
      postLimit,
    });

    jobs.push({
      accountId: account.id,
      username: account.instagramUsername,
      jobId: job.id,
    });
  }

  return {
    accountsQueued: accounts.length,
    jobs,
  };
}

const instagramJobStatusSchema = z.object({
  jobId: z.string(),
  state: z.string(),
  progress: z.number().nullable().optional(),
  attemptsMade: z.number().optional(),
  failedReason: z.string().nullable().optional(),
  returnvalue: z.any().optional(),
  processedOn: z.number().nullable().optional(),
  finishedOn: z.number().nullable().optional(),
  timestamp: z.number().nullable().optional(),
  data: z.any().optional(),
  cancelState: z.enum(['requested', 'cancelled']).nullable().optional(),
});

export type InstagramScrapeJobStatus = z.infer<typeof instagramJobStatusSchema>;

export async function getInstagramScrapeJobStatuses(jobIds: string[]): Promise<InstagramScrapeJobStatus[]> {
  const results = await Promise.all(jobIds.map(async (jobId) => {
    try {
      const job = await instagramScrapeQueue.getJob(jobId);
      const cancelState = await getInstagramJobCancelState(jobId);

      if (!job) {
        return instagramJobStatusSchema.parse({
          jobId,
          state: cancelState === 'cancelled' ? 'cancelled' : 'missing',
          failedReason: cancelState === 'cancelled' ? 'Job cancelled by user' : 'Job not found',
          cancelState,
        });
      }

      const state = await job.getState();
      if (state === 'completed' || state === 'failed') {
        if (cancelState) {
          await clearInstagramJobCancelState(jobId);
        }
      }

      return instagramJobStatusSchema.parse({
        jobId,
        state,
        progress: typeof job.progress === 'number' ? job.progress : null,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason ?? null,
        returnvalue: job.returnvalue ?? null,
        processedOn: job.processedOn ?? null,
        finishedOn: job.finishedOn ?? null,
        timestamp: job.timestamp ?? null,
        data: job.data ?? null,
        cancelState,
      });
    } catch (error: any) {
      return instagramJobStatusSchema.parse({
        jobId,
        state: 'error',
        failedReason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }));

  return results;
}

export interface InstagramScrapeCancelResult {
  jobId: string;
  state: string | null;
  action: 'removed' | 'cancel_requested' | 'already_finished' | 'missing';
}

export async function cancelInstagramScrapeJobs(jobIds: string[]): Promise<InstagramScrapeCancelResult[]> {
  const results: InstagramScrapeCancelResult[] = [];

  for (const jobId of jobIds) {
    const job = await instagramScrapeQueue.getJob(jobId);

    if (!job) {
      await markInstagramJobCancelled(jobId);
      results.push({
        jobId,
        state: null,
        action: 'missing',
      });
      continue;
    }

    const state = await job.getState();

    if (state === 'completed' || state === 'failed') {
      await clearInstagramJobCancelState(jobId);
      results.push({
        jobId,
        state,
        action: 'already_finished',
      });
      continue;
    }

    if (state === 'waiting' || state === 'delayed' || state === 'paused') {
      await job.remove();
      await markInstagramJobCancelled(jobId);
      results.push({
        jobId,
        state,
        action: 'removed',
      });
      continue;
    }

    if (state === 'active') {
      await markInstagramJobCancelRequested(jobId);
      results.push({
        jobId,
        state,
        action: 'cancel_requested',
      });
      continue;
    }

    results.push({
      jobId,
      state,
      action: 'already_finished',
    });
  }

  return results;
}
