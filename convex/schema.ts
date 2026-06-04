import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("success"),
  v.literal("partial"),
  v.literal("error"),
  v.literal("cancelled"),
);

export const jobStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("success"),
  v.literal("error"),
  v.literal("cancelled"),
);

export const queueName = v.union(
  v.literal("scrape"),
  v.literal("match"),
  v.literal("instagramScrape"),
  v.literal("schedule"),
  v.literal("wordpress"),
  v.literal("review"),
  v.literal("posterImport"),
  v.literal("apifyImport"),
);

export const sourceType = v.union(v.literal("website"), v.literal("instagram"));
export const classificationMode = v.union(v.literal("manual"), v.literal("auto"));
export const instagramScraperType = v.union(
  v.literal("apify"),
  v.literal("instagram-private-api"),
);
export const aiProvider = v.union(
  v.literal("gemini"),
  v.literal("claude"),
  v.literal("openrouter"),
);
export const matchStatus = v.union(
  v.literal("open"),
  v.literal("confirmed"),
  v.literal("rejected"),
);
export const canonicalStatus = v.union(
  v.literal("new"),
  v.literal("ready"),
  v.literal("exported"),
  v.literal("ignored"),
);
export const exportStatus = v.union(
  v.literal("success"),
  v.literal("error"),
  v.literal("processing"),
);
export const exportFormat = v.union(
  v.literal("csv"),
  v.literal("json"),
  v.literal("ics"),
  v.literal("wp-rest"),
);
export const scheduleType = v.union(
  v.literal("scrape"),
  v.literal("wordpress_export"),
  v.literal("instagram_scrape"),
);
export const occurrenceType = v.union(
  v.literal("single"),
  v.literal("multi_day"),
  v.literal("all_day"),
  v.literal("recurring"),
  v.literal("virtual"),
);
export const recurrenceType = v.union(
  v.literal("none"),
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("monthly"),
  v.literal("yearly"),
  v.literal("custom"),
);
export const eventStatusType = v.union(
  v.literal("scheduled"),
  v.literal("canceled"),
  v.literal("postponed"),
);

const optionalNumber = v.optional(v.number());
const optionalString = v.optional(v.string());
const optionalBoolean = v.optional(v.boolean());

export default defineSchema({
  sources: defineTable({
    legacyId: optionalString,
    name: v.string(),
    baseUrl: v.string(),
    moduleKey: v.string(),
    active: v.boolean(),
    defaultTimezone: v.string(),
    notes: optionalString,
    rateLimitPerMin: v.number(),
    sourceType,
    instagramUsername: optionalString,
    classificationMode: optionalString,
    instagramScraperType: optionalString,
    lastChecked: optionalNumber,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_module_key", ["moduleKey"])
    .index("by_source_type", ["sourceType"])
    .index("by_instagram_username", ["instagramUsername"])
    .index("by_active", ["active"])
    .index("by_legacy_id", ["legacyId"]),

  runs: defineTable({
    legacyId: optionalString,
    sourceId: v.id("sources"),
    startedAt: v.number(),
    finishedAt: optionalNumber,
    status: runStatus,
    pagesCrawled: v.number(),
    eventsFound: v.number(),
    errors: v.optional(v.any()),
    parentRunId: v.optional(v.id("runs")),
    metadata: v.optional(v.any()),
  })
    .index("by_source", ["sourceId"])
    .index("by_source_and_started_at", ["sourceId", "startedAt"])
    .index("by_parent", ["parentRunId"])
    .index("by_status", ["status"])
    .index("by_started_at", ["startedAt"])
    .index("by_legacy_id", ["legacyId"]),

  eventSeries: defineTable({
    legacyId: optionalString,
    sourceId: v.id("sources"),
    runId: v.id("runs"),
    lastUpdatedByRunId: v.optional(v.id("runs")),
    sourceEventId: optionalString,
    sourceEventKey: optionalString,
    title: v.string(),
    descriptionHtml: optionalString,
    occurrenceType,
    eventStatus: eventStatusType,
    statusReason: optionalString,
    recurrenceType,
    recurrencePattern: optionalString,
    isAllDay: v.boolean(),
    isVirtual: v.boolean(),
    virtualUrl: optionalString,
    venueName: optionalString,
    venueAddress: optionalString,
    city: optionalString,
    region: optionalString,
    country: optionalString,
    lat: optionalNumber,
    lon: optionalNumber,
    organizer: optionalString,
    category: optionalString,
    price: optionalString,
    tags: v.optional(v.array(v.string())),
    urlPrimary: v.string(),
    imageUrl: optionalString,
    raw: v.any(),
    contentHash: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_source", ["sourceId"])
    .index("by_run", ["runId"])
    .index("by_source_event_key", ["sourceEventKey"])
    .index("by_occurrence_type", ["occurrenceType"])
    .index("by_recurrence_type", ["recurrenceType"])
    .index("by_event_status", ["eventStatus"])
    .index("by_virtual", ["isVirtual"])
    .index("by_city", ["city"])
    .index("by_content_hash", ["contentHash"])
    .index("by_created_at", ["createdAt"])
    .index("by_legacy_id", ["legacyId"]),

  eventOccurrences: defineTable({
    legacyId: optionalString,
    seriesId: v.id("eventSeries"),
    occurrenceHash: v.string(),
    sequence: v.number(),
    startDatetime: v.number(),
    endDatetime: optionalNumber,
    startDatetimeUtc: v.number(),
    endDatetimeUtc: optionalNumber,
    durationSeconds: optionalNumber,
    timezone: v.string(),
    hasRecurrence: v.boolean(),
    isProvisional: v.boolean(),
    titleOverride: optionalString,
    descriptionOverride: optionalString,
    venueNameOverride: optionalString,
    venueAddressOverride: optionalString,
    eventStatusOverride: v.optional(eventStatusType),
    statusReasonOverride: optionalString,
    raw: v.optional(v.any()),
    scrapedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_series", ["seriesId"])
    .index("by_occurrence_hash", ["occurrenceHash"])
    .index("by_start_datetime", ["startDatetime"])
    .index("by_start_datetime_utc", ["startDatetimeUtc"])
    .index("by_series_and_sequence", ["seriesId", "sequence"])
    .index("by_scraped_at", ["scrapedAt"])
    .index("by_legacy_id", ["legacyId"]),

  eventsRaw: defineTable({
    legacyId: optionalString,
    sourceId: v.id("sources"),
    runId: v.id("runs"),
    lastUpdatedByRunId: v.optional(v.id("runs")),
    sourceEventId: optionalString,
    sourceEventKey: optionalString,
    title: v.string(),
    descriptionHtml: optionalString,
    startDatetime: v.number(),
    endDatetime: optionalNumber,
    timezone: optionalString,
    venueName: optionalString,
    venueAddress: optionalString,
    city: optionalString,
    region: optionalString,
    country: optionalString,
    lat: optionalNumber,
    lon: optionalNumber,
    organizer: optionalString,
    category: optionalString,
    price: optionalString,
    tags: v.optional(v.array(v.string())),
    url: v.string(),
    imageUrl: optionalString,
    scrapedAt: v.number(),
    lastSeenAt: optionalNumber,
    raw: v.any(),
    contentHash: v.string(),
    seriesId: v.optional(v.id("eventSeries")),
    occurrenceId: v.optional(v.id("eventOccurrences")),
    instagramAccountId: v.optional(v.id("instagramAccounts")),
    instagramPostId: optionalString,
    instagramCaption: optionalString,
    localImagePath: optionalString,
    localImageStorageId: v.optional(v.id("_storage")),
    localImageContentType: optionalString,
    localImageSize: optionalNumber,
    classificationConfidence: optionalNumber,
    isEventPoster: optionalBoolean,
  })
    .index("by_source", ["sourceId"])
    .index("by_run", ["runId"])
    .index("by_source_event_key", ["sourceEventKey"])
    .index("by_start_datetime", ["startDatetime"])
    .index("by_start_city", ["startDatetime", "city"])
    .index("by_content_hash", ["contentHash"])
    .index("by_series", ["seriesId"])
    .index("by_instagram_post", ["instagramPostId"])
    .index("by_legacy_id", ["legacyId"]),

  matches: defineTable({
    legacyId: optionalString,
    rawIdA: v.id("eventsRaw"),
    rawIdB: v.id("eventsRaw"),
    score: v.number(),
    reason: v.any(),
    status: matchStatus,
    createdAt: v.number(),
    createdBy: optionalString,
  })
    .index("by_raw_a", ["rawIdA"])
    .index("by_raw_b", ["rawIdB"])
    .index("by_status", ["status"])
    .index("by_score", ["score"])
    .index("by_legacy_id", ["legacyId"]),

  eventsCanonical: defineTable({
    legacyId: optionalString,
    dedupeKey: optionalString,
    title: v.string(),
    descriptionHtml: optionalString,
    startDatetime: v.number(),
    endDatetime: optionalNumber,
    timezone: optionalString,
    venueName: optionalString,
    venueAddress: optionalString,
    city: optionalString,
    region: optionalString,
    country: optionalString,
    lat: optionalNumber,
    lon: optionalNumber,
    organizer: optionalString,
    category: optionalString,
    price: optionalString,
    tags: v.optional(v.array(v.string())),
    urlPrimary: v.string(),
    imageUrl: optionalString,
    mergedFromRawIds: v.array(v.id("eventsRaw")),
    status: canonicalStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dedupe_key", ["dedupeKey"])
    .index("by_start_datetime", ["startDatetime"])
    .index("by_status", ["status"])
    .index("by_city", ["city"])
    .index("by_legacy_id", ["legacyId"]),

  exports: defineTable({
    legacyId: optionalString,
    format: exportFormat,
    createdAt: v.number(),
    itemCount: v.number(),
    filePath: optionalString,
    fileStorageId: v.optional(v.id("_storage")),
    params: v.any(),
    status: exportStatus,
    errorMessage: optionalString,
    scheduleId: v.optional(v.id("schedules")),
  })
    .index("by_created_at", ["createdAt"])
    .index("by_format", ["format"])
    .index("by_status", ["status"])
    .index("by_schedule", ["scheduleId"])
    .index("by_legacy_id", ["legacyId"]),

  users: defineTable({
    legacyId: optionalString,
    email: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_legacy_id", ["legacyId"]),

  schedules: defineTable({
    legacyId: optionalString,
    scheduleType,
    sourceId: v.optional(v.id("sources")),
    wordpressSettingsId: v.optional(v.id("wordpressSettings")),
    cron: v.string(),
    timezone: v.string(),
    active: v.boolean(),
    repeatKey: optionalString,
    config: v.optional(v.any()),
    lastRunAt: optionalNumber,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_type", ["scheduleType"])
    .index("by_source", ["sourceId"])
    .index("by_wordpress_settings", ["wordpressSettingsId"])
    .index("by_legacy_id", ["legacyId"]),

  wordpressSettings: defineTable({
    legacyId: optionalString,
    name: v.string(),
    siteUrl: v.string(),
    username: v.string(),
    applicationPassword: v.string(),
    active: v.boolean(),
    sourceCategoryMappings: v.any(),
    includeMedia: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_legacy_id", ["legacyId"]),

  systemSettings: defineTable({
    legacyId: optionalString,
    posterImportEnabled: v.boolean(),
    aiProvider: v.optional(aiProvider),
    geminiApiKey: optionalString,
    claudeApiKey: optionalString,
    openrouterApiKey: optionalString,
    openrouterModel: optionalString,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_legacy_id", ["legacyId"]),

  instagramSessions: defineTable({
    legacyId: optionalString,
    username: v.string(),
    sessionData: v.any(),
    uploadedAt: v.number(),
    expiresAt: optionalNumber,
    lastUsedAt: optionalNumber,
    isValid: v.boolean(),
  })
    .index("by_username", ["username"])
    .index("by_valid", ["isValid"])
    .index("by_legacy_id", ["legacyId"]),

  instagramSettings: defineTable({
    legacyId: optionalString,
    apifyApiToken: optionalString,
    geminiApiKey: optionalString,
    claudeApiKey: optionalString,
    aiProvider: v.optional(aiProvider),
    geminiPrompt: optionalString,
    claudePrompt: optionalString,
    apifyActorId: optionalString,
    apifyResultsLimit: optionalNumber,
    fetchDelayMinutes: optionalNumber,
    defaultScraperType: v.optional(instagramScraperType),
    allowPerAccountOverride: optionalBoolean,
    autoExtractNewPosts: optionalBoolean,
    autoClassifyWithAi: optionalBoolean,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_legacy_id", ["legacyId"]),

  instagramAccounts: defineTable({
    legacyId: optionalString,
    name: v.string(),
    instagramUsername: v.string(),
    classificationMode,
    instagramScraperType,
    active: v.boolean(),
    defaultTimezone: v.string(),
    notes: optionalString,
    lastChecked: optionalNumber,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_username", ["instagramUsername"])
    .index("by_active", ["active"])
    .index("by_legacy_id", ["legacyId"]),

  auditLogs: defineTable({
    legacyId: optionalString,
    userId: v.optional(v.id("users")),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    oldValues: v.optional(v.any()),
    newValues: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_created_at", ["createdAt"])
    .index("by_legacy_id", ["legacyId"]),

  jobs: defineTable({
    queue: queueName,
    name: v.string(),
    status: jobStatus,
    payload: v.any(),
    runId: v.optional(v.id("runs")),
    attempts: v.number(),
    maxAttempts: v.number(),
    availableAt: v.number(),
    startedAt: optionalNumber,
    finishedAt: optionalNumber,
    lastError: optionalString,
    result: v.optional(v.any()),
    claimedBy: optionalString,
    cancelRequested: optionalBoolean,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_queue_status_available", ["queue", "status", "availableAt"])
    .index("by_run", ["runId"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  runLogs: defineTable({
    runId: v.id("runs"),
    sequence: v.number(),
    timestamp: v.number(),
    level: v.number(),
    message: v.string(),
    source: v.string(),
    raw: v.optional(v.any()),
  })
    .index("by_run_sequence", ["runId", "sequence"])
    .index("by_run_timestamp", ["runId", "timestamp"]),
});
