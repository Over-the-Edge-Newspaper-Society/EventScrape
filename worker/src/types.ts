import { Browser, Page } from 'playwright';

export interface RawEvent {
  sourceEventId?: string;
  title: string;
  descriptionHtml?: string;
  start: string; // ISO or site-local with tz hint
  end?: string;  // ISO or site-local with tz hint
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
  raw: unknown; // original snippet
}

export interface RunContext {
  browser: Browser;
  page: Page;
  sourceId: string;
  runId: string;
  source: {
    id: string;
    name: string;
    baseUrl: string;
    moduleKey: string;
    defaultTimezone: string;
    rateLimitPerMin: number;
  };
  logger: any; // pino logger
  jobData?: {
    testMode?: boolean;
  };
}

export interface ScraperModule {
  key: string;               // e.g. "example_com"
  label: string;             // Human-friendly
  startUrls: string[];       // entry points
  run(ctx: RunContext): Promise<RawEvent[]>; // uses Playwright page/browser
}

export interface ProcessedEvent extends RawEvent {
  startDatetime: Date;
  endDatetime?: Date;
  timezone: string;
  contentHash: string;
  scrapedAt: Date;
}

// Job data types for BullMQ
export interface ScrapeJobData {
  sourceId: string;
  runId: string;
  testMode?: boolean;
}

export interface MatchJobData {
  startDate?: string;
  endDate?: string;
  sourceIds?: string[];
}

// Matching types
export interface SimilarityFeatures {
  titleSimilarity: number;
  timeDelta: number; // minutes
  venueDistance?: number; // km
  organizerSimilarity: number;
}

export interface PotentialMatch {
  eventA: string; // event ID
  eventB: string; // event ID
  score: number;
  features: SimilarityFeatures;
  reason: string;
}