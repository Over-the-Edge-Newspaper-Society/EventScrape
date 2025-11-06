import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, queryClient } from '../db/connection.js';
import { instagramAccounts, runs } from '../db/schema.js';
import type { InstagramAccount } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import {
  enqueueInstagramScrapeJob,
  instagramScrapeQueue,
  markInstagramJobCancelRequested,
  markInstagramJobCancelled,
  getInstagramJobCancelState,
  clearInstagramJobCancelState,
} from '../queue/queue.js';

const INSTAGRAM_SOURCE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

type RunMetadata = Record<string, unknown>;

function normalizeRunMetadata(raw: unknown): RunMetadata {
  if (!raw) {
    return {};
  }

  if (Array.isArray(raw)) {
    return raw.reduce<RunMetadata>((acc, entry) => {
      return { ...acc, ...normalizeRunMetadata(entry) };
    }, {});
  }

  if (typeof raw === 'string') {
    try {
      return normalizeRunMetadata(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  if (typeof raw === 'object') {
    return { ...(raw as Record<string, unknown>) };
  }

  return {};
}

function cleanMetadata(metadata: RunMetadata): RunMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined)
  );
}

async function getRunMetadata(runId: string): Promise<RunMetadata> {
  const rows = await queryClient`
    SELECT metadata
    FROM runs
    WHERE id = ${runId}
    LIMIT 1
  `;
  return normalizeRunMetadata(rows[0]?.metadata);
}

async function setRunMetadata(runId: string, metadata: RunMetadata): Promise<void> {
  await queryClient`
    UPDATE runs
    SET metadata = ${queryClient.json(cleanMetadata(metadata) as any)}
    WHERE id = ${runId}
  `;
}

export class NoActiveInstagramAccountsError extends Error {
  constructor(message = 'No active Instagram accounts found') {
    super(message);
    this.name = 'NoActiveInstagramAccountsError';
  }
}

export interface TriggerInstagramScrapeOptions {
  postLimit?: number;
  accountLimit?: number;
  batchSize?: number;
}

type InstagramScrapeScope = 'all_active' | 'all_inactive' | 'custom';

interface NormalizedScrapeOptions {
  postLimit: number;
  batchSize?: number;
  accountLimit?: number;
}

interface InstagramBatchContext {
  scope?: InstagramScrapeScope;
  scheduleId?: string;
  config?: Record<string, unknown>;
}

export interface InstagramScheduleTriggerOptions extends TriggerInstagramScrapeOptions {
  scope?: InstagramScrapeScope;
  accountIds?: string[];
  scheduleId?: string;
}

function normalizeScrapeOptions(options: TriggerInstagramScrapeOptions = {}): NormalizedScrapeOptions {
  const postLimit = Math.min(Math.max(options.postLimit ?? 10, 1), 100);
  const batchSize = options.batchSize ? Math.min(Math.max(options.batchSize, 1), 25) : undefined;
  const accountLimit =
    options.accountLimit && options.accountLimit > 0 ? Math.max(1, Math.floor(options.accountLimit)) : undefined;

  return { postLimit, batchSize, accountLimit };
}

async function triggerInstagramScrapesForAccounts(
  accounts: InstagramAccount[],
  options: TriggerInstagramScrapeOptions = {},
  context: InstagramBatchContext = {},
) {
  if (!accounts.length) {
    throw new NoActiveInstagramAccountsError();
  }

  const normalized = normalizeScrapeOptions(options);
  const effectiveAccountLimit = normalized.accountLimit
    ? Math.min(normalized.accountLimit, accounts.length)
    : accounts.length;
  const accountsToScrape = accounts.slice(0, effectiveAccountLimit);

  if (!accountsToScrape.length) {
    throw new NoActiveInstagramAccountsError();
  }

  const parentRunId = uuidv4();
  const baseOptions = {
    postLimit: normalized.postLimit,
    batchSize: normalized.batchSize,
    accountLimit: effectiveAccountLimit,
  };

  const metadata: RunMetadata = {
    type: 'instagram_batch',
    accountsTotal: accountsToScrape.length,
    options: baseOptions,
    accountIds: accountsToScrape.map((a) => a.id),
  };

  if (context.scope) {
    metadata.scope = context.scope;
  }
  if (context.scheduleId) {
    metadata.scheduleId = context.scheduleId;
  }
  if (context.config) {
    metadata.config = context.config;
  }

  await db.insert(runs).values({
    id: parentRunId,
    sourceId: INSTAGRAM_SOURCE_ID,
    status: 'queued',
    metadata,
  });

  const jobs = [];
  for (const account of accountsToScrape) {
    const childRunId = uuidv4();
    const queuePosition = jobs.length + 1;

    const childMetadata: RunMetadata = {
      instagramAccountId: account.id,
      instagramUsername: account.instagramUsername,
      queuePosition,
    };

    await db.insert(runs).values({
      id: childRunId,
      sourceId: INSTAGRAM_SOURCE_ID,
      status: 'queued',
      parentRunId,
      metadata: childMetadata,
    });

    const job = await enqueueInstagramScrapeJob({
      accountId: account.id,
      postLimit: normalized.postLimit,
      batchSize: normalized.batchSize,
      runId: childRunId,
      parentRunId,
    });

    if (job.id) {
      await setRunMetadata(childRunId, { ...childMetadata, jobId: job.id });
    }

    jobs.push({
      accountId: account.id,
      username: account.instagramUsername,
      jobId: job.id,
      runId: childRunId,
    });
  }

  await updateBatchRunSummary(parentRunId);

  return {
    accountsQueued: accountsToScrape.length,
    postLimit: normalized.postLimit,
    batchSize: normalized.batchSize,
    parentRunId,
    jobs,
    scope: context.scope,
  };
}

export async function triggerAllActiveInstagramScrapes(options: TriggerInstagramScrapeOptions = {}) {
  const accounts = await db
    .select()
    .from(instagramAccounts)
    .where(eq(instagramAccounts.active, true));

  if (accounts.length === 0) {
    throw new NoActiveInstagramAccountsError();
  }

  return triggerInstagramScrapesForAccounts(accounts, options, { scope: 'all_active' });
}

export async function triggerInstagramScrapeSchedule(
  config: InstagramScheduleTriggerOptions = {},
) {
  const scope: InstagramScrapeScope = config.scope ?? 'all_active';
  let accounts: InstagramAccount[] = [];

  if (scope === 'custom') {
    const uniqueAccountIds = Array.from(new Set(config.accountIds ?? [])).filter(Boolean);
    if (uniqueAccountIds.length === 0) {
      throw new Error('No Instagram accounts selected for custom schedule');
    }

    const rows = await db
      .select()
      .from(instagramAccounts)
      .where(inArray(instagramAccounts.id, uniqueAccountIds));

    const accountMap = new Map(rows.map((row) => [row.id, row]));
    accounts = uniqueAccountIds
      .map((id) => accountMap.get(id))
      .filter((account): account is InstagramAccount => !!account);

    if (accounts.length === 0) {
      throw new Error('Selected Instagram accounts were not found');
    }
  } else {
    const isActive = scope === 'all_active';
    accounts = await db
      .select()
      .from(instagramAccounts)
      .where(eq(instagramAccounts.active, isActive));

    if (accounts.length === 0) {
      throw new NoActiveInstagramAccountsError(
        isActive ? 'No active Instagram accounts found' : 'No inactive Instagram accounts found',
      );
    }
  }

  return triggerInstagramScrapesForAccounts(accounts, config, {
    scope,
    scheduleId: config.scheduleId,
    config: config as Record<string, unknown>,
  });
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
        if (cancelState === 'cancelled') {
          await clearInstagramJobCancelState(jobId);
        }
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
      const runRecord = await findRunByJobId(jobId);
      if (runRecord) {
        await markRunAsCancelled(runRecord.id as string);
        if (runRecord.parent_run_id) {
          await updateBatchRunSummary(runRecord.parent_run_id as string);
        }
      }

      await markInstagramJobCancelled(jobId);
      results.push({
        jobId,
        state: null,
        action: 'missing',
      });
      continue;
    }

    const runIdFromJob = (job.data as any)?.runId as string | undefined;
    const parentRunIdFromJob = (job.data as any)?.parentRunId as string | undefined;
    const state = (await job.getState()) as string;

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
      if (runIdFromJob) {
        await markRunAsCancelled(runIdFromJob);
      }
      if (parentRunIdFromJob) {
        await updateBatchRunSummary(parentRunIdFromJob);
      }
      results.push({
        jobId,
        state,
        action: 'removed',
      });
      continue;
    }

    if (state === 'active') {
      await markInstagramJobCancelRequested(jobId);
      if (runIdFromJob) {
        const metadata = await getRunMetadata(runIdFromJob);
        metadata.cancelRequested = true;
        await setRunMetadata(runIdFromJob, metadata);
      }
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

async function findRunByJobId(jobId: string) {
  const rows = await queryClient`
    SELECT id, parent_run_id
    FROM runs
    WHERE metadata ->> 'jobId' = ${jobId}
    LIMIT 1
  `;
  return rows[0];
}

async function markRunAsCancelled(runId: string) {
  let metadata = await getRunMetadata(runId);
  metadata = cleanMetadata({ ...metadata, cancelled: true });

  await queryClient`
    UPDATE runs
    SET status = 'partial',
        finished_at = NOW(),
        metadata = ${queryClient.json(metadata as any)}
    WHERE id = ${runId}
  `;
}

async function updateBatchRunSummary(parentRunId: string) {
  const [summary] = await queryClient`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
      COUNT(*) FILTER (WHERE status IN ('error', 'partial'))::int AS failed_count,
      COUNT(*) FILTER (WHERE status IN ('queued', 'running'))::int AS pending_count,
      COALESCE(SUM(events_found), 0)::int AS events_total,
      COALESCE(SUM(pages_crawled), 0)::int AS pages_total
    FROM runs
    WHERE parent_run_id = ${parentRunId}
  `;

  if (!summary) {
    return;
  }

  const pendingCount = Number(summary.pending_count ?? 0);
  const failedCount = Number(summary.failed_count ?? 0);
  const eventsTotal = Number(summary.events_total ?? 0);
  const pagesTotal = Number(summary.pages_total ?? 0);

  const nextStatus = pendingCount > 0
    ? 'running'
    : failedCount > 0
      ? 'partial'
      : 'success';

  let metadata = await getRunMetadata(parentRunId);
  metadata.batch = {
    total: Number(summary.total ?? 0),
    success: Number(summary.success_count ?? 0),
    failed: failedCount,
    pending: pendingCount,
  };

  await queryClient`
    UPDATE runs
    SET status = ${nextStatus},
        events_found = ${eventsTotal},
        pages_crawled = ${pagesTotal},
        finished_at = CASE WHEN ${pendingCount} = 0 THEN NOW() ELSE finished_at END,
        metadata = ${queryClient.json(cleanMetadata(metadata) as any)}
    WHERE id = ${parentRunId}
  `;
}
