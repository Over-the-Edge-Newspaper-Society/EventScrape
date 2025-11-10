# Prince George Module Refactor Notes

## Overview

The `worker/src/modules/prince_george_ca` scraper was originally a single ~1,000 line file that mixed DOM helpers, Playwright navigation, and event post-processing. The refactor breaks it into cohesive pieces so logic is easier to test, reuse, and apply to other modules.

### Key Goals

- Reduce `index.ts` to the orchestration glue (date window handling, run pipeline).
- Extract pure helpers that don't require Playwright context into reusable files.
- Make tests consume the same helpers used in production to avoid duplication.
- Set up a repeatable testing environment via Docker to ensure consistent Playwright/browser versions.

## File Structure

```
worker/src/modules/prince_george_ca/
├── fixtures/                    # existing HTML snapshots
├── index.ts                     # orchestrates the scraper run
├── prince_george_ca.test.ts     # Vitest suite exercising helpers + fixtures
├── types.ts                     # shared CalendarEventLink & DetailPageSeriesEntry
└── utils/
    ├── calendar.ts              # navigateToMonth + extractEventsFromCurrentMonth
    ├── detail-page.ts           # DOM extraction + series normalization
    └── event-processor.ts       # combines calendar links with detail page data
```

### What Lives Where

| Responsibility | File |
| --- | --- |
| Scraper metadata + run logic (`startUrls`, pagination loop) | `index.ts` |
| `CalendarEventLink` / series types shared across helpers | `types.ts` |
| Calendar UI automation (switching views, scraping rows) | `utils/calendar.ts` |
| Detail-page DOM parsing, date/time normalization, dedup | `utils/detail-page.ts` |
| Visiting detail URLs, caching series, building `RawEvent`s | `utils/event-processor.ts` |

## Testing Adjustments

- `prince_george_ca.test.ts` now loads fixtures via `__dirname` to match the worker package structure.
- The description selector matches the actual markup (`.field--name-body.field--type-text-with-summary ...`).
- Series normalization expectations were aligned with the dedup logic, ensuring recurring events collapse to unique instances.
- A `docker-compose.playwright.yml` + `scripts/playwright-test.sh` runner executes the module suite inside Microsoft’s official Playwright image for deterministic browser deps.

## Applying to Other Modules

1. **Identify Helper Boundaries**
   - Look for inline DOM utilities, Playwright navigation helpers, data post-processing, and shared types.
2. **Create `utils/` Folder**
   - Mirror the pattern above: `calendar.ts`, `detail-page.ts`, `event-processor.ts`, etc., as needed.
3. **Move Types**
   - Extract repeated inline type aliases (calendar link, detail entry) into a local `types.ts`.
4. **Rewire `index.ts`**
   - Import helpers and keep only the module config + orchestration path.
5. **Update Tests**
   - Point fixtures using `__dirname`.
   - Reuse the exported helpers via `__testables` so tests exercise real code paths.
6. **Add/Update Docker Runner (optional)**
   - If another module needs heavy Playwright/browser setup, it can reuse `docker-compose.playwright.yml` + `scripts/playwright-test.sh` with a different command.

## Benefits

- Smaller files and clearer separation of concerns.
- Tests focus on pure helpers without spinning up Playwright unless necessary.
- Easier to share calendar/detail logic across modules that scrape similar Drupal/FullCalendar instances.
- Reusable Docker runner for deterministic browser-based tests.

Use this pattern as a template when refactoring other city modules to keep the worker codebase maintainable as more sources are added.
