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
  raw: any; // original snippet (arbitrary scraped JSON)
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
    uploadedFile?: {
      path: string;
      format: 'csv' | 'json' | 'xlsx';
      content?: string;
    };
    scrapeMode?: 'full' | 'incremental';
    paginationOptions?: {
      type: 'page' | 'calendar';
      scrapeAllPages?: boolean;
      maxPages?: number;
      startDate?: string;
      endDate?: string;
    };
    sourceId?: string;
    runId?: string;
  };
  stats?: {
    pagesCrawled: number;
  };
}

export interface ScraperModule {
  key: string;               // e.g. "example_com"
  label: string;             // Human-friendly
  startUrls: string[];       // entry points
  mode?: 'scrape' | 'upload' | 'hybrid'; // Default: 'scrape'
  paginationType?: 'page' | 'calendar' | 'none'; // Type of pagination support
  integrationTags?: ('calendar' | 'csv' | 'page-navigation' | 'api' | 'rss')[]; // Integration method tags
  uploadConfig?: {
    supportedFormats: ('csv' | 'json' | 'xlsx')[];
    instructions?: string;    // Instructions for manual download
    downloadUrl?: string;      // Direct link to download page
  };
  run(ctx: RunContext): Promise<RawEvent[]>; // uses Playwright page/browser
  processUpload?(content: string, format: 'csv' | 'json' | 'xlsx', logger: any): Promise<RawEvent[]>;
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
  scrapeMode?: 'full' | 'incremental';
  paginationOptions?: {
    type: 'page' | 'calendar';
    scrapeAllPages?: boolean;
    maxPages?: number;
    startDate?: string;
    endDate?: string;
  };
}

export interface MatchJobData {
  // Epoch-ms window (Convex stores timestamps as numbers).
  startMs?: number;
  endMs?: number;
  sourceIds?: string[];
}

/**
 * BullMQ-compatible job shim handed to job handlers after the Convex migration.
 * `log` writes to Convex runLogs; `updateProgress` is a noop placeholder.
 */
export interface JobShim<T = any> {
  id: string;
  data: T;
  runId?: string;
  log: (msg: string) => void;
  updateProgress: (progress: unknown) => Promise<void>;
}

// Matching types
export interface SimilarityFeatures {
  titleSimilarity: number;
  timeDelta: number; // minutes
  venueDistance?: number; // km
  organizerSimilarity: number;
  citySimilarity?: number; // for same-time analysis
  categoryMatch?: number; // for same-time analysis
}

export interface PotentialMatch {
  eventA: string; // event ID
  eventB: string; // event ID
  score: number;
  features: SimilarityFeatures;
  reason: string;
}