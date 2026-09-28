# Upcoming events on the local calendar — September 28, 2026

Target: [local calendar](https://over-the-edge-local-393fed40.wp.k8s.overtheedgepaper.ca/calendar/). The user selected all upcoming events. The previous operation had published only the 14-event compatibility sample.

## Catalogue and scope

The stored scrape catalogue contained 1,470 upcoming records from active website sources, using September 28 at midnight in America/Vancouver as the cutoff and including series with upcoming occurrences. Matching by external identity and title/date/time grouped 211 overlapping listings, preferring direct providers over aggregators. The initial 1,259 event groups comprised 114 existing published events and 1,145 missing events. One existing Downtown Prince George record was a malformed “Events” placeholder whose timestamp was the scrape time; it was excluded from upcoming publication, leaving 1,258 valid groups.

The inactive Instagram source was excluded. Two Rivers Gallery had no stored records; Northern Lights Winery had no upcoming direct-source records. Aggregators can still supply events from those venues. This publication uses the available catalogue; it does not establish that every provider's website has been scraped exhaustively. Some provider dates extend into 2028.

Production WordPress and export schedules were unchanged. The local destination still has no recurring export schedule. Manual uploads still default to Draft; this operation explicitly selected Publish.

## Upload fixes

- **Invalid scraped end times:** 84 Fraser Finds records had an end before the start, often midnight with no source end time. EventScrape now omits unreliable ends and reports an unknown-end warning after a successful save. It preserves valid overnight ends and leaves source records intact. Single events, recurring occurrences, and raw local date/time inputs are covered. Failed and skipped imports do not claim a normalization save.
- **False success under overlapping imports:** public REST read-back and direct database checks found 504 absent posts despite successful import responses. Campus Manager now serializes REST imports per site with a database advisory lock, covering duplicate lookup and transactional writes. A query guard aborts when a WordPress hook leaves an unchecked SQL error. Rollback clears the existing post cache even when a hook throws before `wp_update_post()` returns. The exact server deadlock diagnostic was unavailable to the site's database user, so the observed concurrency failure is not presented as a confirmed InnoDB diagnosis.
- **Stale existing series:** 25 existing events were missing 63 upcoming dates. These dates were validated with Campus Manager and appended transactionally after a baseline comparison. All 79 previous occurrence rows, post IDs, metadata, series records, and content were preserved. The integration user's permissions were not broadened.

The recovery retried only missing records, with `updateIfExists: false`. Every successful recovery batch was read back through unauthenticated REST. Two SQL failures were correctly surfaced by the new guard and succeeded on a later retry. Backed-up orphan metadata, series, occurrences, and term relationships from the 504 absent post IDs were removed only after confirming the parents were absent and the rows matched the backup.

Final date comparison also found 17 older Downtown Prince George posts with newly scraped dates but only a past occurrence in WordPress. Their 17 latest dates were appended, preserving the prior 17 rows. Combined with the series repair, this added **80 dates to 42 existing events**, retaining **all 96 previous rows**.

## Deployment and verification

EventScrape's Convex upload action was deployed to the events cluster. Campus Manager's maintained PHP service was deployed and byte-verified on the local DDEV site. These plugin changes, like the earlier calendar contrast fix, are newer than the published 2.3.1 ZIP; no new stable release is implied.

- EventScrape: 11 upload regression tests passed; Convex TypeScript checking and deployment passed.
- Campus Manager: PHP syntax checking, 11 standalone media tests, and 57 WordPress integration checks passed. The integration run included ignored-hook SQL failure, rollback, permission boundaries, rejected invalid credentials, recurrence preservation, export round trips, and calendar pagination beyond 500 occurrences. Test fixtures were removed.
- Final public verification: **1,145 new published events + 113 existing events = 1,258 valid event groups**, with no unresolved valid records. All new posts were publicly readable. All expected upcoming dates on the existing posts were present. The calendar API returned 1,330 occurrences across September 28–December 31, 2026 (892), 2027 (324), and 2028 (114). These calendar totals include other existing site events.
- Warnings: **84 unknown end times** and **130 events with image warnings**. Images remain subject to local-copy outbound protection. These warnings do not make the saved events drafts.
- Browser: the September 28 selected-day panel now contains events, and the calendar text is readable. [Calendar screenshot](verification/2026-09-28-upcoming-local-events.png).
- A local installable package was built as `campusmanager/build/campus-manager-2.3.1-import-recovery.zip` and passed package inspection. It includes the current import service and earlier contrast fix; the stable release asset was not replaced.

Operator snapshots, batch responses, the recurring-date backup, and verification results are under `/tmp/cm-full-import-2026-09-28/`. These temporary files are local operational evidence, not committed credentials or durable backups.
