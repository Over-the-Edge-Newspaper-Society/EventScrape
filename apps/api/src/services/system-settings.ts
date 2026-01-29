import { eq, sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { systemSettings, eventsRaw, eventSeries, sources, type SystemSettings } from '../db/schema.js'

export const SYSTEM_SETTINGS_ID = '00000000-0000-0000-0000-000000000100'

export type SystemSettingsUpdate = Partial<
  Pick<SystemSettings, 'posterImportEnabled' | 'aiProvider' | 'geminiApiKey' | 'claudeApiKey' | 'openrouterApiKey' | 'openrouterModel'>
>

export async function ensureSystemSettings(): Promise<SystemSettings> {
  const [settings] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
    .limit(1)

  if (settings) {
    return settings
  }

  const [created] = await db
    .insert(systemSettings)
    .values({ id: SYSTEM_SETTINGS_ID })
    .returning()

  return created
}

export async function updateSystemSettings(updates: SystemSettingsUpdate): Promise<SystemSettings> {
  const settings = await ensureSystemSettings()

  if (Object.keys(updates).length === 0) {
    return settings
  }

  const [updated] = await db
    .update(systemSettings)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(systemSettings.id, settings.id))
    .returning()

  return updated
}

export interface CleanupDuplicatesResult {
  eventsRawDeleted: number
  eventSeriesDeleted: number
  duplicatesFound: Array<{
    url: string
    title: string
    count: number
  }>
}

/**
 * Find and remove duplicate events from the UNBC source (or any specified source).
 * Keeps the most recently created event and deletes older duplicates.
 */
export async function cleanupDuplicateEvents(sourceKey?: string): Promise<CleanupDuplicatesResult> {
  // Find duplicates in events_raw table
  // Group by URL (which is now the sourceEventId for UNBC events)
  const duplicatesQuery = sql`
    WITH duplicates AS (
      SELECT
        er.url,
        er.title,
        er.source_id,
        COUNT(*) as duplicate_count
      FROM events_raw er
      JOIN sources s ON er.source_id = s.id
      WHERE ${sourceKey ? sql`s.module_key = ${sourceKey}` : sql`1=1`}
      GROUP BY er.url, er.title, er.source_id
      HAVING COUNT(*) > 1
    )
    SELECT url, title, duplicate_count::int as count FROM duplicates
    ORDER BY duplicate_count DESC
    LIMIT 100
  `

  const duplicatesResult = await db.execute(duplicatesQuery)
  const duplicatesFound = (duplicatesResult.rows as any[]).map(row => ({
    url: row.url,
    title: row.title,
    count: row.count,
  }))

  // Delete older duplicates from events_raw, keeping the most recent by created_at
  const deleteEventsRawQuery = sql`
    DELETE FROM events_raw
    WHERE id IN (
      SELECT id FROM (
        SELECT
          er.id,
          ROW_NUMBER() OVER (
            PARTITION BY er.url, er.source_id
            ORDER BY er.created_at DESC
          ) as rn
        FROM events_raw er
        JOIN sources s ON er.source_id = s.id
        WHERE ${sourceKey ? sql`s.module_key = ${sourceKey}` : sql`1=1`}
      ) ranked
      WHERE rn > 1
    )
  `

  const eventsRawResult = await db.execute(deleteEventsRawQuery)
  const eventsRawDeleted = eventsRawResult.rowCount ?? 0

  // Delete older duplicates from event_series, keeping the most recent
  const deleteEventSeriesQuery = sql`
    DELETE FROM event_series
    WHERE id IN (
      SELECT id FROM (
        SELECT
          es.id,
          ROW_NUMBER() OVER (
            PARTITION BY es.url_primary, es.source_id
            ORDER BY es.created_at DESC
          ) as rn
        FROM event_series es
        JOIN sources s ON es.source_id = s.id
        WHERE ${sourceKey ? sql`s.module_key = ${sourceKey}` : sql`1=1`}
      ) ranked
      WHERE rn > 1
    )
  `

  const eventSeriesResult = await db.execute(deleteEventSeriesQuery)
  const eventSeriesDeleted = eventSeriesResult.rowCount ?? 0

  return {
    eventsRawDeleted,
    eventSeriesDeleted,
    duplicatesFound,
  }
}
