import assert from "node:assert/strict";
import { test } from "node:test";
import { create, update, previewWordpressExport, runDue, runScheduled } from "../../convex/schedules";

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
        if (table === "sources") return { collect: async () => [] };
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

function executionHarness(current: any, data: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { schedules: [current], runs: [], jobs: [], exports: [],
    sources: [{ _id: "ig-source", sourceType: "instagram", name: "Instagram" },
      { _id: "website", legacyId: "old-website", sourceType: "website", name: "Website" }],
    instagramAccounts: [{ _id: "account-1", legacyId: "old-account", active: true, instagramUsername: "first" },
      { _id: "account-2", active: true, instagramUsername: "second" },
      { _id: "account-inactive", active: false }],
    wordpressSettings: [{ _id: "wp-settings", active: true }], eventsRaw: [], ...data };
  const writes: any[] = [];
  const ctx = { db: {
    query(table: string) {
      let rows = tables[table] ?? [];
      const chain = {
        withIndex(_index: string, filter: any) {
          filter({ eq: (field: string, value: unknown) => { rows = rows.filter(r => r[field] === value); } });
          return chain;
        },
        collect: async () => rows,
        first: async () => rows[0] ?? null,
      };
      return chain;
    },
    get: async (id: string) => Object.values(tables).flat().find(r => r._id === id) ?? null,
    insert: async (table: string, value: any) => {
      const id = `${table}-${writes.length + 1}`;
      writes.push({ table, value });
      tables[table].push({ _id: id, ...value });
      return id;
    },
    patch: async (id: string, patch: any) => {
      Object.assign(Object.values(tables).flat().find(r => r._id === id), patch);
    },
  } };
  return { ctx, writes, tables };
}

for (const format of ["object", "migrated JSON"]) {
  test(`${format} Instagram config retains four-post and eight-item limits with tracked child runs`, async () => {
    const config = { scope: "all_active", postLimit: 4, batchSize: 8 };
    const h = executionHarness(schedule("instagram", { scheduleType: "instagram_scrape",
      config: format === "object" ? config : JSON.stringify(config) }));
    assert.deepEqual(await execute(h.ctx, { scheduleId: "instagram" }), { jobsEnqueued: 2 });
    const [parent, ...children] = h.tables.runs;
    assert.equal(parent.metadata.batch.total, 2);
    assert.equal(children.length, 2);
    for (const job of h.tables.jobs) {
      assert.equal(job.payload.postLimit, 4);
      assert.equal(job.payload.batchSize, 8);
      assert.equal(job.payload.parentRunId, parent._id);
      assert.equal(job.payload.runId, job.runId);
      assert.equal(children.find(r => r._id === job.runId).parentRunId, parent._id);
    }
  });
}

test("Instagram accountLimit and custom targets retain their selection", async () => {
  for (const config of [
    { scope: "all_active", accountLimit: 1 },
    { scope: "custom", accountIds: ["account-1"] },
  ]) {
    const h = executionHarness(schedule("instagram", { scheduleType: "instagram_scrape", config: JSON.stringify(config) }));
    assert.deepEqual(await execute(h.ctx, { scheduleId: "instagram" }), { jobsEnqueued: 1 });
    assert.equal(h.tables.jobs[0].payload.accountId, "account-1");
  }
});

test("malformed Instagram configurations fail before any jobs or runs are written", async () => {
  for (const config of ['{', '[]', 'null', '42', [], false,
    { scope: "all-actve" }, { scope: null }, { scope: "custom" }, { accountIds: "account-1" },
    { postLimit: "4" }, { postLimit: 0 }, { postLimit: 101 }, { batchSize: 26 },
    { accountLimit: 0 }, { accountLimit: 1.5 }]) {
    const h = executionHarness(schedule("instagram", { scheduleType: "instagram_scrape", config }));
    await assert.rejects(execute(h.ctx, { scheduleId: "instagram" }), /Invalid schedule config/);
    assert.equal(h.writes.length, 0);
  }
});

test("create and activation normalize migrated config; invalid updates do not activate", async () => {
  const h = executionHarness(schedule("instagram", { scheduleType: "instagram_scrape", active: false,
    config: '{"scope":"all_active","postLimit":4,"batchSize":8}' }));
  const result = await (update as any)._handler(h.ctx, { id: "instagram", active: true });
  assert.equal(result.schedule.config.postLimit, 4);
  assert.equal(typeof result.schedule.config, "object");
  await assert.rejects((update as any)._handler(h.ctx, { id: "instagram", config: '{' }), /Invalid schedule config/);
  assert.equal(result.schedule.config.postLimit, 4);
  const created = await (create as any)._handler(h.ctx, { scheduleType: "instagram_scrape", cron: "* * * * *",
    config: '{"scope":"custom","accountIds":["account-2"],"postLimit":4}' });
  assert.equal(created.schedule.config.scope, "custom");
  assert.deepEqual(created.schedule.config.accountIds, ["account-2"]);
});

test("website schedules preserve default behavior and configured incremental mode", async () => {
  for (const config of [undefined, { scrapeMode: "incremental" }, '{"scrapeMode":"incremental"}']) {
    const h = executionHarness(schedule("web", { config }));
    assert.deepEqual(await execute(h.ctx, { scheduleId: "web" }), { jobsEnqueued: 1 });
    assert.equal(h.tables.jobs[0].payload.scrapeMode, config ? "incremental" : undefined);
  }
});

const eventStart = Date.UTC(2026, 8, 29, 19);
const webEvent = { _id: "web-event", sourceId: "website", startDatetime: eventStart, title: "Website event" };
const igEvent = { _id: "ig-event", sourceId: "ig-source", instagramAccountId: "account-1",
  instagramPostId: "post", sourceEventId: "post-event-0", contentHash: "post-event-0",
  startDatetime: eventStart, timezone: "America/Vancouver", title: "Reviewed event", isEventPoster: true,
  raw: { events: [{ title: "Reviewed event", startDate: "2026-09-29", timezone: "America/Vancouver" }] } };
const exportSchedule = (config: any) => schedule("export", {
  scheduleType: "wordpress_export", wordpressSettingsId: "wp-settings", config,
});

test("WordPress object and migrated configs retain website targets, status and update behavior", async () => {
  for (const stringify of [false, true]) {
    const config = { sourceIds: ["old-website"], status: "publish", updateIfExists: true };
    const h = executionHarness(exportSchedule(stringify ? JSON.stringify(config) : config),
      { eventsRaw: [webEvent, igEvent] });
    assert.deepEqual(await execute(h.ctx, { scheduleId: "export" }), { jobsEnqueued: 1 });
    assert.deepEqual(h.tables.jobs[0].payload.eventIds, ["web-event"]);
    assert.equal(h.tables.jobs[0].payload.status, "publish");
    assert.equal(h.tables.jobs[0].payload.updateIfExists, true);
  }
});

test("unknown WordPress targets fail closed in preview and export instead of exporting all sources", async () => {
  for (const sourceIds of [["deleted"], ["website", "deleted"]]) {
    const h = executionHarness(exportSchedule({ sourceIds }), { eventsRaw: [webEvent, igEvent] });
    await assert.rejects(execute(h.ctx, { scheduleId: "export" }), /target no longer exists/);
    await assert.rejects((previewWordpressExport as any)._handler(h.ctx, { sourceIds }), /target no longer exists/);
    assert.equal(h.writes.length, 0);
  }
});

test("WordPress migrated account targets only export reviewed extracted events for that account", async () => {
  const h = executionHarness(exportSchedule({ sourceIds: ["old-account"] }), { eventsRaw: [webEvent, igEvent,
    { ...igEvent, _id: "other-account", instagramAccountId: "account-2" },
    { ...igEvent, _id: "unreviewed", isEventPoster: undefined },
    { ...igEvent, _id: "not-event", isEventPoster: false },
    { ...igEvent, _id: "base", sourceEventId: "post", contentHash: "instagram-post-post" },
    { ...igEvent, _id: "no-extraction", raw: {} },
    { ...igEvent, _id: "wrong-date", raw: { events: [{ startDate: "2026-10-10" }] } },
    { ...igEvent, _id: "impossible-date", raw: { events: [{ startDate: "2026-02-30" }] } },
  ] });
  const preview = await (previewWordpressExport as any)._handler(h.ctx, { sourceIds: ["old-account"] });
  assert.equal(preview.count, 1);
  assert.deepEqual(preview.sample.map((e: any) => e.id), ["ig-event"]);
  assert.deepEqual(await execute(h.ctx, { scheduleId: "export" }), { jobsEnqueued: 1 });
  assert.deepEqual(h.tables.jobs[0].payload.eventIds, ["ig-event"]);
});

test("unrestricted WordPress schedules also exclude base Instagram posts while retaining websites", async () => {
  const h = executionHarness(exportSchedule({}), { eventsRaw: [webEvent,
    { ...igEvent, _id: "unreviewed", isEventPoster: undefined },
    { ...igEvent, _id: "base", sourceEventId: "post" }, igEvent] });
  assert.deepEqual(await execute(h.ctx, { scheduleId: "export" }), { jobsEnqueued: 2 });
  assert.deepEqual(h.tables.jobs[0].payload.eventIds, ["web-event", "ig-event"]);
  assert.equal(h.tables.jobs[0].payload.status, "draft");
});

test("malformed WordPress filters fail before selecting a broader export", async () => {
  for (const config of [{ sourceIds: "website" }, { sourceIds: [null] }, { status: "published" },
    { startDateOffset: "0" }, { endDateOffset: Infinity }, { startDateOffset: 30, endDateOffset: 0 },
    { updateIfExists: "false" }]) {
    const h = executionHarness(exportSchedule(config), { eventsRaw: [webEvent] });
    await assert.rejects(execute(h.ctx, { scheduleId: "export" }), /Invalid schedule config/);
    assert.equal(h.writes.length, 0);
  }
});

test("broken config cannot be activated but can always be disabled", async () => {
  const h = executionHarness(schedule("instagram", { scheduleType: "instagram_scrape", active: false, config: '{' }));
  await assert.rejects((update as any)._handler(h.ctx, { id: "instagram", active: true }), /Invalid schedule config/);
  assert.equal(h.tables.schedules[0].active, false);
  h.tables.schedules[0].active = true;
  await (update as any)._handler(h.ctx, { id: "instagram", active: false });
  assert.equal(h.tables.schedules[0].active, false);
});

test("WordPress preview and export apply the same date, city and category filters", async () => {
  const now = Date.now();
  const matching = { ...webEvent, startDatetime: now + 86400000, city: "Prince George", category: "Music" };
  const config = { sourceIds: ["website"], startDateOffset: 0, endDateOffset: 30, city: "prince", category: "music" };
  const h = executionHarness(exportSchedule(config), { eventsRaw: [matching,
    { ...matching, _id: "old", startDatetime: now - 86400000 },
    { ...matching, _id: "later", startDatetime: now + 31 * 86400000 },
    { ...matching, _id: "other-city", city: "Vancouver" },
    { ...matching, _id: "other-category", category: "Sports" }] });
  assert.equal((await (previewWordpressExport as any)._handler(h.ctx, config)).count, 1);
  await execute(h.ctx, { scheduleId: "export" });
  assert.deepEqual(h.tables.jobs[0].payload.eventIds, ["web-event"]);
});
