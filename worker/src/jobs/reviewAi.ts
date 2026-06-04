/**
 * Manual Instagram Review AI job handler.
 *
 * Replaces the inline AI calls that used to live in the API's
 * instagram-review routes (/:id/ai-classify, /:id/extract, plus the bulk
 * variants). The admin now enqueues a "review" job via
 * instagramReview:{enqueueClassify,enqueueExtract,enqueueClassifyPending,
 * enqueueExtractMissing}; this handler runs the actual AI on the worker.
 *
 * payload: { eventId, mode: "classify" | "extract", overwrite?, createEvents? }
 *
 * The image now lives in Convex storage (eventsRaw.localImageStorageId). The
 * file-based AI extractors take a path, so we download the bytes, write them to
 * a temp file, run the extractor, then clean up.
 */

import os from 'os';
import path from 'path';
import { writeFile, unlink, mkdtemp, rm } from 'fs/promises';
import { makeFunctionReference } from 'convex/server';
import {
  convex,
  workerApi,
  downloadFromConvexStorage,
} from '../lib/convex.js';
import { JobShim } from '../types.js';

import * as geminiExtractor from '../modules/instagram/gemini-extractor.js';
import * as claudeExtractor from '../modules/instagram/claude-extractor.js';
import * as openrouterExtractor from '../modules/instagram/openrouter-extractor.js';

type AiProvider = 'gemini' | 'claude' | 'openrouter';

interface ReviewAiPayload {
  eventId: string;
  mode: 'classify' | 'extract';
  overwrite?: boolean;
  createEvents?: boolean;
}

// Read-only references for the Convex functions this handler needs that aren't
// already exposed on workerApi.
const getPostForAiRef = makeFunctionReference<'query'>('instagramReview:getPostForAi');
const classifyRef = makeFunctionReference<'mutation'>('instagramReview:classify');
const persistExtractionRef = makeFunctionReference<'mutation'>('instagramReview:persistExtraction');

interface PostForAi {
  post: {
    _id: string;
    runId?: string;
    instagramAccountId?: string;
    instagramPostId?: string;
    instagramCaption?: string | null;
    imageUrl?: string | null;
    url: string;
    localImagePath?: string | null;
    localImageStorageId?: string | null;
    localImageContentType?: string | null;
    localImageSize?: number | null;
    classificationConfidence?: number | null;
    isEventPoster?: boolean | null;
    scrapedAt: number;
    raw?: any;
  };
  account: { id: string; classificationMode: string; defaultTimezone: string } | null;
  source: { id: string; defaultTimezone: string };
  settings: {
    aiProvider: AiProvider | string;
    geminiApiKey: string | null;
    claudeApiKey: string | null;
    openrouterApiKey: string | null;
    openrouterModel: string | null;
    apifyApiToken: string | null;
  };
}

type ExtractorModule = {
  extractEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: { caption?: string | null; postTimestamp?: Date | null; model?: string },
  ) => Promise<any>;
  classifyEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: { caption?: string | null; postTimestamp?: Date | null; model?: string },
  ) => Promise<any>;
};

// Choose provider + key exactly like the API extraction-service did (and like
// instagram-job picks gemini): systemSettings provider wins, default gemini.
function resolveProvider(settings: PostForAi['settings']): {
  provider: AiProvider;
  apiKey: string;
  model?: string;
  module: ExtractorModule;
} {
  const provider = (settings.aiProvider || 'gemini') as AiProvider;

  if (provider === 'claude') {
    const apiKey = settings.claudeApiKey || process.env.CLAUDE_API_KEY || '';
    if (!apiKey) throw new Error('Claude API key not configured');
    return { provider, apiKey, module: claudeExtractor as unknown as ExtractorModule };
  }

  if (provider === 'openrouter') {
    const apiKey = settings.openrouterApiKey || process.env.OPENROUTER_API_KEY || '';
    const model = settings.openrouterModel || 'google/gemini-2.0-flash-exp';
    if (!apiKey) throw new Error('OpenRouter API key not configured');
    return { provider, apiKey, model, module: openrouterExtractor as unknown as ExtractorModule };
  }

  // gemini (default)
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('Gemini API key not configured');
  return { provider: 'gemini', apiKey, module: geminiExtractor as unknown as ExtractorModule };
}

// Mirrors instagram-review ai-classification.ts: pick the post timestamp from
// raw.instagram.timestamp (or raw.timestamp) and fall back to scrapedAt.
function resolveTimestamp(raw: any, scrapedAt: number): Date {
  if (raw && typeof raw === 'object') {
    const rawTimestamp = raw.instagram?.timestamp || raw.timestamp;
    if (rawTimestamp) {
      const parsed = new Date(rawTimestamp);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date(scrapedAt);
}

function hasExtractedEvents(raw: any): boolean {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  return Array.isArray(parsed?.events) && parsed.events.length > 0;
}

// Same local->UTC conversion the instagram-job uses for extracted events.
function toUtcMs(dateTimeLocal: string, timezone: string): number {
  const localDate = new Date(dateTimeLocal);
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
  const tzOffset = utcDate.getTime() - tzDate.getTime();
  return localDate.getTime() + tzOffset;
}

export async function handleReviewAiJob(job: JobShim<ReviewAiPayload>): Promise<void> {
  const payload = job.data;
  const { eventId, mode } = payload;
  const overwrite = payload.overwrite ?? false;
  const createEvents = payload.createEvents ?? true;

  job.log(`Review AI job: mode=${mode} event=${eventId}`);

  const data = (await convex.query(getPostForAiRef, { id: eventId })) as PostForAi | null;
  if (!data || !data.post) {
    throw new Error(`Instagram post not found: ${eventId}`);
  }
  const { post, account, source, settings } = data;

  if (!post.localImageStorageId) {
    throw new Error('Post does not have a stored image. Image must be downloaded first.');
  }

  const { provider, apiKey, model, module } = resolveProvider(settings);
  job.log(`Using ${provider.toUpperCase()} AI provider`);

  const timestamp = resolveTimestamp(post.raw, post.scrapedAt);

  // Download the poster image from Convex storage to a temp file.
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'eventscrape-review-'));
  const ext = (post.localImageContentType || 'image/jpeg').includes('png')
    ? '.png'
    : (post.localImageContentType || '').includes('webp')
      ? '.webp'
      : '.jpg';
  const tmpFile = path.join(tmpDir, `${post.instagramPostId || 'poster'}${ext}`);

  try {
    const bytes = await downloadFromConvexStorage(post.localImageStorageId);
    await writeFile(tmpFile, bytes);

    if (mode === 'classify') {
      const classification = await module.classifyEventFromImageFile(tmpFile, apiKey, {
        caption: post.instagramCaption || undefined,
        postTimestamp: timestamp,
        model,
      });

      const confidence =
        typeof classification.confidence === 'number' ? classification.confidence : undefined;

      job.log(
        `[AI] Classified ${eventId}: isEvent=${classification.isEventPoster}, confidence=${confidence ?? 'n/a'}`,
      );

      // 1) Persist isEventPoster + confidence (mirrors the original UPDATE).
      await convex.mutation(classifyRef, {
        id: eventId,
        isEventPoster: !!classification.isEventPoster,
        classificationConfidence: confidence,
      });

      // 2) Merge the classification envelope into raw.classification[provider]
      //    (mirrors mergeClassificationIntoRaw in ai-classification.ts).
      const baseRaw =
        post.raw && typeof post.raw === 'object' ? { ...post.raw } : {};
      const existingClassification =
        baseRaw.classification && typeof baseRaw.classification === 'object'
          ? { ...baseRaw.classification }
          : {};
      const mergedRaw = {
        ...baseRaw,
        classification: {
          ...existingClassification,
          [provider]: {
            ...classification,
            decidedAt: new Date().toISOString(),
            method: provider,
          },
        },
      };

      await convex.mutation(persistExtractionRef, {
        id: eventId,
        raw: mergedRaw,
        isEventPoster: !!classification.isEventPoster,
        classificationConfidence: confidence,
      });

      job.log(`Classification persisted for ${eventId}`);
      return;
    }

    // mode === 'extract'
    if (!overwrite && hasExtractedEvents(post.raw)) {
      throw new Error('Post already has extracted data. Set overwrite=true to re-extract.');
    }

    const extraction = await module.extractEventFromImageFile(tmpFile, apiKey, {
      caption: post.instagramCaption || undefined,
      postTimestamp: timestamp,
      model,
    });

    const defaultTimezone =
      account?.defaultTimezone || source.defaultTimezone || 'America/Vancouver';

    // Build the raw envelope and persist it onto the base post (mirrors the
    // API's `db.update(eventsRaw).set({ raw })`).
    const rawData = {
      ...extraction,
      aiProvider: provider,
      instagram: {
        timestamp: timestamp.toISOString(),
        postId: post.instagramPostId,
        caption: post.instagramCaption,
        imageUrl: post.imageUrl,
        localImagePath: post.localImagePath,
      },
    };

    await convex.mutation(persistExtractionRef, { id: eventId, raw: rawData });

    let eventsCreated = 0;
    const events: any[] = Array.isArray(extraction.events) ? extraction.events : [];

    if (createEvents && events.length > 0) {
      if (!post.runId) {
        throw new Error('Post is missing runId; cannot create extracted events');
      }
      if (!post.instagramAccountId || !post.instagramPostId) {
        throw new Error('Post is missing account/postId; cannot create extracted events');
      }

      for (const [eventIndex, event] of events.entries()) {
        const timezone = event.timezone || defaultTimezone;
        const startLocal = `${event.startDate}T${event.startTime || '00:00:00'}`;
        const endLocal = event.endDate
          ? `${event.endDate}T${event.endTime || '23:59:59'}`
          : null;

        const startMs = toUtcMs(startLocal, timezone);
        const endMs = endLocal ? toUtcMs(endLocal, timezone) : undefined;

        await workerApi.insertExtractedEvent({
          runId: post.runId,
          accountId: post.instagramAccountId,
          postId: post.instagramPostId,
          eventIndex,
          title: event.title,
          descriptionHtml: event.description || '',
          startDatetime: startMs,
          endDatetime: endMs,
          timezone,
          venueName: event.venue?.name ?? undefined,
          venueAddress: event.venue?.address ?? undefined,
          city: event.venue?.city ?? undefined,
          region: event.venue?.region ?? undefined,
          country: event.venue?.country ?? undefined,
          organizer: event.organizer ?? undefined,
          category: event.category ?? undefined,
          price: event.price ?? undefined,
          tags: event.tags ?? undefined,
          url: post.url || `https://instagram.com/p/${post.instagramPostId}/`,
          imageUrl: post.imageUrl ?? undefined,
          caption: post.instagramCaption ?? undefined,
          localImagePath: post.localImagePath ?? undefined,
          localImageStorageId: post.localImageStorageId ?? undefined,
          localImageContentType: post.localImageContentType ?? undefined,
          localImageSize: post.localImageSize ?? undefined,
          classificationConfidence: post.classificationConfidence ?? undefined,
          isEventPoster: true,
          raw: rawData,
        });

        eventsCreated++;
      }
    }

    job.log(`Extracted ${events.length} event(s), created ${eventsCreated} record(s) for ${eventId}`);
  } finally {
    // Clean up the temp file + dir.
    await unlink(tmpFile).catch(() => undefined);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
