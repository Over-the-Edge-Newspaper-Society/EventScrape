import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  doublePrecision,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enums
export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'success',
  'partial',
  'error',
]);

export const matchStatusEnum = pgEnum('match_status', [
  'open',
  'confirmed',
  'rejected',
]);

export const scheduleTypeEnum = pgEnum('schedule_type', [
  'scrape',
  'wordpress_export',
]);

export const canonicalStatusEnum = pgEnum('canonical_status', [
  'new',
  'ready',
  'exported',
  'ignored',
]);

export const exportStatusEnum = pgEnum('export_status', [
  'success',
  'error',
  'processing',
]);

export const exportFormatEnum = pgEnum('export_format', [
  'csv',
  'json',
  'ics',
  'wp-rest',
]);

// New enums for event occurrences
export const occurrenceTypeEnum = pgEnum('occurrence_type', [
  'single',
  'multi_day',
  'all_day',
  'recurring',
  'virtual',
]);

export const recurrenceTypeEnum = pgEnum('recurrence_type', [
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'custom',
]);

export const eventStatusTypeEnum = pgEnum('event_status_type', [
  'scheduled',
  'canceled',
  'postponed',
]);

// Source type enum
export const sourceTypeEnum = pgEnum('source_type', [
  'website',
  'instagram',
]);

export const classificationModeEnum = pgEnum('classification_mode', [
  'manual',
  'auto',
]);

export const instagramScraperTypeEnum = pgEnum('instagram_scraper_type', [
  'apify',
  'instagram-private-api',
]);

// Tables
export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  moduleKey: text('module_key').notNull().unique(),
  active: boolean('active').notNull().default(true),
  defaultTimezone: text('default_timezone').default('UTC'),
  notes: text('notes'),
  rateLimitPerMin: integer('rate_limit_per_min').default(60),

  // Instagram-specific fields
  sourceType: sourceTypeEnum('source_type').notNull().default('website'),
  instagramUsername: text('instagram_username'),
  classificationMode: classificationModeEnum('classification_mode').default('manual'),
  instagramScraperType: instagramScraperTypeEnum('instagram_scraper_type').default('instagram-private-api'),
  lastChecked: timestamp('last_checked'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  instagramUsernameIdx: index('sources_instagram_username_idx').on(table.instagramUsername),
}));

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
  status: runStatusEnum('status').notNull().default('queued'),
  pagesCrawled: integer('pages_crawled').default(0),
  eventsFound: integer('events_found').default(0),
  errorsJsonb: jsonb('errors_jsonb'),
}, (table) => ({
  sourceIdIdx: index('runs_source_id_idx').on(table.sourceId),
  startedAtIdx: index('runs_started_at_idx').on(table.startedAt),
}));

export const eventsRaw = pgTable('events_raw', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id),
  runId: uuid('run_id').notNull().references(() => runs.id),
  lastUpdatedByRunId: uuid('last_updated_by_run_id').references(() => runs.id),
  sourceEventId: text('source_event_id'),
  title: text('title').notNull(),
  descriptionHtml: text('description_html'),
  startDatetime: timestamp('start_datetime', { withTimezone: true }).notNull(),
  endDatetime: timestamp('end_datetime', { withTimezone: true }),
  timezone: text('timezone'),
  venueName: text('venue_name'),
  venueAddress: text('venue_address'),
  city: text('city'),
  region: text('region'),
  country: text('country'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  organizer: text('organizer'),
  category: text('category'),
  price: text('price'),
  tags: jsonb('tags'),
  url: text('url').notNull(),
  imageUrl: text('image_url'),
  scrapedAt: timestamp('scraped_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  raw: jsonb('raw').notNull(),
  contentHash: text('content_hash').notNull(),
  // New fields for backwards compatibility with new occurrence system
  seriesId: uuid('series_id').references(() => eventSeries.id),
  occurrenceId: uuid('occurrence_id').references(() => eventOccurrences.id),

  // Instagram-specific fields
  instagramPostId: text('instagram_post_id'),
  instagramCaption: text('instagram_caption'),
  localImagePath: text('local_image_path'),
  classificationConfidence: doublePrecision('classification_confidence'),
  isEventPoster: boolean('is_event_poster'),
}, (table) => ({
  sourceEventIdIdx: uniqueIndex('events_raw_source_event_id_idx')
    .on(table.sourceId, table.sourceEventId)
    .where(sql`${table.sourceEventId} IS NOT NULL`),
  startDatetimeCityIdx: index('events_raw_start_datetime_city_idx')
    .on(table.startDatetime, table.city),
  rawGinIdx: index('events_raw_raw_gin_idx').on(table.raw),
  contentHashIdx: index('events_raw_content_hash_idx').on(table.contentHash),
  seriesIdIdx: index('events_raw_series_id_idx').on(table.seriesId),
  occurrenceIdIdx: index('events_raw_occurrence_id_idx').on(table.occurrenceId),
  instagramPostIdIdx: index('events_raw_instagram_post_id_idx').on(table.instagramPostId),
}));

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  rawIdA: uuid('raw_id_a').notNull().references(() => eventsRaw.id),
  rawIdB: uuid('raw_id_b').notNull().references(() => eventsRaw.id),
  score: doublePrecision('score').notNull(),
  reason: jsonb('reason').notNull(),
  status: matchStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),
}, (table) => ({
  rawIdAIdx: index('matches_raw_id_a_idx').on(table.rawIdA),
  rawIdBIdx: index('matches_raw_id_b_idx').on(table.rawIdB),
  statusIdx: index('matches_status_idx').on(table.status),
  scoreIdx: index('matches_score_idx').on(table.score),
}));

export const eventsCanonical = pgTable('events_canonical', {
  id: uuid('id').primaryKey().defaultRandom(),
  dedupeKey: text('dedupe_key'),
  title: text('title').notNull(),
  descriptionHtml: text('description_html'),
  startDatetime: timestamp('start_datetime', { withTimezone: true }).notNull(),
  endDatetime: timestamp('end_datetime', { withTimezone: true }),
  timezone: text('timezone'),
  venueName: text('venue_name'),
  venueAddress: text('venue_address'),
  city: text('city'),
  region: text('region'),
  country: text('country'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  organizer: text('organizer'),
  category: text('category'),
  price: text('price'),
  tags: jsonb('tags'),
  urlPrimary: text('url_primary').notNull(),
  imageUrl: text('image_url'),
  mergedFromRawIds: jsonb('merged_from_raw_ids').notNull(),
  status: canonicalStatusEnum('status').notNull().default('new'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  dedupeKeyIdx: uniqueIndex('events_canonical_dedupe_key_idx')
    .on(table.dedupeKey)
    .where(sql`${table.dedupeKey} IS NOT NULL`),
  startDatetimeIdx: index('events_canonical_start_datetime_idx').on(table.startDatetime),
  statusIdx: index('events_canonical_status_idx').on(table.status),
  cityIdx: index('events_canonical_city_idx').on(table.city),
}));

export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  format: exportFormatEnum('format').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  itemCount: integer('item_count').notNull(),
  filePath: text('file_path'),
  params: jsonb('params').notNull(),
  status: exportStatusEnum('status').notNull(),
  errorMessage: text('error_message'),
  scheduleId: uuid('schedule_id').references(() => schedules.id),
}, (table) => ({
  createdAtIdx: index('exports_created_at_idx').on(table.createdAt),
  formatIdx: index('exports_format_idx').on(table.format),
  statusIdx: index('exports_status_idx').on(table.status),
  scheduleIdIdx: index('exports_schedule_id_idx').on(table.scheduleId),
}));

// Optional: Users table for future auth
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Automated run schedules
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleType: scheduleTypeEnum('schedule_type').notNull().default('scrape'),
  sourceId: uuid('source_id').references(() => sources.id),
  wordpressSettingsId: uuid('wordpress_settings_id').references(() => wordpressSettings.id),
  cron: text('cron').notNull(),
  timezone: text('timezone').notNull().default('America/Vancouver'),
  active: boolean('active').notNull().default(true),
  repeatKey: text('repeat_key'),
  config: jsonb('config'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// WordPress integration settings
export const wordpressSettings = pgTable('wordpress_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  siteUrl: text('site_url').notNull(),
  username: text('username').notNull(),
  applicationPassword: text('application_password').notNull(),
  active: boolean('active').notNull().default(true),
  sourceCategoryMappings: jsonb('source_category_mappings').notNull().default('{}'),
  includeMedia: boolean('include_media').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Event Series table (parent/master events)
export const eventSeries = pgTable('event_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id),
  runId: uuid('run_id').notNull().references(() => runs.id),
  lastUpdatedByRunId: uuid('last_updated_by_run_id').references(() => runs.id),

  // Source identification
  sourceEventId: text('source_event_id'),

  // Basic event info
  title: text('title').notNull(),
  descriptionHtml: text('description_html'),

  // Event classification
  occurrenceType: occurrenceTypeEnum('occurrence_type').notNull().default('single'),
  eventStatus: eventStatusTypeEnum('event_status').notNull().default('scheduled'),
  statusReason: text('status_reason'),

  // Recurrence info
  recurrenceType: recurrenceTypeEnum('recurrence_type').notNull().default('none'),
  recurrencePattern: text('recurrence_pattern'),

  // All-day flag
  isAllDay: boolean('is_all_day').notNull().default(false),

  // Virtual event info
  isVirtual: boolean('is_virtual').notNull().default(false),
  virtualUrl: text('virtual_url'),

  // Location info
  venueName: text('venue_name'),
  venueAddress: text('venue_address'),
  city: text('city'),
  region: text('region'),
  country: text('country'),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),

  // Organization info
  organizer: text('organizer'),
  category: text('category'),
  price: text('price'),
  tags: jsonb('tags'),

  // URLs
  urlPrimary: text('url_primary').notNull(),
  imageUrl: text('image_url'),

  // Metadata
  raw: jsonb('raw').notNull(),
  contentHash: text('content_hash').notNull(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sourceEventIdIdx: uniqueIndex('event_series_source_event_id_idx')
    .on(table.sourceId, table.sourceEventId)
    .where(sql`${table.sourceEventId} IS NOT NULL`),
  sourceIdIdx: index('event_series_source_id_idx').on(table.sourceId),
  runIdIdx: index('event_series_run_id_idx').on(table.runId),
  occurrenceTypeIdx: index('event_series_occurrence_type_idx').on(table.occurrenceType),
  recurrenceTypeIdx: index('event_series_recurrence_type_idx').on(table.recurrenceType),
  eventStatusIdx: index('event_series_event_status_idx').on(table.eventStatus),
  isVirtualIdx: index('event_series_is_virtual_idx').on(table.isVirtual),
  cityIdx: index('event_series_city_idx').on(table.city),
  contentHashIdx: index('event_series_content_hash_idx').on(table.contentHash),
  createdAtIdx: index('event_series_created_at_idx').on(table.createdAt),
}));

// Event Occurrences table (individual instances)
export const eventOccurrences = pgTable('event_occurrences', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Series relationship
  seriesId: uuid('series_id').notNull().references(() => eventSeries.id),

  // Occurrence identification
  occurrenceHash: text('occurrence_hash').notNull().unique(),
  sequence: integer('sequence').notNull().default(1),

  // Date/time info (local timezone)
  startDatetime: timestamp('start_datetime', { withTimezone: true }).notNull(),
  endDatetime: timestamp('end_datetime', { withTimezone: true }),

  // Date/time info (UTC)
  startDatetimeUtc: timestamp('start_datetime_utc', { withTimezone: true }).notNull(),
  endDatetimeUtc: timestamp('end_datetime_utc', { withTimezone: true }),

  // Duration
  durationSeconds: integer('duration_seconds'),

  // Timezone
  timezone: text('timezone').notNull(),

  // Recurrence metadata
  hasRecurrence: boolean('has_recurrence').notNull().default(false),
  isProvisional: boolean('is_provisional').notNull().default(false),

  // Override fields (can override series defaults)
  titleOverride: text('title_override'),
  descriptionOverride: text('description_override'),
  venueNameOverride: text('venue_name_override'),
  venueAddressOverride: text('venue_address_override'),
  eventStatusOverride: eventStatusTypeEnum('event_status_override'),
  statusReasonOverride: text('status_reason_override'),

  // Source-specific metadata
  raw: jsonb('raw'),

  // Tracking
  scrapedAt: timestamp('scraped_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  seriesIdIdx: index('event_occurrences_series_id_idx').on(table.seriesId),
  startDatetimeIdx: index('event_occurrences_start_datetime_idx').on(table.startDatetime),
  startDatetimeUtcIdx: index('event_occurrences_start_datetime_utc_idx').on(table.startDatetimeUtc),
  sequenceIdx: index('event_occurrences_sequence_idx').on(table.sequence),
  timezoneIdx: index('event_occurrences_timezone_idx').on(table.timezone),
  scrapedAtIdx: index('event_occurrences_scraped_at_idx').on(table.scrapedAt),
  seriesSequenceIdx: index('event_occurrences_series_sequence_idx').on(table.seriesId, table.sequence),
  startCityIdx: index('event_occurrences_start_city_idx').on(table.startDatetimeUtc, table.seriesId),
}));

// Instagram sessions table
export const instagramSessions = pgTable('instagram_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  sessionData: jsonb('session_data').notNull(), // Encrypted Instagram session cookies
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  lastUsedAt: timestamp('last_used_at'),
  isValid: boolean('is_valid').notNull().default(true),
}, (table) => ({
  usernameIdx: uniqueIndex('instagram_sessions_username_idx').on(table.username),
}));

// Instagram settings table (global configuration)
export const instagramSettings = pgTable('instagram_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  // API keys (encrypted)
  apifyApiToken: text('apify_api_token'),
  geminiApiKey: text('gemini_api_key'),
  // Scraping configuration
  apifyActorId: text('apify_actor_id').default('apify/instagram-profile-scraper'),
  apifyResultsLimit: integer('apify_results_limit').default(10),
  fetchDelayMinutes: integer('fetch_delay_minutes').default(5),
  // Automation settings
  autoExtractNewPosts: boolean('auto_extract_new_posts').default(false),
  // Created/Updated
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Optional: Audit logs
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
  entityIdx: index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
}));

// Types for TypeScript
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type EventRaw = typeof eventsRaw.$inferSelect;
export type NewEventRaw = typeof eventsRaw.$inferInsert;

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;

export type EventCanonical = typeof eventsCanonical.$inferSelect;
export type NewEventCanonical = typeof eventsCanonical.$inferInsert;

export type Export = typeof exports.$inferSelect;
export type NewExport = typeof exports.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type WordpressSettings = typeof wordpressSettings.$inferSelect;
export type NewWordpressSettings = typeof wordpressSettings.$inferInsert;

export type EventSeries = typeof eventSeries.$inferSelect;
export type NewEventSeries = typeof eventSeries.$inferInsert;

export type EventOccurrence = typeof eventOccurrences.$inferSelect;
export type NewEventOccurrence = typeof eventOccurrences.$inferInsert;

export type InstagramSession = typeof instagramSessions.$inferSelect;
export type NewInstagramSession = typeof instagramSessions.$inferInsert;

export type InstagramSettings = typeof instagramSettings.$inferSelect;
export type NewInstagramSettings = typeof instagramSettings.$inferInsert;
