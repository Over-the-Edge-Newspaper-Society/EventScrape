import { describe, it, expect, vi } from 'vitest';
import module, { mapCalendarEvent } from './index.js';

const calendarEvent = { title: 'Queer Youth Hangout', start: '2026-11-08T17:00:00-08:00', end: '2026-11-08T20:00:00-08:00', location: '2640 Goheen St', desc: 'Community <dinner>\nAll welcome' };

describe('Pride calendar feed', () => {
  it('preserves exact year, DST offset, end time and location; escapes description', () => {
    const event = mapCalendarEvent(calendarEvent);
    expect(event.start).toBe(calendarEvent.start);
    expect(event.end).toBe(calendarEvent.end);
    expect(event.venueAddress).toBe(calendarEvent.location);
    expect(event.descriptionHtml).toBe('Community &lt;dinner&gt;<br>All welcome');
    expect(event.sourceEventId).toContain('2026-11-09T01:00:00.000Z');
    expect(mapCalendarEvent({ ...calendarEvent, allDay: true }).raw.isAllDay).toBe(true);
  });
  it('uses distinct identities for recurring dates and rejects malformed dates', () => {
    expect(mapCalendarEvent(calendarEvent).sourceEventId).not.toBe(mapCalendarEvent({ ...calendarEvent, start: '2026-12-13T17:00:00-08:00' }).sourceEventId);
    expect(() => mapCalendarEvent({ ...calendarEvent, start: 'invalid' })).toThrow(/valid title\/start/);
    expect(mapCalendarEvent({ ...calendarEvent, end: calendarEvent.start }).end).toBeUndefined();
  });
  it('reads all feed events without waiting for networkidle or only reading five visible cards', async () => {
    const feed = Array.from({ length: 7 }, (_, i) => ({ ...calendarEvent, title: `Event ${i}` }));
    const page = {
      waitForResponse: vi.fn().mockResolvedValue({ ok: () => true, json: async () => ({ events: feed }) }),
      goto: vi.fn().mockResolvedValue({ ok: () => true }),
    };
    const stats = { pagesCrawled: 0 };
    const events = await module.run({ page, stats, logger: { info: vi.fn() } } as any);
    expect(events).toHaveLength(7);
    expect(stats.pagesCrawled).toBe(2);
    expect(page.goto).toHaveBeenCalledWith(module.startUrls[0], expect.objectContaining({ waitUntil: 'domcontentloaded' }));
  });
  it('does not report missing or failed feeds as empty success', async () => {
    const page = { waitForResponse: vi.fn().mockResolvedValue(null), goto: vi.fn().mockResolvedValue({ ok: () => true }) };
    await expect(module.run({ page, logger: { info: vi.fn() } } as any)).rejects.toThrow(/did not load/);
    page.waitForResponse.mockResolvedValue({ ok: () => false, status: () => 503 } as any);
    await expect(module.run({ page, logger: { info: vi.fn() } } as any)).rejects.toThrow(/503/);
  });
});
