import { v } from "convex/values";
import { query } from "./_generated/server";
import { runStatus } from "./schema";

// Aggregate stats for the admin Dashboard page (apps/admin/src/pages/Dashboard.tsx).
// The original page fired four separate API calls (sourcesApi.getAll,
// runsApi.getAll, eventsApi.getRaw, matchesApi.getAll) and derived:
//   - active / total sources
//   - total raw events (rawEvents.pagination.total)
//   - recent runs (last 10, sliced to 5) with source name + status
//   - pending (open) matches count
// This single query returns all of that plus canonical count and counts by run
// status, in one efficient round-trip.

export const stats = query({
  args: {
    recentRunsLimit: v.optional(v.number()),
  },
  returns: v.object({
    sources: v.object({
      total: v.number(),
      active: v.number(),
    }),
    events: v.object({
      raw: v.number(),
      canonical: v.number(),
    }),
    matches: v.object({
      open: v.number(),
    }),
    runs: v.object({
      recent: v.array(
        v.object({
          run: v.any(),
          source: v.object({
            id: v.union(v.id("sources"), v.null()),
            name: v.string(),
          }),
        }),
      ),
      countsByStatus: v.object({
        queued: v.number(),
        running: v.number(),
        success: v.number(),
        partial: v.number(),
        error: v.number(),
        cancelled: v.number(),
      }),
    }),
  }),
  handler: async (ctx, args) => {
    const recentRunsLimit =
      args.recentRunsLimit && args.recentRunsLimit > 0
        ? Math.floor(args.recentRunsLimit)
        : 10;

    // Sources — small table, collect and derive active/total.
    const sources = await ctx.db.query("sources").collect();
    const sourceById = new Map(sources.map((s) => [s._id, s]));
    const activeSources = sources.filter((s) => s.active).length;

    // Raw + canonical event totals. eventsRaw is large (2400+ rows); Convex has
    // no count API, so we collect() the table. Acceptable per task note.
    const rawEvents = await ctx.db.query("eventsRaw").collect();
    const canonicalEvents = await ctx.db.query("eventsCanonical").collect();

    // Open matches — narrow via the by_status index instead of scanning.
    const openMatches = await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    // All runs (small table) for status counts; recent runs via the
    // by_started_at index, newest first.
    const allRuns = await ctx.db.query("runs").collect();
    const countsByStatus = {
      queued: 0,
      running: 0,
      success: 0,
      partial: 0,
      error: 0,
      cancelled: 0,
    } satisfies Record<string, number>;
    for (const run of allRuns) {
      countsByStatus[run.status]++;
    }

    const recentRunRows = await ctx.db
      .query("runs")
      .withIndex("by_started_at")
      .order("desc")
      .take(recentRunsLimit);

    const recent = recentRunRows.map((run) => {
      const src = sourceById.get(run.sourceId);
      return {
        run,
        source: {
          id: src?._id ?? null,
          name: src?.name ?? "Unknown",
        },
      };
    });

    return {
      sources: {
        total: sources.length,
        active: activeSources,
      },
      events: {
        raw: rawEvents.length,
        canonical: canonicalEvents.length,
      },
      matches: {
        open: openMatches.length,
      },
      runs: {
        recent,
        countsByStatus,
      },
    };
  },
});

// Keep the runStatus union referenced so the literal keys above stay in sync
// with the schema definition.
void runStatus;
