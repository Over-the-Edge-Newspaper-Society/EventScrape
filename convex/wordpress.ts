import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

// Ports apps/api/src/routes/wordpress.ts DB-backed endpoints. The connection
// test (POST /settings/:id/test), categories (GET /settings/:id/categories) and
// upload (POST /upload) endpoints do external HTTP and are NOT implemented here.
// TODO(actions phase): port test / categories / upload as Convex actions using
// WordPressClient.

// Strips the application password from a settings row before returning it.
function publicSettings(s: Doc<"wordpressSettings">) {
  return {
    id: s._id,
    name: s.name,
    siteUrl: s.siteUrl,
    username: s.username,
    active: s.active,
    sourceCategoryMappings: s.sourceCategoryMappings,
    includeMedia: s.includeMedia,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// GET /wordpress/sources — website sources for source-category mapping.
export const listSources = query({
  args: {},
  returns: v.object({ sources: v.array(v.any()) }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("sources")
      .withIndex("by_source_type", (q) => q.eq("sourceType", "website"))
      .collect();
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return {
      sources: rows.map((s) => ({
        id: s._id,
        name: s.name,
        moduleKey: s.moduleKey,
        active: s.active,
      })),
    };
  },
});

// GET /wordpress/settings — list (password omitted), newest first.
export const listSettings = query({
  args: {},
  returns: v.object({ settings: v.array(v.any()) }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("wordpressSettings").collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return { settings: rows.map(publicSettings) };
  },
});

// GET /wordpress/settings/:id
export const getSettings = query({
  args: { id: v.id("wordpressSettings") },
  returns: v.union(v.object({ setting: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const setting = await ctx.db.get(args.id);
    if (!setting) return null;
    return { setting: publicSettings(setting) };
  },
});

// POST /wordpress/settings — create.
// NOTE: original tested the WP connection before saving; that external call must
// happen in the actions phase. TODO(actions phase): run testConnection before
// persisting (or call this mutation from an action after a successful test).
export const createSettings = mutation({
  args: {
    name: v.string(),
    siteUrl: v.string(),
    username: v.string(),
    applicationPassword: v.string(),
    active: v.optional(v.boolean()),
    sourceCategoryMappings: v.optional(v.any()),
    includeMedia: v.optional(v.boolean()),
  },
  returns: v.object({ message: v.string(), setting: v.any() }),
  handler: async (ctx, args) => {
    if (!args.name || !args.siteUrl || !args.username || !args.applicationPassword) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Validation error" });
    }
    const now = Date.now();
    const id = await ctx.db.insert("wordpressSettings", {
      name: args.name,
      siteUrl: args.siteUrl,
      username: args.username,
      applicationPassword: args.applicationPassword,
      active: args.active ?? true,
      sourceCategoryMappings: args.sourceCategoryMappings ?? {},
      includeMedia: args.includeMedia ?? true,
      createdAt: now,
      updatedAt: now,
    });
    const setting = await ctx.db.get(id);
    return {
      message: "WordPress setting created successfully",
      setting: setting ? publicSettings(setting) : null,
    };
  },
});

// PUT /wordpress/settings/:id — partial update.
// TODO(actions phase): when siteUrl/username/applicationPassword change, the
// original re-tested the connection before saving.
export const updateSettings = mutation({
  args: {
    id: v.id("wordpressSettings"),
    name: v.optional(v.string()),
    siteUrl: v.optional(v.string()),
    username: v.optional(v.string()),
    applicationPassword: v.optional(v.string()),
    active: v.optional(v.boolean()),
    sourceCategoryMappings: v.optional(v.any()),
    includeMedia: v.optional(v.boolean()),
  },
  returns: v.object({ message: v.string(), setting: v.any() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "WordPress setting not found" });
    }

    const patch: Partial<Doc<"wordpressSettings">> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.siteUrl !== undefined) patch.siteUrl = args.siteUrl;
    if (args.username !== undefined) patch.username = args.username;
    if (args.applicationPassword !== undefined)
      patch.applicationPassword = args.applicationPassword;
    if (args.active !== undefined) patch.active = args.active;
    if (args.sourceCategoryMappings !== undefined)
      patch.sourceCategoryMappings = args.sourceCategoryMappings;
    if (args.includeMedia !== undefined) patch.includeMedia = args.includeMedia;

    await ctx.db.patch(args.id, patch);
    const setting = await ctx.db.get(args.id);
    return {
      message: "WordPress setting updated successfully",
      setting: setting ? publicSettings(setting) : null,
    };
  },
});

// DELETE /wordpress/settings/:id
export const deleteSettings = mutation({
  args: { id: v.id("wordpressSettings") },
  returns: v.object({ message: v.string() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "WordPress setting not found" });
    }
    await ctx.db.delete(args.id);
    return { message: "WordPress setting deleted successfully" };
  },
});
