import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markRunRunning, recordScrapeAttempt, saveScrapedEvent } from '../../convex/worker';
import { heartbeat, reclaimStalled, fail } from '../../convex/jobs';
import { getScrapeMetrics } from '../../apps/admin/src/components/runs/runMetadata';

function harness() {
  const run: any = { _id: 'run', startedAt: 1000, status: 'queued', eventsFound: 0, pagesCrawled: 0, metadata: { scheduleId: 'schedule' } };
  const job: any = { _id: 'job', runId: 'run', status: 'running', claimedBy: 'worker', attempts: 1, maxAttempts: 3, startedAt: Date.now() - 600000, updatedAt: Date.now() };
  const rows: any = { run, job };
  const ctx: any = { db: {
    get: async (id: string) => rows[id],
    patch: async (...args: any[]) => { const [id, patch] = args.slice(-2); Object.assign(rows[id], patch); },
    query: () => ({ withIndex: () => ({ collect: async () => [job] }) }),
  } };
  return { run, job, ctx };
}
const report = { runId: 'run', attempt: 1, activeMs: 51000, pagesCrawled: 50, found: 41, processed: 41, inserted: 0, updated: 0, unchanged: 41, failed: 0, detailFailures: 0 };

test('unchanged events count as found and reporting preserves schedule metadata', async () => {
  const { ctx, run } = harness();
  await (markRunRunning as any)._handler(ctx, { runId: 'run', attempt: 1, maxAttempts: 3 });
  await (recordScrapeAttempt as any)._handler(ctx, report);
  assert.equal(run.eventsFound, 41);
  assert.equal(run.pagesCrawled, 50);
  assert.equal(run.metadata.scrape.unchanged, 41);
  assert.equal(run.metadata.scheduleId, 'schedule');
  assert.equal(run.startedAt, 1000, 'creation time remains stable');
});

test('failed attempts retain progress; retry time and page counts accumulate exactly once', async () => {
  const { ctx, run, job } = harness();
  await (markRunRunning as any)._handler(ctx, { runId: 'run', attempt: 1, maxAttempts: 3 });
  await (recordScrapeAttempt as any)._handler(ctx, { ...report, found: 0, pagesCrawled: 1, activeMs: 15000 });
  await (fail as any)._handler(ctx, { jobId: 'job', error: 'HTTP 403' });
  assert.equal(run.status, 'queued');
  assert.equal(run.pagesCrawled, 1);
  const firstStartedAt = run.metadata.scrape.firstStartedAt;
  await (markRunRunning as any)._handler(ctx, { runId: 'run', attempt: 2, maxAttempts: 3 });
  await (recordScrapeAttempt as any)._handler(ctx, { ...report, attempt: 2 });
  await (recordScrapeAttempt as any)._handler(ctx, { ...report, attempt: 2 });
  assert.equal(run.pagesCrawled, 51);
  assert.equal(run.metadata.scrape.activeMs, 66000);
  assert.equal(run.metadata.scrape.firstStartedAt, firstStartedAt);
  job.attempts = 3;
  await (fail as any)._handler(ctx, { jobId: 'job', error: 'Final failure' });
  assert.equal(run.status, 'error');
  assert.equal(run.errors.error, 'Final failure');
  assert.equal(run.pagesCrawled, 51);
});

test('UI separates active work from queue/retry time and leaves legacy counts alone', () => {
  const run: any = { startedAt: 1000, finishedAt: 274000, status: 'success', metadata: { scrape: { version: 1, activeMs: 51000, attempt: 1, completedAttempt: 1 } } };
  const metrics = getScrapeMetrics(run)!;
  assert.equal(metrics.activeMs, 51000);
  assert.equal(metrics.waitMs, 222000);
  assert.equal(getScrapeMetrics({ ...run, metadata: {} }), null);
});

test('a long crawl with a recent heartbeat is not reclaimed; stale crawls are', async () => {
  const { ctx, job } = harness();
  assert.deepEqual(await (reclaimStalled as any)._handler(ctx, {}), { requeued: 0, failed: 0 });
  job.updatedAt = Date.now() - 600000;
  await (heartbeat as any)._handler(ctx, { jobId: 'job', workerId: 'worker', attempt: 0 });
  assert.ok(job.updatedAt < Date.now() - 500000, 'stale attempt cannot renew');
  await (heartbeat as any)._handler(ctx, { jobId: 'job', workerId: 'worker', attempt: 1 });
  assert.deepEqual(await (reclaimStalled as any)._handler(ctx, {}), { requeued: 0, failed: 0 });
  job.updatedAt = Date.now() - 600000;
  assert.deepEqual(await (reclaimStalled as any)._handler(ctx, {}), { requeued: 1, failed: 0 });
});

for (const change of ['none', 'raw', 'occurrence']) {
  test(`save outcome accounts for ${change} changes beyond the series hash`, async () => {
    const patched: any[] = [];
    const existing: any = {
      eventSeries: { _id: 'series', contentHash: 'same' },
      eventsRaw: { _id: 'raw', contentHash: 'same' },
      eventOccurrences: change === 'occurrence' ? null : { _id: 'occurrence' },
    };
    const ctx = { db: {
      query: (table: string) => ({ withIndex: () => ({ first: async () => existing[table] }) }),
      patch: async (id: string, value: any) => { patched.push({ id, value }); },
      insert: async () => 'new-row',
    } };
    const result = await (saveScrapedEvent as any)._handler(ctx, {
      sourceId: 'source', runId: 'run',
      series: { sourceEventId: 'event', contentHash: 'same' },
      rawEvent: { sourceEventId: 'event', contentHash: change === 'raw' ? 'changed' : 'same' },
      occurrences: [{ startDatetime: 1000 }],
    });
    assert.equal(result.action, change === 'none' ? 'unchanged' : 'updated');
    if (change !== 'none') assert.equal(patched.find(p => p.id === 'raw').value.runId, 'run');
  });
}
