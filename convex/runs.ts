import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { runStatus } from "./schema";

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
