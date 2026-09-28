import assert from "node:assert/strict";
import { test } from "node:test";
import { runDue, runScheduled } from "../../convex/schedules";

const dispatch = (runDue as any)._handler;
const execute = (runScheduled as any)._handler;

function harness(schedules: any[]) {
  const callbacks: any[] = [];
  const writes: any[] = [];
  const ctx = {
    db: {
      query(table: string) {
        // A regression to running exports inside the dispatcher fails here.
        if (table === "eventsRaw") throw new Error("Export exceeds its read budget");
        assert.equal(table, "schedules");
        return {
          withIndex: () => ({ collect: async () => schedules.filter(s => s.active) }),
        };
      },
      get: async (id: string) => id === "wp-settings"
        ? { active: true }
        : schedules.find(s => s._id === id) ?? null,
      patch: async (id: string, patch: object) => {
        Object.assign(schedules.find(s => s._id === id), patch);
      },
      insert: async (table: string, value: object) => {
        writes.push({ table, value });
        return `${table}-${writes.length}`;
      },
    },
    scheduler: {
      runAfter: async (delay: number, fn: unknown, args: object) => {
        assert.equal(delay, 0);
        callbacks.push({ fn, args });
      },
    },
  };
  return { ctx, callbacks, writes };
}

const schedule = (id: string, extra = {}) => ({
  _id: id, active: true, cron: "* * * * *", timezone: "America/Vancouver",
  scheduleType: "scrape", sourceId: "source-1", ...extra,
});

test("exports and scrapes are dispatched independently; one export failure cannot block scrapes", async () => {
  const h = harness([
    schedule("export", { scheduleType: "wordpress_export", wordpressSettingsId: "wp-settings" }),
    schedule("scrape"),
  ]);
  assert.deepEqual(await dispatch(h.ctx), { fired: 2, jobs: 2 });
  assert.equal(h.writes.length, 0, "dispatcher must not create worker jobs or scan events");
  assert.equal(h.callbacks.length, 2);
  await assert.rejects(execute(h.ctx, h.callbacks[0].args), /read budget/);
  assert.deepEqual(await execute(h.ctx, h.callbacks[1].args), { jobsEnqueued: 1 });
  assert.deepEqual(h.writes.map(w => w.table), ["runs", "jobs"]);
  assert.equal(h.writes[1].value.queue, "scrape");
});

test("a second tick within the same minute does not dispatch duplicates", async () => {
  const h = harness([schedule("scrape", { lastRunAt: Date.now() })]);
  assert.deepEqual(await dispatch(h.ctx), { fired: 0, jobs: 0 });
  assert.equal(h.callbacks.length, 0);
});

test("inactive and nonmatching schedules are not dispatched", async () => {
  const h = harness([
    schedule("inactive", { active: false }),
    schedule("never", { cron: "0 0 31 2 *" }),
  ]);
  assert.deepEqual(await dispatch(h.ctx), { fired: 0, jobs: 0 });
  assert.equal(h.callbacks.length, 0);
});

test("deleting or disabling a schedule before its callback prevents execution", async () => {
  const h = harness([schedule("disabled", { active: false })]);
  assert.deepEqual(await execute(h.ctx, { scheduleId: "missing" }), { jobsEnqueued: 0 });
  assert.deepEqual(await execute(h.ctx, { scheduleId: "disabled" }), { jobsEnqueued: 0 });
  assert.equal(h.writes.length, 0);
});
