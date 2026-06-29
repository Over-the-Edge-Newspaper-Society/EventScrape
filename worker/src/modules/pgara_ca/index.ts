import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { PG_TZ, parseLooseDate, parseClockTime, rollForwardIfPast } from '../../lib/dates.js';

// Re-export shared parsers under this module's names (used by its tests).
export { parseLooseDate };
export const parseTime = parseClockTime;

/**
 * Prince George Auto Racing Association (pgara.ca) — Wix.
 *
 * ⚠️ BRITTLE SCRAPER. The /event-schedule page is a Wix site whose race
 * schedule is rendered client-side (Wix Events app is absent — its API returns
 * 404 — so the schedule is plain rendered content / data binding, not a feed).
 * We RENDER the page with the worker's real browser and text-scan for rows that
 * contain a date plus racing content.
 *
 * Wix markup is obfuscated and changes often, so this leans on date-pattern
 * heuristics and WILL need adjustment over time. The reliable fallback is the
 * `fraserfinds_ca` aggregator, which already re-publishes PGARA events.
 */

const BASE_URL = 'https://www.pgara.ca';
const SCHEDULE_URL = `${BASE_URL}/event-schedule`;
const DEFAULT_TZ = PG_TZ;

export interface RawScheduleRow {
  text: string;
  dateText: string;
  timeText: string | null;
}

/**
 * Resolve a schedule date to a concrete start ISO. Race schedules list dates
 * without a year; if the date is already well in the past for `fallbackYear`,
 * roll it forward to the next season.
 */
export function resolveStartIso(row: RawScheduleRow, now: DateTime, zone = DEFAULT_TZ): string | undefined {
  let dt = parseLooseDate(row.dateText, now.year, zone);
  if (!dt) return undefined;
  dt = rollForwardIfPast(dt, now);
  const time = parseTime(row.timeText);
  dt = time ? dt.set({ hour: time.hour, minute: time.minute }) : dt.set({ hour: 18, minute: 0 }); // races run evenings
  return dt.toISO() ?? undefined;
}

/**
 * Self-contained extractor (serialized into the browser + jsdom-tested).
 * Scans leaf-ish text nodes for a date; keeps rows that also mention racing.
 */
export const extractScheduleRows = (doc: Document): RawScheduleRow[] => {
  const DATE_RE = /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}/i;
  const TIME_RE = /\d{1,2}(:\d{2})?\s*[ap]\.?m\.?/i;
  const RACE_RE = /(race|hornet|mini stock|street stock|hit to pass|mayhem|pro mini|gates|practice|points|qualif)/i;

  const candidates = Array.from(doc.querySelectorAll('p, li, td, span, div, h1, h2, h3, h4, h5'));
  const rows: RawScheduleRow[] = [];
  const seen = new Set<string>();

  for (const el of candidates) {
    // Prefer leaf-ish nodes so we don't grab a whole page blob.
    if (el.querySelector('p, li, td, h1, h2, h3, h4, h5')) continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 4 || text.length > 200) continue;
    const dm = text.match(DATE_RE);
    if (!dm) continue;
    if (!RACE_RE.test(text)) continue; // keep race rows, drop menu/date noise

    const key = `${dm[0]}|${text.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tm = text.match(TIME_RE);
    rows.push({ text, dateText: dm[0], timeText: tm ? tm[0] : null });
  }
  return rows;
};

export function mapRowToEvent(row: RawScheduleRow, now: DateTime, zone = DEFAULT_TZ): RawEvent | null {
  const start = resolveStartIso(row, now, zone);
  if (!start) return null;
  // Title: the row text minus the date, or a sensible default.
  const title = row.text.replace(row.dateText, '').replace(/^[\s,–-]+/, '').trim() || 'PGARA Race Day';

  return {
    sourceEventId: `${row.dateText}|${title}`.slice(0, 120),
    title: title.length > 3 ? title : 'PGARA Race Day',
    start,
    url: SCHEDULE_URL,
    venueName: 'PGARA Speedway',
    venueAddress: 'Prince George, BC',
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Prince George Auto Racing Association',
    category: 'Motorsports / Racing',
    raw: { rowText: row.text, dateText: row.dateText, timeText: row.timeText, scraped: true, extractedAt: new Date().toISOString() },
  };
}

const extractorSource = `(${extractScheduleRows.toString()})`;

const pgaraModule: ScraperModule = {
  key: 'pgara_ca',
  label: 'PGARA Speedway',
  startUrls: [SCHEDULE_URL],
  paginationType: 'none',
  integrationTags: ['page-navigation'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label} (BRITTLE: rendered Wix page)`);

    await page.goto(SCHEDULE_URL, { waitUntil: 'networkidle', timeout: 45000 });
    if (ctx.stats) ctx.stats.pagesCrawled++;
    await page.waitForTimeout(2500); // let Wix hydrate

    const rows: RawScheduleRow[] = await page.evaluate((extractor: string) => {
      return eval(extractor)(document);
    }, extractorSource);
    logger.info(`Extracted ${rows.length} candidate schedule row(s)`);

    const now = DateTime.now().setZone(zone);
    const events: RawEvent[] = [];
    const seen = new Set<string>();
    for (const row of (isTestMode ? rows.slice(0, 3) : rows)) {
      const e = mapRowToEvent(row, now, zone);
      if (!e || seen.has(e.sourceEventId!)) continue;
      seen.add(e.sourceEventId!);
      events.push(e);
    }

    if (events.length === 0) {
      logger.warn('No events parsed — Wix markup may have changed. Fallback: fraserfinds_ca aggregator.');
    }
    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default pgaraModule;
