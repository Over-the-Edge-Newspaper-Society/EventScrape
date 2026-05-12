import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { classificationMode, instagramScraperType, sourceType } from "./schema";

const sourceInput = {
  name: v.string(),
  baseUrl: v.string(),
  moduleKey: v.string(),
  active: v.optional(v.boolean()),
  defaultTimezone: v.optional(v.string()),
  notes: v.optional(v.string()),
  rateLimitPerMin: v.optional(v.number()),
  sourceType: v.optional(sourceType),
  instagramUsername: v.optional(v.string()),
  classificationMode: v.optional(classificationMode),
  instagramScraperType: v.optional(instagramScraperType),
};

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return await ctx.db.query("sources").withIndex("by_module_key").collect();
  },
});

export const getByModuleKey = query({
  args: { moduleKey: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sources")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", args.moduleKey))
      .first();
  },
});

export const upsert = mutation({
  args: sourceInput,
  returns: v.id("sources"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", args.moduleKey))
      .first();

    const doc = {
      name: args.name,
      baseUrl: args.baseUrl,
      moduleKey: args.moduleKey,
      active: args.active ?? true,
      defaultTimezone: args.defaultTimezone ?? "UTC",
      notes: args.notes,
      rateLimitPerMin: args.rateLimitPerMin ?? 60,
      sourceType: args.sourceType ?? "website",
      instagramUsername: args.instagramUsername,
      classificationMode: args.classificationMode,
      instagramScraperType: args.instagramScraperType,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert("sources", {
      ...doc,
      createdAt: now,
    });
  },
});

export const setActive = mutation({
  args: {
    sourceId: v.id("sources"),
    active: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Source not found" });
    }

    await ctx.db.patch(args.sourceId, {
      active: args.active,
      updatedAt: Date.now(),
    });
    return null;
  },
});
