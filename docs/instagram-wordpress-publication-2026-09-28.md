# Instagram publication to the local WordPress calendar — September 28, 2026

Published **20 distinct upcoming Instagram events**, comprising **22 occurrences**, to [the local calendar](https://over-the-edge-local-393fed40.wp.k8s.overtheedgepaper.ca/calendar/). All 20 posts are published and publicly readable. All have featured images attached, using 15 distinct saved posters. Post IDs are 24181–24200.

## Selection and review

The inventory covered all 1,058 stored Instagram rows, including the 465 marked as events. Publication used actual extracted event dates, not Instagram publication timestamps. The cutoff was September 28, 2026 in America/Vancouver, consistent with the requested upcoming-only scope.

Twenty-one upcoming candidate entries became 20 events after merging the duplicate Grad Info Session advertisement. Past and undated entries were excluded. An older six-month internship that began in April was excluded from upcoming publication even though its period ends September 30. The undated meeting photo was not assigned an invented date.

- GeoGuessr retains October 1, 8, and 15 as three occurrences.
- The backpacking trip retains October 10–12, with date-only/all-day display semantics; no departure time was supplied.
- The five rush-week events retain their separate October 5–9 dates. Their poster and the UNBC Alpha Pi Beta account contradicted AI-invented California geography. The new extracted records use Prince George, BC, Canada and America/Vancouver, with correction provenance. Original extraction snapshots remain in the operator evidence.
- Karaoke Night remains **October 1, 2027**, as explicitly printed on its poster and verified in the earlier extraction review.
- ESA Meeting retains its next dated occurrence, October 1 at 17:30, and weekly recurrence metadata. No recurrence end or explicit future dates were provided, so additional dates were not invented. Its upload summary reports this limitation.

Twenty distinct extracted records were created with selected-event raw data and source-post provenance. Base posts remain review records. The local destination's Instagram category mapping now points to **Clubs (194)**; all 20 published posts carry that category. Production WordPress and export schedules were not changed.

## Upload corrections and deployment

The Convex uploader now selects the relevant entry from multi-event posters using the extracted source index, with title/date matching for legacy identities. It reads nested explicit recurrence dates, preserves date-only multi-day ends, carries extracted cost, honors `includeMedia: false`, and warns when recurrence metadata lacks additional dates. These changes were deployed to the existing Convex service.

Image transfer for this batch used authenticated multipart uploads to WordPress's standard media endpoint, then the existing Campus Manager import reused the matching attachments. The local-copy outbound protection remained enabled. Raw binary upload with a Content-Disposition header failed because WordPress received no such header through the proxy; multipart succeeded. This was an operator-assisted media preparation step, **not an automatic image-transfer fallback added to EventScrape**. New remote images may still need this treatment on the local site.

Campus Manager and the theme were not edited or released in this operation.

## Verification

- All **16 upload regression tests** passed; Convex TypeScript checking and deployment passed.
- Unauthenticated REST read-back verified all 20 published posts, external IDs, featured-media IDs, event dates, costs, and all expected occurrence starts. The trip's final date and all-day flag were checked explicitly.
- Paginated public calendar reads returned all **22 expected occurrences**, including the 2027 karaoke date. The API caps pages at 100 even when a larger page size is requested; verification followed `pagination.hasMore`.
- Re-pushing GeoGuessr with updates disabled returned `skipped`, the same post ID, and unchanged occurrence rows.
- Browser checks confirmed the Clubs filter, upcoming list, and Learn to Camp dialog with September 29, 18:00–19:30, venue, and organization.
- **Zero image-import warnings** remain for this batch. The one remaining upload warning concerns ESA recurrence dates.

Display limitations observed: the current calendar dialog and generic event-page template do not display the attached posters. The generic event page uses article publication-date presentation rather than event-specific details; the calendar dialog displays the actual event date. The list also renders an unknown ESA end time as the same time as its start. These are presentation follow-ups, not unpublished or missing imported records.

Operator evidence is under `/tmp/eventscrape-instagram-publish-2026-09-28/`, including the selection plan, original records, media and upload results, public read-back, duplicate retry, category baselines, and verification summary. These temporary files are not a durable backup.
