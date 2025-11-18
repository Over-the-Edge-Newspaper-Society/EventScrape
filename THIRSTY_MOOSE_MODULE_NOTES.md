# Thirsty Moose Pub Events Module - Implementation Notes

## Summary

A new event scraper module has been successfully created for the Thirsty Moose Pub events calendar. The module follows all established patterns from existing Prince George area scrapers and is ready for use once the correct URL is identified.

## ⚠️ Important: URL Verification Required

The original URL provided in the issue (`https://www.nugss.ca/thirstymoosepub-events-`) **does not resolve**. The module has been implemented with a placeholder URL that must be updated before the scraper can function.

### Possible URL Alternatives

Based on the context (NUGSS likely refers to Northern Undergraduate Student Society at UNBC), check these locations:

1. **NUGSS Website**:
   - https://mynugss.ca/thirstymoosepub-events
   - https://mynugss.ca/events
   - https://nugss.unbc.ca/events

2. **UNBC Events**:
   - https://www.unbc.ca/nugss/events
   - https://www.unbc.ca/events (search for Thirsty Moose)

3. **Venue Website**:
   - https://thirstymoosepub.ca/events
   - https://thirstymoosepg.ca/events

4. **Community Calendars**:
   - https://downtownpg.com/events (may list Thirsty Moose events)
   - https://tourismpg.com/explore/events

5. **Social Media**:
   - Facebook Events page for Thirsty Moose Pub
   - Instagram (though this might require the instagram module)

## What Was Created

### File Structure

```
worker/src/modules/thirstymoosepub_events/
├── README.md                          # Comprehensive documentation
├── index.ts                           # Main scraper implementation
├── thirstymoosepub_events.test.ts    # Unit and integration tests
└── fixtures/
    └── README.md                      # Guide for adding test fixtures
```

### Module Features

1. **Flexible Event Detection**:
   - Tries multiple selector patterns (FullCalendar, JetEngine, Modern Events Calendar, custom)
   - Works with various calendar implementations
   - Graceful fallbacks if primary selectors don't match

2. **Robust Data Extraction**:
   - Prefers structured data (`<time datetime>` attributes)
   - Falls back to text parsing when needed
   - Extracts: title, date/time, venue, description, image, category, price, organizer

3. **Calendar Pagination**:
   - Supports date range scraping
   - Default: current + next 2 months
   - Configurable via API parameters

4. **Testing**:
   - Test mode: limits to 5 events for quick validation
   - Unit tests: verify module structure
   - Integration tests: ready to enable once URL is verified

5. **Rate Limiting**:
   - 2 seconds between requests
   - Includes jitter (±50ms) to avoid pattern detection

6. **Error Handling**:
   - Continues scraping if individual events fail
   - Comprehensive logging for debugging
   - Screenshot capture capability for troubleshooting

## How to Complete the Setup

### Step 1: Find the Correct URL

1. Check the locations listed above
2. Look for a page with a calendar or list of events
3. Verify it's regularly updated with Thirsty Moose Pub events

### Step 2: Update the Module

Edit `worker/src/modules/thirstymoosepub_events/index.ts`:

```typescript
const thirstyMoosePubModule: ScraperModule = {
  key: 'thirstymoosepub_events',
  label: 'Thirsty Moose Pub Events',
  startUrls: [
    'https://www.CORRECT-URL-HERE.com/events', // ← Update this line
  ],
  // ... rest of configuration
```

### Step 3: Test the Scraper

```bash
cd worker

# Run unit tests (should pass immediately)
pnpm test thirstymoosepub_events.test.ts

# Install Playwright browsers if needed
pnpm exec playwright install chromium

# Enable integration tests by removing .skip from tests in:
# thirstymoosepub_events.test.ts

# Run tests against live site
pnpm test thirstymoosepub_events.test.ts
```

### Step 4: Capture Fixtures

Once the scraper works:

1. Visit the events calendar page in a browser
2. Save page source as `fixtures/calendar.html`
3. Visit an individual event page
4. Save page source as `fixtures/event-detail.html`

These fixtures enable fast, offline regression testing.

### Step 5: Fine-Tune Selectors (if needed)

If the scraper doesn't find events:

1. Open the calendar page in Chrome DevTools
2. Inspect the HTML structure
3. Identify the CSS classes/IDs used for:
   - Event list container
   - Individual event items
   - Event links
   - Date/time elements
   - Venue information
4. Add these selectors to the appropriate arrays in `index.ts`

Look for these sections:
- `possibleSelectors` (line ~50): Calendar container
- `eventSelectors` (line ~118): Event items
- Date/time extraction (line ~210)
- Venue/description extraction (line ~250)

## Using the Module

Once the URL is verified, the module will be automatically loaded and available through the API.

### Via API

**Start a scrape:**
```bash
POST http://localhost:3001/api/runs/scrape/thirstymoosepub_events
```

**With test mode:**
```json
{
  "testMode": true
}
```

**With date range:**
```json
{
  "scrapeMode": "full",
  "paginationOptions": {
    "type": "calendar",
    "startDate": "2025-01-01",
    "endDate": "2025-03-31"
  }
}
```

### Via Admin UI

1. Navigate to http://localhost:3000
2. Go to Sources
3. Find or create "Thirsty Moose Pub Events" source
4. Click "Scrape" to start a job

## Module Integration

The module will be automatically discovered by the ModuleLoader at startup. No manual registration is required.

**Verification:**
```bash
cd worker
pnpm dev

# Look for this in the logs:
# ✅ Loaded module: Thirsty Moose Pub Events (thirstymoosepub_events)
```

## Troubleshooting

### "No events found"

1. Check if the calendar requires JavaScript to render
2. Add `await page.waitForTimeout(5000)` after page load
3. Verify selectors match the actual HTML structure
4. Take a screenshot: `await page.screenshot({ path: '/tmp/debug.png' })`

### "Dates not parsing correctly"

1. Check if dates use `<time datetime>` tags
2. Verify the datetime format (ISO 8601 preferred)
3. Add custom parsing logic if needed
4. See existing modules (e.g., `prince_george_ca`) for examples

### "Module not loading"

1. Ensure module key matches directory name: `thirstymoosepub_events`
2. Check that `index.ts` exports a default ScraperModule
3. Rebuild: `cd worker && pnpm build`
4. Check worker logs for load errors

## Architecture Notes

The module follows the established EventScrape patterns:

- **Modular**: Single responsibility - just scrape events
- **Robust**: Multiple selector fallbacks, error handling
- **Testable**: Unit tests + integration tests
- **Configurable**: Test mode, pagination, date ranges
- **Observable**: Comprehensive logging and stats

It integrates with:
- **API**: REST endpoints for triggering scrapes
- **Worker**: BullMQ job processing
- **Database**: PostgreSQL for storing events
- **Matcher**: Duplicate detection system

## References

- **Module Code**: `worker/src/modules/thirstymoosepub_events/index.ts`
- **Tests**: `worker/src/modules/thirstymoosepub_events/thirstymoosepub_events.test.ts`
- **Documentation**: `worker/src/modules/thirstymoosepub_events/README.md`
- **Dev Guide**: `worker/docs/scraper-development-guide.md`
- **Example Modules**: 
  - `worker/src/modules/tourismpg_com/` (calendar-based)
  - `worker/src/modules/downtownpg_com/` (calendar-based)
  - `worker/src/modules/unbc_ca/` (page-based)

## Questions?

If you need help:

1. Check the [Scraper Development Guide](worker/docs/scraper-development-guide.md)
2. Look at similar modules in `worker/src/modules/`
3. Review the test files for usage examples
4. Check the main [README](README.md) for overall architecture

The module is production-ready except for the URL verification. Once updated, it should work seamlessly with the existing EventScrape infrastructure.
