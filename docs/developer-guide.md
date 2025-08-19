# EventScrape Developer Guide

## Overview

EventScrape is a modular event scraping system built with TypeScript, Playwright, and React. It consists of three main components:

- **Worker**: Scraping engine with pluggable modules
- **API**: REST API backend with job queue management  
- **Admin**: React frontend for monitoring and management

## Table of Contents

- [System Architecture](#system-architecture)
- [Module Development](#module-development)
- [Integration Tags System](#integration-tags-system)
- [Testing and Debugging](#testing-and-debugging)
- [Best Practices](#best-practices)
- [API Integration](#api-integration)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)

## System Architecture

### Components Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Admin UI    │────│   API Server    │────│     Worker      │
│   (React SPA)   │    │  (Fastify REST) │    │  (Playwright)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                │                       │
                         ┌──────▼──────┐         ┌──────▼──────┐
                         │ PostgreSQL  │         │   Redis     │
                         │ (Data Store)│         │ (Job Queue) │
                         └─────────────┘         └─────────────┘
```

### Data Flow

1. **Job Creation**: Admin UI creates scraping jobs via API
2. **Queue Management**: API adds jobs to Redis queue
3. **Job Processing**: Worker picks up jobs and executes scraper modules
4. **Data Storage**: Raw events stored in PostgreSQL
5. **Real-time Updates**: Live logs streamed via Server-Sent Events

## Module Development

### Basic Module Structure

Every scraper module implements the `ScraperModule` interface:

```typescript
interface ScraperModule {
  key: string                              // Unique identifier
  label: string                           // Human-readable name
  startUrls: string[]                     // Entry point URLs
  mode?: 'scrape' | 'upload' | 'hybrid'  // Operation mode
  paginationType?: 'page' | 'calendar' | 'none'
  integrationTags?: IntegrationTag[]      // UI behavior tags
  uploadConfig?: UploadConfig             // CSV upload configuration
  run(ctx: RunContext): Promise<RawEvent[]>
  processUpload?(content: string, format: string, logger: any): Promise<RawEvent[]>
}
```

### Creating a New Module

1. **Create Module Directory**:
```bash
mkdir worker/src/modules/yoursite_com
```

2. **Create Main Module File** (`worker/src/modules/yoursite_com/index.ts`):

```typescript
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';

const yourSiteModule: ScraperModule = {
  key: 'yoursite_com',
  label: 'Your Site Events',
  startUrls: ['https://yoursite.com/events'],
  paginationType: 'page', // or 'calendar' or 'none'
  integrationTags: ['page-navigation'], // or ['calendar'] or ['csv']

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];

    try {
      // Navigate to events page
      await page.goto(this.startUrls[0], { waitUntil: 'networkidle' });
      
      // Extract event data
      const eventData = await page.evaluate(() => {
        const eventElements = document.querySelectorAll('.event-item');
        return Array.from(eventElements).map(el => ({
          title: el.querySelector('.title')?.textContent?.trim(),
          date: el.querySelector('.date')?.textContent?.trim(),
          url: el.querySelector('a')?.href,
        }));
      });

      // Process each event
      for (const event of eventData) {
        const rawEvent: RawEvent = {
          sourceEventId: event.url,
          title: event.title || 'Untitled Event',
          start: parseEventDate(event.date, event.time), // Use timezone-neutral parsing
          city: 'Your City',
          region: 'Your Region', 
          country: 'Canada',
          organizer: 'Your Organization',
          category: 'Event',
          url: event.url,
          raw: {
            extractedAt: new Date().toISOString(),
            originalData: event,
          },
        };
        events.push(rawEvent);
      }

      return events;
    } catch (error) {
      logger.error(`Scrape failed: ${error}`);
      throw error;
    }
  },
};

export default yourSiteModule;
```

3. **Register Module**: Add to `worker/src/lib/module-loader.ts`:

```typescript
import yourSiteModule from '../modules/yoursite_com/index.js';

export const modules = {
  // ... existing modules
  'yoursite_com': yourSiteModule,
};
```

### Module Types and Patterns

#### 1. Calendar-Based Modules

For sites with calendar interfaces:

```typescript
const calendarModule: ScraperModule = {
  key: 'calendar_site',
  paginationType: 'calendar',
  integrationTags: ['calendar'],
  
  async run(ctx: RunContext): Promise<RawEvent[]> {
    // Handle date range from jobData.paginationOptions
    const { startDate, endDate } = ctx.jobData?.paginationOptions || {};
    
    // Navigate through calendar months
    // Extract events within date range
  }
};
```

#### 2. Paginated Modules

For sites with traditional pagination:

```typescript
const paginatedModule: ScraperModule = {
  key: 'paginated_site',
  paginationType: 'page',
  integrationTags: ['page-navigation'],
  
  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { maxPages, scrapeAllPages } = ctx.jobData?.paginationOptions || {};
    
    let currentPage = 1;
    const events: RawEvent[] = [];
    
    while (currentPage <= (maxPages || 10)) {
      // Scrape current page
      // Check for next page
      if (!hasNextPage) break;
      currentPage++;
    }
    
    return events;
  }
};
```

#### 3. Hybrid Modules (Scraping + CSV Upload)

For modules that support both web scraping and CSV uploads:

```typescript
const hybridModule: ScraperModule = {
  key: 'hybrid_site',
  mode: 'hybrid',
  paginationType: 'calendar',
  integrationTags: ['calendar', 'csv'],
  uploadConfig: {
    supportedFormats: ['csv'],
    instructions: 'Download CSV from site admin panel',
    downloadUrl: 'https://site.com/admin/export',
  },
  
  async run(ctx: RunContext): Promise<RawEvent[]> {
    // Regular scraping logic
  },
  
  async processUpload(content: string, format: string, logger: any): Promise<RawEvent[]> {
    // Parse CSV content and return events
    const lines = content.split('\n');
    const events: RawEvent[] = [];
    
    for (const line of lines.slice(1)) { // Skip header
      const [title, date, location] = line.split(',');
      events.push({
        sourceEventId: `csv_${date}_${title}`,
        title: title.trim(),
        start: new Date(date).toISOString(),
        // ... other fields
        raw: { source: 'csv_upload' }
      });
    }
    
    return events;
  }
};
```

## Integration Tags System

The integration tags system controls UI behavior and capabilities:

### Available Tags

- **`calendar`**: Shows date range picker, enables calendar pagination
- **`csv`**: Shows file upload interface, enables CSV processing
- **`page-navigation`**: Shows page limit controls, enables page-based pagination
- **`api`**: Future use for REST API integrations
- **`rss`**: Future use for RSS feed processing

### UI Mapping

Update these files when adding new modules:

**`apps/admin/src/pages/Runs.tsx`**:
```typescript
const integrationTagsMap: Record<string, string[]> = {
  'yoursite_com': ['page-navigation'],
  // ... other modules
};

const paginationMap: Record<string, 'page' | 'calendar' | 'none'> = {
  'yoursite_com': 'page',
  // ... other modules
};
```

## Testing and Debugging

### Unit Tests

Create test files alongside modules:

**`worker/src/modules/yoursite_com/yoursite_com.test.ts`**:
```typescript
import { test, expect } from '@playwright/test';
import yourSiteModule from './index.js';

test.describe('YourSite Module', () => {
  test('should extract events correctly', async ({ page }) => {
    const mockContext = {
      page,
      logger: console,
      sourceId: 'test',
      runId: 'test',
      // ... other required fields
    };

    const events = await yourSiteModule.run(mockContext);
    expect(events).toHaveLength(0); // Adjust based on expectations
  });
});
```

### Integration Tests

Create test scripts in `/scripts/`:

**`scripts/test-yoursite.ts`**:
```typescript
import { chromium } from 'playwright';
import yourSiteModule from '../worker/src/modules/yoursite_com/index.js';

async function testYourSite() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  const mockContext = {
    browser,
    page,
    sourceId: 'test',
    runId: 'test',
    logger: console,
    jobData: { testMode: true },
  };

  try {
    const events = await yourSiteModule.run(mockContext);
    console.log(`Found ${events.length} events`);
    console.log(JSON.stringify(events.slice(0, 3), null, 2));
  } finally {
    await browser.close();
  }
}

testYourSite();
```

Run with:
```bash
NODE_ENV=development pnpm tsx scripts/test-yoursite.ts
```

### Debugging Tips

1. **Browser Inspection**: Set `headless: false` in test scripts
2. **Screenshots**: Use `await page.screenshot({ path: 'debug.png' })`
3. **Page Content**: Log `await page.content()` to see HTML
4. **Network Monitoring**: Use `page.on('response', ...)` to track requests
5. **Console Logs**: Monitor `page.on('console', ...)` for client-side errors

## Best Practices

### 1. Error Handling

```typescript
async run(ctx: RunContext): Promise<RawEvent[]> {
  const { page, logger } = ctx;
  const events: RawEvent[] = [];

  try {
    await page.goto(this.startUrls[0], { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    // Main scraping logic
    
  } catch (error) {
    logger.error(`Scrape failed: ${error}`);
    
    // Optional: Create fallback event or partial results
    const fallbackEvent: RawEvent = {
      sourceEventId: 'error_fallback',
      title: 'Scraping Error',
      start: new Date().toISOString(),
      // ... other required fields
      raw: { error: error.message }
    };
    events.push(fallbackEvent);
    
    return events; // Return partial results instead of throwing
  }
}
```

### 2. Rate Limiting

```typescript
import { delay, addJitter } from '../../lib/utils.js';

// Between page navigations
await delay(addJitter(2000, 50)); // 2s ± 50ms jitter

// Between detail page visits
for (const [index, eventUrl] of eventUrls.entries()) {
  if (index > 0) {
    await delay(addJitter(1500, 100));
  }
  // Process event
}
```

### 3. Data Quality

```typescript
const rawEvent: RawEvent = {
  sourceEventId: event.url, // Use stable, unique identifier
  title: event.title?.trim() || 'Untitled Event', // Always provide fallback
  start: parseEventDate(event.date, event.time), // Use timezone-neutral parsing
  city: 'Prince George', // Use actual city name
  region: 'British Columbia', // Full region name
  country: 'Canada',
  organizer: event.organizer?.trim() || 'Unknown Organizer',
  category: event.category?.trim() || 'Event',
  url: event.url,
  
  // Optional fields - only set if data exists
  ...(event.endTime && { end: parseEventDate(event.date, event.endTime) }),
  ...(event.venue && { venueName: event.venue.trim() }),
  ...(event.address && { venueAddress: event.address.trim() }),
  ...(event.description && { descriptionHtml: event.description }),
  ...(event.image && { imageUrl: new URL(event.image, this.startUrls[0]).href }),
  
  raw: {
    extractedAt: new Date().toISOString(),
    originalData: event, // Store original scraped data
    enhancedFromDetailPage: !!event.fromDetailPage,
    // Store raw date/time for debugging
    originalDate: event.date,
    originalStartTime: event.time,
    originalEndTime: event.endTime,
  },
};
```

### 4. Pagination Handling

```typescript
// Calendar pagination
if (ctx.jobData?.paginationOptions?.type === 'calendar') {
  const { startDate, endDate } = ctx.jobData.paginationOptions;
  // Filter events by date range
  events = events.filter(event => {
    const eventDate = new Date(event.start);
    return eventDate >= new Date(startDate) && eventDate <= new Date(endDate);
  });
}

// Page pagination
if (ctx.jobData?.paginationOptions?.type === 'page') {
  const { maxPages, scrapeAllPages } = ctx.jobData.paginationOptions;
  const limit = scrapeAllPages ? Infinity : (maxPages || 10);
  // Implement pagination logic
}
```

### 5. Detail Page Enhancement

```typescript
// Visit detail pages for additional data
const visitedUrls = new Set<string>();

for (const event of calendarEvents) {
  if (!visitedUrls.has(event.url)) {
    visitedUrls.add(event.url);
    
    try {
      await page.goto(event.url, { waitUntil: 'networkidle' });
      
      const enhancementData = await page.evaluate(() => ({
        description: document.querySelector('.description')?.innerHTML,
        location: document.querySelector('.location')?.textContent,
        image: document.querySelector('img')?.src,
      }));
      
      // Apply enhancements
      if (enhancementData.description) {
        event.descriptionHtml = enhancementData.description;
      }
      
    } catch (detailError) {
      logger.warn(`Failed to enhance ${event.title}: ${detailError}`);
    }
  }
}
```

## API Integration

### Job Data Structure

```typescript
interface ScrapeJobData {
  sourceId: string;
  runId: string;
  scrapeMode?: 'full' | 'incremental';
  testMode?: boolean;
  
  // Pagination options
  paginationOptions?: {
    type: 'page' | 'calendar';
    scrapeAllPages?: boolean;
    maxPages?: number;
    startDate?: string;
    endDate?: string;
  };
  
  // Upload mode data
  uploadedFile?: {
    format: 'csv' | 'json' | 'xlsx';
    content: string;
    path: string;
  };
}
```

### RunContext Interface

```typescript
interface RunContext {
  browser: Browser;           // Playwright browser instance
  page: Page;                // Playwright page instance
  sourceId: string;          // Database source ID
  runId: string;            // Database run ID
  source: Source;           // Source configuration
  logger: Logger;           // Pino logger instance
  jobData?: ScrapeJobData;  // Job parameters
  stats?: {                 // Performance tracking
    pagesCrawled: number;
  };
}
```

## Common Patterns

### Date Parsing and Timezone Handling

**Important**: EventScrape uses a timezone-aware processing pipeline. When creating events, use timezone-neutral date strings instead of JavaScript Date objects to avoid unwanted timezone conversions.

#### Common Date Parsing Issues and Solutions

##### Issue 1: Month Off-by-One Bug with ISO Dates
When parsing ISO format dates from structured data (e.g., "2025-10-25"), be careful not to add 1 to the month value. ISO dates already use 1-based months (01=January, 12=December).

```typescript
// ❌ WRONG: Adding 1 to month from ISO date
const [year, month, day] = "2025-10-25".split('-');
const dateStr = `${year}-${parseInt(month) + 1}-${day}`; // October becomes November!

// ✅ CORRECT: Use month as-is from ISO format
const [year, month, day] = "2025-10-25".split('-');
const dateStr = `${year}-${month}-${day}`; // October stays October
```

##### Issue 2: Missing Date Format in Parser
The `normalizeEvent()` function in `lib/utils.ts` must include all date formats your module uses. If your format isn't listed, dates won't parse correctly with the proper timezone.

```typescript
// Supported formats in lib/utils.ts:
const formats = [
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',     // Added for Downtown PG events
  'MM/dd/yyyy HH:mm',
  'dd/MM/yyyy HH:mm',
  'yyyy-MM-dd',
  'MM/dd/yyyy',
  'dd/MM/yyyy',
];
```

#### Recommended Approach

```typescript
function parseEventDate(dateStr: string, timeStr?: string): string {
  try {
    // Handle ISO format dates from structured data
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // ISO date format (e.g., "2025-10-25")
      const [year, month, day] = dateStr.split('-');
      
      // Parse time if provided
      let hour = 9, minute = 0; // Default time
      if (timeStr) {
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
        if (timeMatch) {
          let [, hours, minutes, ampm] = timeMatch;
          hour = parseInt(hours);
          minute = parseInt(minutes);
          if (ampm.toLowerCase() === 'pm' && hour !== 12) {
            hour += 12;
          } else if (ampm.toLowerCase() === 'am' && hour === 12) {
            hour = 0;
          }
        }
      }
      
      // IMPORTANT: Don't add 1 to month - ISO months are already 1-based!
      return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    
    // Handle text format dates (e.g., "Oct 25 2025")
    const dateMatch = dateStr.match(/(\w{3})\s+(\d{1,2})\s+(\d{4})/);
    if (!dateMatch) throw new Error('Invalid date format');
    
    const [, month, day, year] = dateMatch;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = monthNames.indexOf(month) + 1; // +1 because array is 0-based
    
    // Parse time if provided
    let hour = 9, minute = 0; // Default time
    if (timeStr) {
      const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
      if (timeMatch) {
        let [, hours, minutes, ampm] = timeMatch;
        hour = parseInt(hours);
        minute = parseInt(minutes);
        if (ampm.toLowerCase() === 'pm' && hour !== 12) {
          hour += 12;
        } else if (ampm.toLowerCase() === 'am' && hour === 12) {
          hour = 0;
        }
      }
    }
    
    // Return timezone-neutral string format: "YYYY-MM-DD HH:mm"
    // The processing pipeline will parse this with the source's defaultTimezone
    return `${year}-${String(monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    
  } catch (error) {
    // Fallback to current date in neutral format
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 09:00`;
  }
}
```

#### What NOT to Do (Timezone Issues)

```typescript
// ❌ WRONG: Creates date in system timezone, then converts to UTC
const dateObj = new Date(year, month, day, hour, minute);
return dateObj.toISOString(); // This causes timezone shifts!

// ❌ WRONG: String parsing can cause timezone conversion
return new Date(`${dateStr} ${timeStr}`).toISOString();
```

#### Why This Matters

1. **System Timezone**: The scraper might run in a different timezone than the events
2. **Processing Pipeline**: The `normalizeEvent()` function handles timezone conversion using the source's `defaultTimezone`
3. **Frontend Display**: Times are displayed in the correct local timezone

#### Full Example

```typescript
// Extract date and time from HTML
const eventDetails = await page.evaluate(() => {
  const dateEl = document.querySelector('.event-date');
  const timeEl = document.querySelector('.event-time');
  
  return {
    dateText: dateEl?.textContent?.trim(), // e.g., "Oct 25 2025"
    timeText: timeEl?.textContent?.trim(), // e.g., "7:00 pm"
  };
});

// Create timezone-neutral date string
const eventStart = parseEventDate(eventDetails.dateText, eventDetails.timeText);
// Result: "2025-10-25 19:00"

const rawEvent: RawEvent = {
  // ... other fields
  start: eventStart, // Use string format, not Date object
  end: eventEnd,     // Same for end time
  // ... rest of event
};
```

### Location Parsing

```typescript
function parseLocation(locationText: string) {
  // Handle multi-line locations
  const lines = locationText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  if (lines.length >= 2) {
    return {
      venueName: lines[0],
      venueAddress: lines.slice(1).join(', ')
    };
  } else if (lines.length === 1) {
    // Try to separate venue from address
    const match = lines[0].match(/^(.+?)(\d+.*)$/);
    if (match) {
      return {
        venueName: match[1].trim(),
        venueAddress: match[2].trim()
      };
    } else {
      return { venueName: lines[0] };
    }
  }
  
  return {};
}
```

### CSV Processing

```typescript
async function processCSV(content: string): Promise<RawEvent[]> {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const events: RawEvent[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row: Record<string, string> = {};
    
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    
    // Skip empty rows
    if (!row.title && !row.event) continue;
    
    const event: RawEvent = {
      sourceEventId: `csv_${i}_${row.title || row.event}`,
      title: row.title || row.event || 'Untitled Event',
      start: parseEventDate(row.date || row['start date']),
      // Map other CSV fields to event properties
      raw: {
        source: 'csv_upload',
        csvRow: row,
        extractedAt: new Date().toISOString(),
      }
    };
    
    events.push(event);
  }
  
  return events;
}
```

## Troubleshooting

### Common Issues

1. **Module Not Found**: Ensure module is registered in `module-loader.ts`
2. **UI Not Updating**: Check integration tags mapping in `Runs.tsx`
3. **Date Parsing Errors**: Validate date formats and add fallbacks
4. **Timeout Issues**: Increase timeouts for slow-loading pages
5. **Memory Issues**: Implement rate limiting and browser resource cleanup

### Debug Commands

```bash
# Run specific module test
NODE_ENV=development pnpm tsx scripts/test-yourmodule.ts

# Check module registration
grep -r "yourmodule" worker/src/lib/

# Validate TypeScript
pnpm --filter worker type-check

# Run with debug logging
DEBUG=* NODE_ENV=development pnpm tsx scripts/test-yourmodule.ts
```

### Performance Tips

1. **Minimize Detail Page Visits**: Only visit unique URLs
2. **Use Page Evaluate**: Run DOM operations in browser context
3. **Implement Caching**: Store repeated data in memory
4. **Monitor Memory**: Use `process.memoryUsage()` in tests
5. **Batch Operations**: Group similar operations together

### Security Considerations

1. **Input Validation**: Sanitize all scraped data
2. **URL Validation**: Verify URLs before navigation
3. **Rate Limiting**: Respect target site's resources
4. **User Agents**: Use realistic browser user agents
5. **Error Disclosure**: Don't expose internal errors to users

This guide covers the essential aspects of developing and maintaining EventScrape modules. For specific implementation details, refer to existing modules as examples and the integration tagging system documentation.