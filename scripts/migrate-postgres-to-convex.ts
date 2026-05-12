import postgres from "postgres";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

type Row = Record<string, any>;
type IdMap = Map<string, string>;

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://eventscrape:eventscrape_dev@localhost:5432/eventscrape";
const convexUrl = process.env.CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL;

if (!convexUrl) {
  throw new Error("CONVEX_URL or CONVEX_SELF_HOSTED_URL must be set");
}

const sql = postgres(databaseUrl);
const convex = new ConvexHttpClient(convexUrl);

const BATCH_SIZE = Number(process.env.CONVEX_MIGRATION_BATCH_SIZE ?? 50);
const CLEAR_BATCH_SIZE = Number(process.env.CONVEX_MIGRATION_CLEAR_BATCH_SIZE ?? 20);
const CLEAR_TABLES = [
  "auditLogs",
  "matches",
  "eventsCanonical",
  "eventsRaw",
  "eventOccurrences",
  "eventSeries",
  "exports",
  "schedules",
  "jobs",
  "runLogs",
  "runs",
  "instagramSessions",
  "instagramSettings",
  "instagramAccounts",
  "wordpressSettings",
  "systemSettings",
  "users",
  "sources",
];

function ms(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

function clean<T extends Row>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clean(item)) as T;
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const result: Row = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined || nested === null) continue;
      result[key] = clean(nested);
    }
    return result as T;
  }

  return value;
}

function ref(map: IdMap, legacyId: string | null | undefined, label: string): string | undefined {
  if (!legacyId) return undefined;
  const id = map.get(String(legacyId));
  if (!id) {
    throw new Error(`Missing ${label} mapping for legacy id ${legacyId}`);
  }
  return id;
}

function sourceEventKey(sourceId: string, sourceEventId: string | null | undefined) {
  return sourceEventId ? `${sourceId}:${sourceEventId}` : undefined;
}

function tags(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return value.length > 0 ? [value] : undefined;
    }
  }
  return undefined;
}

async function rows(table: string): Promise<Row[]> {
  return await sql.unsafe(`select * from ${table} order by id`);
}

async function insertBatch(table: string, docs: Row[]): Promise<string[]> {
  if (docs.length === 0) return [];
  const ids: string[] = [];
  for (let index = 0; index < docs.length; index += BATCH_SIZE) {
    const chunk = docs.slice(index, index + BATCH_SIZE).map((doc) => clean(doc));
    const inserted = await withWriteRetry(() =>
      convex.mutation(api.migration.insertBatch, {
        table: table as any,
        docs: chunk,
      }),
    );
    ids.push(...inserted);
  }
  return ids;
}

async function patchBatch(table: string, patches: Array<{ id: string; patch: Row }>): Promise<number> {
  let count = 0;
  for (let index = 0; index < patches.length; index += BATCH_SIZE) {
    const chunk = patches.slice(index, index + BATCH_SIZE).map((item) => ({
      id: item.id,
      patch: clean(item.patch),
    }));
    count += await withWriteRetry(() =>
      convex.mutation(api.migration.patchBatch, {
        table: table as any,
        patches: chunk,
      }),
    );
  }
  return count;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withWriteRetry<T>(operation: () => Promise<T>): Promise<T> {
  let delay = 500;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("TooManyWrites") || attempt >= 8) {
        throw error;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 5000);
    }
  }
}

async function clearConvex() {
  const deleted: Record<string, number> = {};
  for (const table of CLEAR_TABLES) {
    deleted[table] = 0;
    for (;;) {
      const count = await convex.mutation(api.migration.clearTable, {
        table: table as any,
        limit: CLEAR_BATCH_SIZE,
      });
      deleted[table] += count;
      if (count === 0) break;
    }
  }
  return deleted;
}

async function countConvexTable(table: string): Promise<number> {
  let cursor: string | null = null;
  let count = 0;
  for (;;) {
    const page = await convex.query(api.migration.countPage, {
      table: table as any,
      paginationOpts: {
        cursor,
        numItems: 100,
      },
    });
    count += page.page.length;
    if (page.isDone) return count;
    cursor = page.continueCursor;
  }
}

async function countConvexTables() {
  const result: Record<string, number> = {};
  for (const table of [...CLEAR_TABLES].reverse()) {
    result[table] = await countConvexTable(table);
  }
  return result;
}

async function importMapped(
  table: string,
  pgTable: string,
  transform: (row: Row) => Row,
): Promise<IdMap> {
  const pgRows = await rows(pgTable);
  const docs = pgRows.map(transform);
  const ids = await insertBatch(table, docs);
  const map = new Map<string, string>();
  pgRows.forEach((row, index) => map.set(String(row.id), ids[index]));
  console.log(`${pgTable} -> ${table}: ${ids.length}`);
  return map;
}

async function importUnmapped(
  table: string,
  pgTable: string,
  transform: (row: Row) => Row,
): Promise<number> {
  const pgRows = await rows(pgTable);
  const ids = await insertBatch(table, pgRows.map(transform));
  console.log(`${pgTable} -> ${table}: ${ids.length}`);
  return ids.length;
}

async function main() {
  console.log(`Migrating Postgres ${databaseUrl.replace(/:[^:@]+@/, ":***@")} -> Convex ${convexUrl}`);
  const cleared = await clearConvex();
  console.log("Cleared Convex tables:", cleared);

  const sourceMap = await importMapped("sources", "sources", (row) => ({
    legacyId: row.id,
    name: row.name,
    baseUrl: row.base_url,
    moduleKey: row.module_key,
    active: row.active,
    defaultTimezone: row.default_timezone ?? "UTC",
    notes: row.notes,
    rateLimitPerMin: row.rate_limit_per_min ?? 60,
    sourceType: row.source_type ?? "website",
    instagramUsername: row.instagram_username,
    classificationMode: row.classification_mode,
    instagramScraperType: row.instagram_scraper_type,
    lastChecked: ms(row.last_checked),
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  const userMap = await importMapped("users", "users", (row) => ({
    legacyId: row.id,
    email: row.email,
    name: row.name,
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  const wordpressSettingsMap = await importMapped("wordpressSettings", "wordpress_settings", (row) => ({
    legacyId: row.id,
    name: row.name,
    siteUrl: row.site_url,
    username: row.username,
    applicationPassword: row.application_password,
    active: row.active,
    sourceCategoryMappings: row.source_category_mappings ?? {},
    includeMedia: row.include_media,
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  await importUnmapped("systemSettings", "system_settings", (row) => ({
    legacyId: row.id,
    posterImportEnabled: row.poster_import_enabled,
    aiProvider: row.ai_provider,
    geminiApiKey: row.gemini_api_key,
    claudeApiKey: row.claude_api_key,
    openrouterApiKey: row.openrouter_api_key,
    openrouterModel: row.openrouter_model,
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  const instagramAccountMap = await importMapped("instagramAccounts", "instagram_accounts", (row) => ({
    legacyId: row.id,
    name: row.name,
    instagramUsername: row.instagram_username,
    classificationMode: row.classification_mode,
    instagramScraperType: row.instagram_scraper_type,
    active: row.active,
    defaultTimezone: row.default_timezone,
    notes: row.notes,
    lastChecked: ms(row.last_checked),
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  await importUnmapped("instagramSettings", "instagram_settings", (row) => ({
    legacyId: row.id,
    apifyApiToken: row.apify_api_token,
    geminiApiKey: row.gemini_api_key,
    claudeApiKey: row.claude_api_key,
    aiProvider: row.ai_provider,
    geminiPrompt: row.gemini_prompt,
    claudePrompt: row.claude_prompt,
    apifyActorId: row.apify_actor_id,
    apifyResultsLimit: row.apify_results_limit,
    fetchDelayMinutes: row.fetch_delay_minutes,
    defaultScraperType: row.default_scraper_type,
    allowPerAccountOverride: row.allow_per_account_override,
    autoExtractNewPosts: row.auto_extract_new_posts,
    autoClassifyWithAi: row.auto_classify_with_ai,
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  await importUnmapped("instagramSessions", "instagram_sessions", (row) => ({
    legacyId: row.id,
    username: row.username,
    sessionData: row.session_data,
    uploadedAt: ms(row.uploaded_at) ?? Date.now(),
    expiresAt: ms(row.expires_at),
    lastUsedAt: ms(row.last_used_at),
    isValid: row.is_valid,
  }));

  const runRows = await rows("runs");
  const runDocs = runRows.map((row) => ({
      legacyId: row.id,
      sourceId: ref(sourceMap, row.source_id, "source"),
      startedAt: ms(row.started_at) ?? Date.now(),
      finishedAt: ms(row.finished_at),
      status: row.status,
      pagesCrawled: row.pages_crawled ?? 0,
      eventsFound: row.events_found ?? 0,
      errors: row.errors_jsonb,
      metadata: row.metadata,
    }));
  const runIds = await insertBatch("runs", runDocs);
  const runMap = new Map<string, string>();
  runRows.forEach((row, index) => runMap.set(String(row.id), runIds[index]));
  const parentPatches = runRows
    .map((row, index) => ({
      id: runIds[index],
      patch: {
        parentRunId: ref(runMap, row.parent_run_id, "parent run"),
      },
    }))
    .filter((item) => item.patch.parentRunId);
  if (parentPatches.length) {
    await patchBatch("runs", parentPatches);
  }
  console.log(`runs -> runs: ${runMap.size}`);

  const scheduleMap = await importMapped("schedules", "schedules", (row) => ({
    legacyId: row.id,
    scheduleType: row.schedule_type,
    sourceId: ref(sourceMap, row.source_id, "source"),
    wordpressSettingsId: ref(wordpressSettingsMap, row.wordpress_settings_id, "wordpress settings"),
    cron: row.cron,
    timezone: row.timezone,
    active: row.active,
    repeatKey: row.repeat_key,
    config: row.config,
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  const exportMap = await importMapped("exports", "exports", (row) => ({
    legacyId: row.id,
    format: row.format,
    createdAt: ms(row.created_at) ?? Date.now(),
    itemCount: row.item_count,
    filePath: row.file_path,
    params: row.params,
    status: row.status,
    errorMessage: row.error_message,
    scheduleId: ref(scheduleMap, row.schedule_id, "schedule"),
  }));
  void exportMap;

  const eventSeriesMap = await importMapped("eventSeries", "event_series", (row) => ({
    legacyId: row.id,
    sourceId: ref(sourceMap, row.source_id, "source"),
    runId: ref(runMap, row.run_id, "run"),
    lastUpdatedByRunId: ref(runMap, row.last_updated_by_run_id, "run"),
    sourceEventId: row.source_event_id,
    sourceEventKey: sourceEventKey(ref(sourceMap, row.source_id, "source")!, row.source_event_id),
    title: row.title,
    descriptionHtml: row.description_html,
    occurrenceType: row.occurrence_type,
    eventStatus: row.event_status,
    statusReason: row.status_reason,
    recurrenceType: row.recurrence_type,
    recurrencePattern: row.recurrence_pattern,
    isAllDay: row.is_all_day,
    isVirtual: row.is_virtual,
    virtualUrl: row.virtual_url,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    region: row.region,
    country: row.country,
    lat: row.lat,
    lon: row.lon,
    organizer: row.organizer,
    category: row.category,
    price: row.price,
    tags: tags(row.tags),
    urlPrimary: row.url_primary,
    imageUrl: row.image_url,
    raw: row.raw ?? {},
    contentHash: row.content_hash,
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  const eventOccurrenceMap = await importMapped("eventOccurrences", "event_occurrences", (row) => ({
    legacyId: row.id,
    seriesId: ref(eventSeriesMap, row.series_id, "event series"),
    occurrenceHash: row.occurrence_hash,
    sequence: row.sequence,
    startDatetime: ms(row.start_datetime) ?? Date.now(),
    endDatetime: ms(row.end_datetime),
    startDatetimeUtc: ms(row.start_datetime_utc) ?? ms(row.start_datetime) ?? Date.now(),
    endDatetimeUtc: ms(row.end_datetime_utc),
    durationSeconds: row.duration_seconds,
    timezone: row.timezone,
    hasRecurrence: row.has_recurrence,
    isProvisional: row.is_provisional,
    titleOverride: row.title_override,
    descriptionOverride: row.description_override,
    venueNameOverride: row.venue_name_override,
    venueAddressOverride: row.venue_address_override,
    eventStatusOverride: row.event_status_override,
    statusReasonOverride: row.status_reason_override,
    raw: row.raw,
    scrapedAt: ms(row.scraped_at) ?? Date.now(),
    lastSeenAt: ms(row.last_seen_at) ?? Date.now(),
  }));

  const eventRawMap = await importMapped("eventsRaw", "events_raw", (row) => ({
    legacyId: row.id,
    sourceId: ref(sourceMap, row.source_id, "source"),
    runId: ref(runMap, row.run_id, "run"),
    lastUpdatedByRunId: ref(runMap, row.last_updated_by_run_id, "run"),
    sourceEventId: row.source_event_id,
    sourceEventKey: sourceEventKey(ref(sourceMap, row.source_id, "source")!, row.source_event_id),
    title: row.title,
    descriptionHtml: row.description_html,
    startDatetime: ms(row.start_datetime) ?? Date.now(),
    endDatetime: ms(row.end_datetime),
    timezone: row.timezone,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    region: row.region,
    country: row.country,
    lat: row.lat,
    lon: row.lon,
    organizer: row.organizer,
    category: row.category,
    price: row.price,
    tags: tags(row.tags),
    url: row.url,
    imageUrl: row.image_url,
    scrapedAt: ms(row.scraped_at) ?? Date.now(),
    lastSeenAt: ms(row.last_seen_at),
    raw: row.raw ?? {},
    contentHash: row.content_hash,
    seriesId: ref(eventSeriesMap, row.series_id, "event series"),
    occurrenceId: ref(eventOccurrenceMap, row.occurrence_id, "event occurrence"),
    instagramAccountId: ref(instagramAccountMap, row.instagram_account_id, "instagram account"),
    instagramPostId: row.instagram_post_id,
    instagramCaption: row.instagram_caption,
    localImagePath: row.local_image_path,
    classificationConfidence: row.classification_confidence,
    isEventPoster: row.is_event_poster,
  }));

  await importUnmapped("eventsCanonical", "events_canonical", (row) => ({
    legacyId: row.id,
    dedupeKey: row.dedupe_key,
    title: row.title,
    descriptionHtml: row.description_html,
    startDatetime: ms(row.start_datetime) ?? Date.now(),
    endDatetime: ms(row.end_datetime),
    timezone: row.timezone,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    city: row.city,
    region: row.region,
    country: row.country,
    lat: row.lat,
    lon: row.lon,
    organizer: row.organizer,
    category: row.category,
    price: row.price,
    tags: tags(row.tags),
    urlPrimary: row.url_primary,
    imageUrl: row.image_url,
    mergedFromRawIds: (row.merged_from_raw_ids ?? []).map((id: string) => ref(eventRawMap, id, "raw event")),
    status: row.status,
    createdAt: ms(row.created_at) ?? Date.now(),
    updatedAt: ms(row.updated_at) ?? Date.now(),
  }));

  await importUnmapped("matches", "matches", (row) => ({
    legacyId: row.id,
    rawIdA: ref(eventRawMap, row.raw_id_a, "raw event"),
    rawIdB: ref(eventRawMap, row.raw_id_b, "raw event"),
    score: row.score,
    reason: row.reason,
    status: row.status,
    createdAt: ms(row.created_at) ?? Date.now(),
    createdBy: row.created_by,
  }));

  await importUnmapped("auditLogs", "audit_logs", (row) => ({
    legacyId: row.id,
    userId: ref(userMap, row.user_id, "user"),
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValues: row.old_values,
    newValues: row.new_values,
    createdAt: ms(row.created_at) ?? Date.now(),
  }));

  const counts = await countConvexTables();
  console.log("Convex counts:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
