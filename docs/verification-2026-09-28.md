# Live scrape and local WordPress verification — 2026-09-28

> Initial verification record, retained for traceability. Later scraper reruns and WordPress fixes are summarized below. For current behavior, see [WordPress integration](wordpress-integration.md) and [final scraper verification](run-fixes-2026-09-28.md).

All 17 active website modules were manually queued on the Kubernetes EventScrape worker. 15 runs completed successfully, 2 exhausted their three retries. Completed runs processed **1,411 events**, inserted **1,209**, and left **202 unchanged**. These totals count source records, not unique events across sources. At the time of this initial sweep, the runs UI's `eventsFound` counted inserts/updates. New runs now record found/new/updated/unchanged/failed separately; historical counts were not rewritten.

Instagram remains disabled and was not enabled for this website sweep. The demo source and AI poster upload source are not website scrapers. This manual sweep does not add recurring schedules for the 11 newly registered sources; six website schedules remain enabled.

| Source | Result | Processed | New | Unchanged | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| caledonianordic_com | success | 5 | 5 | 0 |  |
| caledoniaramblers_ca | success | 8 | 8 | 0 |  |
| cncentre_ca | success | 39 | 39 | 0 |  |
| downtownpg_com | success | 38 | 18 | 20 |  |
| fraserfinds_ca | success | 890 | 890 | 0 |  |
| legion43pg_ca | success | 8 | 8 | 0 |  |
| northernlightswinery_ca | success | 1 | 1 | 0 |  |
| ominecaartscentre_com | success | 144 | 143 | 1 |  |
| pgara_ca | success | 5 | 5 | 0 |  |
| pgpl_ca | success | 41 | 0 | 41 |  |
| pgpride_com | error | — | — | — | Failed after 3 attempts: navigation waiting for networkidle timed out. |
| prince_george_ca | success | 35 | 2 | 33 |  |
| theexplorationplace_com | success | 77 | 77 | 0 |  |
| tourismpg_com | error | — | — | — | Failed after 3 attempts: calendar selector timed out. Browser inspection: selecting Calendar loads the JetEngine table; scraper needs to open that tab before waiting. |
| tworiversgallery_com | success | 0 | 0 | 0 | Completed with zero events; requires extraction/data-field investigation. |
| unbc_ca | success | 50 | 13 | 37 |  |
| unbctimberwolves_com | success | 70 | 0 | 70 |  |

## Local WordPress import

Target: https://over-the-edge-local-393fed40.wp.k8s.overtheedgepaper.ca/

- Activated installed Campus Manager 2.3.0 through Zoer's extension plan/apply workflow. Integrity-checked backup `2026-09-28T15-10-08-461Z-9a4de839`; health stayed at zero critical checks.
- The local copy had only its administrator account. Created `api_publisher` with an unshared random login password, author role plus the `edit_events` capability, and the same existing EventScrape application password requested by the user. Only a one-way application-password hash was sent through the terminal setup.
- Added a separate EventScrape WordPress destination `OTE Local — Sep 28 import test` (`m57978dgxzhb281zzzkd6ajvyh8f8abe`). Existing production destination and export schedules were preserved. No export schedule targets the local setting.
- Fixed Zoer's managed WordPress proxy and private DDEV bridge to transport Basic authorization separately from bridge authorization, limited to managed HTTPS, canonical `/wp-json/wp/v2/` and `/wp-json/unbc-events/v1/` routes. Generic proxy headers still exclude credentials.
- Same-key authenticated `/wp-json/wp/v2/users/me` succeeded. Incorrect credentials returned HTTP 401.
- The real deployed `wordpressUpload:uploadEvents` action created **14 draft posts** (IDs 22379–22392), representing each successful nonempty source. This was a representative test push, not a bulk publication of all scraped events.
- Authenticated REST read-back verified all 14 titles (after normal HTML-entity decoding), draft statuses, category IDs, dates/times, and metadata. Database read-back confirmed **18 occurrence rows**, including three recurring series (2, 2, and 3 occurrences).
- Repeating the identical 14-event push returned `skipped` for every event with the same post IDs: no duplicates.
- WordPress admin visibly shows Drafts (14). Screenshot: `verification/2026-09-28-local-drafts.png`.

## Follow-up status after fixes and stable release

- **Completed — Campus Manager image reporting:** blocked/failed downloads now return `warnings` and structured `media` results. The local-copy guard remains enabled and existing featured images are preserved. These changes are included in [stable 2.3.1](https://github.com/Over-the-Edge-Newspaper-Society/campusmanager/releases/tag/v2.3.1).
- **Completed — EventScrape warning display:** the action preserves warnings/media and the manual upload panel displays saved, skipped, failed, and warned results. See [browser verification](wordpress-upload-warnings-2026-09-28.md).
- **Completed — local compatibility replay:** all 14 existing events updated with 0 failures, 0 skips, and 5 image warnings; all 18 occurrences survived read-back. The valid application password worked, and deliberately invalid credentials returned HTTP 401 as expected. This replay used the beta.2 candidate subsequently promoted to stable 2.3.1.
- **Completed — scraper fixes:** PG Pride, Tourism PG, and PGPL full reruns passed with 7, 166, and 41 events respectively. The final Tourism fix addressed browser identity/HTTP readiness and date extraction; the initial Calendar-tab diagnosis above was preliminary. See [final run evidence](run-fixes-2026-09-28.md).
- **Open — media opt-out:** `includeMedia: false` still does not suppress a remote `event.imageUrl` passed to the importer. Warning propagation is fixed, but this separate media-option behavior remains unresolved.
- **Open — source coverage:** Two Rivers' empty extraction needs investigation. The eleven newer website sources still lacked schedules at verification, and Instagram remained disabled.
- **Proposed — Zoer connection diagnostics:** a read-only action should distinguish reachability, authentication, event permissions, import endpoint availability, and local-copy image restrictions without publishing a probe or exposing credentials.

## Deployment and rollback

Zoer backend image: `docker.io/zoer-local/backend:dev-1790608802-7a11bd2-dirty`, built as a two-file layer over the exact running image `dev-1790607211-7a11bd2-dirty`. This avoided shipping unrelated changes in the shared Zoer checkout. Typechecking passed in the image; 16 focused proxy/bridge tests passed locally. Deployed file bytes were compared with maintained source. The frontend image was unchanged.

The cluster has no Flux resources, so Zoer's upstream server-dev activation helper cannot run here. Used the Proxmox cluster's local-image path, with an explicit compare-before-update and no active plugin runs/workers before rollout. Deployment annotation `zoer.previous-image` records the prior backend. Updated only the backend tag in Proxmox-Playbook's existing overlay, preserving its other changes. The new backend image is pinned in containerd.

DDEV bridge source backup: `/opt/zoer-ddev-bridge/src/http-proxy.ts.before-dev-1790608802-7a11bd2-dirty` on the Kubernetes node. Restoring it and restarting `zoer-ddev-bridge` reverts that transport change. Roll back the backend image as a paired operation if needed. That initial proxy/bridge deployment did not modify Campus Manager PHP or a distributed plugin ZIP. Subsequent plugin fixes and the stable release are recorded in the follow-up status above.
