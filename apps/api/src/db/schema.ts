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
]);

export const exportFormatEnum = pgEnum('export_format', [
  'csv',
  'json',
  'ics',
  'wp-rest',
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
}, (table) => ({
  sourceEventIdIdx: uniqueIndex('events_raw_source_event_id_idx')
    .on(table.sourceId, table.sourceEventId)
    .where(sql`${table.sourceEventId} IS NOT NULL`),
  startDatetimeCityIdx: index('events_raw_start_datetime_city_idx')
    .on(table.startDatetime, table.city),
  rawGinIdx: index('events_raw_raw_gin_idx').on(table.raw),
  contentHashIdx: index('events_raw_content_hash_idx').on(table.contentHash),
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
