import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fail } from '../../convex/jobs';

const failJob = (fail as any)._handler;

function harness(overrides = {}) {
  const job: any = { _id: 'job', runId: 'run', status: 'running', attempts: 1,
    maxAttempts: 3, availableAt: 1000, ...overrides };
  const run: any = { _id: 'run', status: 'running', metadata: { postsStored: 0 } };
  const ctx = { db: {
    get: async (id: string) => id === 'job' ? job : id === 'run' ? run : null,
    patch: async (...args: any[]) => {
      const [id, value] = args.slice(-2);
      Object.assign(id === 'job' ? job : run, value);
    },
  } };
  return { ctx, job, run };
}

test('nonretryable failures terminate job and run despite remaining attempts', async () => {
  const { ctx, job, run } = harness();
  const before = Date.now();
  await failJob(ctx, { jobId: 'job', error: 'Apify quota exhausted', retryable: false });
  assert.equal(job.status, 'error');
  assert.equal(job.availableAt, 1000, 'must not schedule a retry');
  assert.equal(job.attempts, 1);
  assert.ok(job.finishedAt >= before);
  assert.equal(job.lastError, 'Apify quota exhausted');
  assert.equal(run.status, 'error');
  assert.equal(run.finishedAt, job.finishedAt);
  assert.deepEqual(run.errors, { error: 'Apify quota exhausted' });
  assert.deepEqual(run.metadata, { postsStored: 0 }, 'retain diagnostic progress');
});

for (const retryable of [undefined, true]) {
  test(`ordinary failures still retry when retryable is ${String(retryable)}`, async () => {
    const { ctx, job, run } = harness();
    run.finishedAt = 1000;
    const before = Date.now();
    await failJob(ctx, { jobId: 'job', error: 'Temporary storage outage',
      ...(retryable === undefined ? {} : { retryable }), retryDelayMs: 7000 });
    assert.equal(job.status, 'queued');
    assert.ok(job.availableAt >= before + 7000);
    assert.equal(job.finishedAt, undefined);
    assert.equal(run.status, 'queued');
    assert.equal(run.finishedAt, undefined);
  });
}

test('explicit retryable true does not override exhausted attempts or cancellation', async () => {
  for (const overrides of [{ attempts: 3 }, { cancelRequested: true }]) {
    const { ctx, job, run } = harness(overrides);
    await failJob(ctx, { jobId: 'job', error: 'Failed', retryable: true });
    assert.equal(job.status, 'error');
    assert.equal(run.status, 'error');
  }
});
