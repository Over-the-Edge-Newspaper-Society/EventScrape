import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadEvents } from '../../convex/wordpressUpload';
import { getUploadWarnings, summarizeWordPressUpload } from '../../convex/lib/wordpressUploadResults';

const warning = 'The event was saved, but its featured image was not imported because outbound requests are disabled in this local copy.';
const event = { id: 'event', title: 'Games Night', startDatetime: Date.UTC(2026, 9, 1), imageUrl: 'https://images.example/event.jpg' };
const ctx = { runQuery: async (_ref: unknown, args: any) => args.ids ? [event] : { siteUrl: 'https://wp.example', username: 'fixture', applicationPassword: 'fixture', active: true }, storage: { getUrl: async () => null } };

test('action retains plugin warnings and media details and reports partial image success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(JSON.parse(String(init?.body)).event.status, 'draft');
    return Response.json({ success: true, action: 'updated', post_id: 42, post_url: 'https://wp.example/?p=42', occurrences_created: 1, warnings: [warning], media: { status: 'failed', error_code: 'local_copy' } });
  };
  try {
    const result = await (uploadEvents as any)._handler(ctx, { settingsId: 'local', eventIds: ['event'], status: 'draft' });
    assert.equal(result.message, 'Uploaded 1 events, 0 failed, 0 skipped, 1 with warnings');
    assert.deepEqual(result.results[0].result.warnings, [warning]);
    assert.deepEqual(result.results[0].result.media, { status: 'failed', error_code: 'local_copy' });
    assert.equal(result.results[0].result.success, true);
  } finally { globalThis.fetch = original; }
});

test('older plugin without media fields remains compatible', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, action: 'created', post_id: 43, occurrences_created: 1 });
  try {
    const response = await (uploadEvents as any)._handler(ctx, { settingsId: 'local', eventIds: ['event'] });
    assert.deepEqual(response.results[0].result.warnings, []);
    assert.equal(response.results[0].result.media, undefined);
    assert.equal(summarizeWordPressUpload(response.results).warned, 0);
  } finally { globalThis.fetch = original; }
});

test('summary distinguishes saved, skipped, failed and warned events without double counting warnings', () => {
  const results = [
    { event, result: { success: true, action: 'created' as const, warnings: [warning, 'Another warning'] } },
    { event, result: { success: true, action: 'updated' as const, media: { status: 'imported' as const, attachment_id: 7 } } },
    { event, result: { success: true, action: 'skipped' as const, media: { status: 'not_attempted' as const } } },
    { event, result: { success: false, error: '401 Unauthorized' } },
  ];
  assert.deepEqual(summarizeWordPressUpload(results), { saved: 2, skipped: 1, failed: 1, warned: 1, message: 'Uploaded 2 events, 1 failed, 1 skipped, 1 with warnings' });
});

test('structured media failure cannot silently pass even without warning text', () => {
  assert.equal(getUploadWarnings({ success: true, media: { status: 'failed', error_code: 'local_copy' } }).length, 1);
  assert.equal(getUploadWarnings({ success: true, media: { status: 'skipped' } }).length, 1);
  assert.deepEqual(getUploadWarnings({ success: true, warnings: [null, '', 7] as any }), []);
});

test('HTTP import failure stays a failure, not a saved event', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
  try {
    const response = await (uploadEvents as any)._handler(ctx, { settingsId: 'local', eventIds: ['event'] });
    assert.equal(response.results[0].result.success, false);
    assert.equal(summarizeWordPressUpload(response.results).failed, 1);
  } finally { globalThis.fetch = original; }
});
