import { IgApiClient, MediaRepositoryLikersResponseUsersItem } from 'instagram-private-api';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import axios from 'axios';
import { createHash } from 'crypto';

export interface InstagramPost {
  id: string; // shortcode
  caption: string | null;
  imageUrl: string | null;
  timestamp: Date;
  isVideo: boolean;
  permalink?: string;
}

export interface InstagramSessionData {
  cookies: string;
  // Store serialized session state
  state?: any;
}

export class RateLimitError extends Error {
  constructor(message = 'Instagram rate limit reached') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class InstagramAuthError extends Error {
  constructor(message = 'Instagram authentication failed') {
    super(message);
    this.name = 'InstagramAuthError';
  }
}

export class InstagramScraper {
  private ig: IgApiClient;
  private sessionData?: InstagramSessionData;
  private lastRequestTime: number = 0;
  private minRequestDelay: number = 2000; // 2 seconds between requests

  constructor() {
    this.ig = new IgApiClient();
  }

  /**
   * Set rate limiting delay (in milliseconds)
   */
  setRateLimit(delayMs: number) {
    this.minRequestDelay = delayMs;
  }

  /**
   * Apply rate limiting delay
   */
  private async applyDelay() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestDelay) {
      const delayNeeded = this.minRequestDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delayNeeded));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Load session from stored session data
   */
  async loadSession(sessionData: InstagramSessionData, username: string) {
    this.sessionData = sessionData;

    try {
      // Set the device and user
      this.ig.state.generateDevice(username);

      // Deserialize session if available
      if (sessionData.state) {
        await this.ig.state.deserialize(sessionData.state);
      }

      // TODO: Validate session is still valid
      // This might require a test API call

    } catch (error: any) {
      throw new InstagramAuthError(`Failed to load session: ${error.message}`);
    }
  }

  /**
   * Serialize current session for storage
   */
  async serializeSession(): Promise<InstagramSessionData> {
    const state = await this.ig.state.serialize();

    return {
      cookies: JSON.stringify(state.cookies || {}),
      state,
    };
  }

  /**
   * Fetch recent posts from a username
   * @param username Instagram username (without @)
   * @param limit Maximum number of posts to fetch
   * @param knownPostIds Set of post IDs we already have (for deduplication)
   */
  async fetchRecentPosts(
    username: string,
    limit: number = 10,
    knownPostIds: Set<string> = new Set()
  ): Promise<InstagramPost[]> {
    await this.applyDelay();

    try {
      // Get user ID from username
      const userId = await this.ig.user.getIdByUsername(username);

      // Fetch user feed
      const userFeed = this.ig.feed.user(userId);

      const posts: InstagramPost[] = [];
      let consecutiveKnown = 0;
      const maxConsecutiveKnown = 3; // Stop if we hit 3 known posts in a row

      while (posts.length < limit) {
        await this.applyDelay();

        const items = await userFeed.items();

        if (!items || items.length === 0) {
          break;
        }

        for (const item of items) {
          if (posts.length >= limit) {
            break;
          }

          const shortcode = item.code || item.id;

          // Skip if we already have this post
          if (knownPostIds.has(shortcode)) {
            consecutiveKnown++;
            if (consecutiveKnown >= maxConsecutiveKnown) {
              return posts; // Stop early if we keep hitting known posts
            }
            continue;
          }

          consecutiveKnown = 0;

          // Extract image URL
          let imageUrl: string | null = null;
          if (item.image_versions2?.candidates?.[0]?.url) {
            imageUrl = item.image_versions2.candidates[0].url;
          } else if (item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url) {
            imageUrl = item.carousel_media[0].image_versions2.candidates[0].url;
          }

          // Extract caption
          const caption = item.caption?.text || null;

          // Extract timestamp
          const timestamp = new Date(item.taken_at * 1000);

          posts.push({
            id: shortcode,
            caption,
            imageUrl,
            timestamp,
            isVideo: item.media_type === 2, // 1 = photo, 2 = video, 8 = carousel
            permalink: `https://www.instagram.com/p/${shortcode}/`,
          });
        }

        // Check if there are more items
        if (!userFeed.isMoreAvailable()) {
          break;
        }
      }

      return posts;
    } catch (error: any) {
      // Check for rate limit errors
      if (error.message?.includes('rate') || error.message?.includes('throttl') || error.message?.includes('Please wait')) {
        throw new RateLimitError(error.message);
      }

      // Check for auth errors
      if (error.message?.includes('login') || error.message?.includes('auth')) {
        throw new InstagramAuthError(error.message);
      }

      throw new Error(`Failed to fetch posts for @${username}: ${error.message}`);
    }
  }

  /**
   * Download an image from URL and save locally
   */
  async downloadImage(imageUrl: string, postId: string, downloadDir: string): Promise<string> {
    try {
      // Create hash of URL for unique filename
      const urlHash = createHash('md5').update(imageUrl).digest('hex').substring(0, 8);
      const filename = `${postId}_${urlHash}.jpg`;
      const filepath = path.join(downloadDir, filename);

      // Skip if file already exists
      if (existsSync(filepath)) {
        return filename;
      }

      // Ensure directory exists
      await fs.mkdir(downloadDir, { recursive: true });

      // Download image
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      // Save to file
      await fs.writeFile(filepath, response.data);

      return filename;
    } catch (error: any) {
      throw new Error(`Failed to download image for post ${postId}: ${error.message}`);
    }
  }
}

/**
 * Helper function to create a scraper instance from session data
 */
export async function createScraperWithSession(
  sessionData: InstagramSessionData,
  username: string
): Promise<InstagramScraper> {
  const scraper = new InstagramScraper();
  await scraper.loadSession(sessionData, username);
  return scraper;
}
