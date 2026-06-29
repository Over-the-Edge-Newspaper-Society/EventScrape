import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';

/**
 * Prince George Pride Society (pgpride.com) — GoDaddy Website Builder.
 *
 * ⚠️ BRITTLE SCRAPER. The "Upcoming Events" calendar is a GoDaddy
 * "Websites + Marketing" widget: the server HTML only contains a loading
 * spinner, and the events are fetched client-side and rendered into a
 * bootstrap container. We therefore RENDER the page with the worker's real
 * browser, wait for the widget to populate, then text-scan the calendar
 * section for date-anchored event cards.
 *
 * Because GoDaddy's rendered class names are obfuscated and versioned, this
 * relies on `data-ux` attributes + date-pattern heuristics and WILL need
 * adjustment if GoDaddy changes its widget. The reliable fallback is the
 * `fraserfinds_ca` aggregator, which already re-publishes PG Pride events.
 */

const BASE_URL = 'https://pgpride.com';
const CALENDAR_URL = `${BASE_URL}/event-calendar`;
const DEFAULT_TZ = 'America/Vancouver';

export interface RawScrapedEvent {
  title: string | null;
  dateText: string | null;
  timeText: string | null;
  url: string | null;
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

/** Pull a date out of free text, trying several common formats. */
export function parseDateText(dateText: string | null, fallbackYear: number, zone = DEFAULT_TZ): DateTime | null {
  if (!dateText) return null;
  const t = dateText.replace(/\s+/g, ' ').trim();

  // ISO first
  const iso = DateTime.fromISO(t, { zone });
  if (iso.isValid) return iso;

  // "February 20, 2026" / "Feb 20 2026" / "February 20"
  const m = t.match(new RegExp(`(${MONTHS})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i'));
  if (m) {
    const [, month, day, year] = m;
    const norm = `${month.replace(/\.$/, '')} ${day} ${year || fallbackYear}`;
    for (const fmt of ['MMMM d yyyy', 'MMM d yyyy']) {
      const dt = DateTime.fromFormat(norm, fmt, { zone });
      if (dt.isValid) return dt;
    }
  }

  // numeric: 2026-02-20 / 02/20/2026 / 20/02/2026
  for (const fmt of ['yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'M/d/yyyy']) {
    const dt = DateTime.fromFormat(t, fmt, { zone });
    if (dt.isValid) return dt;
  }
  return null;
}

/** Pull a start time ("7:00 PM", "7 pm", "19:00") out of free text. */
export function parseTimeText(timeText: string | null): { hour: number; minute: number } | null {
  if (!timeText) return null;
  const m = timeText.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Combine scraped date + time text into an ISO start string. */
export function buildStartIso(dateText: string | null, timeText: string | null, fallbackYear: number, zone = DEFAULT_TZ): string | undefined {
  let dt = parseDateText(dateText, fallbackYear, zone);
  if (!dt) return undefined;
  const time = parseTimeText(timeText);
  if (time) dt = dt.set({ hour: time.hour, minute: time.minute });
  return dt.toISO() ?? undefined;
}

/**
 * Self-contained DOM extractor (serialized into the browser + jsdom-tested).
 * Heuristic: within the calendar section, each event card is a node containing
 * a recognizable date string; we read its heading as the title and the first
 * time-looking string as the time.
 */
export const extractEventsFromDocument = (doc: Document): RawScrapedEvent[] => {
  const MONTHS_RE = /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}/i;
  const TIME_RE = /\d{1,2}(:\d{2})?\s*[ap]\.?m\.?/i;

  // Find the calendar section (fall back to whole document).
  const titleEl = doc.querySelector('[data-aid="CALENDAR_SECTION_TITLE_RENDERED"]');
  let root: Element = doc.body;
  if (titleEl) {
    root = titleEl.closest('section') || titleEl.parentElement?.parentElement || doc.body;
  }

  // Candidate event cards: GoDaddy grid cells, or any block whose text has a date.
  let cards = Array.from(root.querySelectorAll('[data-ux="GridCell"], [data-ux="Card"], li, article'));
  cards = cards.filter(c => MONTHS_RE.test(c.textContent || ''));

  const events: RawScrapedEvent[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const full = (card.textContent || '').replace(/\s+/g, ' ').trim();
    const dateMatch = full.match(MONTHS_RE);
    if (!dateMatch) continue;

    const headingEl = card.querySelector('[data-ux="ContentHeading"], h1, h2, h3, h4, [data-ux="Element"]');
    let title = headingEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
    // Avoid using the date itself as the title.
    if (!title || MONTHS_RE.test(title)) {
      title = full.replace(dateMatch[0], '').replace(TIME_RE, '').trim().slice(0, 120);
    }
    const timeMatch = full.match(TIME_RE);
    const linkEl = card.querySelector('a[href]') as HTMLAnchorElement | null;

    const key = `${title}|${dateMatch[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      title: title || null,
      dateText: dateMatch[0],
      timeText: timeMatch ? timeMatch[0] : null,
      url: linkEl?.getAttribute('href') || null,
    });
  }
  return events;
};

export function mapScrapedEvent(raw: RawScrapedEvent, fallbackYear: number, zone = DEFAULT_TZ): RawEvent | null {
  const start = buildStartIso(raw.dateText, raw.timeText, fallbackYear, zone);
  if (!start) return null;
  const url = raw.url && raw.url.startsWith('http') ? raw.url
    : raw.url ? `${BASE_URL}${raw.url}` : CALENDAR_URL;

  return {
    sourceEventId: `${raw.title || 'event'}|${raw.dateText}`,
    title: raw.title || 'PG Pride Event',
    start,
    url,
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Prince George Pride Society',
    category: 'Community Event',
    raw: { dateText: raw.dateText, timeText: raw.timeText, scraped: true, extractedAt: new Date().toISOString() },
  };
}

const extractorSource = `(${extractEventsFromDocument.toString()})`;

const pgPrideModule: ScraperModule = {
  key: 'pgpride_com',
  label: 'Prince George Pride Society',
  startUrls: [CALENDAR_URL],
  paginationType: 'none',
  integrationTags: ['page-navigation'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label} (BRITTLE: rendered GoDaddy widget)`);

    await page.goto(CALENDAR_URL, { waitUntil: 'networkidle', timeout: 45000 });
    if (ctx.stats) ctx.stats.pagesCrawled++;

    // Give the client-side calendar widget time to fetch + render its events.
    try {
      await page.waitForFunction(() => {
        const re = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i;
        return re.test(document.body.innerText);
      }, { timeout: 15000 });
    } catch {
      logger.warn('Calendar widget did not render any date text within timeout');
    }
    await page.waitForTimeout(2000);

    const scraped: RawScrapedEvent[] = await page.evaluate((extractor: string) => {
      return eval(extractor)(document);
    }, extractorSource);
    logger.info(`Extracted ${scraped.length} candidate event(s) from rendered page`);

    const fallbackYear = DateTime.now().setZone(zone).year;
    const events: RawEvent[] = [];
    for (const raw of (isTestMode ? scraped.slice(0, 3) : scraped)) {
      const e = mapScrapedEvent(raw, fallbackYear, zone);
      if (e) events.push(e);
    }

    if (events.length === 0) {
      logger.warn('No events parsed — GoDaddy markup may have changed. Fallback: fraserfinds_ca aggregator.');
    }
    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default pgPrideModule;
