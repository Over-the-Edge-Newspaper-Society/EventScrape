import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';

const BASE_URL = 'https://www.pgpl.ca';
const TIMEZONE = 'America/Vancouver';
const DEFAULT_MAX_PAGES = 8;
const DEFAULT_PAGE_DELAY_MS = 1200;
const DEFAULT_DETAIL_DELAY_MS = 700;

type PgplListingEvent = {
  title: string;
  relativeUrl: string;
  dateLabel: string;
  timeText?: string | null;
  locationText?: string | null;
  descriptionHtml?: string | null;
  imageUrl?: string | null;
};

type PgplDateRange = {
  start: string;
  end?: string;
};

type PgplDetailData = {
  nodeId?: string | null;
  dates: PgplDateRange[];
  title?: string | null;
  locationText?: string | null;
  imageUrl?: string | null;
};

type ListingFetchResult = {
  success: boolean;
  events: PgplListingEvent[];
  status?: number;
  error?: string;
};

type DetailFetchResult = {
  success: boolean;
  data?: PgplDetailData;
  status?: number;
  error?: string;
};

/**
 * Parse the server-rendered `/events` listing (Drupal 11 "event" view).
 * Each event is an `.event-block-2` card with title, image, time, location
 * and a short description. The authoritative dates live on the detail page.
 */
export const extractListingEventsFromDocument = (doc: Document): PgplListingEvent[] => {
  const blocks = Array.from(doc.querySelectorAll('.event-block-2'));

  return blocks
    .map((block: Element): PgplListingEvent | null => {
      const titleLink = block.querySelector('.post-title a') as HTMLAnchorElement | null;
      const href = titleLink?.getAttribute('href');
      if (!href) return null;

      const imageEl = block.querySelector('.event-image img') as HTMLImageElement | null;
      const locationEl = block.querySelector('.event-address .field__item') || block.querySelector('.event-address');
      const descriptionEl = block.querySelector('.event-description .field__item') || block.querySelector('.event-description');

      const times = Array.from(block.querySelectorAll('.event-time'))
        .map(el => el.textContent?.replace(/\s+/g, ' ').trim())
        .filter((value): value is string => Boolean(value));

      const dayEl = block.querySelector('.event-date .date');
      const monthEl = block.querySelector('.event-date .month');
      const dateLabel = [dayEl?.textContent?.trim(), monthEl?.textContent?.trim()]
        .filter((value): value is string => Boolean(value))
        .join(' ');

      return {
        title: titleLink?.textContent?.replace(/\s+/g, ' ').trim() || '',
        relativeUrl: href,
        dateLabel,
        timeText: times.length ? times.join(' - ') : null,
        locationText: locationEl?.textContent?.replace(/\s+/g, ' ').trim() || null,
        descriptionHtml: descriptionEl?.innerHTML?.trim() || null,
        imageUrl: imageEl?.getAttribute('src') || null,
      };
    })
    .filter((event): event is PgplListingEvent => Boolean(event));
};

/**
 * Parse an event detail page. The Drupal 11 "recurring output" widget renders
 * each occurrence as a pair of `<time datetime>` elements (start + end) inside
 * `.recurring-output--wrapper`, covering both the next instance and the full
 * list of upcoming dates.
 */
export const extractDetailDataFromDocument = (doc: Document): PgplDetailData => {
  const article = doc.querySelector('article[data-history-node-id]');
  const scope: ParentNode = article || doc;

  const wrappers = Array.from(scope.querySelectorAll('.recurring-output--wrapper'));
  const timeContainers = wrappers.length
    ? wrappers
    : Array.from(scope.querySelectorAll('.event-time, .event-info'));

  const dates: PgplDateRange[] = [];
  const seenStarts = new Set<string>();

  for (const container of timeContainers) {
    const isoValues = Array.from(container.querySelectorAll('time[datetime]'))
      .map(el => el.getAttribute('datetime'))
      .filter((value): value is string => Boolean(value));

    for (let i = 0; i < isoValues.length; i += 2) {
      const start = isoValues[i];
      const end = isoValues[i + 1];
      if (!start || seenStarts.has(start)) continue;
      seenStarts.add(start);
      dates.push({ start, end: end || undefined });
    }
  }

  dates.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const locationEl = scope.querySelector('.field--name-field-location .field__item')
    || scope.querySelector('.field--name-field-location');
  const imageEl = scope.querySelector('.field--name-field-event-image img') as HTMLImageElement | null;
  const titleEl = scope.querySelector('h1.post-title');

  return {
    nodeId: article?.getAttribute('data-history-node-id') || null,
    dates,
    title: titleEl?.textContent?.replace(/\s+/g, ' ').trim() || null,
    locationText: locationEl?.textContent?.replace(/\s+/g, ' ').trim() || null,
    imageUrl: imageEl?.getAttribute('src') || null,
  };
};

const listingExtractorSource = `(${extractListingEventsFromDocument.toString()})`;
const detailExtractorSource = `(${extractDetailDataFromDocument.toString()})`;

const pgplModule: ScraperModule = {
  key: 'pgpl_ca',
  label: 'Prince George Public Library',
  startUrls: [`${BASE_URL}/events`],
  paginationType: 'page',
  integrationTags: ['calendar'],

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { page, logger, jobData } = ctx;
    const events: RawEvent[] = [];
    const seenUrls = new Set<string>();
    const isTestMode = jobData?.testMode === true;
    const paginationOptions = jobData?.paginationOptions;

    const maxPages = paginationOptions?.maxPages
      ? paginationOptions.maxPages
      : paginationOptions?.scrapeAllPages
        ? 20
        : DEFAULT_MAX_PAGES;

    logger.info(`Starting ${isTestMode ? 'test ' : ''}scrape of ${this.label}`);

    await page.goto(this.startUrls[0], {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    if (ctx.stats) ctx.stats.pagesCrawled++;

    const totalPages = isTestMode ? Math.min(1, maxPages) : maxPages;

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      logger.info(`Fetching events page ${pageIndex + 1}`);

      const listingResult = await fetchListingPage(page, pageIndex);
      if (!listingResult.success) {
        logger.warn(`Failed to fetch events page ${pageIndex + 1}: ${listingResult.status || listingResult.error}`);
        break;
      }

      if (listingResult.events.length === 0) {
        logger.info(`No events returned for page ${pageIndex + 1}, stopping pagination`);
        break;
      }

      for (const listing of listingResult.events) {
        const absoluteUrl = new URL(listing.relativeUrl, BASE_URL).href;
        if (seenUrls.has(absoluteUrl)) continue;

        seenUrls.add(absoluteUrl);
        logger.info(`Fetching detail for ${listing.title}`);

        const detailResult = await fetchDetailData(page, absoluteUrl);
        if (!detailResult.success || !detailResult.data) {
          logger.warn(`Failed to load detail page for ${absoluteUrl}: ${detailResult.status || detailResult.error}`);
          continue;
        }

        const rawEvent = buildRawEvent(listing, detailResult.data, absoluteUrl);
        if (rawEvent) {
          events.push(rawEvent);
        } else {
          logger.warn(`Skipping event ${listing.title} due to missing date information`);
        }

        await delay(addJitter(DEFAULT_DETAIL_DELAY_MS));
      }

      await delay(addJitter(DEFAULT_PAGE_DELAY_MS));
    }

    logger.info(`Scrape completed. Total events found: ${events.length}`);
    return events;
  },
};

async function fetchListingPage(page: RunContext['page'], pageIndex: number): Promise<ListingFetchResult> {
  const listingUrl = `${BASE_URL}/events?page=${pageIndex}`;
  try {
    return await page.evaluate(
      async ({ url, extractor }: { url: string; extractor: string }) => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });

          if (!response.ok) {
            return { success: false, status: response.status, events: [] };
          }

          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const extractorFn = eval(extractor);
          const events = extractorFn(doc);

          return { success: true, events };
        } catch (error: any) {
          return { success: false, error: error?.message || 'Unknown error', events: [] };
        }
      },
      { url: listingUrl, extractor: listingExtractorSource },
    );
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to evaluate listing page', events: [] };
  }
}

async function fetchDetailData(page: RunContext['page'], url: string): Promise<DetailFetchResult> {
  try {
    return await page.evaluate(
      async ({ detailUrl, extractor }: { detailUrl: string; extractor: string }) => {
        try {
          const response = await fetch(detailUrl, {
            method: 'GET',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });

          if (!response.ok) {
            return { success: false, status: response.status };
          }

          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const extractorFn = eval(extractor);
          const data = extractorFn(doc);

          return { success: true, data };
        } catch (error: any) {
          return { success: false, error: error?.message || 'Unknown error' };
        }
      },
      { detailUrl: url, extractor: detailExtractorSource },
    );
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to evaluate detail page' };
  }
}

function buildRawEvent(
  listing: PgplListingEvent,
  detail: PgplDetailData,
  absoluteUrl: string,
): RawEvent | null {
  const primary = detail.dates[0];
  if (!primary?.start) {
    return null;
  }

  const imageCandidate = detail.imageUrl || listing.imageUrl;
  const absoluteImage = imageCandidate ? new URL(imageCandidate, BASE_URL).href : undefined;

  const seriesDates = detail.dates.map(date => ({
    start: date.start,
    end: date.end,
    rawText: null,
  }));

  return {
    sourceEventId: detail.nodeId || undefined,
    title: detail.title || listing.title,
    start: primary.start,
    end: primary.end,
    descriptionHtml: listing.descriptionHtml || undefined,
    venueName: detail.locationText || listing.locationText || undefined,
    url: absoluteUrl,
    imageUrl: absoluteImage,
    raw: {
      listing,
      detail,
      seriesDates,
      timezone: TIMEZONE,
    },
  };
}

export default pgplModule;
