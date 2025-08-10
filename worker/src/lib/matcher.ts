import stringSimilarity from 'string-similarity';
import jaroWinkler from 'jaro-winkler';
import { getDistance } from 'geolib';
import { DateTime } from 'luxon';
import type { EventRaw } from './database.js';
import type { PotentialMatch, SimilarityFeatures } from '../types.js';

export class EventMatcher {
  private readonly titleWeight = 0.45;
  private readonly timeWeight = 0.25;
  private readonly venueWeight = 0.20;
  private readonly organizerWeight = 0.10;
  
  private readonly highThreshold = 0.78;
  private readonly reviewThreshold = 0.60;

  /**
   * Find potential duplicate events within a given time window
   */
  async findPotentialDuplicates(
    events: EventRaw[],
    options: {
      windowDays?: number;
      minScore?: number;
    } = {}
  ): Promise<PotentialMatch[]> {
    const { windowDays = 7, minScore = this.reviewThreshold } = options;
    const matches: PotentialMatch[] = [];
    
    console.log(`Finding duplicates among ${events.length} events...`);

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
        if (!this.passesBlockingFilters(eventA, eventB, windowDays)) {
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

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);
    
    console.log(`Found ${matches.length} potential duplicates (score >= ${minScore})`);
    return matches;
  }

  /**
   * Blocking filters to quickly eliminate obvious non-matches
   */
  private passesBlockingFilters(eventA: EventRaw, eventB: EventRaw, windowDays: number): boolean {
    // Date proximity check (within window)
    const dateA = DateTime.fromJSDate(eventA.startDatetime);
    const dateB = DateTime.fromJSDate(eventB.startDatetime);
    const daysDiff = Math.abs(dateA.diff(dateB, 'days').days);
    
    if (daysDiff > windowDays) {
      return false;
    }

    // Same date and city with similar start time (±30 minutes)
    if (dateA.hasSame(dateB, 'day') && 
        this.normalizeCity(eventA.city) === this.normalizeCity(eventB.city)) {
      const minutesDiff = Math.abs(dateA.diff(dateB, 'minutes').minutes);
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
      const minutesDiff = Math.abs(dateA.diff(dateB, 'minutes').minutes);
      if (minutesDiff <= 60) {
        return true;
      }
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
  private calculateTimeDelta(dateA: Date, dateB: Date): number {
    const dtA = DateTime.fromJSDate(dateA);
    const dtB = DateTime.fromJSDate(dateB);
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
}