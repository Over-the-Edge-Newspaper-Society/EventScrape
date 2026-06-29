import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DateTime } from 'luxon';
import { parseICal, icalToDateTime, expandOccurrences, unfoldLines } from '../../lib/ical.js';
import ominecaModule, { eventsFromIcal } from './index.js';

const ZONE = 'America/Vancouver';
const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/ominecaartscentre_com/fixtures', file);

const loadIcal = () => readFile(fixturePath('calendar.ics'), 'utf-8');

describe('Omineca Arts Centre module', () => {
  it('has the correct metadata', () => {
    expect(ominecaModule.key).toBe('ominecaartscentre_com');
    expect(ominecaModule.integrationTags).toContain('rss');
  });

  describe('iCal parsing', () => {
    it('unfolds continuation lines', () => {
      const lines = unfoldLines('LOCATION:Omineca Arts Centre\\, 369 Victoria St\n  more text');
      expect(lines).toEqual(['LOCATION:Omineca Arts Centre\\, 369 Victoria St more text']);
    });

    it('parses VEVENTs with summary, dates, and rrule', async () => {
      const events = parseICal(await loadIcal());
      expect(events.length).toBeGreaterThanOrEqual(5);

      const lifeDrawing = events.find(e => e.summary === 'Life Drawing Session')!;
      expect(lifeDrawing).toBeTruthy();
      expect(lifeDrawing.dtstart?.tzid).toBe('America/Vancouver');
      expect(lifeDrawing.rrule).toContain('FREQ=WEEKLY');
      expect(lifeDrawing.location).toContain('369 Victoria St');
    });

    it('converts TZID and UTC dates to the target zone', async () => {
      const events = parseICal(await loadIcal());
      const tzEvent = events.find(e => e.summary === 'Life Drawing Session')!;
      const dt = icalToDateTime(tzEvent.dtstart, ZONE)!;
      expect(dt.toISO()).toBe('2025-02-11T19:00:00.000-08:00'); // PST in February

      const utcEvent = events.find(e => (e.summary || '').includes('Songwriting Workshop'))!;
      const udt = icalToDateTime(utcEvent.dtstart, ZONE)!;
      // 2026-02-04 20:00 UTC → 12:00 PST
      expect(udt.toISO()).toBe('2026-02-04T12:00:00.000-08:00');
    });
  });

  describe('expandOccurrences', () => {
    it('returns a single occurrence for a non-recurring event in window', async () => {
      const events = parseICal(await loadIcal());
      const single = events.find(e => (e.summary || '').includes('Songwriting Workshop'))!;
      const occs = expandOccurrences(
        single,
        DateTime.fromISO('2026-01-01', { zone: ZONE }),
        DateTime.fromISO('2026-12-31', { zone: ZONE }),
        ZONE,
      );
      expect(occs.length).toBe(1);
      expect(occs[0].start).toContain('2026-02-04');
    });

    it('excludes a recurring series whose UNTIL is before the window', async () => {
      const events = parseICal(await loadIcal());
      const past = events.find(e => e.summary === 'Life Drawing Session')!; // UNTIL 2025-05
      const occs = expandOccurrences(
        past,
        DateTime.fromISO('2026-01-01', { zone: ZONE }),
        DateTime.fromISO('2026-12-31', { zone: ZONE }),
        ZONE,
      );
      expect(occs.length).toBe(0);
    });
  });

  describe('eventsFromIcal', () => {
    it('produces well-formed RawEvents for the 2026 window', async () => {
      const events = eventsFromIcal(
        await loadIcal(),
        DateTime.fromISO('2026-01-01', { zone: ZONE }),
        DateTime.fromISO('2026-12-31', { zone: ZONE }),
        ZONE,
      );
      expect(events.length).toBeGreaterThanOrEqual(1);
      for (const e of events) {
        expect(e.start).toMatch(/^2026-\d{2}-\d{2}T/);
        expect(e.venueName).toBe('Omineca Arts Centre');
        expect(e.title.length).toBeGreaterThan(0);
      }
    });
  });
});
