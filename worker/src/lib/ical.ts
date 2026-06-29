import { DateTime } from 'luxon';

/**
 * Minimal iCalendar (RFC 5545) parser, scoped to what Google Calendar emits
 * for public feeds: VEVENTs with TZID/UTC/all-day dates, basic RRULEs
 * (FREQ + INTERVAL + COUNT/UNTIL + BYDAY) and EXDATEs. Good enough to expand a
 * public community calendar into concrete occurrences; not a full RRULE engine.
 */

export interface IcalDate {
  raw: string;
  tzid?: string;
  isDate: boolean; // VALUE=DATE (all-day)
}

export interface VEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  status?: string;
  dtstart?: IcalDate;
  dtend?: IcalDate;
  rrule?: string;
  exdates: string[];
}

export interface Occurrence {
  start: string; // ISO with offset
  end?: string;  // ISO with offset
  allDay: boolean;
}

const WEEKDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/** Unfold folded lines (continuation lines begin with a space or tab). */
export function unfoldLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const out: string[] = [];
  for (const line of normalized.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Parse a property line "NAME;PARAM=x:value" into name, params, value. */
function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/** Parse an iCal document into raw VEVENTs. */
export function parseICal(text: string): VEvent[] {
  const lines = unfoldLines(text);
  const events: VEvent[] = [];
  let cur: VEvent | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    switch (name) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.summary = unescapeText(value).trim(); break;
      case 'DESCRIPTION': cur.description = unescapeText(value); break;
      case 'LOCATION': cur.location = unescapeText(value).trim(); break;
      case 'URL': cur.url = value; break;
      case 'STATUS': cur.status = value; break;
      case 'RRULE': cur.rrule = value; break;
      case 'EXDATE': cur.exdates.push(value); break;
      case 'DTSTART': cur.dtstart = { raw: value, tzid: params.TZID, isDate: params.VALUE === 'DATE' }; break;
      case 'DTEND': cur.dtend = { raw: value, tzid: params.TZID, isDate: params.VALUE === 'DATE' }; break;
    }
  }
  return events;
}

/** Convert an iCal date/datetime to a Luxon DateTime in the target zone. */
export function icalToDateTime(d: IcalDate | undefined, zone: string): DateTime | null {
  if (!d) return null;
  const v = d.raw;
  if (d.isDate || /^\d{8}$/.test(v)) {
    const dt = DateTime.fromFormat(v.slice(0, 8), 'yyyyMMdd', { zone });
    return dt.isValid ? dt : null;
  }
  const isUtc = v.endsWith('Z');
  const core = isUtc ? v.slice(0, -1) : v;
  const srcZone = isUtc ? 'utc' : (d.tzid || zone);
  const dt = DateTime.fromFormat(core, "yyyyMMdd'T'HHmmss", { zone: srcZone });
  return dt.isValid ? dt.setZone(zone) : null;
}

function parseRule(rrule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rrule.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

/**
 * Expand a VEVENT into occurrences within [windowStart, windowEnd].
 * Handles single events and basic FREQ=DAILY/WEEKLY/MONTHLY/YEARLY rules.
 */
export function expandOccurrences(
  ev: VEvent,
  windowStart: DateTime,
  windowEnd: DateTime,
  zone: string,
  cap = 200,
): Occurrence[] {
  const start = icalToDateTime(ev.dtstart, zone);
  if (!start) return [];
  const end = icalToDateTime(ev.dtend, zone);
  const allDay = !!ev.dtstart?.isDate;
  const durationMs = end ? end.toMillis() - start.toMillis() : 0;

  const exSet = new Set(
    ev.exdates.map(x => icalToDateTime({ raw: x.split(':').pop() || x, isDate: /^\d{8}$/.test(x) }, zone)?.toISODate() || '')
  );

  const make = (s: DateTime): Occurrence => ({
    start: s.toISO()!,
    end: durationMs ? s.plus({ milliseconds: durationMs }).toISO()! : undefined,
    allDay,
  });

  const inWindow = (s: DateTime) => s >= windowStart && s <= windowEnd;
  const notExcluded = (s: DateTime) => !exSet.has(s.toISODate() || '');

  if (!ev.rrule) {
    return inWindow(start) && notExcluded(start) ? [make(start)] : [];
  }

  const rule = parseRule(ev.rrule);
  const freq = rule.FREQ;
  const interval = Math.max(1, parseInt(rule.INTERVAL || '1', 10));
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : undefined;
  const until = rule.UNTIL
    ? icalToDateTime({ raw: rule.UNTIL, isDate: /^\d{8}$/.test(rule.UNTIL) }, zone)
    : undefined;
  const byday = (rule.BYDAY || '').split(',').map(s => s.trim()).filter(Boolean);

  const occs: Occurrence[] = [];
  let emitted = 0;
  let cursor = start;
  const hardStop = until && until < windowEnd ? until : windowEnd;

  const stepUnit: Record<string, 'days' | 'weeks' | 'months' | 'years'> = {
    DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months', YEARLY: 'years',
  };
  const unit = stepUnit[freq];
  if (!unit) return inWindow(start) && notExcluded(start) ? [make(start)] : [];

  for (let i = 0; i < cap && cursor <= hardStop.plus({ days: 1 }); i++) {
    let candidates: DateTime[] = [cursor];
    if (freq === 'WEEKLY' && byday.length) {
      const weekStart = cursor.startOf('week'); // Monday
      candidates = byday
        .map(code => WEEKDAY[code.replace(/^[+-]?\d+/, '')])
        .filter(Boolean)
        .map(wd => weekStart.plus({ days: wd - 1 }).set({
          hour: start.hour, minute: start.minute, second: start.second,
        }));
    }
    for (const c of candidates) {
      if (count !== undefined && emitted >= count) break;
      if (until && c > until) continue;
      if (inWindow(c) && notExcluded(c)) { occs.push(make(c)); }
      if (c >= start) emitted++;
    }
    if (count !== undefined && emitted >= count) break;
    cursor = cursor.plus({ [unit]: interval } as any);
  }

  // De-dupe by start instant and sort.
  const uniq = new Map(occs.map(o => [o.start, o]));
  return [...uniq.values()].sort((a, b) => a.start.localeCompare(b.start));
}
