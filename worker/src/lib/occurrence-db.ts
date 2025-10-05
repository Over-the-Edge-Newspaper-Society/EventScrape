import { queryClient as db } from './database.js';
import type { ProcessedEvent } from '../types.js';
import crypto from 'crypto';

/**
 * Database service for storing event series and occurrences
 */

export interface SeriesDateInfo {
  start: string;
  end?: string;
  rawText?: string | null;
}

export interface OccurrenceType {
  occurrenceType: 'single' | 'multi_day' | 'all_day' | 'recurring' | 'virtual';
  recurrenceType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  isAllDay: boolean;
  isVirtual: boolean;
}

/**
 * Generate a unique hash for an occurrence to prevent duplicates
 */
export function generateOccurrenceHash(
  seriesId: string,
  startDatetime: Date,
  endDatetime?: Date
): string {
  const hashInput = [
    seriesId,
    startDatetime.toISOString(),
    endDatetime?.toISOString() || '',
  ].join('|');

  return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 32);
}

/**
 * Generate a content hash for series change detection
 */
export function generateSeriesContentHash(event: ProcessedEvent): string {
  const hashInput = [
    event.title,
    event.descriptionHtml || '',
    event.venueName || '',
    event.venueAddress || '',
    event.organizer || '',
    event.category || '',
  ].join('|');

  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Calculate duration in seconds between two dates
 */
export function calculateDuration(start: Date, end?: Date): number | null {
  if (!end) return null;
  return Math.floor((end.getTime() - start.getTime()) / 1000);
}

/**
 * Detect event occurrence type based on event characteristics
 */
export function detectOccurrenceType(event: ProcessedEvent): OccurrenceType {
  const seriesDates = event.raw?.seriesDates as SeriesDateInfo[] | undefined;
  const virtualUrl = event.raw?.virtualUrl as string | undefined;
  const isAllDay = event.raw?.isAllDay as boolean | undefined;

  const result: OccurrenceType = {
    occurrenceType: 'single',
    recurrenceType: 'none',
    isAllDay: isAllDay || false,
    isVirtual: !!virtualUrl,
  };

  // Check if virtual
  if (virtualUrl) {
    result.occurrenceType = 'virtual';
  }

  // Check if all-day
  if (isAllDay) {
    result.occurrenceType = 'all_day';
  }

  // Check if multi-day (spans more than 24 hours)
  if (event.endDatetime && !isAllDay) {
    const durationHours = (event.endDatetime.getTime() - event.startDatetime.getTime()) / (1000 * 60 * 60);
    if (durationHours > 24) {
      result.occurrenceType = 'multi_day';
    }
  }

  // Check if recurring (has series dates)
  if (seriesDates && seriesDates.length > 1) {
    result.occurrenceType = 'recurring';
    result.recurrenceType = detectRecurrencePattern(seriesDates);
  }

  return result;
}

/**
 * Detect recurrence pattern from series dates
 */
export function detectRecurrencePattern(
  seriesDates: SeriesDateInfo[]
): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' {
  if (seriesDates.length < 2) return 'none';

  // Calculate intervals between consecutive dates
  const intervals: number[] = [];
  for (let i = 1; i < seriesDates.length; i++) {
    const prev = new Date(seriesDates[i - 1].start);
    const curr = new Date(seriesDates[i].start);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    intervals.push(diffDays);
  }

  // Check if all intervals are the same
  const allSame = intervals.every(interval => interval === intervals[0]);

  if (!allSame) {
    return 'custom';
  }

  const interval = intervals[0];

  // Detect pattern based on interval
  if (interval === 1) return 'daily';
  if (interval === 7) return 'weekly';
  if (interval >= 28 && interval <= 31) return 'monthly';
  if (interval >= 365 && interval <= 366) return 'yearly';

  return 'custom';
}

/**
 * Save event with series and occurrences to database
 * Returns: { action: 'inserted' | 'updated' | 'unchanged', seriesId: string }
 */
export async function saveEventWithOccurrences(
  event: ProcessedEvent,
  sourceId: string,
  runId: string
): Promise<{ action: 'inserted' | 'updated' | 'unchanged'; seriesId: string }> {
  // Detect occurrence type
  const occurrenceInfo = detectOccurrenceType(event);

  // Generate content hash for change detection
  const contentHash = generateSeriesContentHash(event);

  // Extract series dates from raw metadata
  const seriesDates: SeriesDateInfo[] = event.raw?.seriesDates || [
    { start: event.startDatetime.toISOString(), end: event.endDatetime?.toISOString() }
  ];

  // Step 1: Insert or update series
  const seriesData = {
    source_id: sourceId,
    run_id: runId,
    source_event_id: event.sourceEventId || null,
    title: event.title,
    description_html: event.descriptionHtml || null,
    occurrence_type: occurrenceInfo.occurrenceType,
    event_status: 'scheduled' as const,
    status_reason: null,
    recurrence_type: occurrenceInfo.recurrenceType,
    recurrence_pattern: null, // Could be extracted from RRULE if available
    is_all_day: occurrenceInfo.isAllDay,
    is_virtual: occurrenceInfo.isVirtual,
    virtual_url: event.raw?.virtualUrl || null,
    venue_name: event.venueName || null,
    venue_address: event.venueAddress || null,
    city: event.city || null,
    region: event.region || null,
    country: event.country || null,
    lat: event.lat || null,
    lon: event.lon || null,
    organizer: event.organizer || null,
    category: event.category || null,
    price: event.price || null,
    tags: event.tags ? JSON.stringify(event.tags) : null,
    url_primary: event.url,
    image_url: event.imageUrl || null,
    raw: JSON.stringify(event.raw),
    content_hash: contentHash,
  };

  // Try to insert series (or update if exists)
  let seriesId: string;
  let seriesAction: 'inserted' | 'updated' | 'unchanged' = 'inserted';

  if (event.sourceEventId) {
    // Try insert first
    const insertedSeries = await db`
      INSERT INTO event_series ${db(seriesData)}
      ON CONFLICT (source_id, source_event_id)
      WHERE source_event_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `;

    if (insertedSeries.length > 0) {
      seriesId = insertedSeries[0].id;
      seriesAction = 'inserted';
    } else {
      // Already exists, check if content changed
      const existingSeries = await db`
        SELECT id, content_hash
        FROM event_series
        WHERE source_id = ${sourceId}
          AND source_event_id = ${event.sourceEventId}
      `;

      if (existingSeries.length === 0) {
        throw new Error('Series should exist but was not found');
      }

      seriesId = existingSeries[0].id;

      // Update if content changed
      if (existingSeries[0].content_hash !== contentHash) {
        await db`
          UPDATE event_series
          SET ${db(seriesData, 'title', 'description_html', 'occurrence_type', 'event_status',
            'recurrence_type', 'is_all_day', 'is_virtual', 'virtual_url', 'venue_name',
            'venue_address', 'city', 'region', 'country', 'lat', 'lon', 'organizer',
            'category', 'price', 'tags', 'url_primary', 'image_url', 'raw', 'content_hash')},
            last_updated_by_run_id = ${runId},
            updated_at = NOW()
          WHERE id = ${seriesId}
        `;
        seriesAction = 'updated';
      } else {
        // Update last_updated_by_run_id even if content unchanged
        await db`
          UPDATE event_series
          SET last_updated_by_run_id = ${runId},
              updated_at = NOW()
          WHERE id = ${seriesId}
        `;
        seriesAction = 'unchanged';
      }
    }
  } else {
    // No source_event_id, always insert new series
    const insertedSeries = await db`
      INSERT INTO event_series ${db(seriesData)}
      RETURNING id
    `;
    seriesId = insertedSeries[0].id;
    seriesAction = 'inserted';
  }

  // Step 2: Insert or update occurrences
  for (let i = 0; i < seriesDates.length; i++) {
    const dateInfo = seriesDates[i];
    const startDatetime = new Date(dateInfo.start);
    const endDatetime = dateInfo.end ? new Date(dateInfo.end) : undefined;

    // Convert to UTC for storage
    const startDatetimeUtc = new Date(startDatetime.toISOString());
    const endDatetimeUtc = endDatetime ? new Date(endDatetime.toISOString()) : null;

    const durationSeconds = calculateDuration(startDatetime, endDatetime);
    const occurrenceHash = generateOccurrenceHash(seriesId, startDatetime, endDatetime);

    const occurrenceData = {
      series_id: seriesId,
      occurrence_hash: occurrenceHash,
      sequence: i + 1,
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime?.toISOString() || null,
      start_datetime_utc: startDatetimeUtc.toISOString(),
      end_datetime_utc: endDatetimeUtc?.toISOString() || null,
      duration_seconds: durationSeconds,
      timezone: event.timezone,
      has_recurrence: seriesDates.length > 1,
      is_provisional: false,
      title_override: null,
      description_override: null,
      venue_name_override: null,
      venue_address_override: null,
      event_status_override: null,
      status_reason_override: null,
      raw: dateInfo.rawText ? JSON.stringify({ rawText: dateInfo.rawText }) : null,
    };

    // Insert occurrence (or update last_seen_at if exists)
    await db`
      INSERT INTO event_occurrences ${db(occurrenceData)}
      ON CONFLICT (occurrence_hash) DO UPDATE
      SET last_seen_at = NOW()
    `;
  }

  return { action: seriesAction, seriesId };
}

/**
 * Backward compatibility: Also insert into events_raw with series_id reference
 */
export async function saveToEventsRaw(
  event: ProcessedEvent,
  sourceId: string,
  runId: string,
  seriesId: string,
  occurrenceId?: string
): Promise<void> {
  const eventData = {
    source_id: sourceId,
    run_id: runId,
    source_event_id: event.sourceEventId || null,
    title: event.title,
    description_html: event.descriptionHtml || null,
    start_datetime: event.startDatetime,
    end_datetime: event.endDatetime || null,
    timezone: event.timezone,
    venue_name: event.venueName || null,
    venue_address: event.venueAddress || null,
    city: event.city || null,
    region: event.region || null,
    country: event.country || null,
    lat: event.lat || null,
    lon: event.lon || null,
    organizer: event.organizer || null,
    category: event.category || null,
    price: event.price || null,
    tags: event.tags ? JSON.stringify(event.tags) : null,
    url: event.url,
    image_url: event.imageUrl || null,
    scraped_at: event.scrapedAt,
    raw: JSON.stringify(event.raw),
    content_hash: event.contentHash,
    last_seen_at: new Date(),
    series_id: seriesId,
    occurrence_id: occurrenceId || null,
  };

  if (!event.sourceEventId) {
    // No stable ID, always insert
    await db`INSERT INTO events_raw ${db(eventData)}`;
    return;
  }

  // Try insert with conflict handling
  const inserted = await db`
    INSERT INTO events_raw ${db(eventData)}
    ON CONFLICT (source_id, source_event_id)
    WHERE source_event_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `;

  if (inserted.length === 0) {
    // Already exists, update if content changed
    await db`
      UPDATE events_raw
      SET ${db(eventData, 'title', 'description_html', 'start_datetime', 'end_datetime',
        'timezone', 'venue_name', 'venue_address', 'city', 'region', 'country',
        'lat', 'lon', 'organizer', 'category', 'price', 'tags', 'url', 'image_url',
        'raw', 'content_hash', 'series_id', 'occurrence_id')},
        last_updated_by_run_id = ${runId},
        last_seen_at = NOW()
      WHERE source_id = ${sourceId}
        AND source_event_id = ${event.sourceEventId}
        AND content_hash != ${event.contentHash}
    `;
  }
}
