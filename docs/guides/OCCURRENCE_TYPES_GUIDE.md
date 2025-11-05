# Event Occurrence Types - Implementation Guide

## Overview

EventScrape now supports all major event occurrence types found in The Events Calendar (TEC), including single-day, multi-day, all-day, recurring, and virtual events. This guide explains the database schema, how to update scrapers, and how the system works end-to-end.

---

## Table of Contents

1. [Supported Occurrence Types](#supported-occurrence-types)
2. [Database Schema](#database-schema)
3. [How to Update Scrapers](#how-to-update-scrapers)
4. [Occurrence Detection Logic](#occurrence-detection-logic)
5. [WordPress Integration](#wordpress-integration)
6. [Testing Your Scraper](#testing-your-scraper)

---

## Supported Occurrence Types

The system now supports these event occurrence types:

### 1. **Single-Day Events** ✅
Events that occur once on a single day with specific start and end times.

**Example:**
```javascript
{
  title: "Community Meeting",
  startDatetime: "2025-10-15T18:00:00-07:00",
  endDatetime: "2025-10-15T20:00:00-07:00"
}
```

**Detection:** Default type when no other conditions are met.

---

### 2. **Multi-Day Events** ✅
Events that span multiple consecutive days (duration > 24 hours).

**Example:**
```javascript
{
  title: "Annual Conference",
  startDatetime: "2025-10-15T09:00:00-07:00",
  endDatetime: "2025-10-17T17:00:00-07:00"  // Spans 2+ days
}
```

**Detection:** Automatically detected when `(end - start) > 24 hours`.

**Database:**
- `occurrence_type`: `'multi_day'`
- `recurrence_type`: `'none'`

---

### 3. **All-Day Events** ✅
Events that last the entire day without specific times.

**Example:**
```javascript
{
  title: "Canada Day",
  startDatetime: "2025-07-01T00:00:00-07:00",
  endDatetime: "2025-07-01T23:59:59-07:00",
  raw: {
    isAllDay: true  // ← Set this flag
  }
}
```

**Detection:** Set `raw.isAllDay = true` in your scraper.

**Database:**
- `occurrence_type`: `'all_day'`
- `is_all_day`: `true`

---

### 4. **Recurring Events** ✅
Events with multiple occurrences (series).

**Example:**
```javascript
{
  title: "Weekly Yoga Class",
  startDatetime: "2025-10-07T18:00:00-07:00",
  endDatetime: "2025-10-07T19:00:00-07:00",
  raw: {
    seriesDates: [  // ← Put all occurrences here
      { start: "2025-10-07T18:00:00-07:00", end: "2025-10-07T19:00:00-07:00" },
      { start: "2025-10-14T18:00:00-07:00", end: "2025-10-14T19:00:00-07:00" },
      { start: "2025-10-21T18:00:00-07:00", end: "2025-10-21T19:00:00-07:00" },
      { start: "2025-10-28T18:00:00-07:00", end: "2025-10-28T19:00:00-07:00" }
    ]
  }
}
```

**Detection:** Automatically detected when `raw.seriesDates.length > 1`.

**Recurrence pattern detection:**
- **Daily:** 1 day intervals
- **Weekly:** 7 day intervals
- **Monthly:** 28-31 day intervals
- **Yearly:** 365-366 day intervals
- **Custom:** Irregular intervals

**Database:**
- `occurrence_type`: `'recurring'`
- `recurrence_type`: `'weekly'` (auto-detected)
- Creates 1 series + 4 occurrences

---

### 5. **Virtual/Online Events** ✅
Events with online attendance mode.

**Example:**
```javascript
{
  title: "Webinar on Climate Change",
  startDatetime: "2025-10-15T14:00:00-07:00",
  endDatetime: "2025-10-15T15:30:00-07:00",
  raw: {
    virtualUrl: "https://zoom.us/j/123456789"  // ← Set this
  }
}
```

**Detection:** Set `raw.virtualUrl` in your scraper.

**Database:**
- `occurrence_type`: `'virtual'`
- `is_virtual`: `true`
- `virtual_url`: stored

---

### 6. **Event Status** ✅
Events can be scheduled, canceled, or postponed.

**Example:**
```javascript
{
  title: "Concert (Canceled)",
  raw: {
    eventStatus: "canceled",  // 'scheduled', 'canceled', or 'postponed'
    statusReason: "Due to weather conditions"
  }
}
```

---

## Database Schema

### EventScrape Tables

#### **`event_series`** (Parent Events)
Stores the master event template for recurring series.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `source_id` | UUID | Which scraper found it |
| `run_id` | UUID | Scrape run that created it |
| `source_event_id` | TEXT | External ID from source |
| `title` | TEXT | Event title |
| `description_html` | TEXT | Event description |
| `occurrence_type` | ENUM | `single`, `multi_day`, `all_day`, `recurring`, `virtual` |
| `recurrence_type` | ENUM | `none`, `daily`, `weekly`, `monthly`, `yearly`, `custom` |
| `event_status` | ENUM | `scheduled`, `canceled`, `postponed` |
| `status_reason` | TEXT | Reason for cancellation/postponement |
| `is_all_day` | BOOLEAN | All-day event flag |
| `is_virtual` | BOOLEAN | Virtual event flag |
| `virtual_url` | TEXT | Virtual meeting URL |
| `venue_name`, `city`, etc. | TEXT | Location info |
| `raw` | JSONB | Original scraped data |

#### **`event_occurrences`** (Individual Instances)
Stores each occurrence of an event.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `series_id` | UUID | FK to event_series |
| `sequence` | INTEGER | 1st, 2nd, 3rd occurrence |
| `occurrence_hash` | TEXT | Unique hash for deduplication |
| `start_datetime` | TIMESTAMP | Local timezone start |
| `end_datetime` | TIMESTAMP | Local timezone end |
| `start_datetime_utc` | TIMESTAMP | UTC start |
| `end_datetime_utc` | TIMESTAMP | UTC end |
| `duration_seconds` | INTEGER | Event duration |
| `timezone` | TEXT | Event timezone |
| `has_recurrence` | BOOLEAN | Part of series |
| `is_provisional` | BOOLEAN | Tentative date |

### WordPress Tables

Similar structure in WordPress:
- `wp_event_series`
- `wp_event_occurrences`

---

## How to Update Scrapers

### Step 1: Extract Series Dates

When you find a recurring event on the source website, extract ALL occurrence dates and put them in `raw.seriesDates`:

```javascript
// Example: Extract dates from HTML
const dateElements = page.locator('.event-dates .date-item');
const seriesDates = [];

for (const dateEl of await dateElements.all()) {
  const dateText = await dateEl.textContent();
  const parsed = parseDate(dateText); // Your date parsing logic

  if (parsed) {
    seriesDates.push({
      start: parsed.start.toISOString(),
      end: parsed.end?.toISOString(),
      rawText: dateText  // Optional: keep original text
    });
  }
}

// Add to event
event.raw = {
  ...event.raw,
  seriesDates: seriesDates.length > 0 ? seriesDates : undefined
};
```

### Step 2: Set Virtual URL (if applicable)

```javascript
const zoomLink = await page.locator('.zoom-link').getAttribute('href');

if (zoomLink) {
  event.raw.virtualUrl = zoomLink;
}
```

### Step 3: Set All-Day Flag (if applicable)

```javascript
const isAllDay = await page.locator('.all-day-badge').count() > 0;

if (isAllDay) {
  event.raw.isAllDay = true;
}
```

### Step 4: Set Event Status (if applicable)

```javascript
const statusText = await page.locator('.event-status').textContent();

if (statusText?.includes('Canceled')) {
  event.raw.eventStatus = 'canceled';
  event.raw.statusReason = 'Event has been canceled';
}
```

### Complete Example

```javascript
async function scrapeEventDetail(page, url) {
  await page.goto(url);

  // Extract basic info
  const title = await page.locator('h1.event-title').textContent();
  const description = await page.locator('.event-description').innerHTML();

  // Extract series dates
  const dateElements = await page.locator('.recurring-dates li').all();
  const seriesDates = [];

  for (const dateEl of dateElements) {
    const dateText = await dateEl.textContent();
    const parsed = parseEventDate(dateText);

    if (parsed) {
      seriesDates.push({
        start: parsed.start.toISOString(),
        end: parsed.end?.toISOString(),
        rawText: dateText
      });
    }
  }

  // Check for virtual link
  const virtualUrl = await page.locator('a.zoom-link').getAttribute('href');

  // Check for all-day
  const isAllDay = await page.locator('.badge-all-day').count() > 0;

  return {
    title,
    descriptionHtml: description,
    startDatetime: seriesDates[0]?.start || primaryDate.start,
    endDatetime: seriesDates[0]?.end || primaryDate.end,
    timezone: 'America/Vancouver',
    raw: {
      seriesDates: seriesDates.length > 1 ? seriesDates : undefined,
      virtualUrl: virtualUrl || undefined,
      isAllDay: isAllDay || undefined,
      fullHtml: await page.content()
    }
  };
}
```

---

## Occurrence Detection Logic

The system automatically detects occurrence types based on the data you provide:

```javascript
// From worker/src/lib/occurrence-db.ts

export function detectOccurrenceType(event: ProcessedEvent): OccurrenceType {
  const seriesDates = event.raw?.seriesDates;
  const virtualUrl = event.raw?.virtualUrl;
  const isAllDay = event.raw?.isAllDay;

  // Priority order:

  // 1. Virtual event
  if (virtualUrl) {
    return { occurrenceType: 'virtual', ... };
  }

  // 2. All-day event
  if (isAllDay) {
    return { occurrenceType: 'all_day', ... };
  }

  // 3. Multi-day event (duration > 24 hours)
  if (endDatetime) {
    const durationHours = (end - start) / (1000 * 60 * 60);
    if (durationHours > 24) {
      return { occurrenceType: 'multi_day', ... };
    }
  }

  // 4. Recurring event (has series dates)
  if (seriesDates && seriesDates.length > 1) {
    const pattern = detectRecurrencePattern(seriesDates);
    return { occurrenceType: 'recurring', recurrenceType: pattern, ... };
  }

  // 5. Default: single-day event
  return { occurrenceType: 'single', ... };
}
```

---

## WordPress Integration

Events are uploaded to WordPress with full occurrence metadata:

```javascript
// From apps/api/src/services/wordpress-client.ts

const result = await wordpressClient.importEventWithOccurrences({
  title: event.title,
  content: event.descriptionHtml,
  external_id: event.sourceEventId,
  series_data: {
    occurrence_type: 'recurring',
    recurrence_type: 'weekly',
    is_all_day: false,
    is_virtual: true,
    virtual_url: 'https://zoom.us/...',
    event_status: 'scheduled'
  },
  occurrences: [
    { sequence: 1, start_datetime: '2025-10-07T18:00:00', end_datetime: '2025-10-07T19:00:00' },
    { sequence: 2, start_datetime: '2025-10-14T18:00:00', end_datetime: '2025-10-14T19:00:00' },
    { sequence: 3, start_datetime: '2025-10-21T18:00:00', end_datetime: '2025-10-21T19:00:00' }
  ]
}, imageUrl);
```

WordPress endpoint: `/wp-json/unbc-events/v1/import-event`

---

## Testing Your Scraper

### 1. Test Locally with Example HTML

```bash
# Run your scraper in test mode
curl -X POST http://localhost:3001/api/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "your-source-id",
    "testMode": true
  }'
```

### 2. Check Database for Series

```sql
-- Check if series was created
SELECT
  s.title,
  s.occurrence_type,
  s.recurrence_type,
  COUNT(o.id) as occurrence_count
FROM event_series s
LEFT JOIN event_occurrences o ON o.series_id = s.id
GROUP BY s.id;

-- View all occurrences
SELECT
  sequence,
  start_datetime,
  end_datetime,
  has_recurrence
FROM event_occurrences
WHERE series_id = 'your-series-id'
ORDER BY sequence;
```

### 3. Check Raw Events Table

```sql
-- Check if seriesDates was captured
SELECT
  title,
  raw->'seriesDates' as series_dates,
  raw->'virtualUrl' as virtual_url,
  raw->'isAllDay' as is_all_day
FROM events_raw
WHERE title LIKE '%your event%';
```

### 4. Verify in Admin UI

Go to the EventScrape admin:
- Navigate to "Raw Events"
- Use the "Series events" filter
- Click an event to see the "Series" tab with all occurrences

---

## Common Patterns by Source Type

### Calendar Grid Sites
If the source shows events in a calendar grid:

1. Click each event to get detail page
2. Look for "Recurring dates" or "Series dates" section
3. Extract all dates shown
4. Create `seriesDates` array

### List-Based Sites
If events are shown in a list:

1. Check if multiple date entries link to same event
2. Group by event ID/URL
3. Collect all dates for that event
4. Create `seriesDates` array

### Event Detail Pages
Look for these patterns:
- "Occurs on:" followed by date list
- "Recurring:" with pattern description
- Multiple date badges/chips
- RRULE strings (can parse with library)

---

## Example: Prince George Scraper

The Prince George scraper extracts recurring dates like this:

```javascript
// Extract series dates from detail page
const seriesDatesText = await page.locator('.event-series-dates').textContent();
// "Thu, Oct 2 2025, 12:15 - 1:45pm
//  Thu, Oct 9 2025, 12:15 - 1:45pm
//  Thu, Oct 16 2025, 12:15 - 1:45pm"

const lines = seriesDatesText.split('\n');
const seriesDates = lines.map(line => {
  const parsed = parseDateTimeFromText(line.trim());
  return {
    start: parsed.start,
    end: parsed.end,
    rawText: line.trim()
  };
}).filter(Boolean);

event.raw.seriesDates = seriesDates.length > 1 ? seriesDates : undefined;
```

---

## Troubleshooting

### Issue: Series dates not detected

**Check:**
1. Is `raw.seriesDates` populated in database?
2. Does the array have > 1 item?
3. Are dates in ISO format?

```sql
SELECT raw->'seriesDates' FROM events_raw WHERE id = 'event-id';
```

### Issue: Wrong occurrence type

The detection has priority:
1. Virtual (if virtualUrl set)
2. All-day (if isAllDay = true)
3. Multi-day (if duration > 24hrs)
4. Recurring (if seriesDates.length > 1)
5. Single (default)

Make sure you're setting the right flags!

### Issue: Dates not parsing correctly

Always use ISO 8601 format:
```javascript
// Good
"2025-10-15T18:00:00-07:00"

// Bad
"Oct 15, 2025 6:00 PM"
```

Use `new Date().toISOString()` to ensure correct format.

---

## Next Steps

1. **Update your scraper** following the patterns above
2. **Test with example HTML** files
3. **Verify in database** that series are created
4. **Upload to WordPress** to test full integration
5. **Check WordPress admin** to see occurrences

---

## Files Modified

### EventScrape
- `apps/api/src/db/migrations/0009_event_occurrences.sql` - Database schema
- `apps/api/src/db/schema.ts` - TypeScript types
- `worker/src/lib/occurrence-db.ts` - Detection logic
- `worker/src/worker.ts` - Save events with occurrences
- `apps/api/src/services/wordpress-client.ts` - Upload to WordPress

### WordPress CampusManager
- `includes/class-event-series.php` - Series management
- `includes/class-rest-api.php` - Import endpoint
- `unbc-events.php` - Plugin initialization

---

## Support

For questions or issues:
1. Check this guide first
2. Review example scrapers (Prince George, UNBC)
3. Test with provided HTML examples
4. Check database queries above

Happy scraping! 🎉
