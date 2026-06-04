import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { canonicalStatus, sourceType } from "./schema";

// Mirrors apps/api/src/routes/events.ts query contract so the admin UI keeps the
// same filter / sort / pagination semantics after the cutover to Convex.

const sortBy = v.union(
  v.literal("title"),
  v.literal("startDatetime"),
  v.literal("city"),
  v.literal("source"),
  v.literal("scrapedAt"),
);
const sortOrder = v.union(v.literal("asc"), v.literal("desc"));

const listArgs = {
  page: v.optional(v.number()),
  limit: v.optional(v.number()),
  sourceId: v.optional(v.id("sources")),
  sourceType: v.optional(sourceType),
  city: v.optional(v.string()),
  category: v.optional(v.string()),
  status: v.optional(canonicalStatus),
  startDate: v.optional(v.number()),
  endDate: v.optional(v.number()),
  search: v.optional(v.string()),
  hasSeries: v.optional(v.boolean()),
  sortBy: v.optional(sortBy),
  sortOrder: v.optional(sortOrder),
};

type ListArgs = {
  page?: number;
  limit?: number;
  sourceId?: Id<"sources">;
  sourceType?: "website" | "instagram";
  city?: string;
  category?: string;
  status?: "new" | "ready" | "exported" | "ignored";
  startDate?: number;
  endDate?: number;
  search?: string;
  hasSeries?: boolean;
  sortBy?: "title" | "startDatetime" | "city" | "source" | "scrapedAt";
  sortOrder?: "asc" | "desc";
};

function clampPage(page?: number) {
  return page && page > 0 ? Math.floor(page) : 1;
}
function clampLimit(limit?: number) {
  const l = limit && limit > 0 ? Math.floor(limit) : 20;
  return Math.min(l, 100);
}
function includes(haystack: string | undefined | null, needle: string) {
  return (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
}
function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  return {
    slice: items.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

// hasSeries: original checked the raw JSON text for a seriesDates array with
// more than one entry. Reproduce against the structured raw object.
function hasMultiSeries(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const seriesDates = (raw as Record<string, unknown>).seriesDates;
  return Array.isArray(seriesDates) && seriesDates.length > 1;
}

export const listRaw = query({
  args: listArgs,
  returns: v.object({ events: v.array(v.any()), pagination: v.any() }),
  handler: async (ctx, args: ListArgs) => {
    const page = clampPage(args.page);
    const limit = clampLimit(args.limit);

    // Narrow by source via index when possible; otherwise scan the table.
    let rows: Doc<"eventsRaw">[];
    if (args.sourceId) {
      const sourceId = args.sourceId;
      rows = await ctx.db
        .query("eventsRaw")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .collect();
    } else {
      rows = await ctx.db.query("eventsRaw").collect();
    }

    // Lookup tables for source / instagram account decoration (small tables).
    const sources = await ctx.db.query("sources").collect();
    const sourceById = new Map(sources.map((s) => [s._id, s]));
    const igAccounts = await ctx.db.query("instagramAccounts").collect();
    const igById = new Map(igAccounts.map((a) => [a._id, a]));

    let filtered = rows.filter((e) => {
      // Keep non-instagram (isEventPoster null/undefined) or confirmed posters.
      if (e.isEventPoster === false) return false;

      if (args.sourceType) {
        const src = sourceById.get(e.sourceId);
        if (!src || src.sourceType !== args.sourceType) return false;
      }
      if (args.city && !includes(e.city, args.city)) return false;
      if (args.startDate !== undefined && e.startDatetime < args.startDate) return false;
      if (args.endDate !== undefined && e.startDatetime > args.endDate) return false;
      if (args.search) {
        const matches =
          includes(e.title, args.search) || includes(e.descriptionHtml, args.search);
        if (!matches) return false;
      }
      if (args.hasSeries && !hasMultiSeries(e.raw)) return false;
      return true;
    });

    const dir = args.sortOrder === "asc" ? 1 : -1;
    const nameOf = (e: Doc<"eventsRaw">) =>
      (e.instagramAccountId ? igById.get(e.instagramAccountId)?.name : undefined) ??
      sourceById.get(e.sourceId)?.name ??
      "";
    filtered = filtered.sort((a, b) => {
      switch (args.sortBy) {
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "city":
          return dir * (a.city ?? "").localeCompare(b.city ?? "");
        case "source":
          return dir * nameOf(a).localeCompare(nameOf(b));
        case "scrapedAt":
          return dir * (a.scrapedAt - b.scrapedAt);
        case "startDatetime":
        default:
          return dir * (a.startDatetime - b.startDatetime);
      }
    });

    const { slice, pagination } = paginate(filtered, page, limit);
    const events = slice.map((event) => {
      const src = sourceById.get(event.sourceId);
      const ig = event.instagramAccountId ? igById.get(event.instagramAccountId) : undefined;
      return {
        event,
        source: {
          id: src?._id,
          name: ig?.name ?? src?.name ?? "Unknown",
          moduleKey: src?.moduleKey,
          baseUrl: src?.baseUrl,
          sourceType: src?.sourceType,
        },
      };
    });

    return { events, pagination };
  },
});

export const getRaw = query({
  args: { id: v.id("eventsRaw") },
  returns: v.union(v.object({ event: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id);
    if (!event) return null;
    const src = await ctx.db.get(event.sourceId);
    const ig = event.instagramAccountId ? await ctx.db.get(event.instagramAccountId) : null;
    return {
      event: {
        event,
        source: {
          id: src?._id,
          name: ig?.name ?? src?.name ?? "Unknown",
          moduleKey: src?.moduleKey,
          baseUrl: src?.baseUrl,
          sourceType: src?.sourceType,
        },
      },
    };
  },
});

export const listCanonical = query({
  args: listArgs,
  returns: v.object({ events: v.array(v.any()), pagination: v.any() }),
  handler: async (ctx, args: ListArgs) => {
    const page = clampPage(args.page);
    const limit = clampLimit(args.limit);

    let rows = await ctx.db.query("eventsCanonical").collect();
    rows = rows.filter((e) => {
      if (args.city && !includes(e.city, args.city)) return false;
      if (args.category && !includes(e.category, args.category)) return false;
      if (args.status && e.status !== args.status) return false;
      if (args.startDate !== undefined && e.startDatetime < args.startDate) return false;
      if (args.endDate !== undefined && e.startDatetime > args.endDate) return false;
      if (args.search) {
        const matches =
          includes(e.title, args.search) || includes(e.descriptionHtml, args.search);
        if (!matches) return false;
      }
      return true;
    });
    // Original always orders canonical by startDatetime desc.
    rows.sort((a, b) => b.startDatetime - a.startDatetime);

    const { slice, pagination } = paginate(rows, page, limit);
    return { events: slice, pagination };
  },
});

export const getCanonical = query({
  args: { id: v.id("eventsCanonical") },
  returns: v.union(v.object({ event: v.any(), rawEvents: v.array(v.any()) }), v.null()),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.id);
    if (!event) return null;
    const rawEvents = await Promise.all(
      (event.mergedFromRawIds ?? []).map(async (rawId) => {
        const raw = await ctx.db.get(rawId);
        if (!raw) return null;
        const src = await ctx.db.get(raw.sourceId);
        return { event: raw, source: { name: src?.name, baseUrl: src?.baseUrl } };
      }),
    );
    return { event, rawEvents: rawEvents.filter(Boolean) };
  },
});

export const deleteRaw = mutation({
  args: { ids: v.array(v.id("eventsRaw")) },
  returns: v.object({ deletedIds: v.array(v.id("eventsRaw")) }),
  handler: async (ctx, args) => {
    if (args.ids.length === 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Event IDs are required" });
    }
    const idSet = new Set(args.ids.map(String));
    for (const id of args.ids) {
      const event = await ctx.db.get(id);
      if (!event) continue;
      // Remove referencing matches (either side).
      const a = await ctx.db
        .query("matches")
        .withIndex("by_raw_a", (q) => q.eq("rawIdA", id))
        .collect();
      const b = await ctx.db
        .query("matches")
        .withIndex("by_raw_b", (q) => q.eq("rawIdB", id))
        .collect();
      for (const m of [...a, ...b]) await ctx.db.delete(m._id);
      // Delete uploaded image from storage if present.
      if (event.localImageStorageId) {
        await ctx.storage.delete(event.localImageStorageId).catch(() => undefined);
      }
      await ctx.db.delete(id);
    }
    return { deletedIds: args.ids.filter((id) => idSet.has(String(id))) };
  },
});

export const deleteCanonical = mutation({
  args: { ids: v.array(v.id("eventsCanonical")) },
  returns: v.object({ deletedIds: v.array(v.id("eventsCanonical")) }),
  handler: async (ctx, args) => {
    if (args.ids.length === 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Event IDs are required" });
    }
    for (const id of args.ids) await ctx.db.delete(id);
    return { deletedIds: args.ids };
  },
});
