import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { exportFormat } from "./schema";

// ---------------------------------------------------------------------------
// Pure file-format generators ported 1:1 from apps/api/src/routes/exports.ts.
// The original consumed Postgres rows where startDatetime/endDatetime were JS
// Dates / ISO strings. In Convex those are epoch-ms NUMBERS, so the date
// helpers below accept a number (or anything Date can parse) and convert.
// ---------------------------------------------------------------------------

type ExportEvent = {
  id: string;
  sourceEventId?: string | null;
  sourceId?: string | null;
  title: string;
  descriptionHtml?: string | null;
  startDatetime: number;
  endDatetime?: number | null;
  timezone?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  organizer?: string | null;
  category?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  raw?: unknown;
};

function generateCSV(
  events: ExportEvent[],
  fieldMap: Record<string, string>,
): string {
  if (events.length === 0) return "";

  const headers = Object.values(fieldMap);
  const rows = events.map((event) => {
    return Object.keys(fieldMap).map((key) => {
      let value = "";
      switch (key) {
        case "title":
          value = event.title || "";
          break;
        case "description":
          value = event.descriptionHtml || "";
          break;
        case "start":
          value = event.startDatetime
            ? new Date(event.startDatetime).toISOString()
            : "";
          break;
        case "end":
          value = event.endDatetime
            ? new Date(event.endDatetime).toISOString()
            : "";
          break;
        case "timezone":
          value = event.timezone || "";
          break;
        case "venue":
          value = event.venueName || "";
          break;
        case "city":
          value = event.city || "";
          break;
        case "organizer":
          value = event.organizer || "";
          break;
        case "category":
          value = event.category || "";
          break;
        case "url":
          value = event.url || "";
          break;
        case "image":
          value = event.imageUrl || "";
          break;
        default:
          value = "";
      }
      // Escape quotes and wrap in quotes if contains comma/quote/newline.
      return value.includes(",") || value.includes('"') || value.includes("\n")
        ? `"${value.replace(/"/g, '""')}"`
        : value;
    });
  });

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

function extractPosterMeta(raw: unknown):
  | {
      club?: {
        id?: string | number | null;
        name?: string | null;
        username?: string | null;
        profileUrl?: string | null;
        platform?: string | null;
      };
      post?: {
        dbId?: string | null;
        postId?: string | number | null;
        postInstagramId?: string | null;
        url?: string | null;
        caption?: string | null;
        imageUrl?: string | null;
        timestamp?: string | null;
      };
    }
  | null {
  if (!raw || typeof raw !== "object") return null;
  const massPosterMeta = (raw as Record<string, unknown>).massPosterMeta;
  if (!massPosterMeta || typeof massPosterMeta !== "object") return null;

  const result: Record<string, unknown> = {};
  const meta = massPosterMeta as Record<string, unknown>;

  if (meta.club && typeof meta.club === "object") {
    const club = meta.club as Record<string, unknown>;
    result.club = {
      id: club.id ?? null,
      name: club.name ?? null,
      username: club.username ?? null,
      profileUrl: club.profileUrl ?? null,
      platform: club.platform ?? null,
    };
  }

  if (meta.post && typeof meta.post === "object") {
    const post = meta.post as Record<string, unknown>;
    result.post = {
      dbId: post.dbId ?? null,
      postId: post.postId ?? null,
      postInstagramId: post.postInstagramId ?? null,
      url: post.url ?? null,
      caption: post.caption ?? null,
      imageUrl: post.imageUrl ?? null,
      timestamp: post.timestamp ?? null,
    };
  }

  return Object.keys(result).length ? (result as never) : null;
}

function generateJSON(
  events: ExportEvent[],
  fieldMap: Record<string, string>,
): string {
  const mappedEvents = events.map((event) => {
    const useFieldMap = fieldMap && Object.keys(fieldMap).length > 0;
    const posterMeta = extractPosterMeta(event.raw);

    if (useFieldMap) {
      const mapped: Record<string, unknown> = {};
      for (const [key, jsonField] of Object.entries(fieldMap)) {
        switch (key) {
          case "title":
            mapped[jsonField] = event.title;
            break;
          case "description":
            mapped[jsonField] = event.descriptionHtml;
            break;
          case "start":
            mapped[jsonField] = event.startDatetime;
            break;
          case "end":
            mapped[jsonField] = event.endDatetime;
            break;
          case "venue":
            mapped[jsonField] = event.venueName;
            break;
          case "city":
            mapped[jsonField] = event.city;
            break;
          case "organizer":
            mapped[jsonField] = event.organizer;
            break;
          case "category":
            mapped[jsonField] = event.category;
            break;
          case "url":
            mapped[jsonField] = event.url;
            break;
          case "image":
            mapped[jsonField] = event.imageUrl;
            break;
          case "clubName":
            mapped[jsonField] = posterMeta?.club?.name ?? null;
            break;
          case "clubProfileUrl":
            mapped[jsonField] = posterMeta?.club?.profileUrl ?? null;
            break;
        }
      }
      return mapped;
    } else {
      return {
        id: event.id,
        sourceEventId: event.sourceEventId,
        title: event.title,
        description: event.descriptionHtml,
        startDatetime: event.startDatetime,
        endDatetime: event.endDatetime,
        timezone: event.timezone,
        venueName: event.venueName,
        venueAddress: event.venueAddress,
        city: event.city,
        organizer: event.organizer,
        category: event.category,
        url: event.url,
        imageUrl: event.imageUrl,
        club: posterMeta?.club ?? null,
        post: posterMeta?.post ?? null,
      };
    }
  });

  return JSON.stringify({ events: mappedEvents }, null, 2);
}

function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICS(text: string): string {
  return text.replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
}

function generateICS(events: ExportEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventScrape//EventScrape//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const event of events) {
    const startDate = new Date(event.startDatetime);
    const endDate = event.endDatetime
      ? new Date(event.endDatetime)
      : new Date(startDate.getTime() + 3600000); // +1 hour default

    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@eventscrape.com`,
      `DTSTART:${formatICSDate(startDate)}`,
      `DTEND:${formatICSDate(endDate)}`,
      `SUMMARY:${escapeICS(event.title)}`,
      event.descriptionHtml
        ? `DESCRIPTION:${escapeICS(event.descriptionHtml.replace(/<[^>]*>/g, ""))}`
        : "",
      event.venueName ? `LOCATION:${escapeICS(event.venueName)}` : "",
      event.url ? `URL:${event.url}` : "",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.filter((line) => line).join("\r\n");
}

// Accept the date filters as either epoch-ms numbers (preferred) or the
// ISO/date strings the original Zod schema produced. Returns epoch-ms or
// undefined.
function toMs(
  val: number | string | undefined | null,
  endOfDay: boolean,
): number | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  if (typeof val === "number") return val;
  // Date-only (YYYY-MM-DD) gets start/end-of-day like the original transform.
  const iso = val.includes("T")
    ? val
    : endOfDay
      ? `${val}T23:59:59.999Z`
      : `${val}T00:00:00.000Z`;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

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

    // The original ran processExport asynchronously via setImmediate. Here we
    // schedule the internal action that queries events, builds the file, stores
    // it, and marks the record complete/error. wp-rest is handled by a worker
    // job (separate task), so we only schedule generation for file formats.
    if (args.format !== "wp-rest") {
      await ctx.scheduler.runAfter(0, internal.exports.generateFile, {
        exportId,
      });
    }

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

// Resolve a download URL for a finished export's stored file. Replaces the
// original GET /:id/download which streamed the file from disk; the file now
// lives in Convex storage and is served via a signed URL.
export const getDownloadUrl = query({
  args: { id: v.id("exports") },
  returns: v.union(
    v.object({
      url: v.union(v.string(), v.null()),
      filename: v.string(),
      format: exportFormat,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const exportRecord = await ctx.db.get(args.id);
    if (!exportRecord || !exportRecord.fileStorageId) return null;
    const url = await ctx.storage.getUrl(exportRecord.fileStorageId);
    const ext =
      exportRecord.format === "csv"
        ? "csv"
        : exportRecord.format === "ics"
          ? "ics"
          : "json";
    return {
      url,
      filename: `export-${args.id}.${ext}`,
      format: exportRecord.format,
    };
  },
});

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

// ---------------------------------------------------------------------------
// File-generation pipeline (replaces the original setImmediate processExport).
// Actions cannot touch ctx.db, so the action drives these internal functions.
// ---------------------------------------------------------------------------

// Read the export row (format + params) for the generation action.
export const getForGeneration = internalQuery({
  args: { exportId: v.id("exports") },
  returns: v.union(
    v.object({
      format: exportFormat,
      params: v.any(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const exportRecord = await ctx.db.get(args.exportId);
    if (!exportRecord) return null;
    return { format: exportRecord.format, params: exportRecord.params };
  },
});

// Reproduce the original processExport event selection: scan eventsRaw, apply
// the export filters (startDate/endDate as ms, city/category substring,
// sourceIds matching sourceId OR instagramAccountId, status*, ids), then drop
// Instagram posts not confirmed as event posters / not AI-extracted.
//
// *status: the original filtered eventsRaw by a canonical status that doesn't
// exist on eventsRaw rows, so it was effectively a no-op there; preserved as a
// no-op here (status lives on eventsCanonical, not eventsRaw).
export const eventsForExport = internalQuery({
  args: {
    filters: v.object({
      startDate: v.optional(v.union(v.number(), v.string())),
      endDate: v.optional(v.union(v.number(), v.string())),
      city: v.optional(v.string()),
      category: v.optional(v.string()),
      sourceIds: v.optional(v.array(v.string())),
      ids: v.optional(v.array(v.string())),
    }),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const f = args.filters;
    const startMs = toMs(f.startDate, false);
    const endMs = toMs(f.endDate, true);
    const city = f.city?.toLowerCase();
    const category = f.category?.toLowerCase();
    const sourceIdSet = f.sourceIds ? new Set(f.sourceIds) : undefined;
    const idSet = f.ids ? new Set(f.ids) : undefined;

    const rows = await ctx.db.query("eventsRaw").collect();

    const filtered = rows
      .filter((e) => {
        if (startMs !== undefined && e.startDatetime < startMs) return false;
        if (endMs !== undefined && e.startDatetime > endMs) return false;
        if (city && !(e.city ?? "").toLowerCase().includes(city)) return false;
        if (category && !(e.category ?? "").toLowerCase().includes(category))
          return false;
        if (sourceIdSet) {
          // Original matched sourceId OR instagramAccountId against sourceIds.
          const matchesSource = sourceIdSet.has(String(e.sourceId));
          const matchesIg =
            e.instagramAccountId !== undefined &&
            sourceIdSet.has(String(e.instagramAccountId));
          if (!matchesSource && !matchesIg) return false;
        }
        if (idSet && !idSet.has(String(e._id))) return false;

        // Instagram exclusion: only keep IG posts confirmed as event posters
        // that have been AI-extracted (raw.events array populated).
        if (e.instagramAccountId) {
          if (e.isEventPoster !== true) return false;
          const raw = e.raw as { events?: unknown } | null;
          if (
            !raw?.events ||
            !Array.isArray(raw.events) ||
            raw.events.length === 0
          ) {
            return false;
          }
        }
        return true;
      })
      // Original ordered by startDatetime ascending.
      .sort((a, b) => a.startDatetime - b.startDatetime);

    return filtered.map((e) => ({
      id: String(e._id),
      sourceEventId: e.sourceEventId ?? null,
      sourceId: e.sourceId ? String(e.sourceId) : null,
      title: e.title,
      descriptionHtml: e.descriptionHtml ?? null,
      startDatetime: e.startDatetime,
      endDatetime: e.endDatetime ?? null,
      timezone: e.timezone ?? null,
      venueName: e.venueName ?? null,
      venueAddress: e.venueAddress ?? null,
      city: e.city ?? null,
      organizer: e.organizer ?? null,
      category: e.category ?? null,
      url: e.url ?? null,
      imageUrl: e.imageUrl ?? null,
      raw: e.raw ?? null,
    }));
  },
});

// Patch the export row to success with the stored file reference + item count.
export const completeWithFile = internalMutation({
  args: {
    exportId: v.id("exports"),
    fileStorageId: v.id("_storage"),
    itemCount: v.number(),
    filePath: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.exportId, {
      status: "success",
      fileStorageId: args.fileStorageId,
      itemCount: args.itemCount,
      filePath: args.filePath,
    });
    return null;
  },
});

// Internal action: generate the export file (CSV/JSON/ICS), store it in Convex
// storage, and mark the export complete. On any error mark the export errored.
export const generateFile = internalAction({
  args: { exportId: v.id("exports") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const record = await ctx.runQuery(internal.exports.getForGeneration, {
        exportId: args.exportId,
      });
      if (!record) {
        throw new Error("Export not found");
      }

      const params = (record.params ?? {}) as {
        filters?: {
          startDate?: number | string;
          endDate?: number | string;
          city?: string;
          category?: string;
          sourceIds?: string[];
          ids?: string[];
        };
        fieldMap?: Record<string, string>;
      };
      const filters = params.filters ?? {};
      const fieldMap = params.fieldMap ?? {};

      const events = (await ctx.runQuery(internal.exports.eventsForExport, {
        filters: {
          startDate: filters.startDate,
          endDate: filters.endDate,
          city: filters.city,
          category: filters.category,
          sourceIds: filters.sourceIds,
          ids: filters.ids,
        },
      })) as ExportEvent[];

      let content: string;
      let contentType: string;
      let ext: string;
      switch (record.format) {
        case "csv":
          content = generateCSV(events, fieldMap);
          contentType = "text/csv";
          ext = "csv";
          break;
        case "json":
          content = generateJSON(events, fieldMap);
          contentType = "application/json";
          ext = "json";
          break;
        case "ics":
          content = generateICS(events);
          contentType = "text/calendar";
          ext = "ics";
          break;
        default:
          throw new Error(`Unsupported export format: ${record.format}`);
      }

      const blob = new Blob([content], { type: contentType });
      const storageId = await ctx.storage.store(blob);

      await ctx.runMutation(internal.exports.completeWithFile, {
        exportId: args.exportId,
        fileStorageId: storageId,
        itemCount: events.length,
        filePath: `export-${args.exportId}.${ext}`,
      });
    } catch (error) {
      await ctx.runMutation(api.exports.markError, {
        id: args.exportId,
        errorMessage:
          error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});
