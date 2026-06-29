import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { PG_TZ, combineDateAndTime } from '../../lib/dates.js';
import { decodeEntities } from '../../lib/text.js';
import { paginateWpRest } from '../../lib/wp.js';

// Re-export the shared HTML-entity decoder for this module's tests.
export { decodeEntities };

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
const DEFAULT_TZ = PG_TZ;
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

const af = (f?: AcfField): string => (f?.value ?? '').trim();

/**
 * Build an ISO string from an ACF "yyyyMMdd" date and "HH:mm:ss" time.
 * Missing time → all-day (midnight local). Returns undefined if no date.
 */
export function acfDateTime(dateVal?: string, timeVal?: string, zone = DEFAULT_TZ): string | undefined {
  const d = (dateVal || '').trim();
  if (!/^\d{8}$/.test(d)) return undefined;
  return combineDateAndTime(d, timeVal, { dateFormat: 'yyyyMMdd', timeFormat: 'HH:mm:ss', zone });
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
      const posts = await paginateWpRest<WpPost>(page, `${BASE_URL}/wp-json/wp/v2/${postType}`, {
        perPage,
        maxPages,
        query: { _embed: '1', orderby: 'date', order: 'desc' },
        logger,
        onPage: () => { if (ctx.stats) ctx.stats.pagesCrawled++; },
      });

      let mapped = 0;
      for (const post of posts) {
        const e = mapPostToRawEvent(post, postType, zone);
        if (e) { events.push(e); mapped++; }
      }
      logger.info(`Mapped ${mapped}/${posts.length} ${postType}`);
    }

    logger.info(`Scrape completed. Total events: ${events.length}`);
    return events;
  },
};

export default twoRiversModule;
