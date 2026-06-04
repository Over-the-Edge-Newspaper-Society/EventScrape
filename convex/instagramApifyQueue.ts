import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";

// Default-runtime companion to convex/instagramApify.ts (which is "use node").
// Mutations + queries cannot live in a "use node" module, so the enqueue
// mutation, the account-resolution query the worker import handler needs, and
// the internal config read used by the snapshot action live here.

// Enqueue an Apify-run import as a worker job. `runId` is the APIFY run id
// string (NOT a Convex runs id). The worker's apifyImport handler reads
// { apifyRunId, limit } from the payload. Returns { jobId } so the admin can
// surface the queued job id.
export const enqueueImport = mutation({
  args: {
    runId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.object({ jobId: v.id("jobs") }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      queue: "apifyImport",
      name: `apify-import-${args.runId}`,
      status: "queued",
      payload: { apifyRunId: args.runId, limit: args.limit },
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId };
  },
});

// Resolve an instagramAccounts row by its Instagram username (by_username
// index). Used by the worker import handler to attribute Apify posts to the
// right account; posts whose username has no matching account are skipped and
// counted as missingAccounts (parity with the original import service).
export const resolveAccountByUsername = query({
  args: { username: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instagramAccounts")
      .withIndex("by_username", (q) => q.eq("instagramUsername", args.username))
      .first();
  },
});

// Internal read of the Apify token + actor id for the snapshot action (which
// runs in the Node runtime and cannot touch the db directly).
export const getApifyConfig = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      apifyApiToken: v.union(v.string(), v.null()),
      apifyActorId: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const settings = await ctx.db.query("instagramSettings").first();
    if (!settings) return null;
    return {
      apifyApiToken: settings.apifyApiToken ?? null,
      apifyActorId: settings.apifyActorId ?? null,
    };
  },
});
