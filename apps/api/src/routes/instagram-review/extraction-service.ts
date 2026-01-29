import type { FastifyBaseLogger } from 'fastify';
import { eq, and } from 'drizzle-orm';
import path from 'path';
import { db } from '../../db/connection.js';
import { eventsRaw, sources, instagramSettings, systemSettings, runs } from '../../db/schema.js';
import { DOWNLOAD_DIR, INSTAGRAM_SOURCE_ID, SETTINGS_ID } from './constants.js';
import { InstagramExtractionError } from './errors.js';
import { hasExtractedEvents, parseEventRaw } from './raw-utils.js';
import type { ExtractionResult, InstagramPostWithSource } from './types.js';
import { SYSTEM_SETTINGS_ID } from '../../services/system-settings.js';

type AiEventCore = {
  title: string;
  descriptionHtml?: string;
  startIso: string;
  endIso?: string;
  timezone: string;
  venueName?: string;
  venueAddress?: string;
  city?: string;
  region?: string;
  country?: string;
  organizer?: string;
  category?: string;
  price?: string;
  tags?: string[];
  imageUrl?: string;
};

type AiEventCoreModule = {
  mapAiEventToCore: (
    event: any,
    options: {
      defaultTimezone: string;
      extractionConfidence?: any;
      wrapperMeta?: any;
      fallbackLocation?: {
        city?: string;
        region?: string;
        country?: string;
      };
      includeAdditionalInfoInDescription: boolean;
      includeConfidenceInDescription: boolean;
      includeCategoryInTags: boolean;
    },
  ) => AiEventCore;
};

type AIExtractorModule = {
  extractEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: {
      caption?: string;
      postTimestamp?: Date | string;
      model?: string;
    }
  ) => Promise<any>;
};

type AIProvider = 'gemini' | 'claude' | 'openrouter';

export const createExtractionService = (log: FastifyBaseLogger) => {
  let geminiExtractorModule: AIExtractorModule | null = null;
  let claudeExtractorModule: AIExtractorModule | null = null;
  let openrouterExtractorModule: AIExtractorModule | null = null;
  let aiEventCoreModule: AiEventCoreModule | null = null;

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
    } else if (provider === 'claude') {
      if (claudeExtractorModule) {
        return claudeExtractorModule;
      }

      const importPath = new URL(
        '../../worker/src/modules/instagram/claude-extractor.js',
        import.meta.url
      ).href;

      claudeExtractorModule = (await import(importPath)) as AIExtractorModule;
      return claudeExtractorModule;
    } else {
      // OpenRouter
      if (openrouterExtractorModule) {
        return openrouterExtractorModule;
      }

      const importPath = new URL(
        '../../worker/src/modules/instagram/openrouter-extractor.js',
        import.meta.url
      ).href;

      openrouterExtractorModule = (await import(importPath)) as AIExtractorModule;
      return openrouterExtractorModule;
    }
  };

  const getAiEventCoreModule = async (): Promise<AiEventCoreModule> => {
    if (aiEventCoreModule) {
      return aiEventCoreModule;
    }

    const importPath = new URL(
      '../../worker/src/modules/ai_poster_import/ai-event-core.js',
      import.meta.url
    ).href;

    aiEventCoreModule = (await import(importPath)) as AiEventCoreModule;
    return aiEventCoreModule;
  };

  const getAISettings = async (): Promise<{ provider: AIProvider; apiKey: string; model?: string }> => {
    const [global] = await db
      .select({
        aiProvider: systemSettings.aiProvider,
        geminiApiKey: systemSettings.geminiApiKey,
        claudeApiKey: systemSettings.claudeApiKey,
        openrouterApiKey: systemSettings.openrouterApiKey,
        openrouterModel: systemSettings.openrouterModel,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID));

    const [igSettings] = await db
      .select({
        aiProvider: instagramSettings.aiProvider,
        geminiApiKey: instagramSettings.geminiApiKey,
        claudeApiKey: instagramSettings.claudeApiKey,
      })
      .from(instagramSettings)
      .where(eq(instagramSettings.id, SETTINGS_ID));

    const provider = (global?.aiProvider || igSettings?.aiProvider || 'gemini') as AIProvider;

    let apiKey: string | undefined;
    let model: string | undefined;

    if (provider === 'gemini') {
      apiKey = global?.geminiApiKey || igSettings?.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new InstagramExtractionError('Gemini API key not configured', 400);
      }
    } else if (provider === 'claude') {
      apiKey = global?.claudeApiKey || igSettings?.claudeApiKey || process.env.CLAUDE_API_KEY;
      if (!apiKey) {
        throw new InstagramExtractionError('Claude API key not configured', 400);
      }
    } else {
      // OpenRouter
      apiKey = global?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
      model = global?.openrouterModel || 'google/gemini-2.0-flash-exp';
      if (!apiKey) {
        throw new InstagramExtractionError('OpenRouter API key not configured', 400);
      }
    }

    return { provider, apiKey, model };
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
    options: { provider: AIProvider; apiKey: string; model?: string; overwrite?: boolean; createEvents?: boolean }
  ): Promise<ExtractionResult> => {
    const { event: post, source } = postWithSource;
    const { provider, apiKey, model, overwrite = false, createEvents = true } = options;

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
    const { mapAiEventToCore } = await getAiEventCoreModule();

    log.info(`Using ${provider.toUpperCase()} AI provider for extraction`);

    const extractionResult = await extractEventFromImageFile(fullImagePath, apiKey, {
      caption: post.instagramCaption || undefined,
      postTimestamp: instagramTimestamp || undefined,
      model: model || undefined,
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
      const defaultTimezone = source.defaultTimezone || 'America/Vancouver';

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

      for (const aiEvent of extractionResult.events) {
        const core = mapAiEventToCore(aiEvent, {
          defaultTimezone,
          extractionConfidence: extractionResult.extractionConfidence,
          wrapperMeta: undefined,
          fallbackLocation: {},
          includeAdditionalInfoInDescription: false,
          includeConfidenceInDescription: false,
          includeCategoryInTags: true,
        });

        const startDateTime = new Date(core.startIso);
        const endDateTime = core.endIso ? new Date(core.endIso) : null;

        await db.insert(eventsRaw).values({
          sourceId: INSTAGRAM_SOURCE_ID,
          runId: manualRun.id,
          sourceEventId: `${post.instagramPostId}-${Date.now()}`,
          title: core.title,
          descriptionHtml: core.descriptionHtml || '',
          startDatetime: startDateTime,
          endDatetime: endDateTime,
          timezone: core.timezone || defaultTimezone,
          venueName: core.venueName || null,
          venueAddress: core.venueAddress || null,
          city: core.city || null,
          region: core.region || null,
          country: core.country || null,
          organizer: core.organizer || null,
          category: core.category || null,
          price: core.price || null,
          tags: core.tags || null,
          url: post.url || `https://instagram.com/p/${post.instagramPostId}/`,
          imageUrl: core.imageUrl || post.imageUrl,
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
    const { provider, apiKey, model } = await getAISettings();
    const postWithSource = await fetchPostWithSource(id);
    return performExtraction(postWithSource, { provider, apiKey, model, ...options });
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
