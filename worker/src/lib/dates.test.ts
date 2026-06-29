import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  PG_TZ,
  localStringToIso,
  combineDateAndTime,
  epochMsToIso,
  normalizeIsoZone,
  isoFromNaiveZ,
  parseLooseDate,
  parseClockTime,
  rollForwardIfPast,
} from './dates.js';

describe('lib/dates', () => {
  it('PG_TZ is the PG zone', () => {
    expect(PG_TZ).toBe('America/Vancouver');
  });

  describe('localStringToIso (tribe-style)', () => {
    it('parses site-local datetime to ISO with offset', () => {
      expect(localStringToIso('2026-07-06 00:00:00')).toBe('2026-07-06T00:00:00.000-07:00');
    });
    it('rejects empty/invalid', () => {
      expect(localStringToIso(undefined)).toBeUndefined();
      expect(localStringToIso('nope')).toBeUndefined();
    });
  });

  describe('combineDateAndTime', () => {
    it('handles yyyy-MM-dd + h:mm a (fraserfinds)', () => {
      expect(combineDateAndTime('2026-06-29', '10:00 AM', { dateFormat: 'yyyy-MM-dd', timeFormat: 'h:mm a' }))
        .toBe('2026-06-29T10:00:00.000-07:00');
      expect(combineDateAndTime('2026-06-29', '6:00 PM', { dateFormat: 'yyyy-MM-dd', timeFormat: 'h:mm a' }))
        .toBe('2026-06-29T18:00:00.000-07:00');
    });
    it('handles yyyyMMdd + HH:mm:ss (ACF)', () => {
      expect(combineDateAndTime('20260924', '15:00:00', { dateFormat: 'yyyyMMdd', timeFormat: 'HH:mm:ss' }))
        .toBe('2026-09-24T15:00:00.000-07:00');
    });
    it('falls back to midnight when time missing', () => {
      expect(combineDateAndTime('20260924', '', { dateFormat: 'yyyyMMdd', timeFormat: 'HH:mm:ss' }))
        .toBe('2026-09-24T00:00:00.000-07:00');
    });
    it('rejects a date that does not match the format', () => {
      expect(combineDateAndTime('2026-09-24', '15:00:00', { dateFormat: 'yyyyMMdd', timeFormat: 'HH:mm:ss' }))
        .toBeUndefined();
      expect(combineDateAndTime('', '10:00 AM', { dateFormat: 'yyyy-MM-dd', timeFormat: 'h:mm a' }))
        .toBeUndefined();
    });
  });

  describe('epochMsToIso', () => {
    it('converts ms to ISO floored to the minute', () => {
      expect(epochMsToIso(1778868000976)).toBe('2026-05-15T11:00:00.000-07:00');
    });
    it('rejects non-numbers', () => {
      expect(epochMsToIso(undefined)).toBeUndefined();
      expect(epochMsToIso(NaN)).toBeUndefined();
    });
  });

  describe('normalizeIsoZone', () => {
    it('normalizes an offset-carrying ISO into the zone', () => {
      expect(normalizeIsoZone('2026-06-27T18:00:00-07:00')).toBe('2026-06-27T18:00:00.000-07:00');
    });
    it('returns undefined for nullish', () => {
      expect(normalizeIsoZone(null)).toBeUndefined();
    });
  });

  describe('isoFromNaiveZ', () => {
    it('strips a spurious Z and reads as local wall time', () => {
      expect(isoFromNaiveZ('2026-07-01T08:45:00Z')).toBe('2026-07-01T08:45:00.000-07:00');
    });
  });

  describe('parseLooseDate', () => {
    it('parses month-name, year-less, and numeric dates', () => {
      expect(parseLooseDate('February 20, 2026', 2026)!.toISODate()).toBe('2026-02-20');
      expect(parseLooseDate('Feb 20 2026', 2026)!.toISODate()).toBe('2026-02-20');
      expect(parseLooseDate('March 8', 2026)!.toISODate()).toBe('2026-03-08');
      expect(parseLooseDate('2026-02-20', 2026)!.toISODate()).toBe('2026-02-20');
      expect(parseLooseDate('May 30', 2026)!.toISODate()).toBe('2026-05-30');
    });
    it('returns null for junk', () => {
      expect(parseLooseDate('see you soon', 2026)).toBeNull();
      expect(parseLooseDate(null, 2026)).toBeNull();
    });
  });

  describe('parseClockTime', () => {
    it('parses 12h and 24h', () => {
      expect(parseClockTime('7:00 PM')).toEqual({ hour: 19, minute: 0 });
      expect(parseClockTime('11:00 AM')).toEqual({ hour: 11, minute: 0 });
      expect(parseClockTime('12:00 AM')).toEqual({ hour: 0, minute: 0 });
      expect(parseClockTime('19:30')).toEqual({ hour: 19, minute: 30 });
      expect(parseClockTime('4:00 pm')).toEqual({ hour: 16, minute: 0 });
    });
    it('returns null for nullish', () => {
      expect(parseClockTime(null)).toBeNull();
    });
  });

  describe('rollForwardIfPast', () => {
    const now = DateTime.fromISO('2026-08-01T12:00:00', { zone: PG_TZ });
    it('rolls a clearly-past date to next year', () => {
      const dt = DateTime.fromISO('2026-05-30', { zone: PG_TZ });
      expect(rollForwardIfPast(dt, now).toISODate()).toBe('2027-05-30');
    });
    it('keeps an upcoming date', () => {
      const dt = DateTime.fromISO('2026-09-20', { zone: PG_TZ });
      expect(rollForwardIfPast(dt, now).toISODate()).toBe('2026-09-20');
    });
  });
});
