import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { scheduleType } from "./schema";

// Ports apps/api/src/routes/schedules.ts. The schedule rows are the source of
// truth; a Convex cron (task #4) reads them. create/update/delete simply persist
// the row — no BullMQ register/unregister. trigger / trigger-all-active enqueue
// jobs (see jobs.enqueue) instead of calling the BullMQ scheduler.

const DEFAULT_TIMEZONE = "America/Vancouver";

// Maps a scheduleType to the job queue used when triggering it.
function queueForScheduleType(
  type: Doc<"schedules">["scheduleType"],
): "scrape" | "instagramScrape" | "schedule" {
  switch (type) {
    case "scrape":
      return "scrape";
    case "instagram_scrape":
      return "instagramScrape";
    case "wordpress_export":
      return "schedule";
  }
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

// Enqueues a job for a single schedule. Mirrors jobs.enqueue shape.
async function enqueueScheduleTrigger(
  ctx: { db: any },
  schedule: Doc<"schedules">,
): Promise<Id<"jobs">> {
  const now = Date.now();
  const queue = queueForScheduleType(schedule.scheduleType);

  let runId: Id<"runs"> | undefined;
  // scrape / instagram_scrape execute against a source and produce a run row.
  // TODO(jobs.enqueue): the worker phase (task #5) defines the exact payload
  // contract per queue. We persist a run for source-bound scrape triggers so
  // progress can be tracked; wordpress_export has no source-bound run.
  if (schedule.scheduleType === "scrape" && schedule.sourceId) {
    runId = await ctx.db.insert("runs", {
      sourceId: schedule.sourceId,
      startedAt: now,
      status: "queued",
      pagesCrawled: 0,
      eventsFound: 0,
      metadata: { triggeredBy: "schedule", scheduleId: schedule._id },
    });
  }

  return await ctx.db.insert("jobs", {
    queue,
    name: `schedule:${schedule.scheduleType}`,
    status: "queued",
    payload: {
      scheduleId: schedule._id,
      scheduleType: schedule.scheduleType,
      sourceId: schedule.sourceId,
      wordpressSettingsId: schedule.wordpressSettingsId,
      config: schedule.config,
    },
    runId,
    attempts: 0,
    maxAttempts: 3,
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

export const trigger = mutation({
  args: { id: v.id("schedules") },
  returns: v.object({
    message: v.string(),
    scheduleId: v.id("schedules"),
    jobId: v.id("jobs"),
  }),
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.id);
    if (!schedule) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Schedule not found" });
    }
    const jobId = await enqueueScheduleTrigger(ctx, schedule);
    return {
      message: "Schedule triggered successfully",
      scheduleId: schedule._id,
      jobId,
    };
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
        const jobId = await enqueueScheduleTrigger(ctx, schedule);
        triggered.push({
          id: schedule._id,
          type: schedule.scheduleType,
          status: "triggered",
          jobId,
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
