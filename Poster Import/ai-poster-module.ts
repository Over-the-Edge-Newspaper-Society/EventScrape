import type { ScraperModule, RunContext, RawEvent } from '../../types.js';
import { DateTime } from 'luxon';

/**
 * AI Poster Import Module
 * 
 * This module processes JSON data extracted from event posters by AI.
 * It expects data in the standardized format defined in poster-import-prompt.md
 */
const aiPosterModule: ScraperModule = {
  key: 'ai_poster_import',
  label: 'AI Poster Import',
  startUrls: [],
  mode: 'upload',
  paginationType: 'none',
  integrationTags: ['csv'], // Reusing CSV tag for upload functionality
  
  uploadConfig: {
    supportedFormats: ['json'],
    instructions: `
      Upload JSON data extracted from event posters using AI.
      
      The JSON should follow this structure:
      {
        "events": [{
          "title": "Event Name",
          "startDate": "YYYY-MM-DD",
          "startTime": "HH:MM",
          "venue": { "name": "...", "city": "..." },
          ...
        }]
      }
      
      Use the provided AI prompt (poster-import-prompt.md) with Claude, GPT-4, or similar AI to extract data from poster images.
    `,
  },

  async run(ctx: RunContext): Promise<RawEvent[]> {
    // This module only supports upload mode
    const { logger } = ctx;
    logger.error('AI Poster Import module only supports upload mode');
    return [];
  },

  async processUpload(content: string, format: string, logger: any): Promise<RawEvent[]> {
    if (format !== 'json') {
      throw new Error('AI Poster Import only supports JSON format');
    }

    try {
      const data = JSON.parse(content);
      
      if (!data.events || !Array.isArray(data.events)) {
        throw new Error('Invalid JSON structure: missing "events" array');
      }

      const events: RawEvent[] = [];
      const extractionNotes = data.extractionConfidence?.notes || '';

      for (const posterEvent of data.events) {
        try {
          // Validate required fields
          if (!posterEvent.title) {
            logger.warn('Skipping event without title');
            continue;
          }

          // Construct datetime strings
          const startDateTime = this.constructDateTime(
            posterEvent.startDate,
            posterEvent.startTime,
            posterEvent.timezone || 'America/Vancouver'
          );

          const endDateTime = posterEvent.endDate || posterEvent.endTime
            ? this.constructDateTime(
                posterEvent.endDate || posterEvent.startDate,
                posterEvent.endTime || posterEvent.startTime,
                posterEvent.timezone || 'America/Vancouver'
              )
            : undefined;

          // Build event URL if registration URL provided, otherwise generate one
          const eventUrl = posterEvent.registrationUrl || 
            `https://ai-import.local/event/${this.slugify(posterEvent.title)}-${Date.now()}`;

          // Create source event ID
          const sourceEventId = `ai_poster_${this.slugify(posterEvent.title)}_${posterEvent.startDate || 'undated'}`;

          // Extract venue information
          const venue = posterEvent.venue || {};
          
          // Compile tags
          const tags = posterEvent.tags || [];
          if (posterEvent.category && !tags.includes(posterEvent.category.toLowerCase())) {
            tags.push(posterEvent.category.toLowerCase());
          }

          const rawEvent: RawEvent = {
            sourceEventId,
            title: posterEvent.title,
            descriptionHtml: this.formatDescription(posterEvent),
            start: startDateTime,
            end: endDateTime,
            venueName: venue.name || null,
            venueAddress: venue.address || null,
            city: venue.city || 'Prince George', // Default city
            region: venue.region || 'BC',
            country: venue.country || 'Canada',
            organizer: posterEvent.organizer || null,
            category: posterEvent.category || 'Community',
            price: posterEvent.price || null,
            tags: tags.length > 0 ? tags : null,
            url: eventUrl,
            imageUrl: posterEvent.imageUrl || null,
            raw: {
              source: 'ai_poster_extraction',
              originalData: posterEvent,
              extractionConfidence: data.extractionConfidence,
              extractedAt: new Date().toISOString(),
              extractionNotes,
            },
          };

          events.push(rawEvent);
          logger.info(`Processed poster event: ${posterEvent.title}`);

        } catch (eventError) {
          logger.error(`Failed to process poster event: ${eventError.message}`, posterEvent);
        }
      }

      logger.info(`Successfully processed ${events.length} events from AI-extracted poster data`);
      
      // Add extraction confidence to logger
      if (data.extractionConfidence) {
        logger.info(`Extraction confidence: ${(data.extractionConfidence.overall * 100).toFixed(0)}%`);
        if (extractionNotes) {
          logger.info(`Extraction notes: ${extractionNotes}`);
        }
      }

      return events;

    } catch (error) {
      logger.error(`Failed to parse AI poster JSON: ${error.message}`);
      throw error;
    }
  },

  /**
   * Helper function to construct ISO datetime string
   */
  constructDateTime(date: string | null, time: string | null, timezone: string): string {
    if (!date) {
      // If no date provided, use today
      date = DateTime.now().toISODate();
    }

    // Handle various date formats
    let dt: DateTime;
    
    // Try parsing as ISO date first
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      dt = DateTime.fromISO(date, { zone: timezone });
    } else {
      // Try other common formats
      const formats = ['MM/dd/yyyy', 'dd/MM/yyyy', 'MMM dd, yyyy', 'MMMM dd, yyyy'];
      for (const format of formats) {
        dt = DateTime.fromFormat(date, format, { zone: timezone });
        if (dt.isValid) break;
      }
      
      if (!dt || !dt.isValid) {
        // Fallback: try to parse with JS Date
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
          dt = DateTime.fromJSDate(parsed, { zone: timezone });
        } else {
          throw new Error(`Could not parse date: ${date}`);
        }
      }
    }

    // Add time if provided
    if (time) {
      const [hours, minutes] = time.split(':').map(Number);
      dt = dt.set({ hour: hours, minute: minutes });
    }

    return dt.toISO();
  },

  /**
   * Generate a URL-friendly slug from text
   */
  slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  },

  /**
   * Format description HTML from poster data
   */
  formatDescription(posterEvent: any): string {
    const parts: string[] = [];

    if (posterEvent.description) {
      parts.push(`<p>${posterEvent.description}</p>`);
    }

    // Add contact information if available
    const contact = posterEvent.contactInfo;
    if (contact && (contact.phone || contact.email || contact.website)) {
      parts.push('<h4>Contact Information</h4>');
      parts.push('<ul>');
      
      if (contact.phone) {
        parts.push(`<li>Phone: ${contact.phone}</li>`);
      }
      if (contact.email) {
        parts.push(`<li>Email: <a href="mailto:${contact.email}">${contact.email}</a></li>`);
      }
      if (contact.website) {
        parts.push(`<li>Website: <a href="${contact.website}" target="_blank">${contact.website}</a></li>`);
      }
      
      parts.push('</ul>');
    }

    // Add additional info if present
    if (posterEvent.additionalInfo) {
      parts.push(`<p><strong>Additional Information:</strong> ${posterEvent.additionalInfo}</p>`);
    }

    // Add extraction note if confidence is low
    if (posterEvent.raw?.extractionConfidence?.overall < 0.8) {
      parts.push(`<p><em>Note: This event was extracted from a poster image with ${Math.round(posterEvent.raw.extractionConfidence.overall * 100)}% confidence. Some details may need verification.</em></p>`);
    }

    return parts.join('\n') || null;
  },
};

export default aiPosterModule;