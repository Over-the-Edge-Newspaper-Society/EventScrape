# Thirsty Moose Pub Events Scraper

This module scrapes events from the Thirsty Moose Pub event calendar.

## Status

⚠️ **URL Verification Required**

The original URL provided (`https://www.nugss.ca/thirstymoosepub-events-`) does not resolve. This module has been created with a placeholder URL that needs to be updated once the correct URL is verified.

## Configuration

- **Module Key**: `thirstymoosepub_events`
- **Label**: Thirsty Moose Pub Events
- **Pagination Type**: `calendar`
- **Integration Tags**: `['calendar']`

## How to Update the URL

1. **Find the correct URL** for the Thirsty Moose Pub events calendar. Possible locations:
   - NUGSS (Northern Undergraduate Student Society) website
   - UNBC (University of Northern British Columbia) events page
   - Downtown Prince George directory
   - Direct venue website

2. **Update the startUrls** in `index.ts`:
   ```typescript
   startUrls: [
     'https://www.correct-url.com/events', // Replace with actual URL
   ],
   ```

3. **Test the scraper**:
   ```bash
   cd worker
   pnpm test thirstymoosepub_events.test.ts
   ```

4. **Capture fixtures** for regression testing:
   - Visit the events calendar page
   - Save the HTML source to `fixtures/calendar.html`
   - Visit a sample event detail page
   - Save the HTML source to `fixtures/event-detail.html`

5. **Update the integration tests** in `thirstymoosepub_events.test.ts`:
   - Remove the `.skip` from integration tests
   - Add tests using the fixtures
   - Run tests against the live site

## Features

The scraper includes:

- **Multiple selector fallbacks**: Tries various common selectors to find events on different calendar implementations
- **Structured data support**: Prefers `<time datetime>` attributes over text parsing
- **Calendar pagination**: Supports date range options for scraping multiple months
- **Test mode**: Limits to 5 events for quick testing
- **Rate limiting**: Includes jitter to avoid overwhelming the server
- **Error handling**: Continues scraping even if individual events fail
- **Event deduplication**: Prevents duplicate URLs from being scraped

## Supported Calendar Types

The scraper attempts to detect and work with:
- FullCalendar (`.fc-*` classes)
- JetEngine Calendar (`.jet-calendar-*` classes)
- Modern Events Calendar (`.mec-*` classes)
- Custom implementations (generic `.event-*`, `.calendar-*` classes)

## Usage

Once the URL is verified, the module will be automatically loaded by the worker and can be used through the API:

```bash
POST /api/runs/scrape/thirstymoosepub_events
```

### Test Mode

```json
{
  "testMode": true
}
```

### With Date Range

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

## Troubleshooting

### Common Issues

1. **Events not found**: Check the selector patterns in the `extractEventLinks` section
2. **Dates not parsing**: Verify the date format and update the extraction logic
3. **Missing fields**: Add additional selectors for venue, description, etc.

### Debugging

Enable debug logging to see what's happening:

```typescript
logger.info(`Found ${eventLinks.length} event links`);
```

Take screenshots for visual debugging:

```typescript
await page.screenshot({ 
  path: '/tmp/thirstymoosepub-debug.png', 
  fullPage: true 
});
```

## Contributing

When updating this module:

1. Test with multiple event types (single, recurring, all-day)
2. Verify date/time extraction accuracy
3. Check that all required fields are captured
4. Add regression tests with fixtures
5. Update this README with any special considerations

## References

- [Scraper Development Guide](../../docs/scraper-development-guide.md)
- [Example Module](../example_com/index.ts)
- [Similar Calendar Scrapers](../tourismpg_com/index.ts)
