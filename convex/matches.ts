import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { matchStatus } from "./schema";

// Mirrors apps/api/src/routes/matches.ts query contract so the admin UI keeps the
// same filter / sort / limit semantics after the cutover to Convex.

const DEFAULT_MIN_SCORE = 0.6;

function clampMinScore(minScore?: number) {
  if (minScore === undefined) return DEFAULT_MIN_SCORE;
  return Math.min(1, Math.max(0, minScore));
}
function clampLimit(limit?: number) {
  const l = limit && limit > 0 ? Math.floor(limit) : 20;
  return Math.min(l, 100);
}

// GET / — potential matches/duplicates with related raw events + source info.
export const list = query({
  args: {
    status: v.optional(matchStatus),
    minScore: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({ matches: v.array(v.any()) }),
  handler: async (ctx, args) => {
    const minScore = clampMinScore(args.minScore);
    const limit = clampLimit(args.limit);

    // Narrow by status via index when provided; otherwise scan the table.
    let rows: Doc<"matches">[];
    if (args.status) {
      const status = args.status;
      rows = await ctx.db
        .query("matches")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
    } else {
      rows = await ctx.db.query("matches").collect();
    }

    rows = rows.filter((m) => m.score >= minScore);

    // orderBy(desc(score), desc(createdAt))
    rows.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
    rows = rows.slice(0, limit);

    // Decorate with both raw events + their source names (small lookup tables).
    const sources = await ctx.db.query("sources").collect();
    const sourceById = new Map(sources.map((s) => [s._id, s]));

    const matchesWithEvents = await Promise.all(
      rows.map(async (match) => {
        const eventA = await ctx.db.get(match.rawIdA);
        const eventB = await ctx.db.get(match.rawIdB);
        const sourceA = eventA ? sourceById.get(eventA.sourceId) : undefined;
        const sourceB = eventB ? sourceById.get(eventB.sourceId) : undefined;
        return {
          match,
          eventA: eventA
            ? {
                id: eventA._id,
                title: eventA.title,
                startDatetime: eventA.startDatetime,
                city: eventA.city,
                venueName: eventA.venueName,
                url: eventA.url,
              }
            : null,
          eventB: eventB
            ? {
                id: eventB._id,
                title: eventB.title,
                startDatetime: eventB.startDatetime,
                city: eventB.city,
                venueName: eventB.venueName,
                url: eventB.url,
              }
            : null,
          sourceA: { name: sourceA?.name ?? null },
          sourceB: { name: sourceB?.name ?? null },
        };
      }),
    );

    return { matches: matchesWithEvents };
  },
});

// GET /:id — detailed match info: both events with source information.
export const get = query({
  args: { id: v.id("matches") },
  returns: v.union(
    v.object({ match: v.any(), eventA: v.any(), eventB: v.any() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.id);
    if (!match) return null;

    const decorate = async (rawId: typeof match.rawIdA) => {
      const event = await ctx.db.get(rawId);
      if (!event) return null;
      const src = await ctx.db.get(event.sourceId);
      return {
        event,
        source: { id: src?._id, name: src?.name, baseUrl: src?.baseUrl },
      };
    };

    const [eventA, eventB] = await Promise.all([
      decorate(match.rawIdA),
      decorate(match.rawIdB),
    ]);

    return { match, eventA, eventB };
  },
});

// PUT /:id/status — confirm/reject duplicate.
export const updateStatus = mutation({
  args: {
    id: v.id("matches"),
    status: v.union(v.literal("confirmed"), v.literal("rejected")),
  },
  returns: v.object({ match: v.any() }),
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.id);
    if (!match) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Match not found" });
    }
    await ctx.db.patch(args.id, { status: args.status });
    const updated = await ctx.db.get(args.id);
    return { match: updated };
  },
});

// POST /merge — create a canonical event from multiple raw events and confirm
// any open matches referencing them. Single Convex mutation == the original
// db.transaction() at matches.ts ~190.
export const merge = mutation({
  args: {
    rawIds: v.array(v.id("eventsRaw")),
    decisions: v.optional(v.any()),
    title: v.string(),
    descriptionHtml: v.optional(v.string()),
    startDatetime: v.number(),
    endDatetime: v.optional(v.number()),
    timezone: v.optional(v.string()),
    venueName: v.optional(v.string()),
    venueAddress: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    country: v.optional(v.string()),
    lat: v.optional(v.number()),
    lon: v.optional(v.number()),
    organizer: v.optional(v.string()),
    category: v.optional(v.string()),
    price: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    urlPrimary: v.string(),
    imageUrl: v.optional(v.string()),
  },
  returns: v.object({ message: v.string(), canonicalId: v.id("eventsCanonical") }),
  handler: async (ctx, args) => {
    if (args.rawIds.length < 2) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "At least two raw event IDs are required",
      });
    }

    const now = Date.now();

    // Create canonical event.
    const canonicalId = await ctx.db.insert("eventsCanonical", {
      title: args.title,
      descriptionHtml: args.descriptionHtml,
      startDatetime: args.startDatetime,
      endDatetime: args.endDatetime,
      timezone: args.timezone,
      venueName: args.venueName,
      venueAddress: args.venueAddress,
      city: args.city,
      region: args.region,
      country: args.country,
      lat: args.lat,
      lon: args.lon,
      organizer: args.organizer,
      category: args.category,
      price: args.price,
      tags: args.tags ?? [],
      urlPrimary: args.urlPrimary,
      imageUrl: args.imageUrl,
      mergedFromRawIds: args.rawIds,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });

    // Update any open matches involving these raw events to confirmed.
    const rawIdSet = new Set(args.rawIds.map(String));
    const touched = new Map<string, Doc<"matches">>();
    for (const rawId of args.rawIds) {
      const a = await ctx.db
        .query("matches")
        .withIndex("by_raw_a", (q) => q.eq("rawIdA", rawId))
        .collect();
      const b = await ctx.db
        .query("matches")
        .withIndex("by_raw_b", (q) => q.eq("rawIdB", rawId))
        .collect();
      for (const m of [...a, ...b]) touched.set(String(m._id), m);
    }

    for (const m of touched.values()) {
      const involves = rawIdSet.has(String(m.rawIdA)) || rawIdSet.has(String(m.rawIdB));
      if (involves && m.status === "open") {
        await ctx.db.patch(m._id, { status: "confirmed" });
      }
    }

    return { message: "Events merged successfully", canonicalId };
  },
});

// POST /recompute — enqueue a match job to recompute matches across all events.
// Mirrors enqueueMatchJob() via convex/jobs.ts `enqueue` shape (queue: "match").
export const recompute = mutation({
  args: {},
  returns: v.object({ message: v.string(), jobId: v.id("jobs") }),
  handler: async (ctx) => {
    const now = Date.now();
    // No filters in payload == process all events (matches original behaviour).
    const jobId = await ctx.db.insert("jobs", {
      queue: "match",
      name: "match",
      status: "queued",
      payload: {},
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { message: "Match recomputation queued", jobId };
  },
});
