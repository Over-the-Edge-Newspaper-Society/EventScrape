import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { DateTime } from 'luxon';
import pgaraModule, {
  parseLooseDate,
  resolveStartIso,
  extractScheduleRows,
  mapRowToEvent,
} from './index.js';

const ZONE = 'America/Vancouver';
const fixturePath = (file: string) =>
  join(process.cwd(), 'src/modules/pgara_ca/fixtures', file);

describe('PGARA module (brittle Wix scraper)', () => {
  it('has the correct metadata', () => {
    expect(pgaraModule.key).toBe('pgara_ca');
    expect(pgaraModule.integrationTags).toContain('page-navigation');
  });

  describe('parseLooseDate', () => {
    it('parses year-less month dates using the fallback year', () => {
      expect(parseLooseDate('May 30', 2026, ZONE)!.toISODate()).toBe('2026-05-30');
      expect(parseLooseDate('June 13, 2026', 2026, ZONE)!.toISODate()).toBe('2026-06-13');
    });
  });

  describe('resolveStartIso', () => {
    it('rolls a past season date forward to next year and defaults to an evening', () => {
      const now = DateTime.fromISO('2026-08-01T12:00:00', { zone: ZONE });
      // "May 30" is >1 month before Aug 1 → roll to 2027
      const iso = resolveStartIso({ text: 'May 30 race', dateText: 'May 30', timeText: null }, now, ZONE);
      expect(iso!.startsWith('2027-05-30')).toBe(true);
      expect(iso).toContain('T18:00:00'); // default evening race time
    });

    it('keeps an upcoming date in the current year and honours an explicit time', () => {
      const now = DateTime.fromISO('2026-05-01T12:00:00', { zone: ZONE });
      const iso = resolveStartIso({ text: 'May 30, gates 4:00 pm', dateText: 'May 30', timeText: '4:00 pm' }, now, ZONE);
      expect(iso!.startsWith('2026-05-30')).toBe(true);
      expect(iso).toContain('T16:00:00');
    });
  });

  describe('extractScheduleRows (representative render)', () => {
    it('keeps race rows with dates and drops menu/noise', async () => {
      const html = await readFile(fixturePath('rendered-schedule.html'), 'utf-8');
      const doc = new JSDOM(html).window.document;
      const rows = extractScheduleRows(doc);

      expect(rows.length).toBe(3);
      expect(rows.map(r => r.dateText)).toEqual(expect.arrayContaining(['May 30', 'June 13', 'July 4']));
      const may = rows.find(r => r.dateText === 'May 30')!;
      expect(may.text).toMatch(/Hornets/);
      expect(may.timeText).toMatch(/4:00 pm/);
    });

    it('maps a row into a racing RawEvent', async () => {
      const html = await readFile(fixturePath('rendered-schedule.html'), 'utf-8');
      const doc = new JSDOM(html).window.document;
      const rows = extractScheduleRows(doc);
      const now = DateTime.fromISO('2026-05-01T12:00:00', { zone: ZONE });
      const mapped = mapRowToEvent(rows.find(r => r.dateText === 'May 30')!, now, ZONE)!;

      expect(mapped.venueName).toBe('PGARA Speedway');
      expect(mapped.category).toBe('Motorsports / Racing');
      expect(mapped.start.startsWith('2026-05-30')).toBe(true);
      expect(mapped.title).toMatch(/Hornets|Race Day/);
    });
  });
});
