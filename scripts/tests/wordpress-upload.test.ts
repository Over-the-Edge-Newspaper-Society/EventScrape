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

for (const [label, fixture, expectedEnds, warningCount] of [
  ['bad end', { ...event, endDatetime: event.startDatetime - 3600000 }, [undefined], 1],
  ['overnight end', { ...event, endDatetime: event.startDatetime + 30 * 3600000 }, ['2026-10-02 06:00:00'], 0],
  ['recurring bad end', { ...event, raw: { seriesDates: [
    { start: '2026-10-01T10:00:00Z', end: '2026-10-01T09:00:00Z' },
    { start: '2026-10-02T10:00:00Z', end: '2026-10-02T12:00:00Z' },
  ] } }, [undefined, '2026-10-02 12:00:00'], 1],
  ['raw bad end', { ...event, raw: { events: [{ startDate: '2026-10-01', startTime: '10:00:00', endDate: '2026-10-01', endTime: '09:00:00' }] } }, [undefined], 1],
] as const) {
  test(`${label}: omits only unreliable ends and reports saved-event warnings`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.event.occurrences.map((o: any) => o.end_datetime), expectedEnds);
      assert.equal(body.event.status, 'publish');
      return Response.json({ success: true, action: 'created', post_id: 44, warnings: [warning] });
    };
    try {
      const fixtureCtx = { ...ctx, runQuery: async (ref: unknown, args: any) => args.ids ? [fixture] : ctx.runQuery(ref, args) };
      const result = await (uploadEvents as any)._handler(fixtureCtx, { settingsId: 'local', eventIds: ['event'], status: 'publish' });
      assert.equal(result.results[0].result.warnings.length, 1 + warningCount);
      assert.equal(result.results[0].result.warnings[0], warning);
      if (warningCount) assert.match(result.results[0].result.warnings[1], /unknown end time/);
      assert.equal(summarizeWordPressUpload(result.results).saved, 1);
    } finally { globalThis.fetch = original; }
  });
}

for (const outcome of ['skipped', 'failed'] as const) {
  test(`bad end does not claim a save when import is ${outcome}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => outcome === 'skipped'
      ? Response.json({ success: true, action: 'skipped', post_id: 44 })
      : new Response('Forbidden', { status: 403 });
    try {
      const fixtureCtx = { ...ctx, runQuery: async (ref: unknown, args: any) => args.ids ? [{ ...event, endDatetime: event.startDatetime - 1 }] : ctx.runQuery(ref, args) };
      const result = await (uploadEvents as any)._handler(fixtureCtx, { settingsId: 'local', eventIds: ['event'] });
      assert.deepEqual(getUploadWarnings(result.results[0].result), []);
      assert.equal(summarizeWordPressUpload(result.results).saved, 0);
    } finally { globalThis.fetch = original; }
  });
}

for (const [label, fixture, expected] of [
  ['second event from a shared poster', { ...event, sourceEventId: 'poster-event-1', raw: { events: [
    { title: 'First', startDate: '2026-10-01', startTime: '09:00' },
    { title: 'Second', startDate: '2026-10-06', startTime: '18:00', price: '$5' },
  ] } }, { starts: ['2026-10-06 18:00'], cost: '$5' }],
  ['nested extracted series', { ...event, raw: { events: [{ startDate: '2026-10-01', startTime: '18:00', seriesDates: [
    { start: '2026-10-01T18:00:00-07:00', end: '2026-10-01T20:00:00-07:00' },
    { start: '2026-10-08T18:00:00-07:00', end: '2026-10-08T20:00:00-07:00' },
  ] }] }, timezone: 'America/Vancouver' }, { starts: ['2026-10-01 18:00:00', '2026-10-08 18:00:00'], type: 'recurring' }],
  ['date-only multi-day trip', { ...event, raw: { events: [{ startDate: '2026-10-10', endDate: '2026-10-12', startTime: null, endTime: null }] } },
    { starts: ['2026-10-10 00:00:00'], end: '2026-10-12 23:59:59', type: 'multi_day', allDay: true }],
] as const) {
  test(label, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)).event;
      assert.deepEqual(body.occurrences.map((o: any) => o.start_datetime), expected.starts);
      if ('cost' in expected) assert.equal(body.meta.cost, expected.cost);
      if ('end' in expected) assert.equal(body.occurrences[0].end_datetime, expected.end);
      if ('type' in expected) assert.equal(body.series_data.occurrence_type, expected.type);
      if ('allDay' in expected) assert.equal(body.series_data.is_all_day, true);
      return Response.json({ success: true, action: 'created', post_id: 45 });
    };
    try {
      const fixtureCtx = { ...ctx, runQuery: async (ref: unknown, args: any) => args.ids ? [fixture] : ctx.runQuery(ref, args) };
      await (uploadEvents as any)._handler(fixtureCtx, { settingsId: 'local', eventIds: ['event'], status: 'publish' });
    } finally { globalThis.fetch = original; }
  });
}

test('includeMedia=false omits both stored and remote images', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (_input, init) => {
    assert.equal(JSON.parse(String(init?.body)).event.featured_media_url, undefined);
    called = true;
    return Response.json({ success: true, action: 'created', post_id: 46 });
  };
  try {
    const fixtureCtx = { ...ctx, runQuery: async (ref: unknown, args: any) => args.ids ? [event] : { ...await ctx.runQuery(ref, args), includeMedia: false } };
    await (uploadEvents as any)._handler(fixtureCtx, { settingsId: 'local', eventIds: ['event'] });
    assert.equal(called, true);
  } finally { globalThis.fetch = original; }
});

test('unbounded recurrence keeps its weekly metadata and warns about missing dates', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)).event;
    assert.equal(body.series_data.recurrence_type, 'weekly');
    assert.equal(body.occurrences.length, 1);
    return Response.json({ success: true, action: 'created', post_id: 47 });
  };
  try {
    const fixture = { ...event, raw: { events: [{ startDate: '2026-10-01', startTime: '17:30', recurrenceType: 'weekly' }] } };
    const fixtureCtx = { ...ctx, runQuery: async (ref: unknown, args: any) => args.ids ? [fixture] : ctx.runQuery(ref, args) };
    const response = await (uploadEvents as any)._handler(fixtureCtx, { settingsId: 'local', eventIds: ['event'] });
    assert.match(response.results[0].result.warnings[0], /additional recurring dates were not supplied/);
  } finally { globalThis.fetch = original; }
});
