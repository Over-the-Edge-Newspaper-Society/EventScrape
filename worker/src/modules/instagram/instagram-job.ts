/**
 * Instagram scraper job handler for BullMQ
 * Orchestrates: fetch posts → classify → extract → store in database
 */

import { Job } from 'bullmq';
import { queryClient as db } from '../../lib/database.js';
import { InstagramScraper, RateLimitError, InstagramAuthError, createScraperWithSession } from './scraper.js';
import { ApifyScraper, ApifyRateLimitError, ApifyAuthError, createApifyScraper } from './apify-scraper.js';
import { createEnhancedApifyClient, ApifyClientError, ApifyRunTimeoutError } from './enhanced-apify-client.js';
import { classify } from './classifier.js';
import { extractEventFromImageFile } from './gemini-extractor.js';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface InstagramScrapeJobData {
  accountId: string;
  runId?: string;
  postLimit?: number;
}

const DOWNLOAD_DIR = process.env.INSTAGRAM_IMAGES_DIR || './data/instagram_images';
const SETTINGS_ID = '00000000-0000-0000-0000-000000000001'; // Singleton settings ID

/**
 * Fetch Instagram settings from database
 */
async function getInstagramSettings() {
  const result = await db`
    SELECT apify_api_token, gemini_api_key, default_scraper_type, allow_per_account_override
    FROM instagram_settings
    LIMIT 1
  `;
  return result[0] || {
    apify_api_token: null,
    gemini_api_key: null,
    default_scraper_type: 'instagram-private-api',
    allow_per_account_override: true
  };
}

// Instagram source ID (fixed)
const INSTAGRAM_SOURCE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Main Instagram scrape job handler
 */
export async function handleInstagramScrapeJob(job: Job<InstagramScrapeJobData>) {
  const { accountId, postLimit = 10 } = job.data;

  job.log(`Starting Instagram scrape for account ${accountId}`);

  try {
    // 0. Fetch Instagram settings from database
    const settings = await getInstagramSettings();
    const APIFY_API_TOKEN = settings.apify_api_token || process.env.APIFY_API_TOKEN || '';
    const GEMINI_API_KEY = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';

    // 1. Fetch account details
    const accountResult = await db`
      SELECT id, name, instagram_username,
             classification_mode, default_timezone, instagram_scraper_type
      FROM instagram_accounts
      WHERE id = ${accountId}
    `;

    const account = accountResult[0];

    if (!account) {
      throw new Error(`Instagram account ${accountId} not found`);
    }

    // Determine which scraper type to use:
    // 1. If per-account override is disabled, always use global setting
    // 2. If per-account override is enabled, use account setting (fallback to global)
    const scraperType = settings.allow_per_account_override
      ? (account.instagram_scraper_type || settings.default_scraper_type || 'instagram-private-api')
      : (settings.default_scraper_type || 'instagram-private-api');

    job.log(`Fetching posts from @${account.instagram_username} using ${scraperType} scraper`);

    // 2. Create scraper instance based on type
    let scraper: InstagramScraper | ApifyScraper | any; // 'any' to support enhanced client

    if (scraperType === 'apify') {
      // Use Enhanced Apify scraper (with Node runner support)
      if (!APIFY_API_TOKEN) {
        throw new ApifyAuthError('Apify API token not configured. Set APIFY_API_TOKEN environment variable.');
      }

      // Use enhanced client if available
      const useEnhancedClient = process.env.USE_ENHANCED_APIFY_CLIENT !== 'false'; // default true

      if (useEnhancedClient) {
        try {
          const enhancedClient = await createEnhancedApifyClient(
            APIFY_API_TOKEN,
            settings.apifyActorId || undefined
          );

          // Wrap enhanced client with compatible interface
          scraper = {
            async fetchRecentPosts(username: string, limit: number, knownPostIds: Set<string>) {
              const posts = await enhancedClient.fetchPostsBatch(
                [username],
                limit,
                new Map([[username, knownPostIds]])
              );

              const userPosts = posts.get(username) || [];

              // Convert enhanced format to standard format
              return userPosts.map(post => ({
                id: post.id,
                caption: post.caption || '',
                imageUrl: post.imageUrl,
                timestamp: post.timestamp,
                isVideo: post.isVideo,
                permalink: post.permalink,
              }));
            },

            async downloadImage(imageUrl: string, postId: string, downloadDir: string) {
              // Use basic download since enhanced client doesn't have this
              const { default: axios } = await import('axios');
              const { default: fs } = await import('fs/promises');

              await fs.mkdir(downloadDir, { recursive: true });
              const extension = imageUrl.split('?')[0].split('.').pop() || 'jpg';
              const filename = `${postId}.${extension}`;
              const filepath = path.join(downloadDir, filename);

              try {
                await fs.access(filepath);
                return filename;
              } catch {}

              const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
              });

              await fs.writeFile(filepath, response.data);
              return filename;
            }
          };

          const runtimeInfo = enhancedClient.getRuntimeInfo();
          job.log(`Using Enhanced Apify client (${runtimeInfo.usingNode ? 'Node runner' : 'REST API'})`);
        } catch (error: any) {
          job.log(`Enhanced Apify client failed, falling back to basic: ${error.message}`);
          scraper = await createApifyScraper(APIFY_API_TOKEN);
          job.log('Using basic Apify scraper (REST API)');
        }
      } else {
        scraper = await createApifyScraper(APIFY_API_TOKEN);
        job.log('Using basic Apify scraper (REST API)');
      }
    } else {
      // Use instagram-private-api scraper (requires session)
      const sessionResult = await db`
        SELECT id, username, session_data, is_valid
        FROM instagram_sessions
        WHERE username = ${account.instagram_username}
      `;

      const session = sessionResult[0];

      if (!session) {
        throw new InstagramAuthError(`No session found for @${account.instagram_username}`);
      }

      scraper = await createScraperWithSession(
        session.session_data as any,
        account.instagram_username
      );
      job.log('Using instagram-private-api scraper (session-based)');
    }

    // 3. Get known post IDs from database for this account
    const knownPostsResult = await db`
      SELECT instagram_post_id
      FROM events_raw
      WHERE instagram_account_id = ${accountId}
        AND instagram_post_id IS NOT NULL
    `;

    const knownPostIds = new Set(
      knownPostsResult
        .map((p: any) => p.instagram_post_id)
        .filter((id): id is string => id !== null)
    );

    job.log(`Found ${knownPostIds.size} known posts`);

    // 4. Fetch recent posts
    const posts = await scraper.fetchRecentPosts(
      account.instagram_username,
      postLimit,
      knownPostIds
    );

    job.log(`Fetched ${posts.length} new posts`);

    // 5. Create a run record for the Instagram source
    const runId = job.data.runId || uuidv4();
    await db`
      INSERT INTO runs (id, source_id, status, started_at, events_found, pages_crawled)
      VALUES (${runId}, ${INSTAGRAM_SOURCE_ID}, 'running', NOW(), 0, 1)
    `;

    let eventsCreated = 0;

    // 6. Process each post
    for (const post of posts) {
      await job.updateProgress({
        current: posts.indexOf(post) + 1,
        total: posts.length,
      });

      try {
        // 6a. Download image
        let localImagePath: string | null = null;
        if (post.imageUrl) {
          try {
            localImagePath = await scraper.downloadImage(
              post.imageUrl,
              post.id,
              DOWNLOAD_DIR
            );
            job.log(`Downloaded image for post ${post.id}`);
          } catch (error: any) {
            job.log(`Failed to download image for post ${post.id}: ${error.message}`);
          }
        }

        // 6b. Classify if mode is auto
        let isEventPoster: boolean | null = null;
        let confidence: number | null = null;

        if (account.classification_mode === 'auto') {
          const [isEvent, conf] = classify(post.caption);
          isEventPoster = isEvent;
          confidence = conf;
          job.log(`Classified post ${post.id}: isEvent=${isEvent}, confidence=${conf}`);
        }

        // 6c. Extract event data with Gemini if classified as event or mode is manual
        const shouldExtract =
          (account.classification_mode === 'auto' && isEventPoster) ||
          account.classification_mode === 'manual';

        let extractedData: any = null;

        if (shouldExtract && localImagePath && GEMINI_API_KEY) {
          try {
            const fullImagePath = path.join(DOWNLOAD_DIR, localImagePath);
            const geminiResult = await extractEventFromImageFile(
              fullImagePath,
              GEMINI_API_KEY,
              {
                caption: post.caption,
                postTimestamp: post.timestamp,
              }
            );

            extractedData = geminiResult;
            job.log(`Extracted event data for post ${post.id}`);

            // 6d. Create event_raw records for each event in the extraction
            if (geminiResult.events && geminiResult.events.length > 0) {
              for (const event of geminiResult.events) {
                // Parse date/time
                const startDateTime = new Date(`${event.startDate}T${event.startTime || '00:00:00'}`);
                const endDateTime = event.endDate ? new Date(`${event.endDate}T${event.endTime || '23:59:59'}`) : null;
                const timezone = event.timezone || account.default_timezone || 'America/Vancouver';

                // Combine Instagram post data with Gemini extraction result
                const rawData = {
                  ...geminiResult,
                  instagram: {
                    timestamp: post.timestamp.toISOString(),
                    postId: post.id,
                    caption: post.caption,
                    imageUrl: post.imageUrl,
                    permalink: post.permalink,
                    isVideo: post.isVideo,
                  }
                };

                await db`
                  INSERT INTO events_raw (
                    source_id, run_id, source_event_id, title, description_html,
                    start_datetime, end_datetime, timezone,
                    venue_name, venue_address, city, region, country,
                    organizer, category, price, tags, url, image_url, raw, content_hash,
                    instagram_account_id, instagram_post_id, instagram_caption, local_image_path,
                    classification_confidence, is_event_poster
                  ) VALUES (
                    ${INSTAGRAM_SOURCE_ID}, ${runId}, ${post.id}, ${event.title}, ${event.description || ''},
                    ${startDateTime.toISOString()}, ${endDateTime ? endDateTime.toISOString() : null}, ${timezone},
                    ${event.venue?.name || null}, ${event.venue?.address || null},
                    ${event.venue?.city || null}, ${event.venue?.region || null}, ${event.venue?.country || null},
                    ${event.organizer || null}, ${event.category || null}, ${event.price || null},
                    ${event.tags ? JSON.stringify(event.tags) : null},
                    ${post.permalink || `https://instagram.com/p/${post.id}/`},
                    ${post.imageUrl || null},
                    ${JSON.stringify(rawData)},
                    ${post.id},
                    ${accountId}, ${post.id}, ${post.caption}, ${localImagePath},
                    ${confidence}, ${isEventPoster ?? true}
                  )
                `;

                eventsCreated++;
              }
            }
          } catch (error: any) {
            job.log(`Failed to extract event for post ${post.id}: ${error.message}`);
          }
        }
      } catch (error: any) {
        job.log(`Error processing post ${post.id}: ${error.message}`);
      }
    }

    // 7. Update run status
    await db`
      UPDATE runs
      SET status = 'success', finished_at = NOW(), events_found = ${eventsCreated}
      WHERE id = ${runId}
    `;

    // 8. Update account last_checked timestamp
    await db`
      UPDATE instagram_accounts
      SET last_checked = NOW()
      WHERE id = ${accountId}
    `;

    job.log(`Instagram scrape completed: ${eventsCreated} events created`);

    return {
      success: true,
      postsProcessed: posts.length,
      eventsCreated,
      runId,
    };
  } catch (error: any) {
    // Handle rate limit errors from all scrapers
    if (error instanceof RateLimitError || error instanceof ApifyRateLimitError) {
      job.log(`Rate limit hit: ${error.message}`);
      throw error; // Will retry later
    }

    // Handle auth errors from all scrapers
    if (error instanceof InstagramAuthError || error instanceof ApifyAuthError) {
      job.log(`Authentication error: ${error.message}`);
      throw error;
    }

    // Handle enhanced client errors
    if (error instanceof ApifyClientError || error instanceof ApifyRunTimeoutError) {
      job.log(`Apify client error: ${error.message}`);
      throw error;
    }

    job.log(`Instagram scrape failed: ${error.message}`);
    throw error;
  }
}
