import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

// Import schema from API package (shared)
// For now, we'll replicate the essential types
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

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const queryClient = postgres(connectionString);
const db = drizzle(queryClient);

export { db, queryClient };
export type { Source, Run, EventRaw };