/**
 * Simple keyword-based classifier for Instagram posts
 * Determines if a post is likely an event poster
 */

const EVENT_KEYWORDS = [
  // Event types
  'event', 'concert', 'show', 'performance', 'festival', 'workshop',
  'seminar', 'conference', 'meeting', 'gathering', 'celebration',
  'party', 'gala', 'fundraiser', 'tournament', 'competition',
  'exhibition', 'expo', 'fair', 'market', 'sale',

  // Time indicators
  'tonight', 'tomorrow', 'this weekend', 'next week', 'coming soon',
  'save the date', 'mark your calendar', 'join us', 'come out',

  // Event-specific words
  'tickets', 'admission', 'register', 'registration', 'rsvp',
  'doors open', 'starts at', 'beginning at', 'from', 'to',
  'free entry', 'cover charge', 'price', 'cost',

  // Common event phrases
  'you\'re invited', 'invite', 'don\'t miss', 'limited seats',
  'early bird', 'vip', 'general admission', 'lineup', 'featuring',

  // Date/time patterns (these are checked separately)
  'pm', 'am', 'p.m.', 'a.m.',
];

const NON_EVENT_KEYWORDS = [
  // Regular posts
  'follow', 'like', 'share', 'comment', 'tag', 'check out',
  'new post', 'throwback', 'tbt', 'flashback', 'memory',
  'announcement', 'update', 'news', 'reminder',

  // Product/promotional
  'sale', 'discount', 'promo', 'offer', 'deal', 'now available',
  'buy now', 'shop', 'order', 'purchase',

  // Social media specific
  'story', 'highlight', 'swipe up', 'link in bio', 'dm', 'dm us',
];

// Regex patterns for dates and times
const DATE_PATTERNS = [
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i,
  /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?/,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
];

const TIME_PATTERNS = [
  /\b\d{1,2}:\d{2}\s*(am|pm|a\.m\.|p\.m\.)?/i,
  /\b\d{1,2}\s*(am|pm|a\.m\.|p\.m\.)\b/i,
];

export interface ClassificationResult {
  isEvent: boolean;
  confidence: number;
  reasons?: string[];
}

/**
 * Classify if a caption indicates an event poster
 */
export function classifyCaption(caption: string | null | undefined): ClassificationResult {
  if (!caption || caption.trim().length === 0) {
    // No caption means we can't classify, return neutral
    return {
      isEvent: false,
      confidence: 0.5,
      reasons: ['No caption available'],
    };
  }

  const lowerCaption = caption.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  // Check for event keywords
  let eventKeywordCount = 0;
  for (const keyword of EVENT_KEYWORDS) {
    if (lowerCaption.includes(keyword.toLowerCase())) {
      eventKeywordCount++;
      if (eventKeywordCount === 1) {
        reasons.push(`Contains event keyword: "${keyword}"`);
      }
    }
  }

  if (eventKeywordCount > 0) {
    score += Math.min(eventKeywordCount * 0.15, 0.4);
  }

  // Check for non-event keywords (negative signal)
  let nonEventKeywordCount = 0;
  for (const keyword of NON_EVENT_KEYWORDS) {
    if (lowerCaption.includes(keyword.toLowerCase())) {
      nonEventKeywordCount++;
    }
  }

  if (nonEventKeywordCount > 0) {
    score -= Math.min(nonEventKeywordCount * 0.1, 0.3);
    reasons.push(`Contains non-event indicators (${nonEventKeywordCount})`);
  }

  // Check for date patterns
  let hasDate = false;
  for (const pattern of DATE_PATTERNS) {
    if (pattern.test(caption)) {
      hasDate = true;
      reasons.push('Contains date information');
      break;
    }
  }
  if (hasDate) {
    score += 0.25;
  }

  // Check for time patterns
  let hasTime = false;
  for (const pattern of TIME_PATTERNS) {
    if (pattern.test(caption)) {
      hasTime = true;
      reasons.push('Contains time information');
      break;
    }
  }
  if (hasTime) {
    score += 0.20;
  }

  // Bonus if both date and time present
  if (hasDate && hasTime) {
    score += 0.15;
    reasons.push('Has both date and time');
  }

  // Clamp score between 0 and 1
  const confidence = Math.max(0, Math.min(1, score + 0.5));

  // Classify as event if confidence > 0.6
  const isEvent = confidence > 0.6;

  return {
    isEvent,
    confidence,
    reasons: reasons.length > 0 ? reasons : ['No clear event indicators'],
  };
}

/**
 * Simple wrapper for backward compatibility
 */
export function classify(caption: string | null | undefined): [boolean, number] {
  const result = classifyCaption(caption);
  return [result.isEvent, result.confidence];
}
