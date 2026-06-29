import { DateTime } from 'luxon';

/**
 * Shared timezone-aware date helpers for scraper modules. Every Prince George
 * source resolves to the same local zone, so PG_TZ is the default everywhere.
 *
 * These consolidate the per-module date helpers (toIsoWithZone, acfDateTime,
 * combineDateTime, msToIso, loose date/time parsing, etc.) into one tested kit.
 */

export const PG_TZ = 'America/Vancouver';

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

/** Site-local "yyyy-MM-dd HH:mm:ss" string → ISO with the zone's offset. */
export function localStringToIso(local?: string, zone: string = PG_TZ): string | undefined {
  if (!local) return undefined;
  const dt = DateTime.fromFormat(local, 'yyyy-MM-dd HH:mm:ss', { zone });
  return dt.isValid ? (dt.toISO() ?? undefined) : undefined;
}

export interface CombineOptions {
  dateFormat: string; // e.g. 'yyyy-MM-dd' or 'yyyyMMdd'
  timeFormat: string; // e.g. 'h:mm a' or 'HH:mm:ss'
  zone?: string;
}

/**
 * Combine a date string and an optional time string into an ISO string using
 * explicit Luxon formats. Invalid date → undefined. Missing/invalid time →
 * all-day (midnight local).
 */
export function combineDateAndTime(
  dateStr: string | undefined,
  timeStr: string | undefined,
  opts: CombineOptions,
): string | undefined {
  const zone = opts.zone ?? PG_TZ;
  const d = (dateStr || '').trim();
  if (!d) return undefined;

  const dateOnly = DateTime.fromFormat(d, opts.dateFormat, { zone });
  if (!dateOnly.isValid) return undefined;

  const t = (timeStr || '').trim();
  if (t) {
    const dt = DateTime.fromFormat(`${d} ${t}`, `${opts.dateFormat} ${opts.timeFormat}`, { zone });
    if (dt.isValid) return dt.toISO() ?? undefined;
  }
  return dateOnly.toISO() ?? undefined;
}

/** Epoch milliseconds → ISO string in the zone, floored to the minute. */
export function epochMsToIso(ms?: number, zone: string = PG_TZ): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return undefined;
  const dt = DateTime.fromMillis(ms, { zone }).set({ second: 0, millisecond: 0 });
  return dt.isValid ? (dt.toISO() ?? undefined) : undefined;
}

/** Normalize an ISO string that already carries an offset into the target zone. */
export function normalizeIsoZone(attr?: string | null, zone: string = PG_TZ): string | undefined {
  if (!attr) return undefined;
  const dt = DateTime.fromISO(attr, { setZone: true });
  return dt.isValid ? (dt.setZone(zone).toISO() ?? undefined) : undefined;
}

/**
 * Some sites serialize a naive wall-clock time with a spurious trailing 'Z'.
 * Strip the Z and interpret the timestamp in the given zone (not UTC).
 */
export function isoFromNaiveZ(attr?: string | null, zone: string = PG_TZ): string | undefined {
  if (!attr) return undefined;
  const naive = attr.replace(/Z$/, '');
  const dt = DateTime.fromISO(naive, { zone });
  return dt.isValid ? (dt.toISO() ?? undefined) : undefined;
}

/**
 * Parse a loose human date from free text, trying ISO, month-name
 * ("February 20, 2026" / "Feb 20" / year-less), and numeric formats.
 * Year-less dates use `fallbackYear`. Returns a Luxon DateTime or null.
 */
export function parseLooseDate(input: string | null, fallbackYear: number, zone: string = PG_TZ): DateTime | null {
  if (!input) return null;
  const t = input.replace(/\s+/g, ' ').trim();

  const iso = DateTime.fromISO(t, { zone });
  if (iso.isValid) return iso;

  const m = t.match(new RegExp(`(${MONTHS})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i'));
  if (m) {
    const norm = `${m[1].replace(/\.$/, '')} ${m[2]} ${m[3] || fallbackYear}`;
    for (const fmt of ['MMMM d yyyy', 'MMM d yyyy']) {
      const dt = DateTime.fromFormat(norm, fmt, { zone });
      if (dt.isValid) return dt;
    }
  }
  for (const fmt of ['yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'M/d/yyyy']) {
    const dt = DateTime.fromFormat(t, fmt, { zone });
    if (dt.isValid) return dt;
  }
  return null;
}

/** Parse a clock time ("7:00 PM", "7 pm", "19:00") out of free text. */
export function parseClockTime(input: string | null): { hour: number; minute: number } | null {
  if (!input) return null;
  const m = input.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Roll a date forward by a year if it sits more than `monthsTolerance` months
 * before `now` — used for year-less seasonal schedules (e.g. race calendars).
 */
export function rollForwardIfPast(dt: DateTime, now: DateTime, monthsTolerance = 1): DateTime {
  return dt < now.minus({ months: monthsTolerance }) ? dt.plus({ years: 1 }) : dt;
}
