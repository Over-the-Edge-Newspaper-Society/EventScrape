import stringSimilarity from 'string-similarity';
import jaroWinkler from 'jaro-winkler';
import { getDistance } from 'geolib';
import { DateTime } from 'luxon';
import type { EventRaw } from './database.js';
import type { PotentialMatch, SimilarityFeatures } from '../types.js';

export class EventMatcher {
  private readonly titleWeight = 0.40;
  private readonly timeWeight = 0.30;  // Increased time weight for same-time detection
  private readonly venueWeight = 0.20;
  private readonly organizerWeight = 0.10;
  
  private readonly highThreshold = 0.78;
  private readonly reviewThreshold = 0.60;
  private readonly sameTimeThreshold = 0.85;  // Higher threshold for same-time events

  /**
   * Find potential duplicate events within a given time window
   */
  async findPotentialDuplicates(
    events: EventRaw[],
    options: {
      windowDays?: number;
      minScore?: number;
      includeSameTimeAnalysis?: boolean;
    } = {}
  ): Promise<PotentialMatch[]> {
    const { windowDays = 7, minScore = this.reviewThreshold, includeSameTimeAnalysis = true } = options;
    
    console.log(`Match options: windowDays=${windowDays}, minScore=${minScore}, sameTimeAnalysis=${includeSameTimeAnalysis}`);
    const matches: PotentialMatch[] = [];
    
    console.log(`Finding duplicates among ${events.length} events...`);

    // First pass: Find same-time event clusters across sources
    if (includeSameTimeAnalysis) {
      const sameTimeMatches = await this.findSameTimeEventClusters(events, windowDays);
      matches.push(...sameTimeMatches);
      console.log(`Found ${sameTimeMatches.length} same-time matches across sources`);
    }

    for (let i = 0; i < events.length; i++) {
      const eventA = events[i];
      
      // Only compare with events after current index to avoid duplicates
      for (let j = i + 1; j < events.length; j++) {
        const eventB = events[j];
        
        // Skip if events are from same source and have same source event ID
        if (eventA.sourceId === eventB.sourceId && 
            eventA.sourceEventId && 
            eventB.sourceEventId && 
            eventA.sourceEventId === eventB.sourceEventId) {
          continue;
        }
        
        // Apply blocking filters first (performance optimization)
        const passesFilters = this.passesBlockingFilters(eventA, eventB, windowDays);
        if (!passesFilters) {
          continue;
        }
        
        // Calculate detailed similarity score
        const features = this.calculateSimilarityFeatures(eventA, eventB);
        const score = this.calculateOverallScore(features);
        
        if (score >= minScore) {
          matches.push({
            eventA: eventA.id,
            eventB: eventB.id,
            score,
            features,
            reason: this.generateReason(features, score),
          });
        }
      }
    }

    // Deduplicate matches (remove lower-scored duplicates of same pair)
    const deduplicatedMatches = this.deduplicateMatches(matches);
    
    // Sort by score descending
    deduplicatedMatches.sort((a, b) => b.score - a.score);
    
    console.log(`Found ${deduplicatedMatches.length} potential duplicates (${matches.length} before deduplication, score >= ${minScore})`);
    return deduplicatedMatches;
  }

  /**
   * Find events that happen at exactly the same time across different sources
   * This method focuses specifically on temporal clustering
   */
  async findSameTimeEventClusters(events: EventRaw[], windowDays: number = 7): Promise<PotentialMatch[]> {
    const matches: PotentialMatch[] = [];
    const timeSlots = new Map<string, EventRaw[]>();

    // Group events by time slots (15-minute granularity)
    for (const event of events) {
      const dateTime = event.startDatetime instanceof Date 
        ? DateTime.fromJSDate(event.startDatetime)
        : DateTime.fromISO(event.startDatetime as string);
      
      // Round to 15-minute slots for grouping
      const roundedMinutes = Math.floor(dateTime.minute / 15) * 15;
      const slotDateTime = dateTime.set({ minute: roundedMinutes, second: 0, millisecond: 0 });
      const slotKey = slotDateTime.toISO();

      if (!timeSlots.has(slotKey)) {
        timeSlots.set(slotKey, []);
      }
      timeSlots.get(slotKey)!.push(event);
    }

    // Find clusters with events from multiple sources
    for (const [timeSlot, slotEvents] of timeSlots) {
      if (slotEvents.length < 2) continue;

      // Check if events are from different sources
      const sourceIds = new Set(slotEvents.map(e => e.sourceId));
      if (sourceIds.size < 2) continue; // Skip if all from same source

      console.log(`Found ${slotEvents.length} events from ${sourceIds.size} sources at ${timeSlot}`);

      // Compare all pairs in this time slot
      for (let i = 0; i < slotEvents.length; i++) {
        for (let j = i + 1; j < slotEvents.length; j++) {
          const eventA = slotEvents[i];
          const eventB = slotEvents[j];

          // Skip if same source
          if (eventA.sourceId === eventB.sourceId) continue;

          // Calculate enhanced features for same-time events
          const features = this.calculateSameTimeFeatures(eventA, eventB);
          const score = this.calculateSameTimeScore(features);

          if (score >= this.reviewThreshold) {
            matches.push({
              eventA: eventA.id,
              eventB: eventB.id,
              score,
              features,
              reason: this.generateSameTimeReason(features, score, timeSlot),
            });
          }
        }
      }
    }

    return matches;
  }

  /**
   * Blocking filters to quickly eliminate obvious non-matches
   */
  private passesBlockingFilters(eventA: EventRaw, eventB: EventRaw, windowDays: number): boolean {
    // Date proximity check (within window)
    const dateA = eventA.startDatetime instanceof Date 
      ? DateTime.fromJSDate(eventA.startDatetime)
      : DateTime.fromISO(eventA.startDatetime as string);
    const dateB = eventB.startDatetime instanceof Date 
      ? DateTime.fromJSDate(eventB.startDatetime)
      : DateTime.fromISO(eventB.startDatetime as string);
    const daysDiff = Math.abs(dateA.diff(dateB, 'days').days);
    
    if (daysDiff > windowDays) {
      return false;
    }

    const minutesDiff = Math.abs(dateA.diff(dateB, 'minutes').minutes);

    // ENHANCED: Same time events across different sources (±15 minutes)
    if (eventA.sourceId !== eventB.sourceId && minutesDiff <= 15) {
      return true;
    }

    // Same date and city with similar start time (±30 minutes)
    if (dateA.hasSame(dateB, 'day') && 
        this.normalizeCity(eventA.city) === this.normalizeCity(eventB.city)) {
      if (minutesDiff <= 30) {
        return true;
      }
    }

    // Same venue (fuzzy match) and date
    if (dateA.hasSame(dateB, 'day') && 
        this.fuzzyVenueMatch(eventA.venueName, eventB.venueName)) {
      return true;
    }

    // Similar title and start time within 60 minutes
    const titleSimilarity = this.calculateTitleSimilarity(eventA.title, eventB.title);
    if (titleSimilarity > 0.7) {
      if (minutesDiff <= 60) {
        return true;
      }
    }

    // ENHANCED: Cross-source events with same title and same day (even different times)
    if (eventA.sourceId !== eventB.sourceId && 
        dateA.hasSame(dateB, 'day') && 
        titleSimilarity > 0.8) {
      return true;
    }

    return false;
  }

  /**
   * Calculate detailed similarity features
   */
  private calculateSimilarityFeatures(eventA: EventRaw, eventB: EventRaw): SimilarityFeatures {
    const titleSimilarity = this.calculateTitleSimilarity(eventA.title, eventB.title);
    const timeDelta = this.calculateTimeDelta(eventA.startDatetime, eventB.startDatetime);
    const venueDistance = this.calculateVenueDistance(eventA, eventB);
    const organizerSimilarity = this.calculateOrganizerSimilarity(
      eventA.organizer, 
      eventB.organizer
    );

    return {
      titleSimilarity,
      timeDelta,
      venueDistance,
      organizerSimilarity,
    };
  }

  /**
   * Calculate weighted overall similarity score
   */
  private calculateOverallScore(features: SimilarityFeatures): number {
    const titleScore = features.titleSimilarity;
    
    // Time proximity score (closer times = higher score)
    const timeScore = Math.max(0, 1 - (features.timeDelta / 180)); // 180 min = 0 score
    
    // Venue score (closer venues or fuzzy name match = higher score)
    let venueScore = 0;
    if (features.venueDistance !== undefined) {
      if (features.venueDistance <= 1) venueScore = 1.0;
      else if (features.venueDistance <= 5) venueScore = 1 - ((features.venueDistance - 1) / 4);
      else venueScore = 0;
    }
    
    const organizerScore = features.organizerSimilarity;

    return (
      titleScore * this.titleWeight +
      timeScore * this.timeWeight +
      venueScore * this.venueWeight +
      organizerScore * this.organizerWeight
    );
  }

  /**
   * Calculate title similarity using multiple approaches
   */
  private calculateTitleSimilarity(titleA?: string, titleB?: string): number {
    if (!titleA || !titleB) return 0;

    const normalizedA = this.normalizeTitle(titleA);
    const normalizedB = this.normalizeTitle(titleB);

    // Token set ratio (handles word order differences)
    const tokenSetScore = stringSimilarity.compareTwoStrings(normalizedA, normalizedB);
    
    // Jaro-Winkler (good for typos and partial matches)
    const jaroScore = jaroWinkler(normalizedA, normalizedB);
    
    // Weighted combination
    return tokenSetScore * 0.6 + jaroScore * 0.4;
  }

  /**
   * Calculate time delta in minutes
   */
  private calculateTimeDelta(dateA: Date | string, dateB: Date | string): number {
    const dtA = dateA instanceof Date 
      ? DateTime.fromJSDate(dateA)
      : DateTime.fromISO(dateA);
    const dtB = dateB instanceof Date 
      ? DateTime.fromJSDate(dateB)
      : DateTime.fromISO(dateB);
    return Math.abs(dtA.diff(dtB, 'minutes').minutes);
  }

  /**
   * Calculate venue distance (geographic or name similarity)
   */
  private calculateVenueDistance(eventA: EventRaw, eventB: EventRaw): number | undefined {
    // Try geographic distance first
    if (eventA.lat && eventA.lon && eventB.lat && eventB.lon) {
      const distanceMeters = getDistance(
        { latitude: eventA.lat, longitude: eventA.lon },
        { latitude: eventB.lat, longitude: eventB.lon }
      );
      return distanceMeters / 1000; // Convert to kilometers
    }

    // Fall back to venue name similarity
    if (eventA.venueName && eventB.venueName) {
      const nameSimilarity = this.calculateVenueNameSimilarity(
        eventA.venueName, 
        eventB.venueName
      );
      // Convert similarity to "distance" (1 = same name, 0 = completely different)
      return (1 - nameSimilarity) * 10; // Scale to ~km equivalent
    }

    return undefined;
  }

  /**
   * Calculate organizer similarity
   */
  private calculateOrganizerSimilarity(orgA?: string, orgB?: string): number {
    if (!orgA || !orgB) return 0;
    
    const normalizedA = this.normalizeOrganizer(orgA);
    const normalizedB = this.normalizeOrganizer(orgB);
    
    return jaroWinkler(normalizedA, normalizedB);
  }

  /**
   * Check if venues match fuzzily
   */
  private fuzzyVenueMatch(venueA?: string, venueB?: string): boolean {
    if (!venueA || !venueB) return false;
    return this.calculateVenueNameSimilarity(venueA, venueB) > 0.8;
  }

  private calculateVenueNameSimilarity(venueA: string, venueB: string): number {
    const normalizedA = this.normalizeVenue(venueA);
    const normalizedB = this.normalizeVenue(venueB);
    
    return stringSimilarity.compareTwoStrings(normalizedA, normalizedB);
  }

  /**
   * Generate human-readable reason for the match
   */
  private generateReason(features: SimilarityFeatures, score: number): string {
    const reasons: string[] = [];

    if (features.titleSimilarity > 0.8) {
      reasons.push('very similar titles');
    } else if (features.titleSimilarity > 0.6) {
      reasons.push('similar titles');
    }

    if (features.timeDelta < 15) {
      reasons.push('same start time');
    } else if (features.timeDelta < 60) {
      reasons.push('similar start times');
    }

    if (features.venueDistance !== undefined) {
      if (features.venueDistance < 0.5) {
        reasons.push('same location');
      } else if (features.venueDistance < 2) {
        reasons.push('nearby locations');
      }
    }

    if (features.organizerSimilarity > 0.8) {
      reasons.push('same organizer');
    }

    let reasonText = reasons.join(', ');
    
    if (score >= this.highThreshold) {
      reasonText = `Likely duplicate: ${reasonText}`;
    } else {
      reasonText = `Possible duplicate: ${reasonText}`;
    }

    return reasonText;
  }

  /**
   * Normalization helpers
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeVenue(venue: string): string {
    return venue
      .toLowerCase()
      .replace(/\b(the|at|in|on)\b/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeOrganizer(organizer: string): string {
    return organizer
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|company|organization|org)\b/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeCity(city?: string): string {
    if (!city) return '';
    return city
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate enhanced features specifically for same-time events
   */
  private calculateSameTimeFeatures(eventA: EventRaw, eventB: EventRaw): SimilarityFeatures {
    const titleSimilarity = this.calculateTitleSimilarity(eventA.title, eventB.title);
    const timeDelta = this.calculateTimeDelta(eventA.startDatetime, eventB.startDatetime);
    const venueDistance = this.calculateVenueDistance(eventA, eventB);
    const organizerSimilarity = this.calculateOrganizerSimilarity(
      eventA.organizer, 
      eventB.organizer
    );

    // Additional same-time specific features
    const citySimilarity = this.calculateCitySimilarity(eventA.city, eventB.city);
    const categoryMatch = this.calculateCategoryMatch(eventA.category, eventB.category);

    return {
      titleSimilarity,
      timeDelta,
      venueDistance,
      organizerSimilarity,
      citySimilarity,
      categoryMatch,
    };
  }

  /**
   * Calculate score optimized for same-time events with source diversity bonus
   */
  private calculateSameTimeScore(features: SimilarityFeatures): number {
    const titleScore = features.titleSimilarity;
    
    // For same-time events, give full time score if within 15 minutes
    const timeScore = features.timeDelta <= 15 ? 1.0 : Math.max(0, 1 - (features.timeDelta / 60));
    
    // Venue score
    let venueScore = 0;
    if (features.venueDistance !== undefined) {
      if (features.venueDistance <= 0.5) venueScore = 1.0;
      else if (features.venueDistance <= 2) venueScore = 0.8;
      else if (features.venueDistance <= 5) venueScore = 0.5;
      else venueScore = 0;
    }
    
    const organizerScore = features.organizerSimilarity;
    const cityScore = features.citySimilarity || 0;
    const categoryScore = features.categoryMatch || 0;

    // Base score
    let score = (
      titleScore * this.titleWeight +
      timeScore * this.timeWeight +
      venueScore * this.venueWeight +
      organizerScore * this.organizerWeight
    );

    // Bonus for same city/location (helps with venue-less events)
    if (cityScore > 0.8) {
      score += 0.05;
    }

    // Bonus for same category
    if (categoryScore > 0.8) {
      score += 0.03;
    }

    // Source diversity bonus (events from different sources are more likely to be real matches)
    score += 0.02;

    return Math.min(1.0, score);
  }

  /**
   * Calculate city similarity
   */
  private calculateCitySimilarity(cityA?: string, cityB?: string): number {
    if (!cityA || !cityB) return 0;
    const normalizedA = this.normalizeCity(cityA);
    const normalizedB = this.normalizeCity(cityB);
    return stringSimilarity.compareTwoStrings(normalizedA, normalizedB);
  }

  /**
   * Calculate category match score
   */
  private calculateCategoryMatch(categoryA?: string, categoryB?: string): number {
    if (!categoryA || !categoryB) return 0;
    const normalizedA = categoryA.toLowerCase().trim();
    const normalizedB = categoryB.toLowerCase().trim();
    return normalizedA === normalizedB ? 1.0 : 0.0;
  }

  /**
   * Generate reason text for same-time matches
   */
  private generateSameTimeReason(features: SimilarityFeatures, score: number, timeSlot: string): string {
    const reasons: string[] = ['same time slot'];

    if (features.titleSimilarity > 0.8) {
      reasons.push('very similar titles');
    } else if (features.titleSimilarity > 0.6) {
      reasons.push('similar titles');
    }

    if (features.citySimilarity && features.citySimilarity > 0.8) {
      reasons.push('same city');
    }

    if (features.venueDistance !== undefined && features.venueDistance < 0.5) {
      reasons.push('same venue');
    }

    if (features.organizerSimilarity > 0.8) {
      reasons.push('same organizer');
    }

    if (features.categoryMatch && features.categoryMatch > 0.8) {
      reasons.push('same category');
    }

    let reasonText = reasons.join(', ');
    
    if (score >= this.sameTimeThreshold) {
      reasonText = `Highly likely same event: ${reasonText}`;
    } else if (score >= this.highThreshold) {
      reasonText = `Likely same event: ${reasonText}`;
    } else {
      reasonText = `Possible same event: ${reasonText}`;
    }

    return reasonText;
  }

  /**
   * Remove duplicate matches (keep only the highest scored match for each pair)
   */
  private deduplicateMatches(matches: PotentialMatch[]): PotentialMatch[] {
    const pairMap = new Map<string, PotentialMatch>();

    for (const match of matches) {
      // Create a consistent key for the pair (order doesn't matter)
      const key = [match.eventA, match.eventB].sort().join('|');
      
      // Keep the match with the higher score
      if (!pairMap.has(key) || pairMap.get(key)!.score < match.score) {
        pairMap.set(key, match);
      }
    }

    return Array.from(pairMap.values());
  }
}