import 'dotenv/config';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

// The worker talks to Convex over HTTP instead of Postgres/Redis. We reference
// functions by name (makeFunctionReference) so the worker stays a self-contained
// package and does not need to import convex/_generated across the package
// boundary (which would break its rootDir:src tsc build).

const convexUrl =
  process.env.CONVEX_URL ||
  process.env.CONVEX_SELF_HOSTED_URL ||
  'http://127.0.0.1:3210';

export const convex = new ConvexHttpClient(convexUrl);

// Generic helpers ------------------------------------------------------------
type AnyArgs = Record<string, unknown>;

function q<R = any>(name: string) {
  const ref = makeFunctionReference<'query'>(name);
  return (args: AnyArgs = {}) => convex.query(ref, args) as Promise<R>;
}
function m<R = any>(name: string) {
  const ref = makeFunctionReference<'mutation'>(name);
  return (args: AnyArgs = {}) => convex.mutation(ref, args) as Promise<R>;
}

// Jobs queue (replaces BullMQ) ----------------------------------------------
export type ClaimedJob = {
  _id: string;
  queue: 'scrape' | 'match' | 'instagramScrape' | 'schedule';
  name: string;
  payload: any;
  runId?: string;
  attempts: number;
  maxAttempts: number;
  cancelRequested?: boolean;
} | null;

export const jobs = {
  claimNext: m<ClaimedJob>('jobs:claimNext'),
  complete: m('jobs:complete'),
  fail: m('jobs:fail'),
  enqueue: m<string>('jobs:enqueue'),
  reclaimStalled: m<{ requeued: number; failed: number }>('jobs:reclaimStalled'),
};

// Run logs (replaces Redis log streams) -------------------------------------
export const runLogs = {
  append: m('runLogs:append'),
};

// Worker data layer (replaces postgres-js queries) --------------------------
export const workerApi = {
  // reads
  getSource: q('worker:getSource'),
  getRunMetadata: q('worker:getRunMetadata'),
  eventsForMatching: q('worker:eventsForMatching'),
  getInstagramConfig: q('worker:getInstagramConfig'),
  getInstagramAccount: q('worker:getInstagramAccount'),
  getInstagramSession: q('worker:getInstagramSession'),
  getKnownInstagramPostIds: q<string[]>('worker:getKnownInstagramPostIds'),
  getInstagramSourceId: q<string | null>('worker:getInstagramSourceId'),
  // run lifecycle
  markRunRunning: m('worker:markRunRunning'),
  finishRun: m('worker:finishRun'),
  mergeRunMetadata: m('worker:mergeRunMetadata'),
  // scrape persistence
  saveScrapedEvent: m<{ action: 'inserted' | 'updated' | 'unchanged'; seriesId: string }>(
    'worker:saveScrapedEvent',
  ),
  replaceOpenMatches: m<{ cleared: number; inserted: number }>('worker:replaceOpenMatches'),
  // instagram persistence
  createInstagramRun: m<string>('worker:createInstagramRun'),
  upsertInstagramPost: m('worker:upsertInstagramPost'),
  insertExtractedEvent: m<string>('worker:insertExtractedEvent'),
  touchInstagramAccount: m('worker:touchInstagramAccount'),
  refreshInstagramBatchRun: m('worker:refreshInstagramBatchRun'),
};

// Helper to append a log line with auto-sequencing handled server-side.
export async function appendRunLog(
  runId: string,
  level: number,
  message: string,
  source = 'worker',
  raw?: unknown,
) {
  try {
    await runLogs.append({ runId, level, message, source, raw });
  } catch (err) {
    // Never let logging failures break a job.
    console.error('Failed to append run log:', (err as Error).message);
  }
}
