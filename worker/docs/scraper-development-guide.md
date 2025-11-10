# Event Scraper Development Guide

This guide documents lessons learned from building the Prince George scraper and provides a blueprint for creating scrapers for other municipalities.

## Table of Contents

- [Key Lessons Learned](#key-lessons-learned)
- [Step-by-Step Development Process](#step-by-step-development-process)
- [Architecture Patterns](#architecture-patterns)
- [Testing Strategy](#testing-strategy)
- [Common Pitfalls](#common-pitfalls)
- [Quick Start Template](#quick-start-template)

---

## Key Lessons Learned

### 1. Don't Rely on URL Patterns

**❌ Bad Approach:**
```typescript
if (url.includes('/events-calendar/')) {
  // Extract event data
}
```

**✅ Good Approach:**
```typescript
// Use CSS selectors to find content regardless of URL structure
const dateField = document.querySelector('.field--name-field-when')
  || document.querySelector('.views-field-field-when');
```

**Why:** Events can be at any URL path:
- `/events-calendar/russell-peters`
- `/CivicLightUp` (custom short URL)
- `/community/special-event`

The CSS selectors work regardless of URL structure.

---

### 2. Support Multiple Date/Time Selectors

Different pages on the same site may use different class names for date fields:

```typescript
// Check multiple possible selectors
const dateSelectors = [
  '.views-field-field-when',
  '.field--name-field-when',
  '.add-to-cal__wrapper'
];

dateSelectors.forEach(selector => {
  const nodes = document.querySelectorAll(selector);
  nodes.forEach(node => {
    dates.push(...extractDatesFromNode(node));
  });
});
```

**Testing Strategy:**
- Visit 5-10 different event pages
- Inspect the HTML for date fields
- Document all selector variations you find
- Add all variations to your extractor

---

### 3. Handle Three Date Format Types

| Format Type | Example | Storage Format | Use Case |
|-------------|---------|----------------|----------|
| **Specific Times** | `Fri, Oct 3 2025, 7:30pm - 9pm` | `2025-10-03T19:30:00-07:00` | Most events |
| **All-Day Events** | `Wed, Nov 26 - Sun, Nov 30 2025, All day` | `2025-11-26` (date only) | Festivals, holidays |
| **Recurring Events** | 71 weekly skating sessions | Array of datetime instances | Classes, programs |

**Implementation:**

```typescript
interface DateExtraction {
  start: string;  // ISO datetime or date-only
  end?: string;   // ISO datetime or date-only
}

function extractDates(element: Element): DateExtraction[] {
  const dates: DateExtraction[] = [];

  // Prefer structured <time> tags
  const timeElements = element.querySelectorAll('time[datetime]');
  if (timeElements.length > 0) {
    // Extract from datetime attributes
    timeElements.forEach(el => {
      const datetime = el.getAttribute('datetime');
      if (datetime) dates.push({ start: datetime });
    });
  } else {
    // Fallback to text parsing
    const text = element.textContent || '';
    dates.push(...parseTextDates(text));
  }

  return dates;
}
```

---

### 4. Browser Context vs. Node Context

Understanding where your code runs is critical:

```typescript
// ❌ WRONG: This will fail in browser context
await page.evaluate(() => {
  const ELEMENT_NODE = Node.ELEMENT_NODE; // Node is not defined in browser!
  if (element.nodeType === ELEMENT_NODE) { ... }
});

// ✅ CORRECT: Use literal values in browser context
await page.evaluate(() => {
  if (element.nodeType === 1) { // 1 is the literal value for ELEMENT_NODE
    // ...
  }
});

// ✅ CORRECT: Run Node.js code outside evaluate
const rawData = await page.evaluate(extractFunction); // Browser context
const normalized = normalizeData(rawData);             // Node.js context
```

**Rule of Thumb:**
- Code inside `page.evaluate()` runs in the browser
- Code outside runs in Node.js
- Don't reference Node.js globals inside `evaluate()`

---

### 5. Use Official Playwright Docker Image

**docker-compose.playwright.yml:**
```yaml
services:
  playwright:
    image: mcr.microsoft.com/playwright:v1.54.2-noble
    working_dir: /workspace
    entrypoint: ["/bin/bash", "-lc"]
    command: >
      corepack enable pnpm &&
      pnpm install --frozen-lockfile &&
      pnpm --filter @eventscrape/worker exec vitest run
    environment:
      - CI=true  # Prevents interactive prompts
      - PNPM_HOME=/root/.local/share/pnpm
      - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
      - PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    volumes:
      - .:/workspace
      - playwright-cache:/ms-playwright
      - pnpm-store:/root/.local/share/pnpm/store

volumes:
  playwright-cache:
  pnpm-store:
```

**Key Points:**
- Match Docker image version to your `package.json` Playwright version
- Add `CI=true` to avoid pnpm hanging on interactive prompts
- Use volumes to cache browsers and dependencies
- Enables consistent testing across different environments

---

### 6. Integration Tests > Unit Tests

**Unit Tests (with fixtures):**
```typescript
// Good for regression testing, but limited
it('should parse fixture HTML', async () => {
  const html = await fs.readFile('fixtures/event.html');
  const data = parseHTML(html);
  expect(data.title).toBe('Expected Title');
});
```

**Integration Tests (against live site):**
```typescript
// Catches real-world issues
it('should scrape live event', async () => {
  await page.goto('https://site.com/event');
  const data = await extractEventData(page);
  expect(data.title).toBeTruthy();
  expect(data.dates.length).toBeGreaterThan(0);
});
```

**What Integration Tests Catch:**
- Date format changes
- HTML structure updates
- New event types
- Missing/renamed CSS selectors
- JavaScript-rendered content

---

### 7. Deduplication Strategy

Many sites show duplicate entries for recurring events:

```typescript
interface SeriesEntry {
  start: string;
  end?: string;
  location?: string;
}

function deduplicateEvents(entries: SeriesEntry[]): SeriesEntry[] {
  const seen = new Set<string>();
  const unique: SeriesEntry[] = [];

  for (const entry of entries) {
    // Create signature-based key
    const signature = `${entry.start}|${entry.end || ''}|${entry.location || ''}`;

    if (!seen.has(signature)) {
      seen.add(signature);
      unique.push(entry);
    }
  }

  return unique;
}
```

**Signature Components:**
- Date/time (required)
- Location (if available)
- End time (if available)

---

### 8. Text Fallback Handling

Always prefer structured data over text parsing:

```typescript
function extractDates(container: Element): DateInfo[] {
  const dates: DateInfo[] = [];

  // 1. Check for structured <time> tags first
  const timeElements = container.querySelectorAll('time[datetime]');
  if (timeElements.length > 0) {
    timeElements.forEach(el => {
      const datetime = el.getAttribute('datetime');
      if (datetime) {
        dates.push({ start: datetime });
      }
    });
    return dates; // Skip text parsing
  }

  // 2. Fallback to text parsing only if no structured data
  const text = container.textContent || '';
  return parseTextDates(text);
}
```

**Why:**
- `<time datetime="2025-11-26T19:30:00-08:00">` is unambiguous
- Text like "Friday, November 26" requires complex parsing
- Some sites show both — structured data is more reliable

---

### 9. Environment Variable Testing

Make it easy to test specific events:

**scripts/playwright-test.sh:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# Pass through TEST_EVENT_URL if set
if [ -n "${TEST_EVENT_URL:-}" ]; then
  docker compose -f docker-compose.playwright.yml run --rm \
    -e TEST_EVENT_URL="${TEST_EVENT_URL}" \
    playwright "${FULL_CMD}"
else
  docker compose -f docker-compose.playwright.yml run --rm \
    playwright "${FULL_CMD}"
fi
```

**Usage:**
```bash
# Test specific event
TEST_EVENT_URL="https://site.com/event" ./scripts/playwright-test.sh

# Run default tests
./scripts/playwright-test.sh
```

**Benefits:**
- Quick debugging of specific edge cases
- Easy to share test commands with team
- Essential for CI/CD pipelines

---

### 10. Modular Architecture

Organize your scraper into focused modules:

```
worker/src/modules/your_site/
├── index.ts                    # Orchestration only (<200 lines)
├── types.ts                    # Shared TypeScript types
├── fixtures/                   # Test HTML snapshots
│   ├── calendar.html
│   ├── event-detail.html
│   └── recurring-event.html
├── utils/
│   ├── calendar.ts            # Calendar navigation & list extraction
│   ├── detail-page.ts         # Individual event page parsing
│   └── event-processor.ts     # Enrichment & normalization
└── your_site.test.ts          # Unit tests with fixtures
└── integration.test.ts        # Live website tests
```

**Benefits:**
- Each file is independently testable
- Easy to update one part without breaking others
- Other scrapers can reuse utilities (e.g., date parsing)
- Clear separation of concerns

**index.ts (orchestration only):**
```typescript
import { navigateToCalendar, extractEventLinks } from './utils/calendar.js';
import { extractDetailPage } from './utils/detail-page.js';
import { processEvents } from './utils/event-processor.js';

export async function run(context: RunContext): Promise<RawEvent[]> {
  const { page, logger } = context;

  // 1. Navigate to calendar
  await navigateToCalendar(page, logger);

  // 2. Extract event links
  const eventLinks = await extractEventLinks(page);
  logger.info(`Found ${eventLinks.length} events`);

  // 3. Process each event
  const events = await processEvents(page, eventLinks, logger);

  return events;
}
```

---

## Step-by-Step Development Process

### Phase 1: Exploration (15-30 minutes)

**Goal:** Understand the site's structure and identify key selectors

1. **Visit the calendar page** in Chrome DevTools
2. **Identify the calendar type:**
   - FullCalendar.js (look for `.fc-` classes)
   - Custom implementation
   - WordPress/Drupal event plugin
3. **Find event list selectors:**
   - Right-click on an event → Inspect
   - Note the class names (`.fc-list-item`, `.event-card`, etc.)
4. **Check 3-5 different event detail pages:**
   - Single event with specific times
   - All-day event
   - Recurring event
5. **Document all selectors:**
   ```
   Calendar:
     - Event list: .fc-list-item
     - Event link: .fc-list-item-title a
     - Event date: .fc-list-item-time

   Detail Page (Variant 1):
     - Dates: .field--name-field-when time[datetime]
     - Location: .field--name-field-location

   Detail Page (Variant 2):
     - Dates: .views-field-field-when time[datetime]
     - Location: .location-info
   ```

---

### Phase 2: Calendar Extraction (1-2 hours)

**Goal:** Extract list of event URLs from the calendar

1. **Create `utils/calendar.ts`:**

```typescript
import { Page } from 'playwright';

export interface EventLink {
  url: string;
  title: string;
  date?: string;
  time?: string;
}

export async function navigateToCalendar(page: Page): Promise<void> {
  await page.goto('https://site.com/events', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  // Wait for calendar to load
  await page.waitForSelector('.fc-view-container', { timeout: 15000 });
}

export async function extractEventLinks(page: Page): Promise<EventLink[]> {
  return await page.$$eval('.fc-list-item', nodes =>
    nodes.map(node => {
      const link = node.querySelector('a');
      const dateEl = node.querySelector('.fc-list-item-time');

      return {
        url: link?.href || '',
        title: link?.textContent?.trim() || '',
        date: dateEl?.getAttribute('data-start') || '',
      };
    }).filter(event => event.url)
  );
}
```

2. **Handle pagination if needed:**

```typescript
export async function extractAllMonths(
  page: Page,
  startDate: Date,
  endDate: Date
): Promise<EventLink[]> {
  const allEvents: EventLink[] = [];
  let currentMonth = new Date(startDate);

  while (currentMonth <= endDate) {
    // Click next month button
    await page.click('.fc-next-button');
    await page.waitForTimeout(1000);

    // Extract events from this month
    const events = await extractEventLinks(page);
    allEvents.push(...events);

    // Move to next month
    currentMonth.setMonth(currentMonth.getMonth() + 1);
  }

  return allEvents;
}
```

3. **Test with integration test:**

```typescript
it('should extract calendar events', async () => {
  const page = await browser.newPage();
  await navigateToCalendar(page);
  const events = await extractEventLinks(page);

  expect(events.length).toBeGreaterThan(0);
  expect(events[0].url).toMatch(/^https?:\/\//);
  expect(events[0].title).toBeTruthy();
});
```

---

### Phase 3: Detail Page Parsing (2-3 hours)

**Goal:** Extract complete event data from individual event pages

1. **Create `utils/detail-page.ts`:**

```typescript
import { Page } from 'playwright';

export interface DetailPageData {
  dates: Array<{ start: string; end?: string }>;
  title?: string;
  location?: string;
  description?: string;
  eventType?: string;
  imageUrl?: string;
}

export function extractDetailPageData(): DetailPageData {
  // This function runs in BROWSER context
  const dates: Array<{ start: string; end?: string }> = [];

  // Try multiple selectors for dates
  const dateSelectors = [
    '.field--name-field-when',
    '.views-field-field-when',
    '.event-date-time'
  ];

  for (const selector of dateSelectors) {
    const container = document.querySelector(selector);
    if (!container) continue;

    // Look for structured time tags
    const timeElements = container.querySelectorAll('time[datetime]');
    timeElements.forEach((el, idx) => {
      const datetime = el.getAttribute('datetime');
      if (!datetime) return;

      // Pair start and end times
      if (idx % 2 === 0) {
        const nextEl = timeElements[idx + 1];
        const endDatetime = nextEl?.getAttribute('datetime');
        dates.push({
          start: datetime,
          end: endDatetime || undefined,
        });
      }
    });

    if (dates.length > 0) break; // Found dates, stop searching
  }

  // Extract other fields
  const title = document.querySelector('h1.page-title')?.textContent?.trim();
  const location = document.querySelector('.field--name-field-location')?.textContent?.trim();
  const description = document.querySelector('.field--name-body')?.innerHTML;
  const eventType = document.querySelector('.field--name-field-event-type')?.textContent?.trim();
  const imageUrl = document.querySelector('.field--name-field-image img')?.getAttribute('src');

  return {
    dates,
    title,
    location,
    description,
    eventType,
    imageUrl,
  };
}
```

2. **Handle recurring events:**

```typescript
export function normalizeRecurringDates(
  dates: Array<{ start: string; end?: string }>
): Array<{ start: string; end?: string }> {
  const seen = new Set<string>();
  const unique: Array<{ start: string; end?: string }> = [];

  for (const entry of dates) {
    const signature = `${entry.start}|${entry.end || ''}`;

    if (!seen.has(signature)) {
      seen.add(signature);
      unique.push(entry);
    }
  }

  return unique;
}
```

3. **Test with real URLs:**

```typescript
it('should extract detail page data', async () => {
  const page = await browser.newPage();
  await page.goto('https://site.com/event/some-event');

  const data = await page.evaluate(extractDetailPageData);

  expect(data.title).toBeTruthy();
  expect(data.dates.length).toBeGreaterThan(0);
  expect(data.dates[0].start).toMatch(/^\d{4}-\d{2}-\d{2}/);
});
```

---

### Phase 4: Integration & Testing (1-2 hours)

**Goal:** Wire everything together and create comprehensive tests

1. **Create `utils/event-processor.ts`:**

```typescript
import { Page } from 'playwright';
import { EventLink } from './calendar.js';
import { extractDetailPageData, normalizeRecurringDates } from './detail-page.js';

export async function processEvents(
  page: Page,
  eventLinks: EventLink[],
  logger: Logger
): Promise<RawEvent[]> {
  const events: RawEvent[] = [];

  for (const eventLink of eventLinks) {
    try {
      logger.info(`Processing: ${eventLink.title}`);

      // Navigate to event detail page
      await page.goto(eventLink.url, {
        waitUntil: 'networkidle',
        timeout: 20000,
      });

      // Extract data
      const detailData = await page.evaluate(extractDetailPageData);
      const normalizedDates = normalizeRecurringDates(detailData.dates);

      // Create event for each date instance
      for (const dateInfo of normalizedDates) {
        events.push({
          title: detailData.title || eventLink.title,
          start: dateInfo.start,
          end: dateInfo.end,
          url: eventLink.url,
          location: detailData.location,
          descriptionHtml: detailData.description,
          category: detailData.eventType,
          imageUrl: detailData.imageUrl,
          sourceKey: 'your_site',
          city: 'Your City',
          region: 'Your Region',
          country: 'Your Country',
        });
      }

      // Rate limiting
      await page.waitForTimeout(2000);

    } catch (error) {
      logger.error(`Failed to process ${eventLink.url}: ${error.message}`);
      // Continue with next event
    }
  }

  return events;
}
```

2. **Create Docker test setup:**

```yaml
# docker-compose.playwright.yml
services:
  playwright:
    image: mcr.microsoft.com/playwright:v1.54.2-noble
    working_dir: /workspace
    entrypoint: ["/bin/bash", "-lc"]
    environment:
      - CI=true
      - PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
    volumes:
      - .:/workspace
      - playwright-cache:/ms-playwright
      - pnpm-store:/root/.local/share/pnpm/store

volumes:
  playwright-cache:
  pnpm-store:
```

3. **Create `integration.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';

describe('Your Site Integration Tests', () => {
  it('should scrape current month events', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Your scraper logic here
    const events = await yourScraperModule.run({ page });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].title).toBeTruthy();
    expect(events[0].start).toMatch(/^\d{4}-\d{2}-\d{2}/);

    await browser.close();
  }, 60000);

  it('should handle specific event URL', async () => {
    const testUrl = process.env.TEST_EVENT_URL;
    if (!testUrl) return;

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(testUrl);

    const data = await page.evaluate(extractDetailPageData);

    expect(data.title).toBeTruthy();
    expect(data.dates.length).toBeGreaterThan(0);

    await browser.close();
  });
});
```

---

### Phase 5: Production Validation (30 minutes)

**Goal:** Verify the scraper works end-to-end in production-like conditions

1. **Run full scraper on current month:**
```bash
./scripts/playwright-test.sh
```

2. **Check for duplicate events:**
```typescript
const uniqueUrls = new Set(events.map(e => e.url));
console.log(`Total events: ${events.length}`);
console.log(`Unique URLs: ${uniqueUrls.size}`);
// Should be equal if deduplication works
```

3. **Validate date formats:**
```typescript
const invalidDates = events.filter(e =>
  !e.start.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/)
);
if (invalidDates.length > 0) {
  console.error('Invalid date formats:', invalidDates);
}
```

4. **Review first 10 events manually:**
```typescript
events.slice(0, 10).forEach(event => {
  console.log(`
Title: ${event.title}
Start: ${event.start}
End: ${event.end}
Location: ${event.location}
URL: ${event.url}
---
  `);
});
```

5. **Performance check:**
```typescript
const startTime = Date.now();
const events = await scraper.run(context);
const duration = Date.now() - startTime;

console.log(`Scraped ${events.length} events in ${duration}ms`);
console.log(`Average: ${duration / events.length}ms per event`);
```

---

## Architecture Patterns

### Pattern 1: Separate Concerns

```
Calendar Navigation  →  Extract Links  →  Visit Detail Pages  →  Normalize Data
     (calendar.ts)         (calendar.ts)     (detail-page.ts)     (event-processor.ts)
```

### Pattern 2: Resilient Error Handling

```typescript
for (const eventLink of eventLinks) {
  try {
    const event = await processEvent(page, eventLink);
    events.push(event);
  } catch (error) {
    logger.error(`Failed to process ${eventLink.url}: ${error.message}`);
    // Continue with next event - don't fail entire scrape
  }
}
```

### Pattern 3: Progressive Enhancement

```typescript
// Start with basic data from calendar
const baseEvent = {
  title: calendarLink.title,
  url: calendarLink.url,
  start: calendarLink.date, // May be incomplete
};

// Enhance with detail page
const detailData = await getDetailPageData(page);
if (detailData.dates.length > 0) {
  baseEvent.start = detailData.dates[0].start; // More accurate
  baseEvent.end = detailData.dates[0].end;
}
```

### Pattern 4: Caching for Recurring Events

```typescript
const detailCache = new Map<string, DetailPageData>();

async function getDetailData(page: Page, url: string) {
  if (detailCache.has(url)) {
    return detailCache.get(url);
  }

  await page.goto(url);
  const data = await page.evaluate(extractDetailPageData);
  detailCache.set(url, data);

  return data;
}
```

---

## Testing Strategy

### Test Pyramid

```
        /\
       /  \    Integration Tests (Live Site)
      /____\   - Full scraper runs
     /      \  - Specific event URLs
    /________\ - Edge cases
   /          \
  /____________\ Unit Tests (Fixtures)
 /______________\ - HTML parsing
/________________\ - Date normalization
                   - Deduplication
```

### Test Types

#### 1. Unit Tests (Fast, Isolated)

```typescript
describe('Date Parsing', () => {
  it('should parse ISO datetime', () => {
    const result = parseDate('2025-11-26T19:30:00-08:00');
    expect(result.year).toBe(2025);
    expect(result.month).toBe(11);
    expect(result.hour).toBe(19);
  });

  it('should handle date-only format', () => {
    const result = parseDate('2025-11-26');
    expect(result.year).toBe(2025);
    expect(result.month).toBe(11);
    expect(result.hour).toBeUndefined();
  });
});
```

#### 2. Integration Tests (Realistic, E2E)

```typescript
describe('Live Scraper Tests', () => {
  it('should scrape real events', async () => {
    const events = await scraper.run(context);

    // Sanity checks
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(1000); // Catch infinite loops

    // Data quality checks
    events.forEach(event => {
      expect(event.title).toBeTruthy();
      expect(event.url).toMatch(/^https?:\/\//);
      expect(event.start).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });
});
```

#### 3. Visual Regression Tests (Optional)

```typescript
it('should match expected event structure', async () => {
  const events = await scraper.run(context);
  expect(events[0]).toMatchSnapshot({
    title: expect.any(String),
    start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
    url: expect.any(String),
  });
});
```

### Testing Checklist

For any new scraper, test these scenarios:

- [ ] **Single event with specific times**
  - Example: "Concert on Nov 15, 7:30pm - 10pm"
  - Expected: ISO datetime with timezone

- [ ] **All-day event**
  - Example: "Festival on Nov 20, All day"
  - Expected: Date-only format `2025-11-20`

- [ ] **Multi-day event**
  - Example: "Conference Nov 15-17, All day"
  - Expected: Start and end dates

- [ ] **Recurring event (weekly/monthly)**
  - Example: "Yoga every Monday, 6pm"
  - Expected: Multiple date instances, deduplicated

- [ ] **Event with no location**
  - Expected: `location: undefined`, doesn't crash

- [ ] **Event with no image**
  - Expected: `imageUrl: undefined`, doesn't crash

- [ ] **Event outside regular URL structure**
  - Example: `/special-event` instead of `/events/special-event`
  - Expected: Still extracts correctly

- [ ] **Past event**
  - Expected: Decide if it should be included or skipped

- [ ] **Events in different months**
  - Expected: Pagination works correctly

---

## Common Pitfalls

### Pitfall 1: Hardcoding Date Formats

**Problem:**
```typescript
// This breaks when format changes
const date = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
```

**Solution:**
```typescript
// Support multiple formats
function parseDate(text: string): Date | null {
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return new Date(text);
  }

  // Try MM/DD/YYYY
  const usFormat = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (usFormat) {
    return new Date(`${usFormat[3]}-${usFormat[1]}-${usFormat[2]}`);
  }

  // Try DD/MM/YYYY
  const euFormat = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (euFormat) {
    return new Date(`${euFormat[3]}-${euFormat[2]}-${euFormat[1]}`);
  }

  return null;
}
```

### Pitfall 2: Assuming Single Date Per Event

**Problem:**
```typescript
const date = document.querySelector('.date')?.textContent;
// Misses recurring events!
```

**Solution:**
```typescript
const dates = Array.from(document.querySelectorAll('.date'))
  .map(el => el.textContent)
  .filter(Boolean);
```

### Pitfall 3: Not Handling Missing Fields

**Problem:**
```typescript
const location = document.querySelector('.location').textContent;
// Crashes if location element doesn't exist
```

**Solution:**
```typescript
const location = document.querySelector('.location')?.textContent?.trim() || undefined;
```

### Pitfall 4: Testing Only with Fixtures

**Problem:**
```typescript
// Fixture HTML may be outdated
const html = fs.readFileSync('fixtures/event.html');
```

**Solution:**
```typescript
// Test against live site regularly
it('should scrape live event', async () => {
  await page.goto('https://realsite.com/event');
  // ...
});
```

### Pitfall 5: Using Node.js Constants in Browser Context

**Problem:**
```typescript
await page.evaluate(() => {
  if (node.nodeType === Node.ELEMENT_NODE) { // Node is undefined!
    // ...
  }
});
```

**Solution:**
```typescript
await page.evaluate(() => {
  if (node.nodeType === 1) { // Use literal value
    // ...
  }
});
```

### Pitfall 6: Not Deduplicating

**Problem:**
```typescript
// Recurring events appear multiple times
const events = await extractAllEvents(page);
// Result: 200 events (many duplicates)
```

**Solution:**
```typescript
const events = await extractAllEvents(page);
const deduplicated = deduplicateBySignature(events);
// Result: 75 unique events
```

### Pitfall 7: No Rate Limiting

**Problem:**
```typescript
for (const link of eventLinks) {
  await page.goto(link.url); // Hammers the server
}
```

**Solution:**
```typescript
for (const link of eventLinks) {
  await page.goto(link.url);
  await page.waitForTimeout(addJitter(2000, 50)); // 2s ± 50ms
}
```

---

## Quick Start Template

```typescript
// modules/your_site/index.ts
import { Page } from 'playwright';
import type { RunContext, RawEvent } from '../../types.js';

export default {
  async run(context: RunContext): Promise<RawEvent[]> {
    const { page, logger } = context;
    const events: RawEvent[] = [];

    try {
      // 1. Navigate to calendar
      logger.info('Navigating to calendar...');
      await page.goto('https://yoursite.com/events', {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // 2. Extract event links
      logger.info('Extracting event links...');
      const eventLinks = await page.$$eval('.event-item', nodes =>
        nodes.map(node => ({
          url: node.querySelector('a')?.href || '',
          title: node.querySelector('h2')?.textContent?.trim() || '',
        })).filter(e => e.url)
      );

      logger.info(`Found ${eventLinks.length} events`);

      // 3. Visit each event detail page
      for (const eventLink of eventLinks) {
        try {
          logger.info(`Processing: ${eventLink.title}`);

          await page.goto(eventLink.url, {
            waitUntil: 'networkidle',
            timeout: 20000,
          });

          // Extract event data
          const eventData = await page.evaluate(() => {
            const dates: Array<{ start: string; end?: string }> = [];

            // TODO: Find your date selectors
            document.querySelectorAll('time[datetime]').forEach((el, idx) => {
              const datetime = el.getAttribute('datetime');
              if (!datetime) return;

              if (idx % 2 === 0) {
                const endEl = document.querySelectorAll('time[datetime]')[idx + 1];
                dates.push({
                  start: datetime,
                  end: endEl?.getAttribute('datetime') || undefined,
                });
              }
            });

            return {
              dates,
              title: document.querySelector('h1')?.textContent?.trim(),
              location: document.querySelector('.location')?.textContent?.trim(),
              description: document.querySelector('.description')?.innerHTML,
              imageUrl: document.querySelector('img')?.src,
            };
          });

          // Create event entries
          for (const dateInfo of eventData.dates) {
            events.push({
              sourceEventId: `${eventLink.url}#${dateInfo.start}`,
              title: eventData.title || eventLink.title,
              start: dateInfo.start,
              end: dateInfo.end,
              url: eventLink.url,
              location: eventData.location,
              descriptionHtml: eventData.description,
              imageUrl: eventData.imageUrl,
              sourceKey: 'your_site',
              city: 'Your City',
              region: 'Your Region',
              country: 'Your Country',
              category: 'Community Event',
            });
          }

          // Rate limiting
          await page.waitForTimeout(2000);

        } catch (error) {
          logger.error(`Failed to process ${eventLink.url}: ${error.message}`);
        }
      }

      logger.info(`Successfully scraped ${events.length} events`);
      return events;

    } catch (error) {
      logger.error(`Scraper failed: ${error.message}`);
      throw error;
    }
  },
};
```

---

## Advanced Tips

### 1. Rate Limiting with Jitter

Add randomness to avoid pattern detection:

```typescript
function addJitter(baseDelay: number, jitterPercent: number): number {
  const jitter = baseDelay * (jitterPercent / 100);
  return baseDelay + (Math.random() * jitter * 2 - jitter);
}

await page.waitForTimeout(addJitter(2000, 50)); // 1900-2100ms
```

### 2. Caching for Performance

Avoid re-fetching the same detail page:

```typescript
const detailCache = new Map<string, DetailPageData>();

async function getDetailData(page: Page, url: string): Promise<DetailPageData> {
  if (detailCache.has(url)) {
    logger.info(`Using cached data for ${url}`);
    return detailCache.get(url)!;
  }

  await page.goto(url);
  const data = await page.evaluate(extractDetailPageData);
  detailCache.set(url, data);

  return data;
}
```

### 3. Robust Error Handling

Continue scraping even if individual events fail:

```typescript
const errors: Array<{ url: string; error: string }> = [];

for (const eventLink of eventLinks) {
  try {
    const event = await processEvent(page, eventLink);
    events.push(event);
  } catch (error) {
    errors.push({ url: eventLink.url, error: error.message });
    logger.error(`Failed to process ${eventLink.url}: ${error.message}`);
    // Continue with next event
  }
}

if (errors.length > 0) {
  logger.warn(`Failed to process ${errors.length} events:`, errors);
}
```

### 4. Context-Rich Logging

Include event details in every log message:

```typescript
logger.info(`Processing "${event.title}" at ${event.url}`);
logger.error(`Failed to extract dates for "${event.title}" at ${event.url}`);
logger.warn(`Missing location for "${event.title}" at ${event.url}`);
```

### 5. TypeScript for Safety

Use strong types to catch bugs early:

```typescript
interface EventLink {
  url: string;
  title: string;
  date?: string; // Optional
}

interface DetailPageData {
  dates: Array<{ start: string; end?: string }>; // Required
  title?: string; // Optional
  location?: string;
}

// TypeScript will catch if you forget required fields
const event: RawEvent = {
  title: data.title, // ✓ OK
  start: data.dates[0].start, // ✓ OK
  // Missing url field - TypeScript error!
};
```

---

## Resources

### Prince George Scraper Reference

The Prince George scraper is a complete, production-ready reference implementation:

- **Source Code:** `worker/src/modules/prince_george_ca/`
- **Integration Tests:** `worker/src/modules/prince_george_ca/integration.test.ts`
- **Docker Setup:** `docker-compose.playwright.yml`
- **Test Script:** `scripts/playwright-test.sh`

### Key Files to Study

1. **`utils/calendar.ts`** - Calendar navigation and event link extraction
2. **`utils/detail-page.ts`** - Robust date extraction with multiple selector support
3. **`utils/event-processor.ts`** - Event enrichment and normalization
4. **`integration.test.ts`** - Real-world testing patterns

### External Resources

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Docker Images](https://playwright.dev/docs/docker)
- [CSS Selector Reference](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors)
- [ISO 8601 Date Format](https://en.wikipedia.org/wiki/ISO_8601)

---

## Summary

Building a reliable event scraper requires:

1. **Robust selector strategy** - Multiple fallbacks, no URL assumptions
2. **Flexible date handling** - Support multiple formats and structures
3. **Modular architecture** - Separate concerns, reusable utilities
4. **Comprehensive testing** - Both fixtures and live site integration tests
5. **Error resilience** - Continue scraping even when individual events fail
6. **Production tooling** - Docker setup, environment-based testing, CI/CD ready

Follow this guide and reference the Prince George implementation to build scrapers that are maintainable, testable, and production-ready.

---

**Last Updated:** 2025-11-10
**Based on:** Prince George CA scraper implementation
