import { DateTime } from 'luxon';
import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

/**
 * Two Rivers Gallery (tworiversgallery.ca) — WordPress.
 *
 * The gallery publishes two custom post types through the standard WP REST API:
 *   /wp-json/wp/v2/events    → gallery events (openings, receptions, etc.)
 *   /wp-json/wp/v2/programs  → workshops / classes / camps
 *
 * Both carry ACF date fields (start_date/end_date as "yyyyMMdd",
 * start_time/end_time as "HH:mm:ss"). We request `?_embed=1` to resolve the
 * featured image. Tagged `api`.
 */

const BASE_URL = 'https://tworiversgallery.ca';
const DEFAULT_TZ = 'America/Vancouver';
const POST_TYPES = ['events', 'programs'] as const;

// --- WP REST shapes (only what we use) ---------------------------------------

interface AcfField {
  value?: string;
  value_formatted?: string;
  simple_value_formatted?: string;
}

export interface WpPost {
  id: number;
  link: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  acf?: {
    start_date?: AcfField;
    end_date?: AcfField;
    start_time?: AcfField;
    end_time?: AcfField;
  };
  _embedded?: {
    'wp:featuredmedia'?: Array<{ source_url?: string }>;
  };
}

// --- Pure helpers (unit-tested) ----------------------------------------------

/** Decode the handful of HTML entities WordPress emits in titles. */
export function decodeEntities(input?: string): string {
  if (!input) return '';
  return input
    .replace(/&amp;/g, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

const af = (f?: AcfField): string => (f?.value ?? '').trim();

/**
 * Build an ISO string from an ACF "yyyyMMdd" date and "HH:mm:ss" time.
 * Missing time → all-day (midnight local). Returns undefined if no date.
 */
export function acfDateTime(dateVal?: string, timeVal?: string, zone = DEFAULT_TZ): string | undefined {
  const d = (dateVal || '').trim();
  if (!/^\d{8}$/.test(d)) return undefined;
  const t = (timeVal || '').trim();
  const fmt = t ? 'yyyyMMdd HH:mm:ss' : 'yyyyMMdd';
  const dt = DateTime.fromFormat(t ? `${d} ${t}` : d, fmt, { zone });
  return dt.isValid ? (dt.toISO() ?? undefined) : undefined;
}

function featuredImage(post: WpPost): string | undefined {
  return post._embedded?.['wp:featuredmedia']?.[0]?.source_url || undefined;
}

/** Map a WP post (event or program) onto RawEvent. Returns null if no start date. */
export function mapPostToRawEvent(post: WpPost, postType: string, zone = DEFAULT_TZ): RawEvent | null {
  const acf = post.acf || {};
  const start = acfDateTime(af(acf.start_date), af(acf.start_time), zone);
  if (!start) return null;
  const end = acfDateTime(af(acf.end_date) || af(acf.start_date), af(acf.end_time), zone);

  const event: RawEvent = {
    sourceEventId: `${postType}-${post.id}`,
    title: decodeEntities(post.title?.rendered) || 'Untitled',
    start,
    url: post.link,
    venueName: 'Two Rivers Gallery',
    venueAddress: '725 Canada Games Way, Prince George, BC',
    city: 'Prince George',
    region: 'British Columbia',
    country: 'Canada',
    organizer: 'Two Rivers Gallery',
    category: postType === 'programs' ? 'Workshop / Program' : 'Arts & Culture',
    raw: {
      postType,
      postId: post.id,
      startDate: af(acf.start_date) || null,
      endDate: af(acf.end_date) || null,
      startTime: af(acf.start_time) || null,
      endTime: af(acf.end_time) || null,
      extractedAt: new Date().toISOString(),
    },
  };

  if (end && end !== start) event.end = end;
  const html = post.content?.rendered || post.excerpt?.rendered;
  if (html) event.descriptionHtml = html;
  const img = featuredImage(post);
  if (img) event.imageUrl = img;

  return event;
}

// --- Module ------------------------------------------------------------------

const twoRiversModule: ScraperModule = {
  key: 'tworiversgallery_com',
  label: 'Two Rivers Gallery',
  startUrls: [`${BASE_URL}/events/`, `${BASE_URL}/programs/`],
  paginationType: 'page',
  integrationTags: ['api'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const isTestMode = jobData?.testMode === true;
    const zone = ctx.source?.defaultTimezone || DEFAULT_TZ;
    const perPage = isTestMode ? 5 : 100;
    const maxPages = isTestMode ? 1 : 10;
    const events: RawEvent[] = [];

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label} via WP REST API`);

    for (const postType of POST_TYPES) {
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = `${BASE_URL}/wp-json/wp/v2/${postType}?per_page=${perPage}&page=${pageNum}&_embed=1&orderby=date&order=desc`;
        logger.info(`Fetching ${postType} page ${pageNum}`);
        const res = await page.request.get(url, { timeout: 30000 });
        if (ctx.stats) ctx.stats.pagesCrawled++;

        if (!res.ok()) {
          // WP returns 400 ("rest_post_invalid_page_number") past the last page.
          if (res.status() === 400 && pageNum > 1) {
            logger.info(`Reached end of ${postType} at page ${pageNum}`);
          } else {
            logger.warn(`${postType} page ${pageNum} returned HTTP ${res.status()}`);
          }
          break;
        }

        const posts = (await res.json()) as WpPost[];
        if (!Array.isArray(posts) || posts.length === 0) break;

        let mapped = 0;
        for (const post of posts) {
          const e = mapPostToRawEvent(post, postType, zone);
          if (e) { events.push(e); mapped++; }
        }
        logger.info(`Mapped ${mapped}/${posts.length} ${postType}`);

        const totalPages = Number(res.headers()['x-wp-totalpages'] || '1');
        if (pageNum >= totalPages || isTestMode) break;
        await delay(addJitter(1000, 50));
      }
    }

    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default twoRiversModule;
