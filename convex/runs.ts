import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { runStatus } from "./schema";

function clampPage(page?: number) {
  return page && page > 0 ? Math.floor(page) : 1;
}
function clampLimit(limit?: number) {
  const l = limit && limit > 0 ? Math.floor(limit) : 20;
  return Math.min(l, 100);
}

export const createForSource = mutation({
  args: {
    sourceId: v.id("sources"),
    parentRunId: v.optional(v.id("runs")),
    metadata: v.optional(v.any()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || !source.active) {
      throw new ConvexError({
        code: "SOURCE_UNAVAILABLE",
        message: "Source not found or inactive",
      });
    }

    const now = Date.now();
    return await ctx.db.insert("runs", {
      sourceId: args.sourceId,
      parentRunId: args.parentRunId,
      metadata: args.metadata,
      status: "queued",
      startedAt: now,
      pagesCrawled: 0,
      eventsFound: 0,
    });
  },
});

export const patchStatus = mutation({
  args: {
    runId: v.id("runs"),
    status: runStatus,
    pagesCrawled: v.optional(v.number()),
    eventsFound: v.optional(v.number()),
    errors: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: {
      status: typeof args.status;
      pagesCrawled?: number;
      eventsFound?: number;
      errors?: unknown;
      finishedAt?: number;
    } = {
      status: args.status,
    };

    if (args.pagesCrawled !== undefined) patch.pagesCrawled = args.pagesCrawled;
    if (args.eventsFound !== undefined) patch.eventsFound = args.eventsFound;
    if (args.errors !== undefined) patch.errors = args.errors;
    if (
      args.status === "success" ||
      args.status === "partial" ||
      args.status === "error" ||
      args.status === "cancelled"
    ) {
      patch.finishedAt = now;
    }

    await ctx.db.patch(args.runId, patch);
    return null;
  },
});

export const list = query({
  args: {
    sourceId: v.optional(v.id("sources")),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    if (args.sourceId) {
      const sourceId = args.sourceId;
      return await ctx.db
        .query("runs")
        .withIndex("by_source_and_started_at", (q) => q.eq("sourceId", sourceId))
        .order("desc")
        .take(limit);
    }

    return await ctx.db.query("runs").withIndex("by_started_at").order("desc").take(limit);
  },
});

// GET / — parent runs only, joined to source, with child runs grouped per parent
// and a status-summary reduction. Offset pagination (page/limit) like events.ts.
export const listWithChildren = query({
  args: {
    sourceId: v.optional(v.id("sources")),
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
  },
  returns: v.object({ runs: v.array(v.any()), pagination: v.any() }),
  handler: async (ctx, args) => {
    const page = clampPage(args.page);
    const limit = clampLimit(args.limit);

    // Parent runs only (parentRunId undefined). Narrow by source via index.
    let parents: Doc<"runs">[];
    if (args.sourceId) {
      const sourceId = args.sourceId;
      parents = await ctx.db
        .query("runs")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .collect();
    } else {
      parents = await ctx.db.query("runs").collect();
    }
    parents = parents.filter((r) => r.parentRunId === undefined);

    // orderBy(desc(startedAt))
    parents.sort((a, b) => b.startedAt - a.startedAt);

    const total = parents.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const pageItems = parents.slice(offset, offset + limit);

    // Source lookup table (small).
    const sources = await ctx.db.query("sources").collect();
    const sourceById = new Map(sources.map((s) => [s._id, s]));
    const sourceInfo = (run: Doc<"runs">) => {
      const src = sourceById.get(run.sourceId);
      return src
        ? { id: src._id, name: src.name, moduleKey: src.moduleKey }
        : null;
    };

    // Fetch children for the runs on this page only.
    const childrenByParent = new Map<
      string,
      { run: Doc<"runs">; source: ReturnType<typeof sourceInfo> }[]
    >();
    for (const parent of pageItems) {
      const children = await ctx.db
        .query("runs")
        .withIndex("by_parent", (q) => q.eq("parentRunId", parent._id))
        .collect();
      children.sort((a, b) => a.startedAt - b.startedAt);
      childrenByParent.set(
        String(parent._id),
        children.map((child) => ({ run: child, source: sourceInfo(child) })),
      );
    }

    const runs = pageItems.map((run) => {
      const children = childrenByParent.get(String(run._id)) ?? [];
      const summary = children.reduce(
        (acc, child) => {
          acc.total += 1;
          switch (child.run.status) {
            case "success":
              acc.success += 1;
              break;
            case "error":
            case "partial":
              acc.failed += 1;
              break;
            case "running":
              acc.running += 1;
              acc.pending += 1;
              break;
            case "queued":
              acc.queued += 1;
              acc.pending += 1;
              break;
            default:
              break;
          }
          return acc;
        },
        { total: 0, success: 0, failed: 0, pending: 0, running: 0, queued: 0 },
      );

      return { run, source: sourceInfo(run), children, summary };
    });

    return {
      runs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },
});

// GET /:id — run + source + its raw events + child runs.
export const getDetail = query({
  args: { id: v.id("runs") },
  returns: v.union(v.object({ run: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.id);
    if (!run) return null;

    const src = await ctx.db.get(run.sourceId);
    const source = src
      ? {
          id: src._id,
          name: src.name,
          moduleKey: src.moduleKey,
          baseUrl: src.baseUrl,
        }
      : null;

    const rawEvents = await ctx.db
      .query("eventsRaw")
      .withIndex("by_run", (q) => q.eq("runId", args.id))
      .collect();
    rawEvents.sort((a, b) => a.startDatetime - b.startDatetime);
    const events = rawEvents.map((e) => ({
      id: e._id,
      title: e.title,
      startDatetime: e.startDatetime,
      endDatetime: e.endDatetime,
      venueName: e.venueName,
      venueAddress: e.venueAddress,
      city: e.city,
      region: e.region,
      country: e.country,
      url: e.url,
      category: e.category,
      organizer: e.organizer,
      sourceEventId: e.sourceEventId,
    }));

    const sources = await ctx.db.query("sources").collect();
    const sourceById = new Map(sources.map((s) => [s._id, s]));
    const childRunsRaw = await ctx.db
      .query("runs")
      .withIndex("by_parent", (q) => q.eq("parentRunId", args.id))
      .collect();
    childRunsRaw.sort((a, b) => a.startedAt - b.startedAt);
    const children = childRunsRaw.map((child) => {
      const csrc = sourceById.get(child.sourceId);
      return {
        run: child,
        source: csrc
          ? { id: csrc._id, name: csrc.name, moduleKey: csrc.moduleKey }
          : null,
      };
    });

    return { run: { run, source, events, children } };
  },
});

// POST /scrape/:sourceKey and /test/:sourceKey — look up source by moduleKey,
// validate active, create a run, and enqueue a scrape job (queue: "scrape").
export const triggerScrape = mutation({
  args: {
    sourceKey: v.string(),
    testMode: v.optional(v.boolean()),
    scrapeMode: v.optional(v.any()),
    paginationOptions: v.optional(v.any()),
  },
  returns: v.object({
    message: v.string(),
    run: v.any(),
    source: v.object({
      id: v.id("sources"),
      name: v.string(),
      moduleKey: v.string(),
    }),
    jobId: v.id("jobs"),
  }),
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", args.sourceKey))
      .first();

    if (!source) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Source not found" });
    }
    if (!source.active) {
      throw new ConvexError({
        code: "SOURCE_UNAVAILABLE",
        message: "Source is not active",
      });
    }

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      sourceId: source._id,
      status: "queued",
      startedAt: now,
      pagesCrawled: 0,
      eventsFound: 0,
    });

    const payload: {
      sourceId: typeof source._id;
      runId: typeof runId;
      moduleKey: string;
      sourceName: string;
      testMode?: boolean;
      scrapeMode?: unknown;
      paginationOptions?: unknown;
    } = {
      sourceId: source._id,
      runId,
      moduleKey: source.moduleKey,
      sourceName: source.name,
    };
    if (args.testMode) payload.testMode = true;
    if (args.scrapeMode !== undefined) payload.scrapeMode = args.scrapeMode;
    if (args.paginationOptions !== undefined) {
      payload.paginationOptions = args.paginationOptions;
    }

    const jobId = await ctx.db.insert("jobs", {
      queue: "scrape",
      name: "scrape",
      status: "queued",
      payload,
      runId,
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const run = await ctx.db.get(runId);
    return {
      message: args.testMode ? "Test scrape job queued" : "Scrape job queued",
      run,
      source: {
        id: source._id,
        name: source.name,
        moduleKey: source.moduleKey,
      },
      jobId,
    };
  },
});

// POST /:runId/cancel — only running/queued can cancel; set status and request
// job cancellation (mirrors convex/jobs.ts requestCancelForRun semantics).
export const cancel = mutation({
  args: { runId: v.id("runs") },
  returns: v.object({ message: v.string() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Run not found" });
    }

    if (run.status !== "running" && run.status !== "queued") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Cannot cancel run with status '${run.status}'. Only running or queued runs can be cancelled.`,
      });
    }

    const now = Date.now();
    const reason = "Cancelled by user";

    // Request cancellation of any in-flight jobs for this run.
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
            lastError: reason,
            finishedAt: job.status === "queued" ? now : job.finishedAt,
            updatedAt: now,
          }),
        ),
    );

    await ctx.db.patch(args.runId, {
      status: "cancelled",
      finishedAt: now,
      errors: { error: reason },
    });

    return { message: "Run cancelled successfully" };
  },
});
