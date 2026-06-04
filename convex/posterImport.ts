import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Ports apps/api/src/routes/poster-import.ts to the full-Convex architecture.
//
// The original Fastify routes (POST /poster-import for CSV/JSON content, POST
// /poster-import/image-ai for an uploaded image) created a run + enqueued a
// scrape job whose worker module (ai_poster_import) parsed the payload into
// events_raw rows. In the Convex model:
//   - `enqueue` resolves/creates the ai_poster_import source, creates a run
//     (status "queued"), and inserts a job into the dedicated "posterImport"
//     queue. For image jobs the admin uploads the poster to Convex storage
//     first and passes the storageId (the worker downloads + AI-extracts it).
//   - `getPosterJob` gives the worker the source/run context plus the AI keys
//     and provider it needs (the worker runs Gemini/Claude/OpenRouter itself).
//   - `insertEvent` writes a single extracted event into events_raw for the
//     poster source (the worker maps poster JSON -> normalized event fields).

const POSTER_MODULE_KEY = "ai_poster_import";

// Resolve the ai_poster_import source, creating/reactivating it if needed.
// Mirrors ensureAiPosterImportSource() from the original route.
async function ensurePosterSource(ctx: {
  db: any;
}): Promise<Id<"sources">> {
  const now = Date.now();
  const existing = await ctx.db
    .query("sources")
    .withIndex("by_module_key", (q: any) => q.eq("moduleKey", POSTER_MODULE_KEY))
    .first();

  if (existing) {
    if (!existing.active) {
      await ctx.db.patch(existing._id, {
        active: true,
        updatedAt: now,
        notes: (existing.notes || "") + " (Reactivated for Poster Import)",
      });
    }
    return existing._id;
  }

  return await ctx.db.insert("sources", {
    name: "AI Poster Import",
    baseUrl: "https://ai-import.local/",
    moduleKey: POSTER_MODULE_KEY,
    active: true,
    defaultTimezone: "America/Vancouver",
    notes: "Auto-created for Poster Import uploads",
    rateLimitPerMin: 30,
    sourceType: "website",
    createdAt: now,
    updatedAt: now,
  });
}

// POST /poster-import (+ /image-ai). Creates a run and queues a posterImport job.
// Provide `content` for a CSV/JSON paste, or `imageStorageId` for an uploaded
// poster image (the admin must upload it to Convex storage first). `testMode`
// is carried through to the worker.
export const enqueue = mutation({
  args: {
    content: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    testMode: v.optional(v.boolean()),
    pictureDateIso: v.optional(v.string()),
  },
  returns: v.object({ runId: v.id("runs"), jobId: v.id("jobs") }),
  handler: async (ctx, args) => {
    // Respect the posterImportEnabled system setting (original returned 403).
    const settings = await ctx.db.query("systemSettings").first();
    if (settings && settings.posterImportEnabled === false) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Poster import is disabled in system settings",
      });
    }
    if (!args.content && !args.imageStorageId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Either content or imageStorageId is required",
      });
    }

    const sourceId = await ensurePosterSource(ctx);
    const now = Date.now();

    const runId = await ctx.db.insert("runs", {
      sourceId,
      status: "queued",
      startedAt: now,
      pagesCrawled: 0,
      eventsFound: 0,
    });

    const jobId = await ctx.db.insert("jobs", {
      queue: "posterImport",
      name: "posterImport",
      status: "queued",
      payload: {
        runId,
        sourceId,
        content: args.content,
        imageStorageId: args.imageStorageId,
        testMode: !!args.testMode,
        pictureDateIso: args.pictureDateIso,
      },
      runId,
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { runId, jobId };
  },
});

// Worker context for a poster-import run: the source/run rows plus the AI
// settings (provider + unmasked keys) needed for image extraction. Keys fall
// back from systemSettings to instagramSettings, matching the original
// getAISettings() resolution order.
export const getPosterJob = query({
  args: { runId: v.id("runs") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const source = await ctx.db.get(run.sourceId);

    const sys = await ctx.db.query("systemSettings").first();
    const ig = await ctx.db.query("instagramSettings").first();

    const aiProvider = sys?.aiProvider ?? ig?.aiProvider ?? "gemini";

    return {
      run: {
        id: run._id,
        status: run.status,
        sourceId: run.sourceId,
      },
      source: source
        ? {
            id: source._id,
            name: source.name,
            moduleKey: source.moduleKey,
            defaultTimezone: source.defaultTimezone,
          }
        : null,
      settings: {
        aiProvider,
        geminiApiKey: sys?.geminiApiKey ?? ig?.geminiApiKey ?? null,
        claudeApiKey: sys?.claudeApiKey ?? ig?.claudeApiKey ?? null,
        openrouterApiKey: sys?.openrouterApiKey ?? null,
        openrouterModel: sys?.openrouterModel ?? null,
        posterImportEnabled: sys?.posterImportEnabled ?? true,
      },
    };
  },
});

// Insert one extracted poster event into events_raw for the poster source.
// The worker passes already-normalized fields (epoch-ms datetimes, mapped via
// the ai_poster_import core). Keeps an explicit focused mutation rather than
// reusing saveScrapedEvent so the poster flow doesn't have to fabricate the
// series/occurrence inputs that mutation requires.
export const insertEvent = mutation({
  args: {
    runId: v.id("runs"),
    sourceId: v.id("sources"),
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
    organizer: v.optional(v.string()),
    category: v.optional(v.string()),
    price: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.string(),
    imageUrl: v.optional(v.string()),
    localImageStorageId: v.optional(v.id("_storage")),
    raw: v.any(),
    contentHash: v.string(),
  },
  returns: v.id("eventsRaw"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const sourceEventKey = args.sourceEventId
      ? `${args.sourceId}:${args.sourceEventId}`
      : undefined;

    // Upsert by sourceEventKey (matches saveScrapedEvent semantics) so re-runs
    // of the same poster don't create duplicate rows.
    const existing = sourceEventKey
      ? await ctx.db
          .query("eventsRaw")
          .withIndex("by_source_event_key", (q: any) =>
            q.eq("sourceEventKey", sourceEventKey),
          )
          .first()
      : null;

    const doc = {
      sourceId: args.sourceId,
      runId: args.runId,
      sourceEventId: args.sourceEventId,
      sourceEventKey,
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
      localImageStorageId: args.localImageStorageId,
      raw: args.raw ?? {},
      contentHash: args.contentHash,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...doc,
        lastUpdatedByRunId: args.runId,
        lastSeenAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("eventsRaw", {
      ...doc,
      scrapedAt: now,
      lastSeenAt: now,
    });
  },
});
