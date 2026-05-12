import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const append = mutation({
  args: {
    runId: v.id("runs"),
    level: v.number(),
    message: v.string(),
    source: v.optional(v.string()),
    raw: v.optional(v.any()),
  },
  returns: v.id("runLogs"),
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("runLogs")
      .withIndex("by_run_sequence", (q) => q.eq("runId", args.runId))
      .order("desc")
      .first();

    const now = Date.now();
    return await ctx.db.insert("runLogs", {
      runId: args.runId,
      sequence: (previous?.sequence ?? 0) + 1,
      timestamp: now,
      level: args.level,
      message: args.message,
      source: args.source ?? "worker",
      raw: args.raw,
    });
  },
});

export const history = query({
  args: {
    runId: v.id("runs"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("runLogs"),
      _creationTime: v.number(),
      runId: v.id("runs"),
      sequence: v.number(),
      timestamp: v.number(),
      level: v.number(),
      message: v.string(),
      source: v.string(),
      raw: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 1000, 2000);
    return await ctx.db
      .query("runLogs")
      .withIndex("by_run_sequence", (q) => q.eq("runId", args.runId))
      .order("desc")
      .take(limit);
  },
});

export const clear = mutation({
  args: { runId: v.id("runs") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("runLogs")
      .withIndex("by_run_sequence", (q) => q.eq("runId", args.runId))
      .collect();

    await Promise.all(logs.map((log) => ctx.db.delete(log._id)));
    return logs.length;
  },
});
