import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  occurrenceType as occurrenceTypeUnion,
  recurrenceType as recurrenceTypeUnion,
} from "./schema";

// Worker-facing Convex API. The external worker keeps Playwright + AI + Apify,
// but all Postgres reads/writes and Redis log/queue usage are replaced by calls
// into this module. Hashing / occurrence-type detection stay in the worker (pure
// Node functions); this module owns the index-based upsert + conflict logic.

function eventKey(sourceId: Id<"sources">, sourceEventId?: string | null) {
  return sourceEventId ? `${sourceId}:${sourceEventId}` : undefined;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const getSource = query({
  args: { sourceId: v.id("sources") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => ctx.db.get(args.sourceId),
});

export const getRunMetadata = query({
  args: { runId: v.id("runs") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return run?.metadata ?? {};
  },
});

// Minimal event fields needed by the matcher (mirrors the SELECT in the old
// match job). Narrows by source via index when sourceIds given, then filters
// the date window in JS.
export const eventsForMatching = query({
  args: {
    sourceIds: v.optional(v.array(v.id("sources"))),
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let rows: Doc<"eventsRaw">[] = [];
    if (args.sourceIds && args.sourceIds.length > 0) {
      for (const sourceId of args.sourceIds) {
        const part = await ctx.db
          .query("eventsRaw")
          .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
          .collect();
        rows.push(...part);
      }
    } else {
      rows = await ctx.db.query("eventsRaw").collect();
    }

    const filtered = rows.filter((e) => {
      if (args.startMs !== undefined && e.startDatetime < args.startMs) return false;
      if (args.endMs !== undefined && e.startDatetime > args.endMs) return false;
      return true;
    });
    filtered.sort((a, b) => a.startDatetime - b.startDatetime);

    // Shape matches the matcher's expected EventRaw subset.
    return filtered.map((e) => ({
      id: e._id,
      sourceId: e.sourceId,
      sourceEventId: e.sourceEventId,
      title: e.title,
      startDatetime: e.startDatetime,
      endDatetime: e.endDatetime,
      venueName: e.venueName,
      venueAddress: e.venueAddress,
      city: e.city,
      lat: e.lat,
      lon: e.lon,
      organizer: e.organizer,
      category: e.category,
    }));
  },
});

export const getInstagramConfig = query({
  args: {},
  returns: v.union(v.any(), v.null()),
  handler: async (ctx) => {
    const settings = await ctx.db.query("instagramSettings").first();
    if (!settings) return null;
    // Unmasked — the worker needs the real keys.
    return {
      apifyApiToken: settings.apifyApiToken ?? null,
      apifyActorId: settings.apifyActorId ?? null,
      geminiApiKey: settings.geminiApiKey ?? null,
      claudeApiKey: settings.claudeApiKey ?? null,
      aiProvider: settings.aiProvider ?? null,
      defaultScraperType: settings.defaultScraperType ?? "instagram-private-api",
      allowPerAccountOverride: settings.allowPerAccountOverride ?? true,
      autoClassifyWithAi: settings.autoClassifyWithAi ?? false,
      autoExtractNewPosts: settings.autoExtractNewPosts ?? false,
    };
  },
});

export const getInstagramAccount = query({
  args: { accountId: v.id("instagramAccounts") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => ctx.db.get(args.accountId),
});

export const getInstagramSession = query({
  args: { username: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    // Unmasked sessionData — the worker needs it to authenticate.
    return await ctx.db
      .query("instagramSessions")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
  },
});

export const getKnownInstagramPostIds = query({
  args: { accountId: v.id("instagramAccounts") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("eventsRaw")
      .withIndex("by_source")
      .collect();
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.instagramAccountId === args.accountId && r.instagramPostId) {
        ids.add(r.instagramPostId);
      }
    }
    return [...ids];
  },
});

// Resolve the single instagram source row's id (replaces the old fixed UUID).
export const getInstagramSourceId = query({
  args: {},
  returns: v.union(v.id("sources"), v.null()),
  handler: async (ctx) => {
    const src = await ctx.db
      .query("sources")
      .withIndex("by_source_type", (q) => q.eq("sourceType", "instagram"))
      .first();
    return src?._id ?? null;
  },
});

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export const markRunRunning = mutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError({ code: "NOT_FOUND", message: "Run not found" });
    await ctx.db.patch(args.runId, {
      status: "running",
      startedAt: run.startedAt ?? Date.now(),
    });
    return null;
  },
});

export const finishRun = mutation({
  args: {
    runId: v.id("runs"),
    status: v.union(
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
    ),
    eventsFound: v.optional(v.number()),
    pagesCrawled: v.optional(v.number()),
    errors: v.optional(v.any()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      finishedAt: Date.now(),
    };
    if (args.eventsFound !== undefined) patch.eventsFound = args.eventsFound;
    if (args.pagesCrawled !== undefined) patch.pagesCrawled = args.pagesCrawled;
    if (args.errors !== undefined) patch.errors = args.errors;
    if (args.metadata !== undefined) patch.metadata = args.metadata;
    await ctx.db.patch(args.runId, patch);
    return null;
  },
});

export const mergeRunMetadata = mutation({
  args: { runId: v.id("runs"), patch: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError({ code: "NOT_FOUND", message: "Run not found" });
    const current = (run.metadata && typeof run.metadata === "object" ? run.metadata : {}) as Record<
      string,
      unknown
    >;
    const merged: Record<string, unknown> = { ...current };
    for (const [k, val] of Object.entries(args.patch ?? {})) {
      if (val !== undefined) merged[k] = val;
    }
    await ctx.db.patch(args.runId, { metadata: merged });
    return merged;
  },
});

// ---------------------------------------------------------------------------
// Scrape persistence (replaces occurrence-db.ts saveEventWithOccurrences +
// saveToEventsRaw). Worker passes pre-computed hashes / occurrence rows.
// ---------------------------------------------------------------------------

const seriesInput = v.object({
  sourceEventId: v.optional(v.string()),
  title: v.string(),
  descriptionHtml: v.optional(v.string()),
  occurrenceType: occurrenceTypeUnion,
  recurrenceType: recurrenceTypeUnion,
  isAllDay: v.boolean(),
  isVirtual: v.boolean(),
  virtualUrl: v.optional(v.string()),
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
  raw: v.any(),
  contentHash: v.string(),
});

// occurrenceHash is computed server-side from the (now-known) seriesId so it
// matches the original seriesId-scoped dedup semantics. The worker can't supply
// it because the seriesId doesn't exist until the series is inserted here.
const occurrenceInput = v.object({
  sequence: v.number(),
  startDatetime: v.number(),
  endDatetime: v.optional(v.number()),
  startDatetimeUtc: v.number(),
  endDatetimeUtc: v.optional(v.number()),
  durationSeconds: v.optional(v.number()),
  timezone: v.string(),
  hasRecurrence: v.boolean(),
  raw: v.optional(v.any()),
});

const rawInput = v.object({
  sourceEventId: v.optional(v.string()),
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
  url: v.string(),
  imageUrl: v.optional(v.string()),
  scrapedAt: v.number(),
  raw: v.any(),
  contentHash: v.string(),
});

export const saveScrapedEvent = mutation({
  args: {
    sourceId: v.id("sources"),
    runId: v.id("runs"),
    series: seriesInput,
    occurrences: v.array(occurrenceInput),
    rawEvent: rawInput,
  },
  returns: v.object({
    action: v.union(v.literal("inserted"), v.literal("updated"), v.literal("unchanged")),
    seriesId: v.id("eventSeries"),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const { sourceId, runId, series, occurrences, rawEvent } = args;

    // --- Series upsert (by sourceEventKey) ---
    const seriesKey = eventKey(sourceId, series.sourceEventId);
    const seriesDoc = {
      sourceId,
      runId,
      sourceEventId: series.sourceEventId,
      sourceEventKey: seriesKey,
      title: series.title,
      descriptionHtml: series.descriptionHtml,
      occurrenceType: series.occurrenceType,
      eventStatus: "scheduled" as const,
      recurrenceType: series.recurrenceType,
      isAllDay: series.isAllDay,
      isVirtual: series.isVirtual,
      virtualUrl: series.virtualUrl,
      venueName: series.venueName,
      venueAddress: series.venueAddress,
      city: series.city,
      region: series.region,
      country: series.country,
      lat: series.lat,
      lon: series.lon,
      organizer: series.organizer,
      category: series.category,
      price: series.price,
      tags: series.tags,
      urlPrimary: series.urlPrimary,
      imageUrl: series.imageUrl,
      raw: series.raw ?? {},
      contentHash: series.contentHash,
    };

    let seriesId: Id<"eventSeries">;
    let action: "inserted" | "updated" | "unchanged" = "inserted";

    const existingSeries = seriesKey
      ? await ctx.db
          .query("eventSeries")
          .withIndex("by_source_event_key", (q) => q.eq("sourceEventKey", seriesKey))
          .first()
      : null;

    if (existingSeries) {
      seriesId = existingSeries._id;
      if (existingSeries.contentHash !== series.contentHash) {
        await ctx.db.patch(seriesId, {
          ...seriesDoc,
          lastUpdatedByRunId: runId,
          updatedAt: now,
        });
        action = "updated";
      } else {
        await ctx.db.patch(seriesId, { lastUpdatedByRunId: runId, updatedAt: now });
        action = "unchanged";
      }
    } else {
      seriesId = await ctx.db.insert("eventSeries", {
        ...seriesDoc,
        createdAt: now,
        updatedAt: now,
      });
      action = "inserted";
    }

    // --- Occurrences upsert (by occurrenceHash, seriesId-scoped) ---
    for (const occ of occurrences) {
      const occurrenceHash = `${seriesId}|${occ.startDatetime}|${occ.endDatetime ?? ""}`;
      const existing = await ctx.db
        .query("eventOccurrences")
        .withIndex("by_occurrence_hash", (q) => q.eq("occurrenceHash", occurrenceHash))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { lastSeenAt: now });
      } else {
        await ctx.db.insert("eventOccurrences", {
          seriesId,
          occurrenceHash,
          sequence: occ.sequence,
          startDatetime: occ.startDatetime,
          endDatetime: occ.endDatetime,
          startDatetimeUtc: occ.startDatetimeUtc,
          endDatetimeUtc: occ.endDatetimeUtc,
          durationSeconds: occ.durationSeconds,
          timezone: occ.timezone,
          hasRecurrence: occ.hasRecurrence,
          isProvisional: false,
          raw: occ.raw,
          scrapedAt: now,
          lastSeenAt: now,
        });
      }
    }

    // --- events_raw upsert (by sourceEventKey) ---
    const rawKey = eventKey(sourceId, rawEvent.sourceEventId);
    const rawDoc = {
      sourceId,
      runId,
      sourceEventId: rawEvent.sourceEventId,
      sourceEventKey: rawKey,
      title: rawEvent.title,
      descriptionHtml: rawEvent.descriptionHtml,
      startDatetime: rawEvent.startDatetime,
      endDatetime: rawEvent.endDatetime,
      timezone: rawEvent.timezone,
      venueName: rawEvent.venueName,
      venueAddress: rawEvent.venueAddress,
      city: rawEvent.city,
      region: rawEvent.region,
      country: rawEvent.country,
      lat: rawEvent.lat,
      lon: rawEvent.lon,
      organizer: rawEvent.organizer,
      category: rawEvent.category,
      price: rawEvent.price,
      tags: rawEvent.tags,
      url: rawEvent.url,
      imageUrl: rawEvent.imageUrl,
      raw: rawEvent.raw ?? {},
      contentHash: rawEvent.contentHash,
      seriesId,
    };

    const existingRaw = rawKey
      ? await ctx.db
          .query("eventsRaw")
          .withIndex("by_source_event_key", (q) => q.eq("sourceEventKey", rawKey))
          .first()
      : null;

    if (existingRaw) {
      if (existingRaw.contentHash !== rawEvent.contentHash) {
        await ctx.db.patch(existingRaw._id, {
          ...rawDoc,
          lastUpdatedByRunId: runId,
          lastSeenAt: now,
        });
      } else {
        await ctx.db.patch(existingRaw._id, { lastSeenAt: now });
      }
    } else {
      await ctx.db.insert("eventsRaw", {
        ...rawDoc,
        scrapedAt: rawEvent.scrapedAt,
        lastSeenAt: now,
      });
    }

    return { action, seriesId };
  },
});

// ---------------------------------------------------------------------------
// Matches (replaces the match job's DELETE open + INSERT loop)
// ---------------------------------------------------------------------------

export const replaceOpenMatches = mutation({
  args: {
    matches: v.array(
      v.object({
        rawIdA: v.id("eventsRaw"),
        rawIdB: v.id("eventsRaw"),
        score: v.number(),
        reason: v.any(),
      }),
    ),
  },
  returns: v.object({ cleared: v.number(), inserted: v.number() }),
  handler: async (ctx, args) => {
    const open = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    for (const m of open) await ctx.db.delete(m._id);

    let inserted = 0;
    const now = Date.now();
    const seen = new Set<string>();
    for (const m of args.matches) {
      // Emulate ON CONFLICT DO NOTHING on the unordered pair.
      const key = [String(m.rawIdA), String(m.rawIdB)].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      await ctx.db.insert("matches", {
        rawIdA: m.rawIdA,
        rawIdB: m.rawIdB,
        score: m.score,
        reason: m.reason,
        status: "open",
        createdAt: now,
        createdBy: "system",
      });
      inserted++;
    }
    return { cleared: open.length, inserted };
  },
});

// ---------------------------------------------------------------------------
// Instagram persistence
// ---------------------------------------------------------------------------

export const createInstagramRun = mutation({
  args: { parentRunId: v.optional(v.id("runs")), metadata: v.optional(v.any()) },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const src = await ctx.db
      .query("sources")
      .withIndex("by_source_type", (q) => q.eq("sourceType", "instagram"))
      .first();
    if (!src) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram source not found" });
    }
    const now = Date.now();
    return await ctx.db.insert("runs", {
      sourceId: src._id,
      parentRunId: args.parentRunId,
      status: "running",
      startedAt: now,
      pagesCrawled: 0,
      eventsFound: 0,
      metadata: args.metadata,
    });
  },
});

export const upsertInstagramPost = mutation({
  args: {
    runId: v.id("runs"),
    accountId: v.id("instagramAccounts"),
    postId: v.string(),
    title: v.string(),
    descriptionHtml: v.string(),
    startDatetime: v.number(),
    timezone: v.string(),
    url: v.string(),
    imageUrl: v.optional(v.string()),
    caption: v.optional(v.string()),
    localImagePath: v.optional(v.string()),
    localImageStorageId: v.optional(v.id("_storage")),
    localImageContentType: v.optional(v.string()),
    localImageSize: v.optional(v.number()),
    classificationConfidence: v.optional(v.number()),
    isEventPoster: v.optional(v.boolean()),
    raw: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const src = await ctx.db
      .query("sources")
      .withIndex("by_source_type", (q) => q.eq("sourceType", "instagram"))
      .first();
    if (!src) throw new ConvexError({ code: "NOT_FOUND", message: "Instagram source not found" });
    const now = Date.now();
    const sourceEventKey = `${src._id}:${args.postId}`;

    const existing = await ctx.db
      .query("eventsRaw")
      .withIndex("by_source_event_key", (q) => q.eq("sourceEventKey", sourceEventKey))
      .first();

    const base = {
      sourceId: src._id,
      runId: args.runId,
      sourceEventId: args.postId,
      sourceEventKey,
      title: args.title,
      descriptionHtml: args.descriptionHtml,
      startDatetime: args.startDatetime,
      timezone: args.timezone,
      url: args.url,
      imageUrl: args.imageUrl,
      raw: args.raw,
      contentHash: `instagram-post-${args.postId}`,
      instagramAccountId: args.accountId,
      instagramPostId: args.postId,
      instagramCaption: args.caption,
      localImagePath: args.localImagePath,
      localImageStorageId: args.localImageStorageId,
      localImageContentType: args.localImageContentType,
      localImageSize: args.localImageSize,
      classificationConfidence: args.classificationConfidence,
      isEventPoster: args.isEventPoster,
      lastUpdatedByRunId: args.runId,
    };

    if (existing) {
      // COALESCE semantics: keep existing image/path/classification when new is null.
      // Replace storage file if a new one was uploaded (delete the stale blob).
      if (args.localImageStorageId && existing.localImageStorageId &&
          args.localImageStorageId !== existing.localImageStorageId) {
        await ctx.storage.delete(existing.localImageStorageId).catch(() => undefined);
      }
      await ctx.db.patch(existing._id, {
        runId: args.runId,
        descriptionHtml: args.descriptionHtml,
        url: args.url,
        imageUrl: args.imageUrl ?? existing.imageUrl,
        instagramCaption: args.caption,
        localImagePath: args.localImagePath ?? existing.localImagePath,
        localImageStorageId: args.localImageStorageId ?? existing.localImageStorageId,
        localImageContentType: args.localImageContentType ?? existing.localImageContentType,
        localImageSize: args.localImageSize ?? existing.localImageSize,
        classificationConfidence:
          args.classificationConfidence ?? existing.classificationConfidence,
        isEventPoster: args.isEventPoster ?? existing.isEventPoster,
        raw: args.raw,
        lastUpdatedByRunId: args.runId,
        scrapedAt: now,
        lastSeenAt: now,
      });
    } else {
      await ctx.db.insert("eventsRaw", { ...base, scrapedAt: now, lastSeenAt: now });
    }
    return null;
  },
});

export const insertExtractedEvent = mutation({
  args: {
    runId: v.id("runs"),
    accountId: v.id("instagramAccounts"),
    postId: v.string(),
    eventIndex: v.number(),
    title: v.string(),
    descriptionHtml: v.string(),
    startDatetime: v.number(),
    endDatetime: v.optional(v.number()),
    timezone: v.string(),
    venueName: v.optional(v.string()),
    venueAddress: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    country: v.optional(v.string()),
    organizer: v.optional(v.string()),
    category: v.optional(v.string()),
    price: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.string(),
    imageUrl: v.optional(v.string()),
    caption: v.optional(v.string()),
    localImagePath: v.optional(v.string()),
    localImageStorageId: v.optional(v.id("_storage")),
    localImageContentType: v.optional(v.string()),
    localImageSize: v.optional(v.number()),
    classificationConfidence: v.optional(v.number()),
    isEventPoster: v.optional(v.boolean()),
    raw: v.any(),
  },
  returns: v.id("eventsRaw"),
  handler: async (ctx, args) => {
    const src = await ctx.db
      .query("sources")
      .withIndex("by_source_type", (q) => q.eq("sourceType", "instagram"))
      .first();
    if (!src) throw new ConvexError({ code: "NOT_FOUND", message: "Instagram source not found" });
    const now = Date.now();
    const sourceEventId = `${args.postId}-event-${args.eventIndex}`;
    // Extracted events were always inserted in the original (no conflict clause).
    return await ctx.db.insert("eventsRaw", {
      sourceId: src._id,
      runId: args.runId,
      sourceEventId,
      sourceEventKey: `${src._id}:${sourceEventId}`,
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
      organizer: args.organizer,
      category: args.category,
      price: args.price,
      tags: args.tags,
      url: args.url,
      imageUrl: args.imageUrl,
      raw: args.raw,
      contentHash: sourceEventId,
      instagramAccountId: args.accountId,
      instagramPostId: args.postId,
      instagramCaption: args.caption,
      localImagePath: args.localImagePath,
      localImageStorageId: args.localImageStorageId,
      localImageContentType: args.localImageContentType,
      localImageSize: args.localImageSize,
      classificationConfidence: args.classificationConfidence,
      isEventPoster: args.isEventPoster ?? true,
      scrapedAt: now,
      lastSeenAt: now,
    });
  },
});

export const touchInstagramAccount = mutation({
  args: { accountId: v.id("instagramAccounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { lastChecked: Date.now() });
    return null;
  },
});

export const refreshInstagramBatchRun = mutation({
  args: { parentRunId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const children = await ctx.db
      .query("runs")
      .withIndex("by_parent", (q) => q.eq("parentRunId", args.parentRunId))
      .collect();
    if (children.length === 0) return null;

    let total = 0,
      success = 0,
      failed = 0,
      pending = 0,
      eventsTotal = 0,
      pagesTotal = 0;
    for (const c of children) {
      total++;
      if (c.status === "success") success++;
      else if (c.status === "error" || c.status === "partial") failed++;
      else if (c.status === "queued" || c.status === "running") pending++;
      eventsTotal += c.eventsFound ?? 0;
      pagesTotal += c.pagesCrawled ?? 0;
    }

    const nextStatus = pending > 0 ? "running" : failed > 0 ? "partial" : "success";
    const parent = await ctx.db.get(args.parentRunId);
    const meta = (parent?.metadata && typeof parent.metadata === "object"
      ? parent.metadata
      : {}) as Record<string, unknown>;
    meta.batch = { total, success, failed, pending };

    await ctx.db.patch(args.parentRunId, {
      status: nextStatus,
      eventsFound: eventsTotal,
      pagesCrawled: pagesTotal,
      finishedAt: pending === 0 ? Date.now() : parent?.finishedAt,
      metadata: meta,
    });
    return null;
  },
});
