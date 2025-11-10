import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { delay, addJitter } from '../../lib/utils.js';
import { DateTime } from 'luxon';

const BASE_URL = 'https://www.pgpl.ca';
const AJAX_ENDPOINT = `${BASE_URL}/views/ajax`;
const VIEW_DOM_ID = '8af03284011b70d3455bce0d07c4b339';
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
  imageUrl?: string | null;
};

type PgplDetailData = {
  dateItems: string[];
  descriptionHtml?: string | null;
  accessibilityHtml?: string | null;
  locationText?: string | null;
  audienceText?: string | null;
  registrationText?: string | null;
  categoryTexts?: string[];
  sourceEventId?: string | null;
  heroImage?: string | null;
};

type AjaxListingResult = {
  success: boolean;
  events: PgplListingEvent[];
  status?: number;
  error?: string;
};

type AjaxDetailResult = {
  success: boolean;
  data?: PgplDetailData;
  status?: number;
  error?: string;
};

const BASE_PAYLOAD: Record<string, string> = {
  view_name: 'programs_and_events',
  view_display_id: 'page',
  view_path: 'events',
  view_base_path: 'events',
  view_dom_id: VIEW_DOM_ID,
  pager_element: '0',
};

export const extractListingEventsFromDocument = (doc: Document): PgplListingEvent[] => {
  const viewContent = doc.querySelector('.view-content');
  if (!viewContent) return [];

  const events: PgplListingEvent[] = [];
  let currentDate = '';

  const children = Array.from(viewContent.children);
  children.forEach((child: Element) => {
    const tagName = child.tagName?.toLowerCase() ?? '';

    if (tagName === 'h3') {
      const label = child.textContent?.trim();
      if (label) currentDate = label;
      return;
    }

    if (!child.classList.contains('views-row')) return;

    const titleLink = child.querySelector('.views-field-title a') as HTMLAnchorElement | null;
    const timeField = child.querySelector('.views-field-field-start-time .field-content');
    const locationField = child.querySelector('.views-field-field-location .field-content');
    const imageEl = child.querySelector('.views-field-field-event-image img') as HTMLImageElement | null;

    if (!titleLink?.getAttribute('href')) return;

    events.push({
      title: titleLink.textContent?.trim() || '',
      relativeUrl: titleLink.getAttribute('href') || '',
      dateLabel: currentDate,
      timeText: timeField?.textContent?.trim() || null,
      locationText: locationField?.textContent?.trim() || null,
      imageUrl: imageEl?.getAttribute('src') || null,
    });
  });

  return events;
};

export const extractDetailDataFromDocument = (doc: Document): PgplDetailData => {
  const descriptionEl = doc.querySelector('.field-name-body .field-item');
  const accessibilityEl = doc.querySelector('.field-name-field-accessibility-information .field-item');
  const locationEl = doc.querySelector('.field-name-field-location .field-item');
  const audienceEl = doc.querySelector('.field-name-field-target-audience .field-item');
  const registrationEl = doc.querySelector('.field-name-field-registration-type .field-item') || doc.querySelector('.field-name-field-registration .field-item');
  const categoryEls = Array.from(doc.querySelectorAll('.field-name-field-program-type .field-item, .field-name-field-categories .field-item'));
  const heroImageEl = doc.querySelector('.field-name-field-event-image img') as HTMLImageElement | null;
  const shortlinkEl = doc.querySelector('link[rel="shortlink"]');

  const dateItems = Array.from(doc.querySelectorAll('.field-name-field-start-time .field-item'))
    .map(item => item.textContent?.replace(/\s+/g, ' ').trim())
    .filter((value): value is string => Boolean(value));

  return {
    dateItems,
    descriptionHtml: descriptionEl?.innerHTML?.trim() || null,
    accessibilityHtml: accessibilityEl?.innerHTML?.trim() || null,
    locationText: locationEl?.textContent?.trim() || null,
    audienceText: audienceEl?.textContent?.trim() || null,
    registrationText: registrationEl?.textContent?.trim() || null,
    categoryTexts: categoryEls
      .map(el => el.textContent?.trim())
      .filter((value): value is string => Boolean(value)),
    sourceEventId: shortlinkEl?.getAttribute('href') || null,
    heroImage: heroImageEl?.getAttribute('src') || null,
  };
};

export const parseDateRangeText = (value: string, timezone: string = TIMEZONE): { start?: string; end?: string } | null => {
  if (!value) return null;
  let normalized = value
    .replace(/\u2013|\u2014/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const [datePartRaw, timePartRaw] = normalized.split(' - ');
  if (!datePartRaw) return null;

  const cleanedDate = datePartRaw
    .replace(/^[A-Za-z]+,\s*/, '')
    .replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1')
    .trim();

  const baseDate = DateTime.fromFormat(cleanedDate, 'MMMM d, yyyy', { zone: timezone });
  if (!baseDate.isValid) {
    return null;
  }

  const normalizeTimeText = (text?: string | null): string | null => {
    if (!text) return null;
    return text
      .replace(/(am|pm)(?=[A-Za-z])/gi, '$1 ')
      .replace(/-/g, ' - ')
      .replace(/(am|pm)to/gi, '$1 to ')
      .replace(/\s+/g, ' ')
      .replace(/\./g, '')
      .trim();
  };

  const parseTimeComponent = (text?: string | null): { hour: number; minute: number } | null => {
    if (!text) return null;
    const cleaned = text.toLowerCase();
    const match = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!match) return null;
    let hour = parseInt(match[1] || '0', 10);
    const minute = parseInt(match[2] || '0', 10);
    const meridiem = match[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  };

  const timeText = normalizeTimeText(timePartRaw);

  if (timeText?.toLowerCase().includes('all day')) {
    const startIso = baseDate.set({ hour: 9, minute: 0 }).toISO();
    const endIso = baseDate.set({ hour: 17, minute: 0 }).toISO();
    return { start: startIso || undefined, end: endIso || undefined };
  }

  let startTimeText: string | null = null;
  let endTimeText: string | null = null;

  if (timeText) {
    const rangeMatch = timeText.match(/^(.+?)\s*(?:to|-)\s*(.+)$/i);
    if (rangeMatch) {
      startTimeText = rangeMatch[1].trim();
      endTimeText = rangeMatch[2].trim();
    } else {
      startTimeText = timeText.trim();
    }
  }

  const startTime = parseTimeComponent(startTimeText) || { hour: 9, minute: 0 };
  const endTime = parseTimeComponent(endTimeText);

  const startIso = baseDate.set({ hour: startTime.hour, minute: startTime.minute }).toISO();
  let endIso: string | undefined;

  if (endTime) {
    let endDateTime = baseDate.set({ hour: endTime.hour, minute: endTime.minute });
    if (endDateTime < baseDate.set({ hour: startTime.hour, minute: startTime.minute })) {
      endDateTime = endDateTime.plus({ days: 1 });
    }
    endIso = endDateTime.toISO() || undefined;
  }

  return {
    start: startIso || undefined,
    end: endIso,
  };
};

const listingExtractorSource = `(${extractListingEventsFromDocument.toString()})`;
const detailExtractorSource = `(${extractDetailDataFromDocument.toString()})`;

const pgplModule: ScraperModule = {
  key: 'pgpl_ca',
  label: 'Prince George Public Library',
  startUrls: [`${BASE_URL}/events`],
  paginationType: 'page',
  integrationTags: ['api', 'calendar'],

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

async function fetchListingPage(page: RunContext['page'], pageIndex: number): Promise<AjaxListingResult> {
  try {
    const payload = { ...BASE_PAYLOAD, page: String(pageIndex) };
    return await page.evaluate(
      async ({ ajaxUrl, payloadData, extractor }: { ajaxUrl: string; payloadData: Record<string, string>; extractor: string }) => {
        try {
          const params = new URLSearchParams(payloadData).toString();
          const response = await fetch(ajaxUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: params,
          });

          if (!response.ok) {
            return { success: false, status: response.status, events: [] };
          }

          const data = await response.json();
          const htmlElement = data.find(
            (entry: any) => entry && typeof entry === 'object' && 'data' in entry && typeof entry.data === 'string',
          );

          if (!htmlElement?.data) {
            return { success: true, events: [] };
          }

          const parser = new DOMParser();
          const doc = parser.parseFromString(htmlElement.data, 'text/html');
          const extractorFn = eval(extractor);
          const events = extractorFn(doc);

          return { success: true, events };
        } catch (error: any) {
          return { success: false, error: error?.message || 'Unknown error', events: [] };
        }
      },
      { ajaxUrl: AJAX_ENDPOINT, payloadData: payload, extractor: listingExtractorSource },
    );
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to evaluate listing page', events: [] };
  }
}

async function fetchDetailData(page: RunContext['page'], url: string): Promise<AjaxDetailResult> {
  try {
    return await page.evaluate(
      async ({ detailUrl, extractor }: { detailUrl: string; extractor: string }) => {
        try {
          const response = await fetch(detailUrl, {
            method: 'GET',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
            },
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
  const dateRanges = detail.dateItems
    .map(item => parseDateRangeText(item))
    .filter((range): range is { start?: string; end?: string } => Boolean(range?.start));

  const dateInfo = dateRanges[0];
  if (!dateInfo?.start) {
    return null;
  }

  const imageCandidate = detail.heroImage || listing.imageUrl;
  const absoluteImage = imageCandidate ? new URL(imageCandidate, BASE_URL).href : undefined;
  const sourceEventIdMatch = detail.sourceEventId?.match(/node\/(\d+)/);

  const descriptionParts: string[] = [];
  if (detail.descriptionHtml) descriptionParts.push(detail.descriptionHtml);
  if (detail.accessibilityHtml) {
    descriptionParts.push(`<h4>Accessibility Information</h4>${detail.accessibilityHtml}`);
  }

  const tags = [
    detail.audienceText?.trim(),
    detail.registrationText?.trim(),
  ].filter((value): value is string => Boolean(value));

  return {
    sourceEventId: sourceEventIdMatch?.[1],
    title: listing.title,
    start: dateInfo.start,
    end: dateInfo.end,
    descriptionHtml: descriptionParts.join('<hr />') || undefined,
    venueName: detail.locationText || listing.locationText || undefined,
    url: absoluteUrl,
    imageUrl: absoluteImage,
    category: detail.categoryTexts && detail.categoryTexts.length > 0 ? detail.categoryTexts.join(', ') : undefined,
    price: detail.registrationText || undefined,
    tags: tags.length ? tags : undefined,
    raw: {
      listing,
      detail,
    },
  };
}

export default pgplModule;
