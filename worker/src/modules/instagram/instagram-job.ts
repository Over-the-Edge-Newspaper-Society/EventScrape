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
import { extractEventFromImageFile, classifyEventFromImageFile } from './gemini-extractor.js';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface InstagramScrapeJobData {
  accountId: string;
  runId?: string;
  postLimit?: number;
  batchSize?: number;
  parentRunId?: string;
}

const DOWNLOAD_DIR = process.env.INSTAGRAM_IMAGES_DIR || './data/instagram_images';
const SETTINGS_ID = '00000000-0000-0000-0000-000000000001'; // Singleton settings ID

type RunMetadata = Record<string, unknown>;

function normalizeRunMetadata(raw: unknown): RunMetadata {
  if (!raw) {
    return {};
  }

  if (Array.isArray(raw)) {
    return raw.reduce<RunMetadata>((acc, entry) => {
      return { ...acc, ...normalizeRunMetadata(entry) };
    }, {});
  }

  if (typeof raw === 'string') {
    try {
      return normalizeRunMetadata(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  if (typeof raw === 'object') {
    return { ...(raw as Record<string, unknown>) };
  }

  return {};
}

function cleanMetadata(metadata: RunMetadata): RunMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined)
  );
}

function isApifyQuotaExceededError(error: Error): boolean {
  return (
    typeof error.message === 'string' &&
    error.message.toLowerCase().includes('monthly usage hard limit exceeded')
  );
}

async function fetchRunMetadata(runId: string): Promise<RunMetadata> {
  const [row] = await db`
    SELECT metadata
    FROM runs
    WHERE id = ${runId}
    LIMIT 1
  `;
  return normalizeRunMetadata(row?.metadata);
}

/**
 * Fetch Instagram settings from database
 */
async function getInstagramSettings() {
  const result = await db`
    SELECT
      apify_api_token,
      gemini_api_key,
      default_scraper_type,
      allow_per_account_override,
      auto_classify_with_ai,
      auto_extract_new_posts
    FROM instagram_settings
    LIMIT 1
  `;
  return result[0] || {
    apify_api_token: null,
    gemini_api_key: null,
    default_scraper_type: 'instagram-private-api',
    allow_per_account_override: true,
    auto_classify_with_ai: false,
    auto_extract_new_posts: false
  };
}

// Instagram source ID (fixed)
const INSTAGRAM_SOURCE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Main Instagram scrape job handler
 */
export async function handleInstagramScrapeJob(job: Job<InstagramScrapeJobData>) {
  const { accountId, postLimit = 10, batchSize, parentRunId } = job.data;
  let runId = job.data.runId || uuidv4();

  if (!job.data.runId) {
    await db`
      INSERT INTO runs (id, source_id, status, parent_run_id)
      VALUES (${runId}, ${INSTAGRAM_SOURCE_ID}, 'queued', ${parentRunId ?? null})
    `;
  }

  await db`
    UPDATE runs
    SET status = 'running',
        started_at = COALESCE(started_at, NOW())
    WHERE id = ${runId}
  `;

  if (parentRunId) {
    await db`
      UPDATE runs
      SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
          started_at = COALESCE(started_at, NOW())
      WHERE id = ${parentRunId}
    `;
  }

  job.log(`Starting Instagram scrape for account ${accountId}`);

  let runMetadata = await fetchRunMetadata(runId);
  const mergeRunMetadata = async (patch: RunMetadata) => {
    runMetadata = cleanMetadata({ ...runMetadata, ...patch });
    await db`
      UPDATE runs
      SET metadata = ${db.json(runMetadata)}
      WHERE id = ${runId}
    `;
  };

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
                new Map([[username, knownPostIds]]),
                batchSize
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

    await mergeRunMetadata({
      instagramAccountId: account.id,
      instagramUsername: account.instagram_username,
      postLimit,
      batchSize: batchSize ?? null,
    });

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
        let aiClassification: any = null;

        if (account.classification_mode === 'auto') {
          if (
            settings.auto_classify_with_ai &&
            GEMINI_API_KEY &&
            localImagePath
          ) {
            try {
              const fullImagePath = path.join(DOWNLOAD_DIR, localImagePath);
              aiClassification = await classifyEventFromImageFile(
                fullImagePath,
                GEMINI_API_KEY,
                {
                  caption: post.caption,
                  postTimestamp: post.timestamp,
                }
              );
              isEventPoster = aiClassification.isEventPoster;
              confidence = aiClassification.confidence ?? null;
              job.log(`[AI] Classified post ${post.id}: isEvent=${aiClassification.isEventPoster}, confidence=${aiClassification.confidence ?? 'n/a'}`);
            } catch (error: any) {
              job.log(`[AI] Failed to classify post ${post.id}: ${error.message}`);
            }
          }

          if (isEventPoster === null) {
            const [isEvent, conf] = classify(post.caption);
            isEventPoster = isEvent;
            confidence = conf;
            job.log(`Classified post ${post.id}: isEvent=${isEvent}, confidence=${conf}`);
          }
        }

        const classificationTimestamp = aiClassification ? new Date().toISOString() : null;
        const classificationRecord = aiClassification
          ? {
              gemini: {
                ...aiClassification,
                decidedAt: classificationTimestamp,
                method: 'gemini-auto',
              }
            }
          : null;

        const captionText = post.caption?.trim() ?? '';
        const baseTitle = captionText.split('\n').map((line) => line.trim()).find(Boolean) ?? `Instagram Post ${post.id}`;
        const descriptionHtml = captionText;
        const postUrl = post.permalink || `https://instagram.com/p/${post.id}/`;
        const timezone = account.default_timezone || 'America/Vancouver';
        const baseRawPayload: Record<string, any> = {
          instagram: {
            timestamp: post.timestamp.toISOString(),
            postId: post.id,
            caption: post.caption,
            imageUrl: post.imageUrl,
            permalink: post.permalink,
            isVideo: post.isVideo,
          }
        };

        if (classificationRecord) {
          baseRawPayload.classification = classificationRecord;
        }

        try {
          await db`
            INSERT INTO events_raw (
              source_id, run_id, source_event_id, title, description_html,
              start_datetime, end_datetime, timezone, url, image_url, raw, content_hash,
              instagram_account_id, instagram_post_id, instagram_caption, local_image_path,
              classification_confidence, is_event_poster, last_updated_by_run_id
            ) VALUES (
              ${INSTAGRAM_SOURCE_ID}, ${runId}, ${post.id}, ${baseTitle}, ${descriptionHtml},
              ${post.timestamp.toISOString()}, null, ${timezone}, ${postUrl}, ${post.imageUrl},
              ${JSON.stringify(baseRawPayload)},
              ${`instagram-post-${post.id}`},
              ${accountId}, ${post.id}, ${post.caption}, ${localImagePath},
              ${confidence}, ${isEventPoster}, ${runId}
            )
            ON CONFLICT (source_id, source_event_id) DO UPDATE
            SET
              run_id = EXCLUDED.run_id,
              description_html = EXCLUDED.description_html,
              url = EXCLUDED.url,
              image_url = COALESCE(EXCLUDED.image_url, events_raw.image_url),
              instagram_caption = EXCLUDED.instagram_caption,
              local_image_path = COALESCE(EXCLUDED.local_image_path, events_raw.local_image_path),
              classification_confidence = COALESCE(EXCLUDED.classification_confidence, events_raw.classification_confidence),
              is_event_poster = COALESCE(EXCLUDED.is_event_poster, events_raw.is_event_poster),
              raw = EXCLUDED.raw,
              last_updated_by_run_id = EXCLUDED.last_updated_by_run_id,
              scraped_at = NOW(),
              last_seen_at = NOW()
          `;
        } catch (error: any) {
          job.log(`Failed to upsert base post ${post.id}: ${error.message}`);
        }

        // 6c. Extract event data with Gemini if classified as event or mode is manual
        const shouldExtract =
          (account.classification_mode === 'auto' && isEventPoster && settings.auto_extract_new_posts && (aiClassification?.shouldExtractEvents ?? true)) ||
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
              for (const [eventIndex, event] of geminiResult.events.entries()) {
                // Parse date/time with proper timezone handling
                const timezone = event.timezone || account.default_timezone || 'America/Vancouver';

                // Convert local time to UTC
                // Create datetime string in ISO format for the local timezone
                const startDateTimeLocal = `${event.startDate}T${event.startTime || '00:00:00'}`;
                const endDateTimeLocal = event.endDate ? `${event.endDate}T${event.endTime || '23:59:59'}` : null;

                // Convert to UTC by parsing as local time in the specified timezone
                // Use toLocaleString to get UTC representation
                const startDateTime = new Date(new Date(startDateTimeLocal).toLocaleString('en-US', { timeZone: timezone }));
                // Adjust: the above gives us local interpretation, we need to calculate UTC offset
                // Better approach: use explicit timezone offset calculation
                const startLocalDate = new Date(startDateTimeLocal);
                const startUtcDate = new Date(startLocalDate.toLocaleString('en-US', { timeZone: 'UTC' }));
                const startTzDate = new Date(startLocalDate.toLocaleString('en-US', { timeZone: timezone }));
                const tzOffset = startUtcDate.getTime() - startTzDate.getTime();
                const startDateTime = new Date(startLocalDate.getTime() + tzOffset);

                const endDateTime = endDateTimeLocal ? (() => {
                  const endLocalDate = new Date(endDateTimeLocal);
                  const endUtcDate = new Date(endLocalDate.toLocaleString('en-US', { timeZone: 'UTC' }));
                  const endTzDate = new Date(endLocalDate.toLocaleString('en-US', { timeZone: timezone }));
                  const endTzOffset = endUtcDate.getTime() - endTzDate.getTime();
                  return new Date(endLocalDate.getTime() + endTzOffset);
                })() : null;

                // Combine Instagram post data with Gemini extraction result
                const classificationEnvelope = classificationRecord
                  ? {
                      classification: {
                        ...(geminiResult?.classification || {}),
                        ...classificationRecord,
                      }
                    }
                  : {};

                const rawData = {
                  ...geminiResult,
                  ...classificationEnvelope,
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
                    ${INSTAGRAM_SOURCE_ID}, ${runId}, ${`${post.id}-event-${eventIndex}`}, ${event.title}, ${event.description || ''},
                    ${startDateTime.toISOString()}, ${endDateTime ? endDateTime.toISOString() : null}, ${timezone},
                    ${event.venue?.name || null}, ${event.venue?.address || null},
                    ${event.venue?.city || null}, ${event.venue?.region || null}, ${event.venue?.country || null},
                    ${event.organizer || null}, ${event.category || null}, ${event.price || null},
                    ${event.tags || null},
                    ${post.permalink || `https://instagram.com/p/${post.id}/`},
                    ${post.imageUrl || null},
                    ${JSON.stringify(rawData)},
                    ${`${post.id}-event-${eventIndex}`},
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

    const pagesCrawled = Math.max(posts.length, 1);

    // 7. Update run status
    runMetadata = cleanMetadata({
      ...runMetadata,
      postsFetched: posts.length,
      eventsCreated,
    });

    await db`
      UPDATE runs
      SET status = 'success',
          finished_at = NOW(),
          events_found = ${eventsCreated},
          pages_crawled = ${pagesCrawled},
          metadata = ${db.json(runMetadata)}
      WHERE id = ${runId}
    `;

    // 8. Update account last_checked timestamp
    await db`
      UPDATE instagram_accounts
      SET last_checked = NOW()
      WHERE id = ${accountId}
    `;

    job.log(`Instagram scrape completed: ${eventsCreated} events created`);

    if (parentRunId) {
      await refreshInstagramBatchRun(parentRunId);
    }

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

      if (isApifyQuotaExceededError(error)) {
        const quotaMessage = 'Apify usage hard limit exceeded';
        job.log('Apify monthly usage limit reached — marking run as error without retry.');
        if (runId) {
          runMetadata = cleanMetadata({ ...runMetadata, error: quotaMessage });
          await db`
            UPDATE runs
            SET status = 'error',
                finished_at = NOW(),
                metadata = ${db.json(runMetadata)}
            WHERE id = ${runId}
          `;
        }
        if (parentRunId) {
          await refreshInstagramBatchRun(parentRunId);
        }
        return;
      }

      throw error;
    }

    job.log(`Instagram scrape failed: ${error.message}`);

    const errorMessage = String(error?.message || error || 'Unknown error');

      if (runId) {
        runMetadata = cleanMetadata({ ...runMetadata, error: errorMessage });
        await db`
          UPDATE runs
          SET status = 'error',
              finished_at = NOW(),
              metadata = ${db.json(runMetadata)}
          WHERE id = ${runId}
        `;
      }

    if (parentRunId) {
      await refreshInstagramBatchRun(parentRunId);
    }

    throw error;
  }
}

async function refreshInstagramBatchRun(parentRunId: string) {
  try {
    const [summary] = await db`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
        COUNT(*) FILTER (WHERE status IN ('error', 'partial'))::int AS failed_count,
        COUNT(*) FILTER (WHERE status IN ('queued', 'running'))::int AS pending_count,
        COALESCE(SUM(events_found), 0)::int AS events_total,
        COALESCE(SUM(pages_crawled), 0)::int AS pages_total
      FROM runs
      WHERE parent_run_id = ${parentRunId}
    `;

    if (!summary) {
      return;
    }

    const pendingCount = Number(summary.pending_count ?? 0);
    const failedCount = Number(summary.failed_count ?? 0);
    const eventsTotal = Number(summary.events_total ?? 0);
    const pagesTotal = Number(summary.pages_total ?? 0);

    const nextStatus = pendingCount > 0
      ? 'running'
      : failedCount > 0
        ? 'partial'
        : 'success';

    let parentMetadata = await fetchRunMetadata(parentRunId);
    parentMetadata = cleanMetadata({
      ...parentMetadata,
      batch: {
        total: Number(summary.total ?? 0),
        success: Number(summary.success_count ?? 0),
        failed: failedCount,
        pending: pendingCount,
      },
    });

    await db`
      UPDATE runs
      SET status = ${nextStatus},
          events_found = ${eventsTotal},
          pages_crawled = ${pagesTotal},
          finished_at = CASE WHEN ${pendingCount} = 0 THEN NOW() ELSE finished_at END,
          metadata = ${db.json(parentMetadata)}
      WHERE id = ${parentRunId}
    `;
  } catch (error) {
    console.error(`Failed to refresh parent Instagram run ${parentRunId}:`, error);
  }
}
