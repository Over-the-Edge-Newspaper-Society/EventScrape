import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { scheduleType } from "./schema";
import { cronMatches } from "./cronMatch";

// Ports apps/api/src/routes/schedules.ts. The schedule rows are the source of
// truth; a Convex cron (task #4) reads them. create/update/delete simply persist
// the row — no BullMQ register/unregister. trigger / trigger-all-active enqueue
// jobs (see jobs.enqueue) instead of calling the BullMQ scheduler.

const DEFAULT_TIMEZONE = "America/Vancouver";

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
      doc = { ...base, sourceId: args.sourceId };
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
        config: args.config,
      };
    } else {
      // instagram_scrape
      const config = { ...(args.config ?? {}) };
      const scope = config.scope ?? "all_active";
      if (scope === "custom" && (!config.accountIds || config.accountIds.length === 0)) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Custom Instagram schedules require at least one account",
        });
      }
      doc = { ...base, config: { ...config, scope } };
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
      config: args.config ?? existing.config,
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
//  - wordpress_export: gated — the WordPress export runs in the worker/actions
//    phase, not yet wired, so it is skipped with no job.
async function enqueueScheduleJobs(
  ctx: any,
  schedule: Doc<"schedules">,
): Promise<{ jobIds: Id<"jobs">[]; units: number }> {
  const now = Date.now();
  const config = (schedule.config ?? {}) as Record<string, any>;

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
    let parentRunId: Id<"runs"> | undefined;
    if (igSource) {
      parentRunId = await ctx.db.insert("runs", {
        sourceId: igSource._id,
        startedAt: now,
        status: "queued",
        pagesCrawled: 0,
        eventsFound: 0,
        metadata: { triggeredBy: "schedule", scheduleId: schedule._id, batch: { total: accounts.length } },
      });
    }

    const jobIds: Id<"jobs">[] = [];
    for (const acc of accounts) {
      const jobId = await ctx.db.insert("jobs", {
        queue: "instagramScrape",
        name: `schedule:instagram`,
        status: "queued",
        payload: {
          accountId: acc._id,
          postLimit: config.postLimit ?? 10,
          batchSize: config.batchSize,
          parentRunId,
        },
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

    // Date window from day offsets relative to now (mirrors the original).
    const DAY = 24 * 60 * 60 * 1000;
    const startMs =
      typeof config.startDateOffset === "number" ? now + config.startDateOffset * DAY : undefined;
    const endMs =
      typeof config.endDateOffset === "number" ? now + config.endDateOffset * DAY : undefined;

    // Resolve configured sourceIds — they may be old Postgres UUIDs (stored in
    // the schedule config pre-migration), so match by Convex _id OR legacyId.
    const targetSources = new Set<string>();
    if (Array.isArray(config.sourceIds) && config.sourceIds.length > 0) {
      const allSources = await ctx.db.query("sources").collect();
      const byId = new Map<string, string>(
        allSources.map((s: Doc<"sources">) => [String(s._id), String(s._id)] as [string, string]),
      );
      const byLegacy = new Map<string, string>(
        allSources
          .filter((s: Doc<"sources">) => s.legacyId)
          .map((s: Doc<"sources">) => [s.legacyId as string, String(s._id)] as [string, string]),
      );
      for (const sid of config.sourceIds) {
        const resolved = byId.get(String(sid)) || byLegacy.get(String(sid));
        if (resolved) targetSources.add(resolved);
      }
    }

    // Select events in the window via the start_datetime index.
    let rows = await ctx.db
      .query("eventsRaw")
      .withIndex("by_start_datetime", (q: any) => {
        let r = q;
        if (startMs !== undefined) r = r.gte("startDatetime", startMs);
        if (endMs !== undefined) r = r.lte("startDatetime", endMs);
        return r;
      })
      .collect();
    rows = rows.filter((e: Doc<"eventsRaw">) => {
      if (e.isEventPoster === false) return false;
      if (targetSources.size > 0 && !targetSources.has(String(e.sourceId))) return false;
      if (config.city && !(e.city ?? "").toLowerCase().includes(String(config.city).toLowerCase())) return false;
      if (config.category && !(e.category ?? "").toLowerCase().includes(String(config.category).toLowerCase())) return false;
      return true;
    });

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
      payload: { settingsId, eventIds, status: wpStatus, scheduleId: schedule._id, exportId },
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

// Cron dispatcher — run every minute by convex/crons.ts. Fires each active
// schedule whose cron expression matches the current minute in its timezone.
// Deduplicated via lastRunAt so a schedule fires at most once per minute.
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
      } catch {
        matches = false;
      }
      if (!matches) continue;

      const { units } = await enqueueScheduleJobs(ctx, schedule);
      await ctx.db.patch(schedule._id, { lastRunAt: now });
      if (units > 0) {
        fired++;
        jobs += units;
      }
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
