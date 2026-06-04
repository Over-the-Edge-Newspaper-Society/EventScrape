import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { exportFormat } from "./schema";

// Ports the RECORD/DB logic of apps/api/src/routes/exports.ts. The actual file
// generation and WordPress upload are external I/O performed by the worker /
// actions phase, so they are intentionally left out here. This module only owns
// the `exports` table rows and the join metadata the admin UI displays.

// Create-export filters mirror the Zod `exportSchema.filters` shape, kept as a
// plain object stored in `params`. We don't run them here (that's the actions
// phase querying eventsRaw), so they're loosely typed.
const exportFilters = v.object({
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  city: v.optional(v.string()),
  category: v.optional(v.string()),
  sourceIds: v.optional(v.array(v.string())),
  status: v.optional(
    v.union(
      v.literal("new"),
      v.literal("ready"),
      v.literal("exported"),
      v.literal("ignored"),
    ),
  ),
  ids: v.optional(v.array(v.string())),
});

// List export history: last 50, newest first, with the schedule + wordpress
// settings join info the original endpoint returned via leftJoin.
export const list = query({
  args: {},
  returns: v.object({ exports: v.array(v.any()) }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("exports")
      .withIndex("by_created_at")
      .order("desc")
      .take(50);

    const exportsWithJoins = await Promise.all(
      rows.map(async (exportRow) => {
        const schedule = exportRow.scheduleId
          ? await ctx.db.get(exportRow.scheduleId)
          : null;
        const wordpressSettings =
          schedule && schedule.wordpressSettingsId
            ? await ctx.db.get(schedule.wordpressSettingsId)
            : null;
        return { export: exportRow, schedule, wordpressSettings };
      }),
    );

    return { exports: exportsWithJoins };
  },
});

// Get a single export by id.
export const get = query({
  args: { id: v.id("exports") },
  returns: v.union(v.object({ export: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const exportRecord = await ctx.db.get(args.id);
    if (!exportRecord) return null;
    return { export: exportRecord };
  },
});

// Create an export record in `processing` state. The actual file generation /
// WordPress upload runs externally (originally a setImmediate processExport),
// and is NOT ported here.
export const create = mutation({
  args: {
    format: exportFormat,
    filters: v.optional(exportFilters),
    fieldMap: v.optional(v.record(v.string(), v.string())),
    wpSiteId: v.optional(v.id("wordpressSettings")),
    wpPostStatus: v.optional(
      v.union(v.literal("publish"), v.literal("draft"), v.literal("pending")),
    ),
    status: v.optional(
      v.union(v.literal("publish"), v.literal("draft"), v.literal("pending")),
    ),
    scheduleId: v.optional(v.id("schedules")),
  },
  returns: v.id("exports"),
  handler: async (ctx, args) => {
    const exportId = await ctx.db.insert("exports", {
      format: args.format,
      createdAt: Date.now(),
      itemCount: 0,
      params: {
        filters: args.filters ?? {},
        fieldMap: args.fieldMap ?? {},
        wpSiteId: args.wpSiteId,
        wpPostStatus: args.wpPostStatus ?? "draft",
        status: args.status,
      },
      status: "processing",
      scheduleId: args.scheduleId,
    });

    // TODO(actions phase): generate file / wp upload, then call markComplete /
    // markError with the result. The original implementation ran processExport
    // asynchronously via setImmediate.

    return exportId;
  },
});

// Cancel a processing export. Mirrors the original POST /:id/cancel which set
// status to 'error' with a cancellation message.
export const cancel = mutation({
  args: { id: v.id("exports") },
  returns: v.object({ message: v.string() }),
  handler: async (ctx, args) => {
    const exportRecord = await ctx.db.get(args.id);
    if (!exportRecord) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Export not found" });
    }
    if (exportRecord.status !== "processing") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Export is not currently processing",
      });
    }

    await ctx.db.patch(args.id, {
      status: "error",
      errorMessage: "Export cancelled by user",
    });

    return { message: "Export cancelled successfully" };
  },
});

// TODO(actions phase): download endpoint (GET /:id/download) streams the
// generated file from disk. File streaming is external I/O and is not ported as
// a Convex query/mutation; the actions/HTTP phase will serve the stored file.

// Mutation the actions phase calls once an export finishes successfully.
export const markComplete = mutation({
  args: {
    id: v.id("exports"),
    filePath: v.optional(v.string()),
    itemCount: v.number(),
    params: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const exportRecord = await ctx.db.get(args.id);
    if (!exportRecord) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Export not found" });
    }
    await ctx.db.patch(args.id, {
      status: "success",
      filePath: args.filePath,
      itemCount: args.itemCount,
      ...(args.params !== undefined ? { params: args.params } : {}),
    });
    return null;
  },
});

// Mutation the actions phase calls when an export fails.
export const markError = mutation({
  args: {
    id: v.id("exports"),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const exportRecord = await ctx.db.get(args.id);
    if (!exportRecord) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Export not found" });
    }
    await ctx.db.patch(args.id, {
      status: "error",
      errorMessage: args.errorMessage,
    });
    return null;
  },
});
