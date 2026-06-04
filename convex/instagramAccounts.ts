import { ConvexError, v } from "convex/values";
import { GenericMutationCtx } from "convex/server";
import { mutation, query } from "./_generated/server";
import { DataModel, Doc, Id } from "./_generated/dataModel";
import { classificationMode, instagramScraperType } from "./schema";

type MutationCtx = GenericMutationCtx<DataModel>;

// Ports apps/api/src/routes/instagram-sources.ts (DB-backed endpoints) plus the
// trigger endpoints which create runs + enqueue instagramScrape jobs.

const DEFAULT_TIMEZONE = "America/Vancouver";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// GET /api/instagram-sources — list all accounts WITH post/event counts.
export const list = query({
  args: {},
  returns: v.object({ sources: v.array(v.any()) }),
  handler: async (ctx) => {
    const accounts = await ctx.db.query("instagramAccounts").collect();
    accounts.sort((a, b) => a._creationTime - b._creationTime);

    // Tally posts / events per account from eventsRaw (scan; no SQL aggregate).
    const rawEvents = await ctx.db.query("eventsRaw").collect();
    const statsMap = new Map<string, { postsCount: number; eventCount: number }>();
    for (const e of rawEvents) {
      if (!e.instagramAccountId) continue;
      const key = String(e.instagramAccountId);
      const stat = statsMap.get(key) ?? { postsCount: 0, eventCount: 0 };
      stat.postsCount += 1;
      if (e.isEventPoster === true) stat.eventCount += 1;
      statsMap.set(key, stat);
    }

    const sources = accounts.map((account) => {
      const stat = statsMap.get(String(account._id)) ?? { postsCount: 0, eventCount: 0 };
      return { ...account, postsCount: stat.postsCount, eventCount: stat.eventCount };
    });

    return { sources };
  },
});

// GET /api/instagram-sources/:id
export const get = query({
  args: { id: v.id("instagramAccounts") },
  returns: v.union(v.object({ source: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.id);
    if (!account) return null;
    return { source: account };
  },
});

// POST /api/instagram-sources
export const create = mutation({
  args: {
    name: v.string(),
    instagramUsername: v.string(),
    classificationMode: v.optional(classificationMode),
    instagramScraperType: v.optional(instagramScraperType),
    active: v.optional(v.boolean()),
    defaultTimezone: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.object({ source: v.any() }),
  handler: async (ctx, args) => {
    if (!args.name.trim() || !args.instagramUsername.trim()) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Validation error" });
    }

    const existing = await ctx.db
      .query("instagramAccounts")
      .withIndex("by_username", (q) => q.eq("instagramUsername", args.instagramUsername))
      .first();
    if (existing) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "An Instagram account for this username already exists",
      });
    }

    const now = Date.now();
    const id = await ctx.db.insert("instagramAccounts", {
      name: args.name,
      instagramUsername: args.instagramUsername,
      classificationMode: args.classificationMode ?? "manual",
      instagramScraperType: args.instagramScraperType ?? "instagram-private-api",
      active: args.active ?? true,
      defaultTimezone: args.defaultTimezone ?? DEFAULT_TIMEZONE,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
    const source = await ctx.db.get(id);
    return { source };
  },
});

// PATCH /api/instagram-sources/:id
export const update = mutation({
  args: {
    id: v.id("instagramAccounts"),
    name: v.optional(v.string()),
    instagramUsername: v.optional(v.string()),
    classificationMode: v.optional(classificationMode),
    instagramScraperType: v.optional(instagramScraperType),
    active: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  returns: v.object({ source: v.any() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram account not found" });
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.instagramUsername !== undefined) patch.instagramUsername = args.instagramUsername;
    if (args.classificationMode !== undefined) patch.classificationMode = args.classificationMode;
    if (args.instagramScraperType !== undefined)
      patch.instagramScraperType = args.instagramScraperType;
    if (args.active !== undefined) patch.active = args.active;
    if (args.notes !== undefined) patch.notes = args.notes;

    await ctx.db.patch(args.id, patch);
    const source = await ctx.db.get(args.id);
    return { source };
  },
});

// DELETE /api/instagram-sources/:id
export const remove = mutation({
  args: { id: v.id("instagramAccounts") },
  returns: v.object({ message: v.string(), source: v.any() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram account not found" });
    }
    await ctx.db.delete(args.id);
    return { message: "Instagram account deleted successfully", source: existing };
  },
});

// ---------------------------------------------------------------------------
// Trigger endpoints — create runs + enqueue instagramScrape jobs.
// The original used a fixed legacy instagram sources row (INSTAGRAM_SOURCE_ID).
// Runs require sourceId: v.id("sources"); resolve the instagram source here.
// ---------------------------------------------------------------------------

async function resolveInstagramSourceId(ctx: MutationCtx): Promise<Id<"sources">> {
  const source = await ctx.db
    .query("sources")
    .withIndex("by_source_type", (q) => q.eq("sourceType", "instagram"))
    .first();
  if (!source) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Instagram source row not found (sources.sourceType === 'instagram')",
    });
  }
  return source._id as Id<"sources">;
}

const DEFAULT_POST_LIMIT = 10;

// POST /api/instagram-sources/:id/trigger — queue a scrape for a single account.
export const trigger = mutation({
  args: {
    id: v.id("instagramAccounts"),
    postLimit: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    message: v.string(),
    accountId: v.id("instagramAccounts"),
    username: v.string(),
    runId: v.id("runs"),
    parentRunId: v.id("runs"),
    jobId: v.id("jobs"),
    postLimit: v.number(),
    batchSize: v.optional(v.number()),
    accountsQueued: v.number(),
    jobs: v.array(v.any()),
  }),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.id);
    if (!account) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram account not found" });
    }
    if (!account.active) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Instagram account is inactive" });
    }

    const postLimit = clamp(args.postLimit ?? DEFAULT_POST_LIMIT, 1, 100);
    const batchSize =
      args.batchSize !== undefined ? clamp(args.batchSize, 1, 25) : undefined;
    const sourceId = await resolveInstagramSourceId(ctx);
    const now = Date.now();

    // Parent batch run + one child run per account (mirrors the service).
    const parentRunId = await ctx.db.insert("runs", {
      sourceId,
      status: "queued",
      startedAt: now,
      pagesCrawled: 0,
      eventsFound: 0,
      metadata: {
        type: "instagram_batch",
        scope: "custom",
        accountsTotal: 1,
        options: { postLimit, batchSize, accountLimit: 1 },
        accountIds: [account._id],
      },
    });

    const childRunId = await ctx.db.insert("runs", {
      sourceId,
      parentRunId,
      status: "queued",
      startedAt: now,
      pagesCrawled: 0,
      eventsFound: 0,
      metadata: {
        instagramAccountId: account._id,
        instagramUsername: account.instagramUsername,
        queuePosition: 1,
      },
    });

    const jobId = await ctx.db.insert("jobs", {
      queue: "instagramScrape",
      name: "instagramScrape",
      status: "queued",
      payload: { accountId: account._id, postLimit, batchSize, parentRunId },
      runId: childRunId,
      attempts: 0,
      maxAttempts: 3,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const jobs = [
      {
        accountId: account._id,
        username: account.instagramUsername,
        jobId,
        runId: childRunId,
      },
    ];

    return {
      message: `Queued scrape job for @${account.instagramUsername}`,
      accountId: account._id,
      username: account.instagramUsername,
      runId: childRunId,
      parentRunId,
      jobId,
      postLimit,
      batchSize,
      accountsQueued: 1,
      jobs,
    };
  },
});

// POST /api/instagram-sources/trigger-all-active — trigger all active accounts.
export const triggerAllActive = mutation({
  args: {
    postLimit: v.optional(v.number()),
    accountLimit: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    message: v.string(),
    accountsQueued: v.number(),
    postLimit: v.number(),
    batchSize: v.optional(v.number()),
    parentRunId: v.id("runs"),
    jobs: v.array(v.any()),
  }),
  handler: async (ctx, args) => {
    let accounts = await ctx.db
      .query("instagramAccounts")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    if (accounts.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "No active Instagram accounts found",
      });
    }

    const accountLimit =
      args.accountLimit && args.accountLimit > 0
        ? Math.min(Math.floor(args.accountLimit), accounts.length)
        : accounts.length;
    accounts = accounts.slice(0, accountLimit);

    const postLimit = clamp(args.postLimit ?? DEFAULT_POST_LIMIT, 1, 100);
    const batchSize =
      args.batchSize !== undefined ? clamp(args.batchSize, 1, 25) : undefined;
    const sourceId = await resolveInstagramSourceId(ctx);
    const now = Date.now();

    const parentRunId = await ctx.db.insert("runs", {
      sourceId,
      status: "queued",
      startedAt: now,
      pagesCrawled: 0,
      eventsFound: 0,
      metadata: {
        type: "instagram_batch",
        scope: "all_active",
        accountsTotal: accounts.length,
        options: { postLimit, batchSize, accountLimit },
        accountIds: accounts.map((a) => a._id),
      },
    });

    const jobs: Array<{
      accountId: Id<"instagramAccounts">;
      username: string;
      jobId: Id<"jobs">;
      runId: Id<"runs">;
    }> = [];

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const childRunId = await ctx.db.insert("runs", {
        sourceId,
        parentRunId,
        status: "queued",
        startedAt: now,
        pagesCrawled: 0,
        eventsFound: 0,
        metadata: {
          instagramAccountId: account._id,
          instagramUsername: account.instagramUsername,
          queuePosition: i + 1,
        },
      });

      const jobId = await ctx.db.insert("jobs", {
        queue: "instagramScrape",
        name: "instagramScrape",
        status: "queued",
        payload: { accountId: account._id, postLimit, batchSize, parentRunId },
        runId: childRunId,
        attempts: 0,
        maxAttempts: 3,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });

      jobs.push({
        accountId: account._id,
        username: account.instagramUsername,
        jobId,
        runId: childRunId,
      });
    }

    return {
      message: `Queued ${accounts.length} scrape jobs for active accounts`,
      accountsQueued: accounts.length,
      postLimit,
      batchSize,
      parentRunId,
      jobs,
    };
  },
});

// POST /api/instagram-sources/jobs/status — statuses for a batch of jobs.
// Maps to Convex jobs rows (BullMQ-style fields don't all exist here).
export const jobStatuses = query({
  args: {
    jobIds: v.optional(v.array(v.id("jobs"))),
    runIds: v.optional(v.array(v.id("runs"))),
    accountIds: v.optional(v.array(v.id("instagramAccounts"))),
  },
  returns: v.object({ jobs: v.array(v.any()) }),
  handler: async (ctx, args) => {
    const out: Doc<"jobs">[] = [];
    const seen = new Set<string>();

    const push = (job: Doc<"jobs"> | null) => {
      if (job && !seen.has(String(job._id))) {
        seen.add(String(job._id));
        out.push(job);
      }
    };

    if (args.jobIds) {
      for (const jobId of args.jobIds) push(await ctx.db.get(jobId));
    }

    if (args.runIds) {
      for (const runId of args.runIds) {
        const jobs = await ctx.db
          .query("jobs")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .collect();
        jobs.forEach(push);
      }
    }

    if (args.accountIds) {
      const accountSet = new Set(args.accountIds.map(String));
      const igJobs = await ctx.db
        .query("jobs")
        .withIndex("by_queue_status_available", (q) => q.eq("queue", "instagramScrape"))
        .collect();
      for (const job of igJobs) {
        const accountId = (job.payload as { accountId?: unknown })?.accountId;
        if (accountId && accountSet.has(String(accountId))) push(job);
      }
    }

    return { jobs: out };
  },
});

// POST /api/instagram-sources/jobs/cancel — cancel queued/running instagram jobs.
export const cancelJobs = mutation({
  args: { jobIds: v.array(v.id("jobs")) },
  returns: v.object({ results: v.array(v.any()) }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const results: Array<{ jobId: Id<"jobs">; state: string | null; action: string }> = [];

    for (const jobId of args.jobIds) {
      const job = await ctx.db.get(jobId);
      if (!job) {
        results.push({ jobId, state: null, action: "missing" });
        continue;
      }

      if (job.status === "success" || job.status === "error" || job.status === "cancelled") {
        results.push({ jobId, state: job.status, action: "already_finished" });
        continue;
      }

      if (job.status === "queued") {
        await ctx.db.patch(jobId, {
          status: "cancelled",
          cancelRequested: true,
          lastError: "Cancelled by user",
          finishedAt: now,
          updatedAt: now,
        });
        if (job.runId) {
          await ctx.db.patch(job.runId, { status: "cancelled", finishedAt: now });
        }
        results.push({ jobId, state: "queued", action: "removed" });
        continue;
      }

      // running — request cancellation; the worker honours it.
      await ctx.db.patch(jobId, { cancelRequested: true, updatedAt: now });
      results.push({ jobId, state: "running", action: "cancel_requested" });
    }

    return { results };
  },
});

// ---------------------------------------------------------------------------
// Instagram sessions (instagramSessions table).
// ---------------------------------------------------------------------------

// POST /api/instagram-sources/sessions — upload (upsert) a session.
export const uploadSession = mutation({
  args: {
    username: v.string(),
    sessionData: v.any(),
  },
  returns: v.object({ message: v.string(), session: v.any() }),
  handler: async (ctx, args) => {
    if (!args.username.trim()) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Validation error" });
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("instagramSessions")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionData: args.sessionData,
        uploadedAt: now,
        isValid: true,
      });
      const session = await ctx.db.get(existing._id);
      return { message: "Session updated successfully", session };
    }

    const id = await ctx.db.insert("instagramSessions", {
      username: args.username,
      sessionData: args.sessionData,
      uploadedAt: now,
      isValid: true,
    });
    const session = await ctx.db.get(id);
    return { message: "Session created successfully", session };
  },
});

// GET /api/instagram-sources/sessions/:username — status only (no session data).
export const getSession = query({
  args: { username: v.string() },
  returns: v.union(v.object({ session: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("instagramSessions")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
    if (!session) return null;
    return {
      session: {
        id: session._id,
        username: session.username,
        uploadedAt: session.uploadedAt,
        expiresAt: session.expiresAt,
        lastUsedAt: session.lastUsedAt,
        isValid: session.isValid,
      },
    };
  },
});

// DELETE /api/instagram-sources/sessions/:username
export const deleteSession = mutation({
  args: { username: v.string() },
  returns: v.object({ message: v.string() }),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("instagramSessions")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
    if (!session) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Session not found" });
    }
    await ctx.db.delete(session._id);
    return { message: "Session deleted successfully" };
  },
});
