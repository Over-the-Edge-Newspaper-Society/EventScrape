import { ConvexError, v } from "convex/values";
import { GenericQueryCtx } from "convex/server";
import { mutation, query } from "./_generated/server";
import { DataModel, Doc } from "./_generated/dataModel";

type QueryCtx = GenericQueryCtx<DataModel>;

// Ports apps/api/src/routes/instagram-review/* (DB-backed endpoints only):
//   - queue.ts        -> queue (paginated list with filters)
//   - stats.ts        -> getStats
//   - accounts.ts     -> getAccounts
//   - classification.ts -> classify (manual UPDATE of eventsRaw)
//   - extraction-routes/extraction-service/ai-classification call Gemini/Apify
//     and download images — those are NOT ported here. See TODO(actions phase)
//     comments below; persistExtraction lets an action write its result back.

type QueueFilter = "pending" | "event" | "not-event" | "needs-extraction" | "all";

const queueFilter = v.union(
  v.literal("pending"),
  v.literal("event"),
  v.literal("not-event"),
  v.literal("needs-extraction"),
  v.literal("all"),
);

function clampPage(page?: number) {
  return page && page > 0 ? Math.floor(page) : 1;
}
function clampLimit(limit?: number) {
  const l = limit && limit > 0 ? Math.floor(limit) : 20;
  return l;
}

// Mirrors raw-utils.ts: a post has extracted events when raw.events is a
// non-empty array (raw may be a JSON string or an object).
function parseEventRaw(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return undefined;
}
function hasExtractedEvents(raw: unknown): boolean {
  const parsed = parseEventRaw(raw);
  if (!parsed) return false;
  const events = (parsed as { events?: unknown }).events;
  return Array.isArray(events) && events.length > 0;
}

// Collect all instagram eventsRaw rows (those whose source is sourceType
// 'instagram'), decorated with source + account, matching the original joins.
async function loadInstagramPosts(ctx: QueryCtx) {
  const sources = await ctx.db.query("sources").collect();
  const sourceById = new Map<string, Doc<"sources">>(
    sources.map((s) => [String(s._id), s]),
  );
  const igSourceIds = new Set(
    sources.filter((s) => s.sourceType === "instagram").map((s) => String(s._id)),
  );

  const accounts = await ctx.db.query("instagramAccounts").collect();
  const accountById = new Map<string, Doc<"instagramAccounts">>(
    accounts.map((a) => [String(a._id), a]),
  );

  const rawEvents = await ctx.db.query("eventsRaw").collect();
  const posts = rawEvents
    .filter((e) => igSourceIds.has(String(e.sourceId)))
    .map((event) => {
      const src = sourceById.get(String(event.sourceId));
      const account = event.instagramAccountId
        ? accountById.get(String(event.instagramAccountId))
        : undefined;
      return {
        event,
        source: src
          ? {
              id: src._id,
              name: src.name,
              moduleKey: src.moduleKey,
              instagramUsername: src.instagramUsername,
            }
          : null,
        account: account
          ? {
              id: account._id,
              name: account.name,
              instagramUsername: account.instagramUsername,
              classificationMode: account.classificationMode,
              active: account.active,
            }
          : null,
      };
    });

  return posts;
}

// GET /queue — paginated list of instagram posts with filters.
export const queue = query({
  args: {
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
    filter: v.optional(queueFilter),
    accountId: v.optional(v.id("instagramAccounts")),
  },
  returns: v.object({ posts: v.array(v.any()), pagination: v.any() }),
  handler: async (ctx, args) => {
    const page = clampPage(args.page);
    const limit = clampLimit(args.limit);
    const filter: QueueFilter = args.filter ?? "pending";

    let posts = await loadInstagramPosts(ctx);

    if (args.accountId) {
      const accountId = String(args.accountId);
      posts = posts.filter((p) => String(p.event.instagramAccountId) === accountId);
    }

    if (filter === "pending") {
      posts = posts.filter((p) => p.event.isEventPoster === undefined || p.event.isEventPoster === null);
    } else if (filter === "event") {
      posts = posts.filter((p) => p.event.isEventPoster === true);
    } else if (filter === "not-event") {
      posts = posts.filter((p) => p.event.isEventPoster === false);
    } else if (filter === "needs-extraction") {
      posts = posts.filter(
        (p) =>
          p.event.isEventPoster === true &&
          !!p.event.localImagePath &&
          !hasExtractedEvents(p.event.raw),
      );
    }

    // Original orders by scrapedAt desc.
    posts.sort((a, b) => b.event.scrapedAt - a.event.scrapedAt);

    const total = posts.length;
    const totalPages = limit ? Math.ceil(total / limit) : 0;
    const offset = (page - 1) * limit;
    const slice = posts.slice(offset, offset + limit);

    // Resolve Convex storage URLs for each post's local image (only `limit` items).
    const sliceWithUrls = await Promise.all(
      slice.map(async (p) => {
        const localImageUrl = p.event.localImageStorageId
          ? await ctx.storage.getUrl(p.event.localImageStorageId)
          : null;
        return { ...p, event: { ...p.event, localImageUrl } };
      }),
    );

    return {
      posts: sliceWithUrls,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1 && totalPages > 0,
      },
    };
  },
});

// GET /stats — counts by classification status + needs-extraction.
export const getStats = query({
  args: {},
  returns: v.object({
    unclassified: v.number(),
    markedAsEvent: v.number(),
    markedAsNotEvent: v.number(),
    needsExtraction: v.number(),
    total: v.number(),
  }),
  handler: async (ctx) => {
    const posts = await loadInstagramPosts(ctx);

    let unclassified = 0;
    let markedAsEvent = 0;
    let markedAsNotEvent = 0;
    let needsExtraction = 0;

    for (const { event } of posts) {
      if (event.isEventPoster === undefined || event.isEventPoster === null) {
        unclassified += 1;
      } else if (event.isEventPoster === true) {
        markedAsEvent += 1;
        if (event.localImagePath && !hasExtractedEvents(event.raw)) needsExtraction += 1;
      } else if (event.isEventPoster === false) {
        markedAsNotEvent += 1;
      }
    }

    return {
      unclassified,
      markedAsEvent,
      markedAsNotEvent,
      needsExtraction,
      total: unclassified + markedAsEvent + markedAsNotEvent,
    };
  },
});

// GET /accounts — id/name/username/active, ordered by name.
export const getAccounts = query({
  args: {},
  returns: v.object({ accounts: v.array(v.any()) }),
  handler: async (ctx) => {
    const accounts = await ctx.db.query("instagramAccounts").collect();
    accounts.sort((a, b) => a.name.localeCompare(b.name));
    return {
      accounts: accounts.map((a) => ({
        id: a._id,
        name: a.name,
        instagramUsername: a.instagramUsername,
        active: a.active,
      })),
    };
  },
});

// POST /:id/classify — manual classification (UPDATE eventsRaw only).
export const classify = mutation({
  args: {
    id: v.id("eventsRaw"),
    isEventPoster: v.boolean(),
    classificationConfidence: v.optional(v.number()),
  },
  returns: v.object({ message: v.string(), post: v.any() }),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.id);
    if (!post) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram post not found" });
    }
    // Confirm it really is an instagram-sourced post.
    const src = await ctx.db.get(post.sourceId);
    if (!src || src.sourceType !== "instagram") {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram post not found" });
    }

    await ctx.db.patch(args.id, {
      isEventPoster: args.isEventPoster,
      classificationConfidence: args.classificationConfidence ?? 1.0,
    });
    const updated = await ctx.db.get(args.id);
    return {
      message: `Post marked as ${args.isEventPoster ? "event" : "not event"}`,
      post: updated,
    };
  },
});

// ---------------------------------------------------------------------------
// Extraction / AI classification.
//
// TODO(actions phase): external AI/Apify call. The original /:id/extract,
// /extract-missing, and the AI-classification routes call Gemini/Claude, may
// download images, and write the structured result into eventsRaw.raw +
// create derived events. Those external calls must live in a Convex action.
//
// persistExtraction below is the DB-only tail: an action performs the AI
// extraction, then calls this mutation to persist the provided result onto the
// eventsRaw row (set raw envelope, classification fields). No external I/O.
// ---------------------------------------------------------------------------
export const persistExtraction = mutation({
  args: {
    id: v.id("eventsRaw"),
    raw: v.any(),
    isEventPoster: v.optional(v.boolean()),
    classificationConfidence: v.optional(v.number()),
  },
  returns: v.object({ post: v.any() }),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.id);
    if (!post) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Instagram post not found" });
    }

    const patch: {
      raw: unknown;
      isEventPoster?: boolean;
      classificationConfidence?: number;
    } = { raw: args.raw };
    if (args.isEventPoster !== undefined) patch.isEventPoster = args.isEventPoster;
    if (args.classificationConfidence !== undefined)
      patch.classificationConfidence = args.classificationConfidence;

    await ctx.db.patch(args.id, patch);
    const updated = await ctx.db.get(args.id);
    return { post: updated };
  },
});
