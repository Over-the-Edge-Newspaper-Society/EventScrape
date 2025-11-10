import type { DetailPageSeriesEntry } from '../types.js';

const MONTH_PATTERN = /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)/i;

const toYMD = (date: Date): string => {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
};

export const parseDateTimeRangeFromText = (text: string): { start?: string; end?: string } | null => {
  if (!text) return null;
  const normalized = text.replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  const monthMatch = normalized.match(new RegExp(`${MONTH_PATTERN.source}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`, 'i'));
  if (!monthMatch) {
    return null;
  }

  const datePartRaw = monthMatch[0].replace(/(\d)(st|nd|rd|th)/gi, '$1').replace(/\s{2,}/g, ' ').trim();
  const dateObj = new Date(datePartRaw);
  if (isNaN(dateObj.getTime())) {
    return null;
  }
  const dateYMD = toYMD(dateObj);

  const remainder = normalized.slice(normalized.indexOf(monthMatch[0]) + monthMatch[0].length).replace(/^[,\s-]+/, '');
  const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s*(?:[ap]\.??m\.?)?)(?:\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.??m\.?)?))?/i;
  const timeMatch = remainder.match(timeRangeRegex);

  const extractMeridiem = (value: string | null | undefined): 'am' | 'pm' | null => {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower.includes('am')) return 'am';
    if (lower.includes('pm')) return 'pm';
    return null;
  };

  const parseTime = (value: string | null | undefined, hint?: 'am' | 'pm'): string | null => {
    if (!value) return null;
    const cleaned = value.toLowerCase().replace(/\./g, '').trim();
    const meridiem = extractMeridiem(cleaned) || hint || null;
    const numbers = cleaned.replace(/[^0-9:]/g, '');
    if (!numbers) return null;
    const [h, m] = numbers.split(':');
    let hour = parseInt(h ?? '0', 10);
    const minute = parseInt(m ?? '0', 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  let startTime: string | null = null;
  let endTime: string | null = null;

  if (timeMatch) {
    const startRaw = timeMatch[1];
    const endRaw = timeMatch[2];
    const endMeridiem = extractMeridiem(endRaw);
    startTime = parseTime(startRaw, endMeridiem || extractMeridiem(startRaw));
    endTime = parseTime(endRaw, extractMeridiem(endRaw) || extractMeridiem(startRaw));
  }

  if (!startTime) {
    const singleTimeMatch = remainder.match(/(\d{1,2}(?::\d{2})?\s*(?:[ap]\.??m\.?))/i);
    if (singleTimeMatch) {
      startTime = parseTime(singleTimeMatch[1]);
    }
  }

  const result: { start?: string; end?: string } = {};
  if (startTime) {
    result.start = `${dateYMD} ${startTime}`;
  }
  if (endTime) {
    result.end = `${dateYMD} ${endTime}`;
  }

  if (!result.start) {
    // Default to noon if no time info is present
    result.start = `${dateYMD} 12:00`;
  }

  return result;
};

export const extractPrinceGeorgeDetailPageData = (): {
  eventType?: string | null;
  communityType?: string | null;
  location?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  dates: DetailPageSeriesEntry[];
} => {
  const cleanText = (value: string | null | undefined): string => {
    if (!value) return '';
    return value.replace(/\s+/g, ' ').replace(/\s+-\s+/g, ' - ').trim();
  };

  const collectTimeSeries = (container: Element | null): DetailPageSeriesEntry[] => {
    const series: DetailPageSeriesEntry[] = [];
    if (!container) return series;
    const timeNodes = Array.from(container.querySelectorAll('time[datetime]')) as HTMLElement[];

    const findMatchingEnd = (startEl: HTMLElement): HTMLElement | null => {
      let cursor: ChildNode | null = startEl.nextSibling;
      while (cursor) {
        if (cursor.nodeType === 1) { // ELEMENT_NODE
          const element = cursor as HTMLElement;
          const tag = element.tagName?.toLowerCase();
          if (tag === 'time' && element.hasAttribute('datetime')) {
            return element;
          }
          if (tag === 'br') {
            break;
          }
        }
        cursor = cursor.nextSibling;
      }
      return null;
    };

    for (let i = 0; i < timeNodes.length; i++) {
      const startEl = timeNodes[i];
      const start = startEl?.getAttribute('datetime');
      if (!start) continue;

      const matchingEnd = findMatchingEnd(startEl);
      const end = matchingEnd?.getAttribute('datetime') || null;
      const startText = cleanText(startEl.textContent);
      const endText = matchingEnd ? cleanText(matchingEnd.textContent) : '';
      const rawText = cleanText(endText ? `${startText} - ${endText}` : startText);

      series.push({ start, end, rawText: rawText || null });

      if (matchingEnd) {
        const nextIndex = timeNodes.indexOf(matchingEnd);
        if (nextIndex > i) {
          i = nextIndex;
        }
      }
    }

    return series;
  };

  const collectTextEntries = (container: Element | null): DetailPageSeriesEntry[] => {
    const entries: DetailPageSeriesEntry[] = [];
    if (!container) return entries;

    const html = container.innerHTML || '';
    const plain = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<[^>]+>/g, ' ');

    plain
      .split('\n')
      .map(line => cleanText(line))
      .filter(Boolean)
      .forEach(text => entries.push({ rawText: text }));

    return entries;
  };

  const dates: DetailPageSeriesEntry[] = [];
  const seenContainers = new Set<Element>();

  ['.views-field-field-when', '.field--name-field-when', '.add-to-cal__wrapper'].forEach(selector => {
    const nodes = document.querySelectorAll(selector);
    nodes.forEach(node => {
      if (!seenContainers.has(node as Element)) {
        seenContainers.add(node as Element);
        dates.push(...collectTimeSeries(node as Element));
      }
    });
  });

  ['.views-field-field-when', '.field--name-field-when'].forEach(selector => {
    const nodes = document.querySelectorAll(selector);
    nodes.forEach(node => {
      const element = node as Element;
      if (element.querySelector('time[datetime]')) {
        return;
      }
      collectTextEntries(element).forEach(entry => {
        dates.push({ rawText: entry.rawText });
      });
    });
  });

  document.querySelectorAll('.add-to-cal__item').forEach(item => {
    if ((item as Element).querySelector('time[datetime]')) {
      return;
    }
    const text = cleanText(item.textContent);
    if (text) {
      dates.push({ rawText: text });
    }
  });

  const eventTypeEl = document.querySelector('.field--name-field-types .field__item');
  const communityTypeEl = document.querySelector('.field--name-field-types2 .field__item');
  const eventType = eventTypeEl?.textContent?.trim();
  const communityType = communityTypeEl?.textContent?.trim();

  const locationEl = document.querySelector('.field--name-field-contact-information .field__item');
  const location = locationEl?.textContent?.trim();

  const descriptionEl = document.querySelector('.field--name-body.field--type-text-with-summary .field__item') ||
    document.querySelector('.field--name-body .field__item') ||
    document.querySelector('.field--name-body.field--type-text-with-summary') ||
    document.querySelector('.field--name-body');
  const description = descriptionEl?.innerHTML?.trim();

  const imageEl = document.querySelector('.field--name-field-media-image img') as HTMLImageElement;
  const imageUrl = imageEl?.src;

  return {
    eventType,
    communityType,
    location,
    description,
    imageUrl,
    startDateTime: dates.find(d => d.start)?.start || null,
    endDateTime: dates.find(d => d.end)?.end || null,
    dates,
  };
};

const normalizeDateSignature = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = value.trim();
  const withT = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const signature = withT.length >= 16 ? withT.slice(0, 16) : withT;
  return signature.toLowerCase();
};

export const normalizeSeriesEntries = (
  rawSeries: DetailPageSeriesEntry[],
): Array<{ start: string; end?: string; rawText?: string | null }> => {
  const normalizedSeries = rawSeries.map(entry => {
    if (entry?.start) {
      return { start: entry.start, end: entry.end ?? undefined, rawText: entry.rawText ?? null };
    }
    if (entry?.rawText) {
      const parsed = parseDateTimeRangeFromText(entry.rawText);
      if (parsed?.start) {
        return { start: parsed.start, end: parsed.end, rawText: entry.rawText };
      }
    }
    return { start: null, end: null, rawText: entry?.rawText ?? null };
  });

  const dedupedSeries: Array<{ start: string; end?: string; rawText?: string | null }> = [];
  const seenSeries = new Set<string>();
  const buildKey = (entry: { start?: string | null; end?: string; rawText?: string | null }) => {
    const startSignature = normalizeDateSignature(entry.start);
    if (startSignature) {
      const endSignature = normalizeDateSignature(entry.end);
      return `${startSignature}|${endSignature}`;
    }
    if (entry.rawText) {
      return entry.rawText.replace(/\s+/g, ' ').trim().toLowerCase();
    }
    return '';
  };

  for (const entry of normalizedSeries) {
    if (!entry.start) continue;
    const key = buildKey(entry);
    if (!key || seenSeries.has(key)) continue;
    seenSeries.add(key);
    dedupedSeries.push({
      start: entry.start,
      end: entry.end,
      rawText: entry.rawText ?? null,
    });
  }

  return dedupedSeries;
};
