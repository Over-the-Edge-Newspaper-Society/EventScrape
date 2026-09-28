import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { scheduleType } from "./schema";
import { cronMatches } from "./cronMatch";

// Ports apps/api/src/routes/schedules.ts. The schedule rows are the source of
// truth; a Convex cron (task #4) reads them. create/update/delete simply persist
// the row — no BullMQ register/unregister. trigger / trigger-all-active enqueue
// jobs (see jobs.enqueue) instead of calling the BullMQ scheduler.

const DEFAULT_TIMEZONE = "America/Vancouver";

// Migrated schedules may retain Postgres JSON as a string. Validate before any
// writes or target selection so malformed limits cannot broaden a scrape.
function normalizeScheduleConfig(type: Doc<"schedules">["scheduleType"], raw: unknown) {
  const invalid = (message: string): never => {
    throw new ConvexError({ code: "BAD_REQUEST", message: `Invalid schedule config: ${message}` });
  };
  let value = raw ?? {};
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { invalid("expected valid JSON"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("expected an object");
  }
  const config = { ...value } as Record<string, any>;
  const integer = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    if (config[key] !== undefined &&
        (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max)) {
      invalid(`${key} must be an integer between ${min} and ${max}`);
    }
  };
  const strings = (key: string) => {
    if (config[key] !== undefined && (!Array.isArray(config[key]) ||
        config[key].some((id: unknown) => typeof id !== "string" || !id.trim()))) {
      invalid(`${key} must be an array of nonempty strings`);
    }
  };
  if (type === "instagram_scrape") {
    if (config.scope === undefined) config.scope = "all_active";
    if (!["all_active", "all_inactive", "custom"].includes(config.scope)) {
      invalid("unsupported Instagram scope");
    }
    strings("accountIds");
    if (config.scope === "custom" && !config.accountIds?.length) {
      invalid("custom Instagram schedules require at least one account");
    }
    integer("postLimit", 1, 100);
    integer("batchSize", 1, 25);
    integer("accountLimit", 1);
  } else if (type === "scrape") {
    if (config.scrapeMode !== undefined && !["full", "incremental"].includes(config.scrapeMode)) {
      invalid("scrapeMode must be full or incremental");
    }
  } else if (type === "wordpress_export") {
    strings("sourceIds");
    for (const key of ["startDateOffset", "endDateOffset"]) {
      if (config[key] !== undefined && (typeof config[key] !== "number" || !Number.isFinite(config[key]))) {
        invalid(`${key} must be a finite number`);
      }
    }
    if (config.startDateOffset !== undefined && config.endDateOffset !== undefined &&
        config.endDateOffset < config.startDateOffset) invalid("end date precedes start date");
    if (config.status !== undefined && !["publish", "draft", "pending"].includes(config.status)) {
      invalid("unsupported WordPress status");
    }
    if (config.updateIfExists !== undefined && typeof config.updateIfExists !== "boolean") {
      invalid("updateIfExists must be a boolean");
    }
    for (const key of ["city", "category", "wordpressSettingsId"]) {
      if (config[key] !== undefined && typeof config[key] !== "string") invalid(`${key} must be a string`);
    }
  }
  return config;
}

function isReviewedInstagramEvent(event: Doc<"eventsRaw">): boolean {
  if (event.isEventPoster !== true || !Number.isFinite(event.startDatetime)) return false;
  // Base posts use their publication timestamp, even after extraction is saved
  // for review. Only a separately created event can enter scheduled exports.
  if (!event.instagramPostId || !event.sourceEventId?.startsWith(`${event.instagramPostId}-`) ||
      event.contentHash === `instagram-post-${event.instagramPostId}`) return false;
  let raw = event.raw;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return false; }
  }
  if (!Array.isArray(raw?.events)) return false;
  return raw.events.some((extracted: any) => {
    if (!extracted || typeof extracted.startDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(extracted.startDate)) return false;
    const date = new Date(`${extracted.startDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== extracted.startDate) return false;
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: extracted.timezone || event.timezone || "America/Vancouver",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date(event.startDatetime));
      const get = (type: string) => parts.find(p => p.type === type)?.value;
      return `${get("year")}-${get("month")}-${get("day")}` === extracted.startDate;
    } catch { return false; }
  });
}

// Shared by the preview and actual export: explicit targets never fall back to
// exporting every source. Older Instagram schedules store account IDs here.
async function selectWordpressEvents(ctx: any, config: Record<string, any>, now: number) {
  const allSources: Doc<"sources">[] = await ctx.db.query("sources").collect();
  const targetSources = new Set<string>();
  const targetAccounts = new Set<string>();
  const sourceIds: string[] = config.sourceIds ?? [];
  if (sourceIds.length) {
    const accounts: Doc<"instagramAccounts">[] = await ctx.db.query("instagramAccounts").collect();
    for (const id of sourceIds) {
      const source = allSources.find(s => String(s._id) === id || s.legacyId === id);
      if (source) { targetSources.add(String(source._id)); continue; }
      const account = accounts.find(a => String(a._id) === id || a.legacyId === id);
      if (account) { targetAccounts.add(String(account._id)); continue; }
      throw new ConvexError({ code: "BAD_REQUEST", message: `WordPress schedule target no longer exists: ${id}` });
    }
  }
  const queriedSources = new Set(targetSources);
  if (targetAccounts.size) {
    for (const source of allSources) {
      if (source.sourceType === "instagram") queriedSources.add(String(source._id));
    }
  }
  let rows: Doc<"eventsRaw">[] = [];
  if (sourceIds.length) {
    for (const sourceId of queriedSources) {
      rows.push(...await ctx.db.query("eventsRaw")
        .withIndex("by_source", (q: any) => q.eq("sourceId", sourceId)).collect());
    }
  } else {
    rows = await ctx.db.query("eventsRaw").collect();
  }
  const DAY = 24 * 60 * 60 * 1000;
  const startMs = config.startDateOffset === undefined ? undefined : now + config.startDateOffset * DAY;
  const endMs = config.endDateOffset === undefined ? undefined : now + config.endDateOffset * DAY;
  const sourcesById = new Map(allSources.map(s => [String(s._id), s]));
  rows = rows.filter(event => {
    if (sourceIds.length && !targetSources.has(String(event.sourceId)) &&
        !targetAccounts.has(String(event.instagramAccountId))) return false;
    const source = sourcesById.get(String(event.sourceId));
    if (!source || event.isEventPoster === false) return false;
    if (source.sourceType === "instagram" && !isReviewedInstagramEvent(event)) return false;
    if (startMs !== undefined && event.startDatetime < startMs) return false;
    if (endMs !== undefined && event.startDatetime > endMs) return false;
    if (config.city && !(event.city ?? "").toLowerCase().includes(config.city.toLowerCase())) return false;
    if (config.category && !(event.category ?? "").toLowerCase().includes(config.category.toLowerCase())) return false;
    return true;
  });
  return { rows, allSources, startMs, endMs };
}

export const list = query({
  args: {},
  returns: v.object({ schedules: v.array(v.any()) }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("schedules").collect();

    const sources = await ctx.db.query("sources").collect();
    const sourceById = new Map(sources.map((s) => [s._id, s]));
    const wpSettings = await ctx.db.query("wordpressSettings").collect();
    const wpById = new Map(wpSettings.map((w) => [w._id, w]));

    const schedules = rows.map((schedule) => {
      const src = schedule.sourceId ? sourceById.get(schedule.sourceId) : undefined;
      const wp = schedule.wordpressSettingsId
        ? wpById.get(schedule.wordpressSettingsId)
        : undefined;
      return {
        schedule,
        source: src
          ? { id: src._id, name: src.name, moduleKey: src.moduleKey }
          : null,
        wordpressSettings: wp
          ? { id: wp._id, name: wp.name, siteUrl: wp.siteUrl }
          : null,
      };
    });

    return { schedules };
  },
});

const createArgs = {
  scheduleType,
  sourceId: v.optional(v.id("sources")),
  wordpressSettingsId: v.optional(v.id("wordpressSettings")),
  cron: v.string(),
  timezone: v.optional(v.string()),
  active: v.optional(v.boolean()),
  config: v.optional(v.any()),
};

export const create = mutation({
  args: createArgs,
  returns: v.object({ schedule: v.any() }),
  handler: async (ctx, args) => {
    if (args.cron.length < 5) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid cron expression" });
    }

    const now = Date.now();
    const timezone = args.timezone ?? DEFAULT_TIMEZONE;
    const active = args.active ?? true;
    const config = normalizeScheduleConfig(args.scheduleType, args.config);

    const base = {
      scheduleType: args.scheduleType,
      cron: args.cron,
      timezone,
      active,
      createdAt: now,
      updatedAt: now,
    };

    let doc: Omit<Doc<"schedules">, "_id" | "_creationTime">;

    if (args.scheduleType === "scrape") {
      if (!args.sourceId) {
        throw new ConvexError({ code: "BAD_REQUEST", message: "sourceId is required for scrape schedules" });
      }
      doc = { ...base, sourceId: args.sourceId, config };
    } else if (args.scheduleType === "wordpress_export") {
      if (!args.wordpressSettingsId) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "wordpressSettingsId is required for wordpress_export schedules",
        });
      }
      doc = {
        ...base,
        wordpressSettingsId: args.wordpressSettingsId,
        config,
      };
    } else {
      // instagram_scrape
      doc = { ...base, config };
    }

    const id = await ctx.db.insert("schedules", doc);
    const schedule = await ctx.db.get(id);
    return { schedule };
  },
});

export const update = mutation({
  args: {
    id: v.id("schedules"),
    cron: v.optional(v.string()),
    timezone: v.optional(v.string()),
    active: v.optional(v.boolean()),
    config: v.optional(v.any()),
  },
  returns: v.object({ schedule: v.any() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Schedule not found" });
    }
    if (args.cron !== undefined && args.cron.length < 5) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid cron expression" });
    }

    await ctx.db.patch(args.id, {
      cron: args.cron ?? existing.cron,
      timezone: args.timezone ?? existing.timezone,
      active: args.active ?? existing.active,
      // Always permit disabling a broken schedule without repairing its config.
      config: args.active === false && args.config === undefined ? existing.config
        : normalizeScheduleConfig(existing.scheduleType, args.config ?? existing.config),
      updatedAt: Date.now(),
    });

    const schedule = await ctx.db.get(args.id);
    return { schedule };
  },
});

export const remove = mutation({
  args: { id: v.id("schedules") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Schedule not found" });
    }

    // Orphan referencing exports to preserve export history (was SET NULL).
    const referencing = await ctx.db
      .query("exports")
      .withIndex("by_schedule", (q) => q.eq("scheduleId", args.id))
      .collect();
    for (const exp of referencing) {
      await ctx.db.patch(exp._id, { scheduleId: undefined });
    }

    await ctx.db.delete(args.id);
    return null;
  },
});

// Enqueues worker-compatible job(s) for a schedule and returns the job ids.
// Payload shapes MUST match what the worker handlers read:
//  - scrape: { sourceId, runId, testMode, scrapeMode } (see worker processScrapeJob)
//  - instagramScrape: { accountId, postLimit, batchSize, parentRunId } (fan-out per account)
//  - wordpress: { settingsId, eventIds, status, scheduleId, exportId, updateIfExists }
async function enqueueScheduleJobs(
  ctx: any,
  schedule: Doc<"schedules">,
): Promise<{ jobIds: Id<"jobs">[]; units: number }> {
  const now = Date.now();
  const config = normalizeScheduleConfig(schedule.scheduleType, schedule.config);

  if (schedule.scheduleType === "scrape") {
    if (!schedule.sourceId) return { jobIds: [], units: 0 };
    const runId = await ctx.db.insert("runs", {
      sourceId: schedule.sourceId,
      startedAt: now,
      status: "queued",
      pagesCrawled: 0,
      eventsFound: 0,
      metadata: { triggeredBy: "schedule", scheduleId: schedule._id },
    });
    const jobId = await ctx.db.insert("jobs", {
      queue: "scrape",
      name: `schedule:scrape`,
      status: "queued",
      payload: {
        sourceId: schedule.sourceId,
        runId,
        testMode: false,
        scrapeMode: config.scrapeMode,
      },
      runId,
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { jobIds: [jobId], units: 1 };
  }

  if (schedule.scheduleType === "instagram_scrape") {
    // Resolve target accounts: explicit accountIds, or all active accounts.
    let accounts: Doc<"instagramAccounts">[];
    if (config.scope === "custom" && Array.isArray(config.accountIds)) {
      accounts = [];
      for (const id of config.accountIds) {
        const acc = await ctx.db.get(id as Id<"instagramAccounts">);
        if (acc) accounts.push(acc);
      }
    } else {
      accounts = await ctx.db
        .query("instagramAccounts")
        .withIndex("by_active", (q: any) => q.eq("active", config.scope === "all_inactive" ? false : true))
        .collect();
    }
    if (typeof config.accountLimit === "number") {
      accounts = accounts.slice(0, config.accountLimit);
    }
    if (accounts.length === 0) return { jobIds: [], units: 0 };

    // Parent batch run for progress aggregation.
    const igSource = await ctx.db
      .query("sources")
      .withIndex("by_source_type", (q: any) => q.eq("sourceType", "instagram"))
      .first();
    if (!igSource) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram source not found" });
    }
    const parentRunId = await ctx.db.insert("runs", {
        sourceId: igSource._id,
        startedAt: now,
        status: "queued",
        pagesCrawled: 0,
        eventsFound: 0,
        metadata: { triggeredBy: "schedule", scheduleId: schedule._id, batch: { total: accounts.length } },
      });

    const jobIds: Id<"jobs">[] = [];
    for (const acc of accounts) {
      const runId = await ctx.db.insert("runs", {
        sourceId: igSource._id,
        parentRunId,
        status: "queued",
        startedAt: now,
        pagesCrawled: 0,
        eventsFound: 0,
        metadata: { instagramAccountId: acc._id, instagramUsername: acc.instagramUsername, scheduleId: schedule._id },
      });
      const jobId = await ctx.db.insert("jobs", {
        queue: "instagramScrape",
        name: `schedule:instagram`,
        status: "queued",
        payload: {
          accountId: acc._id,
          runId,
          postLimit: config.postLimit ?? 10,
          batchSize: config.batchSize,
          parentRunId,
        },
        runId,
        attempts: 0,
        maxAttempts: 3,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
      jobIds.push(jobId);
    }
    return { jobIds, units: jobIds.length };
  }

  // wordpress_export: select the configured events and schedule the WordPress
  // upload action (wordpressUpload:uploadEvents). Replaces the old BullMQ path.
  if (schedule.scheduleType === "wordpress_export") {
    const settingsId = schedule.wordpressSettingsId ?? (config.wordpressSettingsId as Id<"wordpressSettings"> | undefined);
    if (!settingsId) return { jobIds: [], units: 0 };
    const wp = await ctx.db.get(settingsId);
    if (!wp || !wp.active) return { jobIds: [], units: 0 };

    const { rows } = await selectWordpressEvents(ctx, config, now);

    const eventIds = rows.map((e: Doc<"eventsRaw">) => String(e._id));
    if (eventIds.length === 0) return { jobIds: [], units: 0 };

    const wpStatus = (config.status as "publish" | "draft" | "pending" | undefined) ?? "draft";

    // Create an Export History record (Automated wp-rest, "processing") — the
    // worker marks it success/error with the uploaded count, matching the old
    // scheduler. scheduleId set => UI shows the "Automated" badge.
    const exportId = await ctx.db.insert("exports", {
      format: "wp-rest",
      createdAt: now,
      itemCount: eventIds.length,
      params: { filters: {}, wpSiteId: settingsId, status: wpStatus, scheduleId: schedule._id },
      status: "processing",
      scheduleId: schedule._id,
    });

    // Route through the worker (a real Node process) instead of a scheduled
    // node action — self-hosted Convex doesn't reliably run background "use node"
    // actions. The worker calls wordpressUpload:uploadEvents via direct HTTP.
    const jobId = await ctx.db.insert("jobs", {
      queue: "wordpress",
      name: "schedule:wordpress",
      status: "queued",
      payload: {
        settingsId,
        eventIds,
        status: wpStatus,
        scheduleId: schedule._id,
        exportId,
        updateIfExists: config.updateIfExists === true,
      },
      attempts: 0,
      maxAttempts: 2,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { jobIds: [jobId], units: eventIds.length };
  }

  return { jobIds: [], units: 0 };
}

// Dry-run the WordPress export selection for the CURRENT (possibly unsaved)
// form values, so the UI can show how many events would be pulled and from
// which sources before the user saves/runs. Mirrors the selection in
// enqueueScheduleJobs exactly (same date window + source + isEventPoster filter).
export const previewWordpressExport = query({
  args: {
    startDateOffset: v.optional(v.number()),
    endDateOffset: v.optional(v.number()),
    sourceIds: v.optional(v.array(v.string())),
    city: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  returns: v.object({
    count: v.number(),
    sources: v.array(v.object({ sourceId: v.string(), name: v.string(), count: v.number() })),
    sample: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        startDatetime: v.optional(v.number()),
        sourceName: v.string(),
      }),
    ),
    windowStart: v.optional(v.number()),
    windowEnd: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const config = normalizeScheduleConfig("wordpress_export", args);
    const { rows, allSources, startMs, endMs } = await selectWordpressEvents(ctx, config, now);
    const nameById = new Map(allSources.map(source => [String(source._id), source.name]));

    const bySource = new Map<string, number>();
    for (const e of rows) {
      const sid = String(e.sourceId);
      bySource.set(sid, (bySource.get(sid) ?? 0) + 1);
    }
    const sources = Array.from(bySource.entries())
      .map(([sourceId, count]) => ({ sourceId, name: nameById.get(sourceId) ?? "Unknown", count }))
      .sort((a, b) => b.count - a.count);

    const sample = rows
      .slice()
      .sort((a, b) => (a.startDatetime ?? 0) - (b.startDatetime ?? 0))
      .slice(0, 50)
      .map((e) => ({
        id: String(e._id),
        title: e.title ?? "(untitled)",
        startDatetime: e.startDatetime,
        sourceName: nameById.get(String(e.sourceId)) ?? "Unknown",
      }));

    return { count: rows.length, sources, sample, windowStart: startMs, windowEnd: endMs };
  },
});

export const trigger = mutation({
  args: { id: v.id("schedules") },
  returns: v.object({
    message: v.string(),
    scheduleId: v.id("schedules"),
    jobId: v.optional(v.id("jobs")),
    jobsEnqueued: v.number(),
  }),
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.id);
    if (!schedule) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Schedule not found" });
    }
    const { jobIds, units } = await enqueueScheduleJobs(ctx, schedule);
    await ctx.db.patch(schedule._id, { lastRunAt: Date.now() });
    const wp = schedule.scheduleType === "wordpress_export";
    return {
      message:
        units > 0
          ? wp
            ? `WordPress export started for ${units} event${units === 1 ? "" : "s"}`
            : `Schedule triggered (${units} job${units === 1 ? "" : "s"})`
          : wp
            ? "No matching events to export (check the date window / sources / WordPress settings)"
            : "No jobs enqueued (no matching target)",
      scheduleId: schedule._id,
      jobId: jobIds[0],
      jobsEnqueued: units,
    };
  },
});

// Each schedule gets its own transaction and read budget. In particular, two
// WordPress exports must not combine their event scans in the cron transaction:
// exceeding Convex's read limit would roll back every scrape queued that minute.
export const runScheduled = internalMutation({
  args: { scheduleId: v.id("schedules") },
  returns: v.object({ jobsEnqueued: v.number() }),
  handler: async (ctx, { scheduleId }) => {
    const schedule = await ctx.db.get(scheduleId);
    if (!schedule || !schedule.active) return { jobsEnqueued: 0 };
    const { units } = await enqueueScheduleJobs(ctx, schedule);
    return { jobsEnqueued: units };
  },
});

// Cron dispatcher — run every minute by convex/crons.ts. Only dispatch here;
// event selection and worker job creation happen in independent runScheduled
// mutations. Recording lastRunAt atomically with runAfter prevents duplicates.
// `jobs` counts scheduled callbacks, not the eventual worker jobs they create.
export const runDue = internalMutation({
  args: {},
  returns: v.object({ fired: v.number(), jobs: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const active = await ctx.db
      .query("schedules")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    let fired = 0;
    let jobs = 0;
    for (const schedule of active) {
      // Skip if already fired this minute.
      if (schedule.lastRunAt && Math.floor(schedule.lastRunAt / 60000) === currentMinute) continue;
      const tz = schedule.timezone || DEFAULT_TIMEZONE;
      let matches = false;
      try {
        matches = cronMatches(schedule.cron, now, tz);
      } catch (error) {
        console.warn("Invalid schedule cron/timezone", schedule._id, String(error));
        matches = false;
      }
      if (!matches) continue;

      await ctx.scheduler.runAfter(0, internal.schedules.runScheduled, {
        scheduleId: schedule._id,
      });
      await ctx.db.patch(schedule._id, { lastRunAt: now });
      fired++;
      jobs++;
    }
    return { fired, jobs };
  },
});

export const triggerAllActive = mutation({
  args: {},
  returns: v.object({
    message: v.string(),
    triggered: v.array(
      v.object({
        id: v.id("schedules"),
        type: scheduleType,
        status: v.string(),
        jobId: v.optional(v.id("jobs")),
        error: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const activeSchedules = await ctx.db
      .query("schedules")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    if (activeSchedules.length === 0) {
      return { message: "No active schedules found", triggered: [] };
    }

    const triggered: Array<{
      id: Id<"schedules">;
      type: Doc<"schedules">["scheduleType"];
      status: string;
      jobId?: Id<"jobs">;
      error?: string;
    }> = [];

    for (const schedule of activeSchedules) {
      try {
        const { jobIds, units } = await enqueueScheduleJobs(ctx, schedule);
        await ctx.db.patch(schedule._id, { lastRunAt: Date.now() });
        triggered.push({
          id: schedule._id,
          type: schedule.scheduleType,
          status: units > 0 ? "triggered" : "skipped",
          jobId: jobIds[0],
        });
      } catch (err) {
        triggered.push({
          id: schedule._id,
          type: schedule.scheduleType,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      message: `Triggered ${triggered.length} active schedules`,
      triggered,
    };
  },
});
