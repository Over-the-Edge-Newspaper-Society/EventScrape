# WordPress upload warning verification — September 28, 2026

EventScrape now preserves Campus Manager's `warnings` and `media` response fields. The manual upload page retains a results panel with saved, skipped, failed, and warned event counts, event titles, warning messages, and individual failures. Its toast uses the returned outcomes rather than the number selected. Missing image messages receive a fallback warning when structured media status is failed or skipped. Older plugin responses without the new fields remain supported.

The action's message includes warnings and skips. Scheduled workers retain compatibility with its existing `Uploaded N events, M failed` prefix, and their batch log now includes the appended counts. This change does not add per-event warning storage to Export History.

## Validation

- `pnpm exec tsx --test scripts/tests/wordpress-upload.test.ts`: 5 passed (action response propagation, old plugin compatibility, mixed outcomes, missing warning fallback, HTTP failure).
- Convex and admin TypeScript checks passed. Admin production build passed.
- Convex functions deployed to the existing Kubernetes-backed service.
- Admin image `docker.io/eventscrape-local/admin:dev-1790610980-wp-warnings-contrast` deployed successfully. Built static files were layered on the existing admin image; the worker image was unchanged. Infrastructure overlay pins the new admin tag. Rollback annotation retains the preceding admin image `dev-1790610212-2e97461-dirty`.
- Five existing image-bearing local drafts retried through `wordpressUpload:uploadEvents` with the same application password: **Uploaded 5 events, 0 failed, 0 skipped, 5 with warnings**. Each returned `media.error_code: local_copy` and the explanatory warning.
- Duplicate retry: **Uploaded 0 events, 0 failed, 1 skipped, 0 with warnings**.
- Browser verification on the deployed canonical-events page used a temporary canonical fixture and the local WordPress destination, with status Draft. The result visibly showed **1 saved · 0 skipped · 0 failed · 1 with warnings**, **Saved with warnings**, and the actual local-copy protection message.
- Temporary canonical fixture removed after testing; temporary WordPress drafts moved to Trash. No production WordPress uploads were performed.

Screenshot: [Upload warnings](verification/2026-09-28-upload-warnings.png).

The panel remains visible until dismissed, replaced by another result, or the page is left/reloaded. Image downloading remains blocked by the local-copy guard; these changes report that outcome rather than bypassing the guard.
