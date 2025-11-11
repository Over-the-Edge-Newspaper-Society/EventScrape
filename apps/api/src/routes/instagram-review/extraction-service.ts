import type { FastifyBaseLogger } from 'fastify';
import { eq, and } from 'drizzle-orm';
import path from 'path';
import { db } from '../../db/connection.js';
import { eventsRaw, sources, instagramSettings, runs } from '../../db/schema.js';
import { DOWNLOAD_DIR, INSTAGRAM_SOURCE_ID, SETTINGS_ID } from './constants.js';
import { InstagramExtractionError } from './errors.js';
import { hasExtractedEvents, parseEventRaw } from './raw-utils.js';
import type { ExtractionResult, InstagramPostWithSource } from './types.js';

type AIExtractorModule = {
  extractEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: {
      caption?: string;
      postTimestamp?: Date | string;
    }
  ) => Promise<any>;
};

type AIProvider = 'gemini' | 'claude';

export const createExtractionService = (log: FastifyBaseLogger) => {
  let geminiExtractorModule: AIExtractorModule | null = null;
  let claudeExtractorModule: AIExtractorModule | null = null;

  const getExtractor = async (provider: AIProvider): Promise<AIExtractorModule> => {
    if (provider === 'gemini') {
      if (geminiExtractorModule) {
        return geminiExtractorModule;
      }

      const importPath = new URL(
        '../../worker/src/modules/instagram/gemini-extractor.js',
        import.meta.url
      ).href;

      geminiExtractorModule = (await import(importPath)) as AIExtractorModule;
      return geminiExtractorModule;
    } else {
      // Claude
      if (claudeExtractorModule) {
        return claudeExtractorModule;
      }

      const importPath = new URL(
        '../../worker/src/modules/instagram/claude-extractor.js',
        import.meta.url
      ).href;

      claudeExtractorModule = (await import(importPath)) as AIExtractorModule;
      return claudeExtractorModule;
    }
  };

  const getAISettings = async (): Promise<{ provider: AIProvider; apiKey: string }> => {
    const [settings] = await db
      .select({
        aiProvider: instagramSettings.aiProvider,
        geminiApiKey: instagramSettings.geminiApiKey,
        claudeApiKey: instagramSettings.claudeApiKey,
      })
      .from(instagramSettings)
      .where(eq(instagramSettings.id, SETTINGS_ID));

    const provider = (settings?.aiProvider || 'gemini') as AIProvider;

    let apiKey: string | undefined;
    if (provider === 'gemini') {
      apiKey = settings?.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new InstagramExtractionError('Gemini API key not configured', 400);
      }
    } else {
      apiKey = settings?.claudeApiKey || process.env.CLAUDE_API_KEY;
      if (!apiKey) {
        throw new InstagramExtractionError('Claude API key not configured', 400);
      }
    }

    return { provider, apiKey };
  };

  // Keep legacy method for backwards compatibility
  const getGeminiApiKey = async (): Promise<string> => {
    const { provider, apiKey } = await getAISettings();
    if (provider !== 'gemini') {
      throw new InstagramExtractionError('Gemini is not the active AI provider', 400);
    }
    return apiKey;
  };

  const fetchPostWithSource = async (id: string): Promise<InstagramPostWithSource> => {
    const [result] = await db
      .select({
        event: eventsRaw,
        source: sources,
      })
      .from(eventsRaw)
      .innerJoin(sources, eq(eventsRaw.sourceId, sources.id))
      .where(and(eq(eventsRaw.id, id), eq(sources.sourceType, 'instagram')));

    if (!result) {
      throw new InstagramExtractionError('Instagram post not found', 404);
    }

    return result;
  };

  const performExtraction = async (
    postWithSource: InstagramPostWithSource,
    options: { provider: AIProvider; apiKey: string; overwrite?: boolean; createEvents?: boolean }
  ): Promise<ExtractionResult> => {
    const { event: post, source } = postWithSource;
    const { provider, apiKey, overwrite = false, createEvents = true } = options;

    if (!post.localImagePath) {
      throw new InstagramExtractionError(
        'Post does not have a local image. Image must be downloaded first.',
        400
      );
    }

    if (!overwrite && hasExtractedEvents(post.raw)) {
      throw new InstagramExtractionError(
        'Post already has extracted data. Set overwrite=true to re-extract.',
        400,
        {
          existingData: parseEventRaw(post.raw),
        }
      );
    }

    const fullImagePath = path.join(DOWNLOAD_DIR, post.localImagePath);

    const existingRaw = parseEventRaw(post.raw);
    let instagramTimestamp: Date | undefined;

    if (existingRaw && typeof existingRaw === 'object') {
      // Try multiple possible locations for the timestamp:
      // 1. raw.instagram.timestamp (manually extracted posts with full structure)
      // 2. raw.timestamp (Apify imported posts, auto-scraped base posts)
      const rawAsAny = existingRaw as any;
      const rawTimestamp = rawAsAny.instagram?.timestamp || rawAsAny.timestamp;

      if (rawTimestamp) {
        const parsedTimestamp = new Date(rawTimestamp);
        if (!Number.isNaN(parsedTimestamp.getTime())) {
          instagramTimestamp = parsedTimestamp;
          log.info(`Found Instagram post timestamp: ${parsedTimestamp.toISOString()}`);
        }
      }
    }

    if (!instagramTimestamp && post.scrapedAt) {
      log.warn(`No Instagram post timestamp found in raw data for post ${post.instagramPostId}, falling back to scrape date. This may cause incorrect year inference for events.`);
      instagramTimestamp = new Date(post.scrapedAt);
    }

    const { extractEventFromImageFile } = await getExtractor(provider);

    log.info(`Using ${provider.toUpperCase()} AI provider for extraction`);

    const extractionResult = await extractEventFromImageFile(fullImagePath, apiKey, {
      caption: post.instagramCaption || undefined,
      postTimestamp: instagramTimestamp || undefined,
    });

    const rawData = {
      ...extractionResult,
      aiProvider: provider,
      instagram: {
        timestamp: (instagramTimestamp || post.scrapedAt)?.toISOString?.() || new Date().toISOString(),
        postId: post.instagramPostId,
        caption: post.instagramCaption,
        imageUrl: post.imageUrl,
        localImagePath: post.localImagePath,
      },
    };

    await db
      .update(eventsRaw)
      .set({
        raw: rawData,
      })
      .where(eq(eventsRaw.id, post.id));

    let eventsCreated = 0;

    if (createEvents && extractionResult.events && extractionResult.events.length > 0) {
      const timezone = source.defaultTimezone || 'America/Vancouver';

      if (post.instagramPostId) {
        const deleteResult = await db
          .delete(eventsRaw)
          .where(eq(eventsRaw.instagramPostId, post.instagramPostId))
          .returning();

        if (deleteResult.length > 0) {
          log.info(
            `Deleted ${deleteResult.length} existing record(s) for Instagram post ${post.instagramPostId} to avoid duplicates`
          );
        }
      }

      const [manualRun] = await db
        .insert(runs)
        .values({
          sourceId: INSTAGRAM_SOURCE_ID,
          status: 'success',
          pagesCrawled: 1,
          eventsFound: extractionResult.events.length,
          finishedAt: new Date(),
        })
        .returning();

      for (const event of extractionResult.events) {
        const startDate = event.startDate
          ? `${event.startDate}T${event.startTime || '00:00:00'}`
          : undefined;
        const endDate = event.endDate
          ? `${event.endDate}T${event.endTime || '23:59:59'}`
          : undefined;

        const startDateTime = startDate ? new Date(startDate) : new Date();
        const endDateTime = endDate ? new Date(endDate) : null;

        await db.insert(eventsRaw).values({
          sourceId: INSTAGRAM_SOURCE_ID,
          runId: manualRun.id,
          sourceEventId: `${post.instagramPostId}-${Date.now()}`,
          title: event.title,
          descriptionHtml: event.description || '',
          startDatetime: startDateTime,
          endDatetime: endDateTime,
          timezone: event.timezone || timezone,
          venueName: event.venue?.name || null,
          venueAddress: event.venue?.address || null,
          city: event.venue?.city || null,
          region: event.venue?.region || null,
          country: event.venue?.country || null,
          organizer: event.organizer || null,
          category: event.category || null,
          price: event.price || null,
          tags: event.tags || null,
          url: post.url || `https://instagram.com/p/${post.instagramPostId}/`,
          imageUrl: post.imageUrl,
          raw: rawData,
          contentHash: `${post.instagramPostId}-extraction-${Date.now()}`,
          instagramAccountId: post.instagramAccountId,
          instagramPostId: post.instagramPostId,
          instagramCaption: post.instagramCaption,
          localImagePath: post.localImagePath,
          classificationConfidence: post.classificationConfidence,
          isEventPoster: true,
        });

        eventsCreated++;
      }
    }

    return {
      success: true,
      message: `Extracted ${extractionResult.events?.length || 0} event(s) from post using ${provider}`,
      extraction: extractionResult,
      eventsCreated,
    };
  };

  const extractPostById = async (
    id: string,
    options: { overwrite?: boolean; createEvents?: boolean } = {}
  ): Promise<ExtractionResult> => {
    const { provider, apiKey } = await getAISettings();
    const postWithSource = await fetchPostWithSource(id);
    return performExtraction(postWithSource, { provider, apiKey, ...options });
  };

  return {
    getGeminiApiKey,
    getAISettings,
    fetchPostWithSource,
    performExtraction,
    extractPostById,
  };
};

export type ExtractionService = ReturnType<typeof createExtractionService>;
