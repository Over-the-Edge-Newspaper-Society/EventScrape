import { DateTime } from 'luxon';
import { createHash } from 'crypto';
import type { RawEvent, ProcessedEvent } from '../types.js';

export function normalizeEvent(
  event: RawEvent,
  defaultTimezone: string = 'UTC'
): ProcessedEvent {
  // Parse and normalize start datetime
  const startDT = parseDateTime(event.start, defaultTimezone);
  const endDT = event.end ? parseDateTime(event.end, defaultTimezone) : undefined;

  // Generate content hash for deduplication
  const contentHash = generateContentHash(event);

  return {
    ...event,
    startDatetime: startDT.toJSDate(),
    endDatetime: endDT?.toJSDate(),
    timezone: startDT.zoneName || defaultTimezone,
    contentHash,
    scrapedAt: new Date(),
  };
}

function parseDateTime(dateStr: string, defaultTimezone: string): DateTime {
  // Try parsing as ISO first
  let dt = DateTime.fromISO(dateStr);
  
  if (!dt.isValid) {
    // Try common formats
    const formats = [
      'yyyy-MM-dd HH:mm:ss',
      'MM/dd/yyyy HH:mm',
      'dd/MM/yyyy HH:mm',
      'yyyy-MM-dd',
      'MM/dd/yyyy',
      'dd/MM/yyyy',
    ];

    for (const format of formats) {
      dt = DateTime.fromFormat(dateStr, format, { zone: defaultTimezone });
      if (dt.isValid) break;
    }
  }

  if (!dt.isValid) {
    // Fallback: try native Date parsing
    dt = DateTime.fromJSDate(new Date(dateStr), { zone: defaultTimezone });
  }

  if (!dt.isValid) {
    throw new Error(`Could not parse date: ${dateStr}`);
  }

  return dt;
}

function generateContentHash(event: RawEvent): string {
  // Create a stable hash from key event properties
  const hashData = {
    title: normalizeText(event.title),
    start: event.start,
    venue: normalizeText(event.venueName),
    url: event.url,
  };

  const hashString = JSON.stringify(hashData, Object.keys(hashData).sort());
  return createHash('sha256').update(hashString).digest('hex').substring(0, 16);
}

function normalizeText(text?: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove special chars
    .replace(/\s+/g, ' ')     // Collapse whitespace
    .trim();
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function addJitter(baseMs: number, maxJitterPercent: number = 25): number {
  const jitter = Math.random() * (maxJitterPercent / 100) * baseMs;
  return Math.round(baseMs + jitter);
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

// Rate limiting helper
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per ms

  constructor(tokensPerMinute: number) {
    this.capacity = tokensPerMinute;
    this.tokens = tokensPerMinute;
    this.refillRate = tokensPerMinute / (60 * 1000); // tokens per ms
    this.lastRefill = Date.now();
  }

  async waitForToken(): Promise<void> {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until we have a token
    const timeToWait = (1 - this.tokens) / this.refillRate;
    await delay(Math.ceil(timeToWait));
    
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}