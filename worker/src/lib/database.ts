// Shared worker types (formerly co-located with the postgres-js client).
interface Source {
  id: string;
  name: string;
  baseUrl: string;
  moduleKey: string;
  active: boolean;
  defaultTimezone: string;
  rateLimitPerMin: number;
}

interface Run {
  id: string;
  sourceId: string;
  startedAt: Date;
  finishedAt?: Date;
  status: 'queued' | 'running' | 'success' | 'partial' | 'error';
  pagesCrawled: number;
  eventsFound: number;
  errorsJsonb?: any;
}

interface EventRaw {
  id: string;
  sourceId: string;
  runId: string;
  sourceEventId?: string;
  title: string;
  descriptionHtml?: string;
  startDatetime: Date;
  endDatetime?: Date;
  timezone?: string;
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
  tags?: string[];
  url: string;
  imageUrl?: string;
  scrapedAt: Date;
  raw: any;
  contentHash: string;
}

// NOTE: Postgres has been retired. This module now only exports shared types
// used by the matcher and job handlers. All data access goes through Convex
// (see ./convex.ts). The `id` fields are Convex document ids (strings).

export type { Source, Run, EventRaw };