import { ConvexError, v } from "convex/values";
import { mutation, query, action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";

// Ports apps/api/src/routes/wordpress.ts. DB-backed endpoints are queries/
// mutations; connection test + categories are Convex actions (short external
// HTTP). Bulk event upload remains a worker job (heavy/long) — see Task #11.

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

// Internal: returns a settings row WITH the application password (for actions).
export const getSettingWithSecret = internalQuery({
  args: { id: v.id("wordpressSettings") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => ctx.db.get(args.id),
});

// Internal: load the events that wordpressUpload:uploadEvents needs to publish.
// Accepts a mix of eventsRaw / eventsCanonical ids (the admin selects canonical
// events; the original Fastify route loaded eventsRaw). For each id we try
// eventsRaw first, then eventsCanonical. Canonical rows have no sourceId/raw of
// their own, so we resolve those from the first merged raw event (used for
// source-category mapping + club-organization matching).
export const getEventsForUpload = internalQuery({
  args: { ids: v.array(v.string()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const out: any[] = [];

    for (const idStr of args.ids) {
      // Try eventsRaw.
      const rawId = ctx.db.normalizeId("eventsRaw", idStr);
      if (rawId) {
        const e = await ctx.db.get(rawId);
        if (e) {
          out.push({
            id: e._id,
            rawEventId: e._id,
            title: e.title,
            descriptionHtml: e.descriptionHtml ?? undefined,
            startDatetime: e.startDatetime, // epoch ms
            endDatetime: e.endDatetime ?? undefined,
            timezone: e.timezone ?? undefined,
            venueName: e.venueName ?? undefined,
            venueAddress: e.venueAddress ?? undefined,
            city: e.city ?? undefined,
            region: e.region ?? undefined,
            country: e.country ?? undefined,
            organizer: e.organizer ?? undefined,
            category: e.category ?? undefined,
            price: e.price ?? undefined,
            url: e.url,
            imageUrl: e.imageUrl ?? undefined,
            localImageStorageId: e.localImageStorageId ?? undefined,
            tags: e.tags ?? undefined,
            raw: e.raw,
            sourceId: e.sourceId,
          });
          continue;
        }
      }

      // Try eventsCanonical.
      const canonId = ctx.db.normalizeId("eventsCanonical", idStr);
      if (canonId) {
        const c = await ctx.db.get(canonId);
        if (c) {
          // Resolve raw/sourceId/storage from the first merged raw event.
          let raw: any = undefined;
          let sourceId: any = undefined;
          let localImageStorageId: any = undefined;
          const firstRawId = c.mergedFromRawIds?.[0];
          if (firstRawId) {
            const r = await ctx.db.get(firstRawId);
            if (r) {
              raw = r.raw;
              sourceId = r.sourceId;
              localImageStorageId = r.localImageStorageId ?? undefined;
            }
          }
          out.push({
            id: c._id,
            title: c.title,
            descriptionHtml: c.descriptionHtml ?? undefined,
            startDatetime: c.startDatetime, // epoch ms
            endDatetime: c.endDatetime ?? undefined,
            timezone: c.timezone ?? undefined,
            venueName: c.venueName ?? undefined,
            venueAddress: c.venueAddress ?? undefined,
            city: c.city ?? undefined,
            region: c.region ?? undefined,
            country: c.country ?? undefined,
            organizer: c.organizer ?? undefined,
            category: c.category ?? undefined,
            price: c.price ?? undefined,
            url: c.urlPrimary,
            imageUrl: c.imageUrl ?? undefined,
            localImageStorageId,
            tags: c.tags ?? undefined,
            raw,
            sourceId,
          });
          continue;
        }
      }
    }

    return out;
  },
});

function basicAuth(username: string, appPassword: string) {
  // btoa is available in the Convex runtime.
  return "Basic " + btoa(`${username}:${appPassword}`);
}

// POST /settings/:id/test — verify credentials against wp-json users/me.
export const testConnection = action({
  args: { id: v.id("wordpressSettings") },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const s: any = await ctx.runQuery(internal.wordpress.getSettingWithSecret, { id: args.id });
    if (!s) return { success: false, error: "WordPress setting not found" };
    try {
      const res = await fetch(`${s.siteUrl}/wp-json/wp/v2/users/me`, {
        method: "GET",
        headers: { Authorization: basicAuth(s.username, s.applicationPassword) },
      });
      if (!res.ok) {
        return { success: false, error: `Connection failed: ${res.status} - ${await res.text()}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: `Connection error: ${(err as Error).message}` };
    }
  },
});

// GET /settings/:id/categories — fetch the WP event_category taxonomy.
export const getCategories = action({
  args: { id: v.id("wordpressSettings") },
  returns: v.object({ categories: v.array(v.any()) }),
  handler: async (ctx, args): Promise<{ categories: any[] }> => {
    const s: any = await ctx.runQuery(internal.wordpress.getSettingWithSecret, { id: args.id });
    if (!s) return { categories: [] };
    try {
      const res = await fetch(
        `${s.siteUrl}/wp-json/wp/v2/event_category?per_page=100&_fields=id,name,slug`,
        { method: "GET", headers: { Authorization: basicAuth(s.username, s.applicationPassword) } },
      );
      if (!res.ok) return { categories: [] };
      return { categories: (await res.json()) as any[] };
    } catch {
      return { categories: [] };
    }
  },
});

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
