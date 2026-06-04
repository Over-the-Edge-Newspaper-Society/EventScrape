import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { jobStatus, queueName } from "./schema";

const DEFAULT_MAX_ATTEMPTS = 3;

const enqueueArgs = {
  queue: queueName,
  name: v.string(),
  payload: v.any(),
  runId: v.optional(v.id("runs")),
  maxAttempts: v.optional(v.number()),
  delayMs: v.optional(v.number()),
};

export const enqueue = mutation({
  args: enqueueArgs,
  returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("jobs", {
      queue: args.queue,
      name: args.name,
      status: "queued",
      payload: args.payload,
      runId: args.runId,
      attempts: 0,
      maxAttempts: args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      availableAt: now + (args.delayMs ?? 0),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const claimNext = mutation({
  args: {
    queue: queueName,
    workerId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("jobs"),
      _creationTime: v.number(),
      queue: queueName,
      name: v.string(),
      status: jobStatus,
      payload: v.any(),
      runId: v.optional(v.id("runs")),
      attempts: v.number(),
      maxAttempts: v.number(),
      availableAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      result: v.optional(v.any()),
      claimedBy: v.optional(v.string()),
      cancelRequested: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_queue_status_available", (q) =>
        q.eq("queue", args.queue).eq("status", "queued").lte("availableAt", now),
      )
      .order("asc")
      .first();

    if (!job) {
      return null;
    }

    await ctx.db.patch("jobs", job._id, {
      status: "running",
      attempts: job.attempts + 1,
      startedAt: now,
      claimedBy: args.workerId,
      updatedAt: now,
    });

    if (job.runId) {
      await ctx.db.patch("runs", job.runId, {
        status: "running",
      });
    }

    return {
      ...job,
      status: "running" as const,
      attempts: job.attempts + 1,
      startedAt: now,
      claimedBy: args.workerId,
      updatedAt: now,
    };
  },
});

// Reclaim jobs left "running" by a worker that crashed/was killed before
// completing. Without this they'd be stuck forever (claimNext only takes
// "queued" jobs). Requeues if retries remain, else marks error.
export const reclaimStalled = mutation({
  args: { stalledMs: v.optional(v.number()) },
  returns: v.object({ requeued: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const threshold = now - (args.stalledMs ?? 5 * 60 * 1000);
    const running = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();

    let requeued = 0;
    let failed = 0;
    for (const job of running) {
      if ((job.startedAt ?? job.updatedAt) > threshold) continue;
      if (job.cancelRequested) {
        await ctx.db.patch(job._id, { status: "cancelled", finishedAt: now, updatedAt: now });
        continue;
      }
      if (job.attempts < job.maxAttempts) {
        await ctx.db.patch(job._id, {
          status: "queued",
          availableAt: now,
          lastError: "Reclaimed after worker stall",
          updatedAt: now,
        });
        requeued++;
      } else {
        await ctx.db.patch(job._id, {
          status: "error",
          finishedAt: now,
          lastError: "Stalled and out of retries",
          updatedAt: now,
        });
        if (job.runId) {
          await ctx.db.patch(job.runId, {
            status: "error",
            finishedAt: now,
            errors: { error: "Worker stalled" },
          });
        }
        failed++;
      }
    }
    return { requeued, failed };
  },
});

export const complete = mutation({
  args: {
    jobId: v.id("jobs"),
    result: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Job not found" });
    }

    await ctx.db.patch(args.jobId, {
      status: "success",
      result: args.result,
      finishedAt: now,
      updatedAt: now,
    });

    return null;
  },
});

export const fail = mutation({
  args: {
    jobId: v.id("jobs"),
    error: v.string(),
    retryDelayMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Job not found" });
    }

    const shouldRetry = job.attempts < job.maxAttempts && !job.cancelRequested;
    const patch: {
      status: "queued" | "error";
      lastError: string;
      updatedAt: number;
      availableAt?: number;
      finishedAt?: number;
    } = {
      status: shouldRetry ? "queued" : "error",
      lastError: args.error,
      updatedAt: now,
    };

    if (shouldRetry) {
      patch.availableAt = now + (args.retryDelayMs ?? 5000);
    } else {
      patch.finishedAt = now;
    }

    await ctx.db.patch(args.jobId, patch);

    if (!shouldRetry && job.runId) {
      await ctx.db.patch("runs", job.runId, {
        status: "error",
        finishedAt: now,
        errors: { error: args.error },
      });
    }

    return null;
  },
});

export const requestCancelForRun = mutation({
  args: {
    runId: v.id("runs"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Run not found" });
    }

    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();

    await Promise.all(
      jobs
        .filter((job) => job.status === "queued" || job.status === "running")
        .map((job) =>
          ctx.db.patch(job._id, {
            cancelRequested: true,
            status: job.status === "queued" ? "cancelled" : job.status,
            lastError: args.reason ?? "Cancelled by user",
            finishedAt: job.status === "queued" ? now : job.finishedAt,
            updatedAt: now,
          }),
        ),
    );

    await ctx.db.patch(args.runId, {
      status: "cancelled",
      finishedAt: now,
      errors: { error: args.reason ?? "Cancelled by user" },
    });

    return null;
  },
});

export const status = query({
  args: {},
  returns: v.object({
    scrape: v.object({ waiting: v.number(), active: v.number(), completed: v.number(), failed: v.number() }),
    match: v.object({ waiting: v.number(), active: v.number(), completed: v.number(), failed: v.number() }),
    instagram: v.object({ waiting: v.number(), active: v.number(), completed: v.number(), failed: v.number() }),
    schedule: v.object({ waiting: v.number(), active: v.number(), completed: v.number(), failed: v.number() }),
  }),
  handler: async (ctx) => {
    const jobs = await ctx.db.query("jobs").collect();
    const empty = () => ({ waiting: 0, active: 0, completed: 0, failed: 0 });
    const result = {
      scrape: empty(),
      match: empty(),
      instagram: empty(),
      schedule: empty(),
    };

    for (const job of jobs) {
      const bucket =
        job.queue === "instagramScrape"
          ? result.instagram
          : (result as Record<string, { waiting: number; active: number; completed: number; failed: number }>)[job.queue];
      if (!bucket) continue; // new queues (wordpress/review/posterImport/apifyImport) not surfaced here
      if (job.status === "queued") bucket.waiting += 1;
      if (job.status === "running") bucket.active += 1;
      if (job.status === "success") bucket.completed += 1;
      if (job.status === "error" || job.status === "cancelled") bucket.failed += 1;
    }

    return result;
  },
});

export const listByRun = query({
  args: { runId: v.id("runs") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export type ClaimedJob = {
  _id: Id<"jobs">;
  queue: "scrape" | "match" | "instagramScrape" | "schedule";
  name: string;
  payload: unknown;
  runId?: Id<"runs">;
};
