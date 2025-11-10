import type { RunContext, RawEvent } from '../../../types.js';
import { delay, addJitter } from '../../../lib/utils.js';
import type { CalendarEventLink } from '../types.js';
import { extractPrinceGeorgeDetailPageData, normalizeSeriesEntries } from './detail-page.js';

export const processEventDetails = async (
  ctx: RunContext,
  eventLinks: CalendarEventLink[],
  isTestMode: boolean,
  seriesCache: Record<string, Array<{ start: string, end?: string }>>,
): Promise<RawEvent[]> => {
  const { page, logger } = ctx;
  const events: RawEvent[] = [];

  const eventsToProcess = isTestMode ? eventLinks.slice(0, 1) : eventLinks;
  logger.info(`Processing ${eventsToProcess.length} event${eventsToProcess.length === 1 ? '' : 's'}${isTestMode ? ' (test mode)' : ''}`);

  const visitedUrls = new Set<string>();

  for (const [index, eventLink] of eventsToProcess.entries()) {
    try {
      logger.info(`Processing calendar event ${index + 1}/${eventsToProcess.length}: ${eventLink.title}`);

      let eventStart = '';
      let eventEnd: string | undefined;
      try {
        if (eventLink.dataStart) {
          eventStart = eventLink.dataStart;
          logger.info(`Using data-start attribute for event start: ${eventStart}`);
          if (eventLink.dataEnd) {
            eventEnd = eventLink.dataEnd;
          }
        } else if (eventLink.date && eventLink.time) {
          const dateStr = eventLink.date;
          const timeStr = eventLink.time;

          let startTime = timeStr;
          let endTime = null;
          const rangePieces = timeStr.split(/\s?[–-]\s?/);
          if (rangePieces.length === 2) {
            startTime = rangePieces[0].trim();
            endTime = rangePieces[1]?.trim() || null;
          }

          const normalizeTimeToString = (time: string): string => {
            const normalized = time.trim().toLowerCase();

            if (normalized === 'all day' || normalized === 'all-day') {
              return '09:00';
            }
            if (normalized === 'noon') {
              return '12:00';
            }
            if (normalized === 'midnight') {
              return '00:00';
            }

            const simpleMatch = normalized.match(/^(\d{1,2})\s*([ap])m?$/);
            if (simpleMatch) {
              const hour = parseInt(simpleMatch[1], 10);
              const meridiem = simpleMatch[2];
              const isPM = meridiem === 'p';
              const hour24 = isPM && hour !== 12 ? hour + 12 : (!isPM && hour === 12 ? 0 : hour);
              return `${hour24.toString().padStart(2, '0')}:00`;
            }

            const detailedMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*([ap])m?$/);
            if (detailedMatch) {
              const hour = parseInt(detailedMatch[1], 10);
              const min = detailedMatch[2];
              const meridiem = detailedMatch[3];
              const isPM = meridiem === 'p';
              const hour24 = isPM && hour !== 12 ? hour + 12 : (!isPM && hour === 12 ? 0 : hour);
              return `${hour24.toString().padStart(2, '0')}:${min}`;
            }

            const twentyFourHourMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?$/);
            if (twentyFourHourMatch) {
              const hour = parseInt(twentyFourHourMatch[1], 10);
              const min = twentyFourHourMatch[2] ?? '00';
              if (!Number.isNaN(hour)) {
                return `${hour.toString().padStart(2, '0')}:${min}`;
              }
            }

            return '19:00';
          };

          const startTimeNormalized = normalizeTimeToString(startTime);

          let dateOnlyStr = dateStr;
          if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            dateOnlyStr = dateStr;
          } else {
            const tempDate = new Date(dateStr);
            if (!isNaN(tempDate.getTime())) {
              dateOnlyStr = `${tempDate.getFullYear()}-${(tempDate.getMonth() + 1).toString().padStart(2, '0')}-${tempDate.getDate().toString().padStart(2, '0')}`;
            }
          }

          eventStart = `${dateOnlyStr} ${startTimeNormalized}`;
          logger.info(`Created event start time: ${eventStart} from date: "${dateStr}" and time: "${timeStr}"`);

          if (endTime) {
            const endTimeNormalized = normalizeTimeToString(endTime);
            const isAllDay = endTime.trim().toLowerCase().startsWith('all');
            eventEnd = `${dateOnlyStr} ${isAllDay ? '17:00' : endTimeNormalized}`;
            logger.info(`Created event end time: ${eventEnd}`);
          }
        }
        if (!eventStart && eventLink.dataStart) {
          eventStart = eventLink.dataStart;
        }

        if (!eventStart) {
          const now = new Date();
          eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
          logger.warn(`Using current date as fallback for event: ${eventLink.title}`);
        }
      } catch (dateError) {
        const now = new Date();
        eventStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
        logger.warn(`Date parsing failed for ${eventLink.title}, using current date`);
      }

      const calendarDateString = eventLink.date || new Date(eventStart).toDateString();
      let sourceEventId = `${eventLink.url}#${calendarDateString}`;

      const baseEvent: RawEvent = {
        sourceEventId: sourceEventId,
        title: eventLink.title || 'Untitled Event',
        start: eventStart,
        end: eventEnd,
        city: 'Prince George',
        region: 'British Columbia',
        country: 'Canada',
        organizer: 'City of Prince George',
        category: 'Community Event',
        url: eventLink.url,
        raw: {
          calendarTime: eventLink.time,
          calendarDate: eventLink.date,
          extractedAt: new Date().toISOString(),
          originalEventLink: eventLink,
          sourcePageUrl: eventLink.url,
        },
      };

      const normalizeToYMD = (d: string): string | null => {
        try {
          if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
          const tmp = new Date(d);
          if (isNaN(tmp.getTime())) return null;
          return `${tmp.getFullYear()}-${(tmp.getMonth() + 1).toString().padStart(2, '0')}-${tmp.getDate().toString().padStart(2, '0')}`;
        } catch {
          return null;
        }
      };

      if (!visitedUrls.has(eventLink.url)) {
        logger.info(`Enhancing with details from: ${eventLink.url}`);
        visitedUrls.add(eventLink.url);

        await delay(addJitter(2000, 50));

        try {
          await page.goto(eventLink.url, {
            waitUntil: 'networkidle',
            timeout: 20000,
          });
          if (ctx.stats) ctx.stats.pagesCrawled++;

          const enhancementData = await page.evaluate(extractPrinceGeorgeDetailPageData);
          const rawSeries = Array.isArray(enhancementData.dates)
            ? (enhancementData.dates as Array<{ start?: string | null; end?: string | null; rawText?: string | null }>)
            : [];

          const validSeries = normalizeSeriesEntries(rawSeries);

          if (validSeries.length) {
            seriesCache[eventLink.url] = validSeries.map(({ start, end }) => ({ start, end }));
          }

          const eventDateYMD = normalizeToYMD(eventLink.date) || normalizeToYMD(eventLink.dataStart || '');
          if (eventDateYMD && validSeries.length) {
            const match = validSeries.find(d => {
              const datePart = d.start.includes('T') ? d.start.split('T')[0] : d.start.split(' ')[0];
              return datePart === eventDateYMD;
            });
            if (match) {
              baseEvent.start = match.start;
              baseEvent.end = match.end;
              logger.info(`Matched series date ${eventDateYMD} from detail page for ${eventLink.title}`);
            } else if (!enhancementData.startDateTime && validSeries[0]) {
              baseEvent.start = validSeries[0].start;
              baseEvent.end = validSeries[0].end;
              logger.info(`No exact series match; using first series instance for ${eventLink.title}`);
            }
          } else {
            if (enhancementData.startDateTime) baseEvent.start = enhancementData.startDateTime;
            if (enhancementData.endDateTime) baseEvent.end = enhancementData.endDateTime;
          }

          const categories = [enhancementData.eventType, enhancementData.communityType].filter(Boolean) as string[];

          if (categories.length > 0) {
            baseEvent.category = categories[0];
          }

          if (categories.length > 1) {
            baseEvent.tags = categories.slice(1);
          }

          if (enhancementData.description) {
            baseEvent.descriptionHtml = enhancementData.description;
          }

          if (enhancementData.location) {
            let locationText = enhancementData.location.trim();

            locationText = locationText
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/&nbsp;/gi, ' ')
              .replace(/<[^>]*>/g, '')
              .trim();

            const locationLines = locationText
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0);

            if (locationLines.length >= 2) {
              baseEvent.venueName = locationLines[0];
              baseEvent.venueAddress = locationLines.slice(1).join(', ').trim();
            } else if (locationLines.length === 1) {
              const singleLine = locationLines[0];

              const match = singleLine.match(/^(.+?)(\d+.*)$/);
              if (match) {
                baseEvent.venueName = match[1].trim();
                baseEvent.venueAddress = match[2].trim();
              } else {
                baseEvent.venueName = singleLine;
              }
            }
          }

          if (enhancementData.imageUrl) {
            baseEvent.imageUrl = new URL(enhancementData.imageUrl, eventLink.url).href;
          }

          baseEvent.raw = {
            ...baseEvent.raw,
            eventType: enhancementData.eventType,
            communityType: enhancementData.communityType,
            fullDescription: enhancementData.description,
            detailPageStartDateTime: enhancementData.startDateTime,
            detailPageEndDateTime: enhancementData.endDateTime,
            seriesDates: validSeries,
            seriesDatesRaw: rawSeries,
            enhancedFromDetailPage: true,
          };

          if (validSeries.length > 1) {
            baseEvent.sourceEventId = eventLink.url;
            logger.info(`Set recurring event sourceEventId to URL: ${eventLink.url}`);
          }

          logger.info(`Enhanced event with details: ${eventLink.title}`);
        } catch (detailError) {
          logger.warn(`Failed to load detail page for ${eventLink.title}: ${detailError}`);
          baseEvent.raw = {
            ...baseEvent.raw,
            detailPageError: 'Failed to load detail page',
            enhancedFromDetailPage: false,
          };
        }
      } else {
        logger.info(`Detail page already processed, using cached data: ${eventLink.url}`);
        const eventDateYMD = normalizeToYMD(eventLink.date) || normalizeToYMD(eventLink.dataStart || '');
        const series = seriesCache[eventLink.url];
        if (eventDateYMD && series?.length) {
          const match = series.find(d => {
            const datePart = d.start.includes('T') ? d.start.split('T')[0] : d.start.split(' ')[0];
            return datePart === eventDateYMD;
          });
          if (match) {
            baseEvent.start = match.start;
            baseEvent.end = match.end;
            logger.info(`Applied cached series match for ${eventLink.title} on ${eventDateYMD}`);
          }
          baseEvent.raw.seriesDates = series;

          if (series.length > 1) {
            baseEvent.sourceEventId = eventLink.url;
          }
        }
        baseEvent.raw = {
          ...baseEvent.raw,
          enhancedFromDetailPage: false,
          note: 'Detail page already processed for another calendar entry',
        };
      }

      if (baseEvent.raw?.seriesDates && Array.isArray(baseEvent.raw.seriesDates) && baseEvent.raw.seriesDates.length > 1) {
        const alreadyAdded = events.some(e => e.url === eventLink.url);
        if (!alreadyAdded) {
          events.push(baseEvent);
          logger.info(`Created recurring event with ${baseEvent.raw.seriesDates.length} occurrences: ${eventLink.title}`);
        } else {
          logger.info(`Skipping duplicate calendar entry for recurring event: ${eventLink.title}`);
        }
      } else {
        events.push(baseEvent);
        logger.info(`Created single event: ${eventLink.title} on ${eventLink.date}`);
      }
    } catch (eventError) {
      logger.warn(`Failed to process calendar event ${eventLink.title}: ${eventError}`);

      const now = new Date();
      const fallbackStart = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 19:00`;
      const fallbackEvent: RawEvent = {
        sourceEventId: `${eventLink.url}#${eventLink.date || new Date().toDateString()}`,
        title: eventLink.title || 'Untitled Event',
        start: fallbackStart,
        city: 'Prince George',
        region: 'British Columbia',
        country: 'Canada',
        organizer: 'City of Prince George',
        url: eventLink.url,
        raw: {
          calendarTime: eventLink.time,
          calendarDate: eventLink.date,
          error: 'Failed to process calendar event',
          extractedAt: new Date().toISOString(),
          sourcePageUrl: eventLink.url,
        },
      };

      events.push(fallbackEvent);
    }
  }

  return events;
};

