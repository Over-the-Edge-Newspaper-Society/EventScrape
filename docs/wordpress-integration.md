# WordPress integration with Campus Manager

Verified September 28, 2026. Campus Manager [2.3.1](https://github.com/Over-the-Edge-Newspaper-Society/campusmanager/releases/tag/v2.3.1) is published as a full stable release. Its ZIP and stable updater manifest were verified after the release CI passed. Publishing that release does not install it automatically on a WordPress site.

## Configure and upload

1. Install or update Campus Manager from its release ZIP or stable WordPress updater.
2. In EventScrape's WordPress settings, select the intended HTTPS site and configure a WordPress username and application password. The active Convex uploader sends Basic authentication with those credentials; this is distinct from the plugin's separately supported legacy `X-API-Key` header.
3. Check the connection, then select a small sample of events, the destination, and the desired post status. Manual uploads default to Draft.
4. Review the saved, skipped, failed, and warned counts and the individual results. Read the resulting events back from WordPress to verify content and dates.
5. Confirm the schedule's destination and status before enabling recurring exports. The existing local-test destination has no export schedule.

The import endpoint is `POST /wp-json/unbc-events/v1/import-event`. The WordPress user needs `edit_events` to create events, permission to edit the actual target to update it, and `publish_events` for published/private/future events. Organization managers are restricted to their assigned organization. Authentication does not bypass those checks.

## Interpret the result

| Result | Meaning and next step |
| --- | --- |
| Invalid credentials return HTTP 401 | Expected negative test. No authentication fix is needed when valid credentials succeed. If real credentials fail, check the destination, username, application password, and proxy forwarding. |
| Authenticated request returns HTTP 403 | The user lacks permission for the requested event, organization, or status. Check intended permissions; changing the password does not grant publishing rights. |
| Saved as Draft | Draft was selected/defaulted. Publishing requires selecting Publish and an account with `publish_events`. The initial test account was draft-only; it now has local event publishing permissions after the authorized publication described below. |
| Saved with `local_copy` image warning | The local WordPress copy blocked the outbound image request. The event was saved and any existing featured image preserved. The copy protection remains enabled. |
| Skipped | Existing event was retained under the selected duplicate/update behavior. This is not a new save. |
| Failed | Inspect the event's error. A batch can contain both successful and failed events. |

The manual upload panel shows counts, event titles, warning messages, and failures until dismissed, replaced by a later result, or the page is left/reloaded. Older plugin responses without `warnings` or `media` remain compatible. Scheduled batch log messages include warning/skip counts; Export History does not yet store per-event warnings.

## Zoer-managed local sites

The tested request path is:

```text
EventScrape → managed HTTPS WordPress hostname → Zoer proxy → DDEV bridge → WordPress
```

Zoer authenticates to its bridge with a private bridge credential. WordPress application-password credentials travel separately and are restored as `Authorization` only for approved managed HTTPS REST routes under `/wp-json/wp/v2/` and `/wp-json/unbc-events/v1/`. WordPress and Campus Manager still validate authentication and event permissions. Do not substitute the bridge credential for a WordPress application password.

## Compatibility evidence

The real deployed EventScrape action replayed 14 previously scraped events against the authorized local clone using the existing application password and Campus Manager beta.2 candidate. It returned **14 updated, 0 failed, 0 skipped, 5 with warnings**. Read-back preserved all 18 occurrences, post IDs, draft statuses, content, categories, and featured-image values. Incorrect credentials returned HTTP 401. This was a local compatibility test, not bulk production publication.

That plugin candidate was promoted to stable 2.3.1. Its [release workflow](https://github.com/Over-the-Edge-Newspaper-Society/campusmanager/actions/runs/36456035565) passed PHP checks, frontend lint/type checks/tests/builds, disposable WordPress integration tests, and package inspection. The live replay was performed on beta.2; no subsequent production WordPress deployment is claimed.

See [Campus Manager's fixes and verification](https://github.com/Over-the-Edge-Newspaper-Society/campusmanager/blob/main/FIXES-2026-09-28.md) and [the warning-panel browser check](wordpress-upload-warnings-2026-09-28.md).

## Remaining limitations

- `includeMedia: false` prevents Convex-storage image resolution/upload, but the current import path still passes an event's remote `imageUrl`. It is not yet a reliable switch for suppressing all image requests. Image restrictions in WordPress remain enforced independently.
- Per-event warning persistence in Export History is not implemented.
- A Zoer “Test REST connection” action with separate reachability, authentication, event permissions, endpoint availability, and local-copy restriction checks remains a proposed follow-up. EventScrape's existing connection test is not proof of every import permission or image outcome.

## Local publication follow-up — September 28, 2026

At the user's request, the 14 previously imported local drafts were re-pushed through `wordpressUpload:uploadEvents` with `status: publish` and `updateIfExists: true`. The local `api_publisher` account received `publish_events` and `edit_published_events`, permitting publication and later updates of its own events. No permission to edit other users' events was added.

Result: **14 updated/published, 0 failed, 0 skipped, 5 image warnings**. Existing post IDs, content, categories, featured-image values, and all 18 occurrences were preserved. All 14 posts were readable through unauthenticated WordPress REST requests, and all 18 occurrences appeared in the public calendar API across their stored dates. The browser showed “Games Night at Legion 43” on October 1 at 6:00 PM. [Public-calendar screenshot](verification/2026-09-28-published-local-events.png).

This operation published the existing local sample, not the entire scraped catalogue or a production-site export. Manual upload still defaults to Draft; select Publish for future manual uploads. No scheduled export destination or status was changed. The September 28 selected-day panel can remain empty because none of these imported occurrences is dated September 28. The five image warnings remain expected under the local-copy outbound protection.

The pre-publication REST snapshot and upload/read-back results are retained under `/tmp/cm-publish-local-2026-09-28/` on the operator's machine.

## Full upcoming catalogue follow-up

The later [catalogue audit and recovery](upcoming-publication-2026-09-28.md) published **1,145 additional events** to the local clone and appended **80 dates to 42 existing events**, preserving their history. Public REST and calendar verification covered **1,258 valid event groups**; one malformed placeholder was excluded. The earlier 14-event sample is historical evidence, not the current local catalogue size.

The operation also deployed invalid-end warnings in EventScrape and concurrency/error safeguards in Campus Manager. There were 84 unknown-end warnings and 130 image warnings, with no unresolved valid-event imports after recovery. The plugin safeguards and calendar contrast patch are newer than the stable 2.3.1 release ZIP. The local site still has no recurring export schedule.
