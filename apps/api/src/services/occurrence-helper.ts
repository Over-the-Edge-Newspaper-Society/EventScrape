import crypto from 'crypto';
import { NewEventSeries, NewEventOccurrence } from '../db/schema.js';

/**
 * Helper utilities for working with event series and occurrences
 */

export interface SeriesDateInfo {
  start: string | Date;
  end?: string | Date;
}

export interface OccurrenceTypeDetection {
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
export function generateSeriesContentHash(series: Partial<NewEventSeries>): string {
  const hashInput = [
    series.title,
    series.descriptionHtml || '',
    series.venueName || '',
    series.venueAddress || '',
    series.organizer || '',
    series.category || '',
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
 * Convert local datetime to UTC
 */
export function convertToUtc(datetime: Date, timezone: string): Date {
  // For now, we'll use the datetime as-is since it should already be in the correct timezone
  // In a production system, you'd want to use a library like date-fns-tz or luxon
  return new Date(datetime.toISOString());
}

/**
 * Detect event occurrence type based on event characteristics
 */
export function detectOccurrenceType(
  startDatetime: Date,
  endDatetime?: Date,
  seriesDates?: SeriesDateInfo[],
  virtualUrl?: string,
  isAllDay?: boolean
): OccurrenceTypeDetection {
  const result: OccurrenceTypeDetection = {
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
  if (endDatetime && !isAllDay) {
    const durationHours = (endDatetime.getTime() - startDatetime.getTime()) / (1000 * 60 * 60);
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
 * Create event series and occurrences from scraped event data
 */
export function createSeriesAndOccurrences(
  rawEvent: {
    sourceId: string;
    runId: string;
    sourceEventId?: string;
    title: string;
    descriptionHtml?: string;
    startDatetime: Date;
    endDatetime?: Date;
    timezone: string;
    venueName?: string;
    venueAddress?: string;
    city?: string;
    region?: string;
    country?: string;
    lat?: number;
    lon?: number;
    organizer?: string;
    category?: string;
    price?: string;
    tags?: any;
    url: string;
    imageUrl?: string;
    raw: any;
  }
): {
  series: Partial<NewEventSeries>;
  occurrences: Partial<NewEventOccurrence>[];
} {
  // Extract series dates if available
  const seriesDates: SeriesDateInfo[] = rawEvent.raw?.seriesDates || [
    { start: rawEvent.startDatetime, end: rawEvent.endDatetime }
  ];

  // Detect occurrence type
  const detection = detectOccurrenceType(
    rawEvent.startDatetime,
    rawEvent.endDatetime,
    seriesDates,
    rawEvent.raw?.virtualUrl,
    rawEvent.raw?.isAllDay
  );

  // Generate content hash
  const contentHash = generateSeriesContentHash({
    title: rawEvent.title,
    descriptionHtml: rawEvent.descriptionHtml,
    venueName: rawEvent.venueName,
    venueAddress: rawEvent.venueAddress,
    organizer: rawEvent.organizer,
    category: rawEvent.category,
  });

  // Create series
  const series: Partial<NewEventSeries> = {
    sourceId: rawEvent.sourceId,
    runId: rawEvent.runId,
    sourceEventId: rawEvent.sourceEventId,
    title: rawEvent.title,
    descriptionHtml: rawEvent.descriptionHtml,
    occurrenceType: detection.occurrenceType,
    eventStatus: 'scheduled',
    recurrenceType: detection.recurrenceType,
    isAllDay: detection.isAllDay,
    isVirtual: detection.isVirtual,
    virtualUrl: rawEvent.raw?.virtualUrl,
    venueName: rawEvent.venueName,
    venueAddress: rawEvent.venueAddress,
    city: rawEvent.city,
    region: rawEvent.region,
    country: rawEvent.country,
    lat: rawEvent.lat,
    lon: rawEvent.lon,
    organizer: rawEvent.organizer,
    category: rawEvent.category,
    price: rawEvent.price,
    tags: rawEvent.tags,
    urlPrimary: rawEvent.url,
    imageUrl: rawEvent.imageUrl,
    raw: rawEvent.raw,
    contentHash,
  };

  // Note: We can't generate occurrences yet because we need the series.id
  // This will be done in a two-step process in the database service
  return { series, occurrences: [] };
}

/**
 * Create occurrence records for a series
 * This should be called after the series is inserted and we have the series.id
 */
export function createOccurrencesForSeries(
  seriesId: string,
  seriesDates: SeriesDateInfo[],
  timezone: string,
  hasRecurrence: boolean
): Partial<NewEventOccurrence>[] {
  return seriesDates.map((dateInfo, index) => {
    const startDatetime = new Date(dateInfo.start);
    const endDatetime = dateInfo.end ? new Date(dateInfo.end) : undefined;
    const startDatetimeUtc = convertToUtc(startDatetime, timezone);
    const endDatetimeUtc = endDatetime ? convertToUtc(endDatetime, timezone) : undefined;
    const durationSeconds = calculateDuration(startDatetime, endDatetime);
    const occurrenceHash = generateOccurrenceHash(seriesId, startDatetime, endDatetime);

    return {
      seriesId,
      occurrenceHash,
      sequence: index + 1,
      startDatetime,
      endDatetime,
      startDatetimeUtc,
      endDatetimeUtc,
      durationSeconds,
      timezone,
      hasRecurrence,
      isProvisional: false,
      raw: dateInfo,
    };
  });
}
