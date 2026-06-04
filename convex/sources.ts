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

// -- CRUD ported from apps/api/src/routes/sources.ts ----------------------------

// GET / — list website sources only (Instagram lives in instagramAccounts).
export const listWebsite = query({
  args: {},
  returns: v.object({ sources: v.array(v.any()) }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("sources")
      .withIndex("by_source_type", (q) => q.eq("sourceType", "website"))
      .collect();
    return { sources: rows };
  },
});

// GET /:id
export const get = query({
  args: { id: v.id("sources") },
  returns: v.union(v.object({ source: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.id);
    if (!source) return null;
    return { source };
  },
});

// POST / — create a new source. Mirrors createSourceSchema defaults.
export const create = mutation({
  args: {
    name: v.string(),
    baseUrl: v.string(),
    moduleKey: v.string(),
    active: v.optional(v.boolean()),
    defaultTimezone: v.optional(v.string()),
    notes: v.optional(v.string()),
    rateLimitPerMin: v.optional(v.number()),
  },
  returns: v.object({ source: v.any() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("sources", {
      name: args.name,
      baseUrl: args.baseUrl,
      moduleKey: args.moduleKey,
      active: args.active ?? true,
      defaultTimezone: args.defaultTimezone ?? "UTC",
      notes: args.notes,
      rateLimitPerMin: args.rateLimitPerMin ?? 60,
      sourceType: "website",
      createdAt: now,
      updatedAt: now,
    });
    const source = await ctx.db.get(id);
    return { source };
  },
});

// PUT /:id — partial update (updateSourceSchema is createSourceSchema.partial()).
export const update = mutation({
  args: {
    id: v.id("sources"),
    name: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    moduleKey: v.optional(v.string()),
    active: v.optional(v.boolean()),
    defaultTimezone: v.optional(v.string()),
    notes: v.optional(v.string()),
    rateLimitPerMin: v.optional(v.number()),
  },
  returns: v.union(v.object({ source: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const existing = await ctx.db.get(id);
    if (!existing) return null;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    await ctx.db.patch(id, patch);
    const source = await ctx.db.get(id);
    return { source };
  },
});

// DELETE /:id
export const remove = mutation({
  args: { id: v.id("sources") },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Source not found" });
    }
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

// POST /sync — module discovery (reading the worker modules dir) is external I/O
// and is done by the caller. This mutation takes the discovered module list and
// performs only the DB create / reactivate / deactivate logic, exactly mirroring
// the original loop.
export const syncFromModules = mutation({
  args: {
    modules: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        baseUrl: v.string(),
      }),
    ),
  },
  returns: v.object({
    message: v.string(),
    stats: v.object({
      availableModules: v.number(),
      created: v.number(),
      updated: v.number(),
      deactivated: v.number(),
    }),
    availableModules: v.array(
      v.object({ key: v.string(), label: v.string(), baseUrl: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    const availableModules = args.modules;
    const existingSources = await ctx.db.query("sources").collect();
    const now = Date.now();

    let created = 0;
    let updated = 0;

    const cleanNotes = (notes: string | undefined) =>
      (notes || "")
        .replace(/\s*\(Deactivated - module not found\)\s*/g, "")
        .replace(/\s*\(Reactivated from available module\)\s*/g, "")
        .trim();

    for (const module of availableModules) {
      const existingSource = existingSources.find(
        (s) => s.moduleKey === module.key,
      );

      if (!existingSource) {
        await ctx.db.insert("sources", {
          name: module.label,
          baseUrl: module.baseUrl,
          moduleKey: module.key,
          active: true,
          defaultTimezone: "America/Vancouver",
          notes: "Auto-created from available module",
          rateLimitPerMin: 30,
          sourceType: "website",
          createdAt: now,
          updatedAt: now,
        });
        created++;
      } else if (!existingSource.active) {
        const cleanedNotes = cleanNotes(existingSource.notes);
        const newNotes = cleanedNotes
          ? `${cleanedNotes} (Reactivated from available module)`
          : "Reactivated from available module";
        await ctx.db.patch(existingSource._id, {
          active: true,
          updatedAt: now,
          notes: newNotes,
        });
        updated++;
      }
    }

    // Deactivate active sources that no longer have a corresponding module.
    const moduleKeys = availableModules.map((m) => m.key);
    const orphanedSources = existingSources.filter(
      (s) => s.active && !moduleKeys.includes(s.moduleKey),
    );

    let deactivated = 0;
    for (const orphan of orphanedSources) {
      const cleanedNotes = cleanNotes(orphan.notes);
      const newNotes = cleanedNotes
        ? `${cleanedNotes} (Deactivated - module not found)`
        : "Deactivated - module not found";
      await ctx.db.patch(orphan._id, {
        active: false,
        updatedAt: now,
        notes: newNotes,
      });
      deactivated++;
    }

    return {
      message: "Sources synced successfully",
      stats: {
        availableModules: availableModules.length,
        created,
        updated,
        deactivated,
      },
      availableModules,
    };
  },
});
