/**
 * Apify-based Instagram scraper
 * Uses Apify's Instagram Profile Scraper for reliable, official API-based scraping
 */

import { ApifyClient } from 'apify-client';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

export interface ApifyInstagramPost {
  id: string;
  caption?: string;
  timestamp: Date;
  imageUrl?: string;
  videoUrl?: string;
  isVideo: boolean;
  permalink: string;
  likesCount?: number;
  commentsCount?: number;
}

export interface ApifyScraperOptions {
  apiToken: string;
  username: string;
  resultsLimit?: number;
}

export class ApifyRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApifyRateLimitError';
  }
}

export class ApifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApifyAuthError';
  }
}

export class ApifyScraper {
  private client: ApifyClient;
  private apiToken: string;

  constructor(apiToken: string) {
    if (!apiToken) {
      throw new ApifyAuthError('Apify API token is required');
    }
    this.apiToken = apiToken;
    this.client = new ApifyClient({ token: apiToken });
  }

  /**
   * Fetch recent posts from an Instagram profile using Apify
   */
  async fetchRecentPosts(
    username: string,
    limit: number = 10,
    knownPostIds: Set<string> = new Set()
  ): Promise<ApifyInstagramPost[]> {
    try {
      // Use Apify's Instagram Profile Scraper
      // Actor ID: apify/instagram-profile-scraper
      const run = await this.client.actor('apify/instagram-profile-scraper').call({
        usernames: [username],
        resultsLimit: Math.max(limit * 2, 20), // Fetch more to account for filtering
        resultsType: 'posts',
        searchType: 'user',
        searchLimit: 1,
      });

      // Wait for the run to finish
      const { defaultDatasetId } = run;
      const dataset = await this.client.dataset(defaultDatasetId).listItems();

      const posts: ApifyInstagramPost[] = [];
      let consecutiveKnown = 0;
      const maxConsecutiveKnown = 5;

      for (const item of dataset.items) {
        // Check if we've seen this post before
        const postId = item.shortCode || item.id;
        if (knownPostIds.has(postId)) {
          consecutiveKnown++;
          if (consecutiveKnown >= maxConsecutiveKnown) {
            // Stop if we've seen too many known posts in a row
            break;
          }
          continue;
        }

        consecutiveKnown = 0;

        // Extract post data
        const post: ApifyInstagramPost = {
          id: postId,
          caption: item.caption || null,
          timestamp: new Date(item.timestamp || item.takenAtTimestamp * 1000),
          imageUrl: item.displayUrl || item.thumbnailUrl || null,
          videoUrl: item.videoUrl || null,
          isVideo: item.type === 'Video' || !!item.videoUrl,
          permalink: `https://www.instagram.com/p/${postId}/`,
          likesCount: item.likesCount,
          commentsCount: item.commentsCount,
        };

        posts.push(post);

        // Stop if we've reached the limit
        if (posts.length >= limit) {
          break;
        }
      }

      return posts;
    } catch (error: any) {
      if (error.message?.includes('rate limit')) {
        throw new ApifyRateLimitError(`Apify rate limit exceeded: ${error.message}`);
      }
      if (error.message?.includes('authentication') || error.message?.includes('token')) {
        throw new ApifyAuthError(`Apify authentication failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Download an image from a URL and save it locally
   */
  async downloadImage(
    imageUrl: string,
    postId: string,
    downloadDir: string
  ): Promise<string> {
    try {
      // Ensure download directory exists
      await fs.mkdir(downloadDir, { recursive: true });

      // Generate filename
      const extension = imageUrl.split('?')[0].split('.').pop() || 'jpg';
      const filename = `${postId}.${extension}`;
      const filepath = path.join(downloadDir, filename);

      // Check if file already exists
      try {
        await fs.access(filepath);
        return filename; // File already exists
      } catch {
        // File doesn't exist, download it
      }

      // Download the image
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      // Save to disk
      await fs.writeFile(filepath, response.data);

      return filename;
    } catch (error: any) {
      throw new Error(`Failed to download image for post ${postId}: ${error.message}`);
    }
  }

  /**
   * Get account info from Apify
   */
  async getAccountInfo(username: string): Promise<any> {
    try {
      const run = await this.client.actor('apify/instagram-profile-scraper').call({
        usernames: [username],
        resultsType: 'details',
        searchType: 'user',
        searchLimit: 1,
      });

      const { defaultDatasetId } = run;
      const dataset = await this.client.dataset(defaultDatasetId).listItems();

      if (dataset.items.length === 0) {
        throw new Error(`Account @${username} not found`);
      }

      return dataset.items[0];
    } catch (error: any) {
      throw new Error(`Failed to get account info for @${username}: ${error.message}`);
    }
  }
}

/**
 * Create an Apify scraper instance with error handling
 */
export async function createApifyScraper(apiToken: string): Promise<ApifyScraper> {
  if (!apiToken) {
    throw new ApifyAuthError('Apify API token is required. Set APIFY_API_TOKEN environment variable.');
  }

  return new ApifyScraper(apiToken);
}
