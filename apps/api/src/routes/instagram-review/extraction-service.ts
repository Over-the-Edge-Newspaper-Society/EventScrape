import type { FastifyBaseLogger } from 'fastify';
import { eq, and } from 'drizzle-orm';
import path from 'path';
import { db } from '../../db/connection.js';
import { eventsRaw, sources, instagramSettings, runs } from '../../db/schema.js';
import { DOWNLOAD_DIR, INSTAGRAM_SOURCE_ID, SETTINGS_ID } from './constants.js';
import { InstagramExtractionError } from './errors.js';
import { hasExtractedEvents, parseEventRaw } from './raw-utils.js';
import type { ExtractionResult, InstagramPostWithSource } from './types.js';

type GeminiExtractorModule = {
  extractEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: {
      caption?: string;
      postTimestamp?: Date | string;
    }
  ) => Promise<any>;
};

export const createExtractionService = (log: FastifyBaseLogger) => {
  let geminiExtractorModule: GeminiExtractorModule | null = null;

  const getGeminiExtractor = async (): Promise<GeminiExtractorModule> => {
    if (geminiExtractorModule) {
      return geminiExtractorModule;
    }

    const importPath = new URL(
      '../../worker/src/modules/instagram/gemini-extractor.js',
      import.meta.url
    ).href;

    geminiExtractorModule = (await import(importPath)) as GeminiExtractorModule;
    return geminiExtractorModule;
  };

  const getGeminiApiKey = async (): Promise<string> => {
    const [settings] = await db
      .select({ geminiApiKey: instagramSettings.geminiApiKey })
      .from(instagramSettings)
      .where(eq(instagramSettings.id, SETTINGS_ID));

    const GEMINI_API_KEY = settings?.geminiApiKey || process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      throw new InstagramExtractionError('Gemini API key not configured', 400);
    }

    return GEMINI_API_KEY;
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
    options: { geminiApiKey: string; overwrite?: boolean; createEvents?: boolean }
  ): Promise<ExtractionResult> => {
    const { event: post, source } = postWithSource;
    const { geminiApiKey, overwrite = false, createEvents = true } = options;

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
      const rawTimestamp = (existingRaw as { instagram?: { timestamp?: string } }).instagram?.timestamp;
      if (rawTimestamp) {
        const parsedTimestamp = new Date(rawTimestamp);
        if (!Number.isNaN(parsedTimestamp.getTime())) {
          instagramTimestamp = parsedTimestamp;
        }
      }
    }

    if (!instagramTimestamp && post.scrapedAt) {
      instagramTimestamp = new Date(post.scrapedAt);
    }

    const { extractEventFromImageFile } = await getGeminiExtractor();

    const geminiResult = await extractEventFromImageFile(fullImagePath, geminiApiKey, {
      caption: post.instagramCaption || undefined,
      postTimestamp: instagramTimestamp || undefined,
    });

    const rawData = {
      ...geminiResult,
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

    if (createEvents && geminiResult.events && geminiResult.events.length > 0) {
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
          eventsFound: geminiResult.events.length,
          finishedAt: new Date(),
        })
        .returning();

      for (const event of geminiResult.events) {
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
      message: `Extracted ${geminiResult.events?.length || 0} event(s) from post`,
      extraction: geminiResult,
      eventsCreated,
    };
  };

  const extractPostById = async (
    id: string,
    options: { overwrite?: boolean; createEvents?: boolean } = {}
  ): Promise<ExtractionResult> => {
    const geminiApiKey = await getGeminiApiKey();
    const postWithSource = await fetchPostWithSource(id);
    return performExtraction(postWithSource, { geminiApiKey, ...options });
  };

  return {
    getGeminiApiKey,
    fetchPostWithSource,
    performExtraction,
    extractPostById,
  };
};

export type ExtractionService = ReturnType<typeof createExtractionService>;
