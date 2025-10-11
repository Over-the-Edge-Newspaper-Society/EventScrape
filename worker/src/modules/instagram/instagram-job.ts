/**
 * Instagram scraper job handler for BullMQ
 * Orchestrates: fetch posts → classify → extract → store in database
 */

import { Job } from 'bullmq';
import { queryClient as db } from '../../lib/database.js';
import { InstagramScraper, RateLimitError, InstagramAuthError, createScraperWithSession } from './scraper.js';
import { ApifyScraper, ApifyRateLimitError, ApifyAuthError, createApifyScraper } from './apify-scraper.js';
import { classify } from './classifier.js';
import { extractEventFromImageFile } from './gemini-extractor.js';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface InstagramScrapeJobData {
  sourceId: string;
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
    SELECT apify_api_token, gemini_api_key
    FROM instagram_settings
    WHERE id = ${SETTINGS_ID}
  `;
  return result[0] || { apify_api_token: null, gemini_api_key: null };
}

/**
 * Main Instagram scrape job handler
 */
export async function handleInstagramScrapeJob(job: Job<InstagramScrapeJobData>) {
  const { sourceId, postLimit = 10 } = job.data;

  job.log(`Starting Instagram scrape for source ${sourceId}`);

  try {
    // 0. Fetch Instagram settings from database
    const settings = await getInstagramSettings();
    const APIFY_API_TOKEN = settings.apify_api_token || process.env.APIFY_API_TOKEN || '';
    const GEMINI_API_KEY = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';

    // 1. Fetch source details
    const sourceResult = await db`
      SELECT id, name, base_url, source_type, instagram_username,
             classification_mode, default_timezone, instagram_scraper_type
      FROM sources
      WHERE id = ${sourceId}
    `;

    const source = sourceResult[0];

    if (!source || source.source_type !== 'instagram') {
      throw new Error(`Instagram source ${sourceId} not found`);
    }

    if (!source.instagram_username) {
      throw new Error(`Instagram source ${sourceId} missing username`);
    }

    const scraperType = source.instagram_scraper_type || 'instagram-private-api';
    job.log(`Fetching posts from @${source.instagram_username} using ${scraperType} scraper`);

    // 2. Create scraper instance based on type
    let scraper: InstagramScraper | ApifyScraper;

    if (scraperType === 'apify') {
      // Use Apify scraper
      if (!APIFY_API_TOKEN) {
        throw new ApifyAuthError('Apify API token not configured. Set APIFY_API_TOKEN environment variable.');
      }
      scraper = await createApifyScraper(APIFY_API_TOKEN);
      job.log('Using Apify scraper (official API)');
    } else {
      // Use instagram-private-api scraper (requires session)
      const sessionResult = await db`
        SELECT id, username, session_data, is_valid
        FROM instagram_sessions
        WHERE username = ${source.instagram_username}
      `;

      const session = sessionResult[0];

      if (!session) {
        throw new InstagramAuthError(`No session found for @${source.instagram_username}`);
      }

      scraper = await createScraperWithSession(
        session.session_data as any,
        source.instagram_username
      );
      job.log('Using instagram-private-api scraper (session-based)');
    }

    // 3. Get known post IDs from database
    const knownPostsResult = await db`
      SELECT instagram_post_id
      FROM events_raw
      WHERE source_id = ${sourceId}
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
      source.instagram_username,
      postLimit,
      knownPostIds
    );

    job.log(`Fetched ${posts.length} new posts`);

    // 5. Create a run record
    const runId = job.data.runId || uuidv4();
    await db`
      INSERT INTO runs (id, source_id, status, started_at, events_found, pages_crawled)
      VALUES (${runId}, ${source.id}, 'running', NOW(), 0, 1)
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

        if (source.classification_mode === 'auto') {
          const [isEvent, conf] = classify(post.caption);
          isEventPoster = isEvent;
          confidence = conf;
          job.log(`Classified post ${post.id}: isEvent=${isEvent}, confidence=${conf}`);
        }

        // 6c. Extract event data with Gemini if classified as event or mode is manual
        const shouldExtract =
          (source.classification_mode === 'auto' && isEventPoster) ||
          source.classification_mode === 'manual';

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
                const timezone = event.timezone || source.default_timezone || 'America/Vancouver';

                await db`
                  INSERT INTO events_raw (
                    source_id, run_id, source_event_id, title, description_html,
                    start_datetime, end_datetime, timezone,
                    venue_name, venue_address, city, region, country,
                    organizer, category, price, tags, url, image_url, raw, content_hash,
                    instagram_post_id, instagram_caption, local_image_path,
                    classification_confidence, is_event_poster
                  ) VALUES (
                    ${source.id}, ${runId}, ${post.id}, ${event.title}, ${event.description || ''},
                    ${startDateTime.toISOString()}, ${endDateTime ? endDateTime.toISOString() : null}, ${timezone},
                    ${event.venue?.name || null}, ${event.venue?.address || null},
                    ${event.venue?.city || null}, ${event.venue?.region || null}, ${event.venue?.country || null},
                    ${event.organizer || null}, ${event.category || null}, ${event.price || null},
                    ${event.tags ? JSON.stringify(event.tags) : null},
                    ${post.permalink || `https://instagram.com/p/${post.id}/`},
                    ${post.imageUrl || null},
                    ${JSON.stringify(geminiResult)},
                    ${post.id},
                    ${post.id}, ${post.caption}, ${localImagePath},
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

    // 8. Update source last_checked timestamp
    await db`
      UPDATE sources
      SET last_checked = NOW()
      WHERE id = ${sourceId}
    `;

    job.log(`Instagram scrape completed: ${eventsCreated} events created`);

    return {
      success: true,
      postsProcessed: posts.length,
      eventsCreated,
      runId,
    };
  } catch (error: any) {
    // Handle rate limit errors from both scrapers
    if (error instanceof RateLimitError || error instanceof ApifyRateLimitError) {
      job.log(`Rate limit hit: ${error.message}`);
      throw error; // Will retry later
    }

    // Handle auth errors from both scrapers
    if (error instanceof InstagramAuthError || error instanceof ApifyAuthError) {
      job.log(`Authentication error: ${error.message}`);
      throw error;
    }

    job.log(`Instagram scrape failed: ${error.message}`);
    throw error;
  }
}
