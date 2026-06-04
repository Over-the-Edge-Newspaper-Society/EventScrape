import { workerApi } from './convex.js';
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

function toMs(d: Date | string | undefined | null): number | undefined {
  if (d === undefined || d === null) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  const ms = date.getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Persist a scraped event (series + occurrences + events_raw) to Convex in one
 * atomic mutation. Replaces the former saveEventWithOccurrences + saveToEventsRaw
 * Postgres pair. All hashing / occurrence-type detection stays here (pure Node);
 * the Convex mutation owns the index-based upsert + conflict logic.
 */
export async function persistScrapedEvent(
  event: ProcessedEvent,
  sourceId: string,
  runId: string,
): Promise<{ action: 'inserted' | 'updated' | 'unchanged'; seriesId: string }> {
  const occurrenceInfo = detectOccurrenceType(event);
  const contentHash = generateSeriesContentHash(event);

  const seriesDates: SeriesDateInfo[] = event.raw?.seriesDates || [
    { start: event.startDatetime.toISOString(), end: event.endDatetime?.toISOString() },
  ];

  const occurrences = seriesDates.map((dateInfo, i) => {
    const startMs = toMs(dateInfo.start)!;
    const endMs = toMs(dateInfo.end);
    return {
      sequence: i + 1,
      startDatetime: startMs,
      endDatetime: endMs,
      startDatetimeUtc: startMs,
      endDatetimeUtc: endMs,
      durationSeconds:
        endMs !== undefined ? Math.floor((endMs - startMs) / 1000) : undefined,
      timezone: event.timezone,
      hasRecurrence: seriesDates.length > 1,
      raw: dateInfo.rawText ? { rawText: dateInfo.rawText } : undefined,
    };
  });

  return await workerApi.saveScrapedEvent({
    sourceId,
    runId,
    series: {
      sourceEventId: event.sourceEventId || undefined,
      title: event.title,
      descriptionHtml: event.descriptionHtml || undefined,
      occurrenceType: occurrenceInfo.occurrenceType,
      recurrenceType: occurrenceInfo.recurrenceType,
      isAllDay: occurrenceInfo.isAllDay,
      isVirtual: occurrenceInfo.isVirtual,
      virtualUrl: event.raw?.virtualUrl || undefined,
      venueName: event.venueName || undefined,
      venueAddress: event.venueAddress || undefined,
      city: event.city || undefined,
      region: event.region || undefined,
      country: event.country || undefined,
      lat: event.lat ?? undefined,
      lon: event.lon ?? undefined,
      organizer: event.organizer || undefined,
      category: event.category || undefined,
      price: event.price || undefined,
      tags: event.tags ?? undefined,
      urlPrimary: event.url,
      imageUrl: event.imageUrl || undefined,
      raw: event.raw ?? {},
      contentHash,
    },
    occurrences,
    rawEvent: {
      sourceEventId: event.sourceEventId || undefined,
      title: event.title,
      descriptionHtml: event.descriptionHtml || undefined,
      startDatetime: toMs(event.startDatetime)!,
      endDatetime: toMs(event.endDatetime),
      timezone: event.timezone || undefined,
      venueName: event.venueName || undefined,
      venueAddress: event.venueAddress || undefined,
      city: event.city || undefined,
      region: event.region || undefined,
      country: event.country || undefined,
      lat: event.lat ?? undefined,
      lon: event.lon ?? undefined,
      organizer: event.organizer || undefined,
      category: event.category || undefined,
      price: event.price || undefined,
      tags: event.tags ?? undefined,
      url: event.url,
      imageUrl: event.imageUrl || undefined,
      scrapedAt: toMs(event.scrapedAt) ?? Date.now(),
      raw: event.raw ?? {},
      contentHash: event.contentHash,
    },
  });
}
