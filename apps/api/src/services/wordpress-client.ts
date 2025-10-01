import { WordpressSettings } from '../db/schema.js';

export interface WordPressEvent {
  title: string;
  content: string;
  status?: 'publish' | 'draft' | 'pending';
  excerpt?: string;
  meta?: {
    event_start_date?: string;
    event_end_date?: string;
    event_start_time?: string;
    event_end_time?: string;
    event_venue?: string;
    event_address?: string;
    event_city?: string;
    event_organizer?: string;
    event_category?: string;
    event_url?: string;
    event_image_url?: string;
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
   * Create a new event post in WordPress
   */
  async createEvent(event: WordPressEvent): Promise<WordPressUploadResult> {
    try {
      const response = await fetch(`${this.siteUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          title: event.title,
          content: event.content,
          status: event.status || 'draft',
          excerpt: event.excerpt,
          meta: event.meta,
          featured_media: event.featured_media,
          categories: event.categories,
          tags: event.tags,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Post creation failed: ${response.status} - ${error}`,
        };
      }

      const post = (await response.json()) as { id: number; link: string };
      return {
        success: true,
        postId: post.id,
        postUrl: post.link,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Post creation error: ${error.message}`,
      };
    }
  }

  /**
   * Upload a full event with image to WordPress
   */
  async uploadEventWithImage(
    event: WordPressEvent,
    imageUrl?: string
  ): Promise<WordPressUploadResult> {
    let featuredMediaId: number | undefined;

    // Upload image if provided
    if (imageUrl) {
      const mediaResult = await this.uploadMedia(
        imageUrl,
        `event-${Date.now()}.jpg`
      );
      if (mediaResult.error) {
        // Continue without image if upload fails
        console.warn(`Image upload failed: ${mediaResult.error}`);
      } else {
        featuredMediaId = mediaResult.mediaId;
      }
    }

    // Create the post
    return this.createEvent({
      ...event,
      featured_media: featuredMediaId,
    });
  }

  /**
   * Batch upload multiple events
   */
  async uploadEvents(
    events: Array<{
      title: string;
      descriptionHtml?: string;
      startDatetime: string | Date;
      endDatetime?: string | Date;
      venueName?: string;
      venueAddress?: string;
      city?: string;
      organizer?: string;
      category?: string;
      url?: string;
      imageUrl?: string;
    }>
  ): Promise<
    Array<{
      event: any;
      result: WordPressUploadResult;
    }>
  > {
    const results = [];

    for (const event of events) {
      const wpEvent: WordPressEvent = {
        title: event.title,
        content: event.descriptionHtml || '',
        status: 'draft', // Default to draft for review
        meta: {
          event_start_date: new Date(event.startDatetime).toISOString(),
          event_end_date: event.endDatetime
            ? new Date(event.endDatetime).toISOString()
            : undefined,
          event_venue: event.venueName,
          event_address: event.venueAddress,
          event_city: event.city,
          event_organizer: event.organizer,
          event_category: event.category,
          event_url: event.url,
          event_image_url: event.imageUrl,
        },
      };

      const result = await this.uploadEventWithImage(wpEvent, event.imageUrl);
      results.push({ event, result });

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  }
}
