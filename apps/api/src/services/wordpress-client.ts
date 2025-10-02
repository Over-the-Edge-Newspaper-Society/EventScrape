import { WordpressSettings } from '../db/schema.js';
import { db } from '../db/connection.js';
import { sql } from 'drizzle-orm';

export interface WordPressEvent {
  title: string;
  content: string;
  status?: 'publish' | 'draft' | 'pending';
  excerpt?: string;
  external_id?: string;
  meta?: {
    [key: string]: any;
  };
  event_meta?: {
    date?: string;
    start_time?: string;
    end_time?: string;
    location?: string;
    cost?: string;
    organization?: string;
    featured?: boolean;
    website?: string;
    virtual_link?: string;
    registration_link?: string;
    [key: string]: any;
  };
  featured_media?: number;
  categories?: number[];
  tags?: number[];
}

export interface WordPressUploadResult {
  success: boolean;
  postId?: number;
  postUrl?: string;
  error?: string;
  action?: 'created' | 'updated' | 'skipped';
}

interface ClubData {
  id?: string | number | null;
  name?: string | null;
  username?: string | null;
  profileUrl?: string | null;
  platform?: string | null;
}

export class WordPressClient {
  private siteUrl: string;
  private username: string;
  private applicationPassword: string;

  constructor(settings: WordpressSettings) {
    this.siteUrl = settings.siteUrl.replace(/\/$/, ''); // Remove trailing slash
    this.username = settings.username;
    this.applicationPassword = settings.applicationPassword;
  }

  /**
   * Get authentication headers for WordPress REST API
   */
  private getAuthHeaders(): Record<string, string> {
    const credentials = Buffer.from(
      `${this.username}:${this.applicationPassword}`
    ).toString('base64');

    return {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Test connection to WordPress site
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.siteUrl}/wp-json/wp/v2/users/me`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Connection failed: ${response.status} - ${error}`,
        };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: `Connection error: ${error.message}`,
      };
    }
  }

  /**
   * Fetch all event categories from WordPress
   */
  async getCategories(): Promise<Array<{ id: number; name: string; slug: string }>> {
    try {
      const response = await fetch(
        `${this.siteUrl}/wp-json/wp/v2/event_category?per_page=100&_fields=id,name,slug`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      if (!response.ok) {
        console.error('Failed to fetch categories:', response.status);
        return [];
      }

      const categories = (await response.json()) as Array<{
        id: number;
        name: string;
        slug: string;
      }>;

      return categories;
    } catch (error: any) {
      console.error('Error fetching categories:', error.message);
      return [];
    }
  }

  /**
   * Upload media to WordPress
   */
  async uploadMedia(
    imageUrl: string,
    filename?: string
  ): Promise<{ mediaId?: number; error?: string }> {
    try {
      // Download the image
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        return { error: `Failed to download image from ${imageUrl}` };
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const contentType =
        imageResponse.headers.get('content-type') || 'image/jpeg';

      // Upload to WordPress
      const uploadResponse = await fetch(`${this.siteUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeaders().Authorization as string,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${
            filename || 'event-image.jpg'
          }"`,
        },
        body: imageBuffer,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.text();
        return { error: `Media upload failed: ${error}` };
      }

      const media = (await uploadResponse.json()) as { id: number };
      return { mediaId: media.id };
    } catch (error: any) {
      return { error: `Media upload error: ${error.message}` };
    }
  }

  /**
   * Match event to WordPress organization by Instagram username/URL
   */
  private async matchOrganization(clubData?: ClubData): Promise<string | null> {
    if (!clubData) {
      return null;
    }

    try {
      // Query WordPress for organizations with org_instagram field
      const response = await fetch(
        `${this.siteUrl}/wp-json/wp/v2/organization?per_page=100&_fields=id,org_instagram`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      if (!response.ok) {
        console.warn('Failed to fetch organizations from WordPress:', response.status);
        return null;
      }

      const organizations = (await response.json()) as Array<{
        id: number;
        org_instagram?: string;
      }>;

      console.log(`Found ${organizations.length} organizations in WordPress for club: ${clubData.username}, profileUrl: ${clubData.profileUrl}`);

      // Normalize the club's Instagram URL for comparison
      const normalizedClubUrl = clubData.profileUrl
        ? this.normalizeInstagramUrl(clubData.profileUrl)
        : null;

      // Try to match by Instagram URL (PRIMARY METHOD)
      for (const org of organizations) {
        // Access org_instagram field (registered via register_rest_field)
        const orgInstagram = org.org_instagram
          ? String(org.org_instagram).trim()
          : null;

        if (!orgInstagram) {
          continue;
        }

        console.log(`Checking org ${org.id}: org_instagram="${orgInstagram}"`);

        // Normalize the org's Instagram URL
        const normalizedOrgUrl = this.normalizeInstagramUrl(orgInstagram);

        console.log(`  Comparing URLs: club="${normalizedClubUrl}" vs org="${normalizedOrgUrl}"`);

        // Match by full URL (BEST match)
        if (normalizedClubUrl && normalizedOrgUrl === normalizedClubUrl) {
          console.log(`✓ Matched organization ${org.id} by URL match`);
          return org.id.toString();
        }

        // Fallback: Extract and match by username if URL match didn't work
        if (clubData.username) {
          const normalizedUsername = clubData.username.replace(/^@/, '').toLowerCase().trim();

          // Extract username from org's Instagram (could be URL or username)
          let orgUsername = orgInstagram.toLowerCase();
          if (orgInstagram.includes('instagram.com')) {
            const match = orgInstagram.match(/instagram\.com\/([^\/\?]+)/);
            if (match) {
              orgUsername = match[1].toLowerCase().trim();
            }
          } else {
            orgUsername = orgInstagram.replace(/^@/, '').toLowerCase().trim();
          }

          console.log(`  Comparing usernames: club="${normalizedUsername}" vs org="${orgUsername}"`);

          if (orgUsername === normalizedUsername) {
            console.log(`✓ Matched organization ${org.id} by username`);
            return org.id.toString();
          }
        }
      }

      console.log(`✗ No matching organization found for club: ${clubData.username || 'unknown'}`);
      return null;
    } catch (error: any) {
      console.error('Error matching organization:', error.message);
      return null;
    }
  }

  /**
   * Normalize Instagram URL for comparison
   */
  private normalizeInstagramUrl(url: string): string {
    return url
      .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
      .replace(/\/$/, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Convert UTC datetime to local date and time
   */
  private convertToLocalDateTime(
    utcDatetime: Date,
    timezone: string = 'UTC'
  ): { date: string; time: string } {
    try {
      // Format: YYYY-MM-DD for date, HH:mm:ss for time
      const localDatetime = new Date(utcDatetime.toLocaleString('en-US', { timeZone: timezone }));

      const year = localDatetime.getFullYear();
      const month = String(localDatetime.getMonth() + 1).padStart(2, '0');
      const day = String(localDatetime.getDate()).padStart(2, '0');
      const hours = String(localDatetime.getHours()).padStart(2, '0');
      const minutes = String(localDatetime.getMinutes()).padStart(2, '0');
      const seconds = String(localDatetime.getSeconds()).padStart(2, '0');

      return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}:${seconds}`,
      };
    } catch (error) {
      // Fallback to UTC if timezone conversion fails
      const year = utcDatetime.getUTCFullYear();
      const month = String(utcDatetime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(utcDatetime.getUTCDate()).padStart(2, '0');
      const hours = String(utcDatetime.getUTCHours()).padStart(2, '0');
      const minutes = String(utcDatetime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(utcDatetime.getUTCSeconds()).padStart(2, '0');

      return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}:${seconds}`,
      };
    }
  }

  /**
   * Check if event already exists in WordPress by external_id
   */
  private async findExistingEvent(externalId: string): Promise<number | null> {
    try {
      // Fetch all events with external_id field and filter client-side
      // Note: WordPress meta_key/meta_value query is unreliable with empty values
      const response = await fetch(
        `${this.siteUrl}/wp-json/wp/v2/events?per_page=100&_fields=id,external_id`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      if (!response.ok) {
        return null;
      }

      const events = (await response.json()) as Array<{ id: number; external_id?: string }>;

      // Find event with matching external_id (only match if both IDs exist and are non-empty)
      const matchingEvent = events.find(
        event => event.external_id && event.external_id === externalId
      );
      return matchingEvent ? matchingEvent.id : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Create a new event post in WordPress
   */
  async createEvent(event: WordPressEvent, updateIfExists: boolean = false): Promise<WordPressUploadResult> {
    try {
      // Check if event already exists
      let existingEventId: number | null = null;
      if (event.external_id) {
        existingEventId = await this.findExistingEvent(event.external_id);
      }

      if (existingEventId && !updateIfExists) {
        return {
          success: true,
          postId: existingEventId,
          action: 'skipped',
        };
      }

      const endpoint = existingEventId
        ? `${this.siteUrl}/wp-json/wp/v2/events/${existingEventId}`
        : `${this.siteUrl}/wp-json/wp/v2/events`;

      const method = existingEventId ? 'PUT' : 'POST';

      const requestBody = {
        title: event.title,
        content: event.content,
        status: event.status || 'draft',
        excerpt: event.excerpt,
        external_id: event.external_id,
        meta: event.meta,
        event_meta: event.event_meta,
        featured_media: event.featured_media,
        event_category: event.categories, // WordPress expects taxonomy name as field name
        tags: event.tags,
      };

      console.log(`[WordPress Client] ${method} ${endpoint}`);
      console.log(`[WordPress Client] Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await fetch(endpoint, {
        method,
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Post ${existingEventId ? 'update' : 'creation'} failed: ${response.status} - ${error}`,
        };
      }

      const post = (await response.json()) as { id: number; link: string };
      return {
        success: true,
        postId: post.id,
        postUrl: post.link,
        action: existingEventId ? 'updated' : 'created',
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Post operation error: ${error.message}`,
      };
    }
  }

  /**
   * Upload a full event with image to WordPress
   */
  async uploadEventWithImage(
    event: WordPressEvent,
    imageUrl?: string,
    updateIfExists: boolean = false,
    includeMedia: boolean = true
  ): Promise<WordPressUploadResult> {
    let featuredMediaId: number | undefined;

    // Upload image if provided and includeMedia is true
    if (imageUrl && includeMedia) {
      const mediaResult = await this.uploadMedia(
        imageUrl,
        `event-${Date.now()}.jpg`
      );
      if (mediaResult.error) {
        // Continue without image if upload fails
        console.warn(`Image upload failed: ${mediaResult.error}`);
      } else {
        featuredMediaId = mediaResult.mediaId;
        console.log(`[WordPress Client] Uploaded media ID: ${featuredMediaId} for image: ${imageUrl}`);
      }
    }

    // Create the post
    const result = await this.createEvent({
      ...event,
      featured_media: featuredMediaId,
    }, updateIfExists);

    // If post was created/updated successfully and we have a media ID, attach it
    if (result.success && result.postId && featuredMediaId) {
      await this.attachMediaToPost(result.postId, featuredMediaId);
    }

    return result;
  }

  /**
   * Attach media to a post (for custom post types that don't auto-attach)
   */
  private async attachMediaToPost(postId: number, mediaId: number): Promise<void> {
    try {
      const response = await fetch(`${this.siteUrl}/wp-json/wp/v2/media/${mediaId}`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          post: postId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.warn(`Failed to attach media ${mediaId} to post ${postId}: ${error}`);
      } else {
        console.log(`[WordPress Client] Successfully attached media ${mediaId} to post ${postId}`);
      }
    } catch (error: any) {
      console.warn(`Error attaching media ${mediaId} to post ${postId}: ${error.message}`);
    }
  }

  /**
   * Batch upload multiple events
   */
  async uploadEvents(
    events: Array<{
      id: string;
      title: string;
      descriptionHtml?: string;
      startDatetime: string | Date;
      endDatetime?: string | Date;
      timezone?: string;
      venueName?: string;
      venueAddress?: string;
      city?: string;
      organizer?: string;
      category?: string;
      url?: string;
      imageUrl?: string;
      raw?: any;
      sourceId?: string;
    }>,
    options: {
      status?: 'publish' | 'draft' | 'pending';
      updateIfExists?: boolean;
      sourceCategoryMappings?: Record<string, number>;
      includeMedia?: boolean;
    } = {}
  ): Promise<
    Array<{
      event: any;
      result: WordPressUploadResult;
    }>
  > {
    const results = [];

    for (const event of events) {
      // Extract club data from raw metadata if available
      let clubData: ClubData | undefined;
      if (event.raw?.massPosterMeta?.club) {
        clubData = event.raw.massPosterMeta.club;
      }

      // Match organization
      const organizationId = await this.matchOrganization(clubData);

      // Convert UTC to local timezone
      const startDate = new Date(event.startDatetime);
      const endDate = event.endDatetime ? new Date(event.endDatetime) : null;

      const localStart = this.convertToLocalDateTime(
        startDate,
        event.timezone || 'UTC'
      );
      const localEnd = endDate
        ? this.convertToLocalDateTime(endDate, event.timezone || 'UTC')
        : null;

      // Get category ID from source-category mappings if available
      // Handle case where mappings might be a JSON string from database
      const mappings = typeof options.sourceCategoryMappings === 'string'
        ? JSON.parse(options.sourceCategoryMappings)
        : options.sourceCategoryMappings;

      let categoryId: number | undefined;
      if (event.sourceId && mappings) {
        categoryId = mappings[event.sourceId];
        console.log(`Event "${event.title}" - sourceId: ${event.sourceId}, categoryId from mapping: ${categoryId}`);
        console.log(`Available mappings:`, mappings);
      } else {
        console.log(`Event "${event.title}" - No category mapping. sourceId: ${event.sourceId}, has mappings: ${!!mappings}`);
      }

      const wpEvent: WordPressEvent = {
        title: event.title,
        content: event.descriptionHtml || '',
        status: options.status || 'draft',
        external_id: event.id,
        event_meta: {
          date: localStart.date,
          start_time: localStart.time,
          end_time: localEnd?.time || '',
          location: event.venueName || '',
          cost: '',
          organization: organizationId || '',
          featured: false,
          website: event.url || '',
        },
        categories: categoryId ? [categoryId] : undefined,
      };

      console.log(`Uploading event "${event.title}" with categories:`, wpEvent.categories);

      const result = await this.uploadEventWithImage(
        wpEvent,
        event.imageUrl,
        options.updateIfExists || false,
        options.includeMedia !== false // Default to true if not specified
      );
      results.push({ event, result });

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  }
}
