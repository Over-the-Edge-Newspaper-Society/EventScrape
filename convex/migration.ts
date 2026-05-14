import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

const tableName = v.union(
  v.literal("auditLogs"),
  v.literal("eventOccurrences"),
  v.literal("eventSeries"),
  v.literal("eventsCanonical"),
  v.literal("eventsRaw"),
  v.literal("exports"),
  v.literal("instagramAccounts"),
  v.literal("instagramSessions"),
  v.literal("instagramSettings"),
  v.literal("jobs"),
  v.literal("matches"),
  v.literal("runLogs"),
  v.literal("runs"),
  v.literal("schedules"),
  v.literal("sources"),
  v.literal("systemSettings"),
  v.literal("users"),
  v.literal("wordpressSettings"),
);

const tables = [
  "auditLogs",
  "matches",
  "eventsCanonical",
  "eventsRaw",
  "eventOccurrences",
  "eventSeries",
  "exports",
  "schedules",
  "jobs",
  "runLogs",
  "runs",
  "instagramSessions",
  "instagramSettings",
  "instagramAccounts",
  "wordpressSettings",
  "systemSettings",
  "users",
  "sources",
] as const;

export const clearTable = mutation({
  args: {
    table: tableName,
    limit: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const docs = await ctx.db.query(args.table).take(args.limit ?? 200);
    await Promise.all(docs.map((doc) => ctx.db.delete(doc._id)));
    return docs.length;
  },
});

export const clearStorage = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const files = await ctx.db.system.query("_storage").take(args.limit ?? 50);
    await Promise.all(files.map((file) => ctx.storage.delete(file._id)));
    return files.length;
  },
});

export const insertBatch = mutation({
  args: {
    table: tableName,
    docs: v.array(v.any()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const ids: string[] = [];

    for (const doc of args.docs) {
      const id = await ctx.db.insert(args.table, doc);
      ids.push(id);
    }

    return ids;
  },
});

export const patchBatch = mutation({
  args: {
    table: tableName,
    patches: v.array(
      v.object({
        id: v.string(),
        patch: v.any(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    for (const item of args.patches) {
      await ctx.db.patch(item.id as any, item.patch);
    }

    return args.patches.length;
  },
});

export const countPage = query({
  args: {
    table: tableName,
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.query(args.table).paginate(args.paginationOpts);
  },
});
