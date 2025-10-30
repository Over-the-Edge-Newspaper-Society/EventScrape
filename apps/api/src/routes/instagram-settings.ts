import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { instagramSettings } from '../db/schema.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001'; // Singleton settings

const updateSettingsSchema = z.object({
  apifyApiToken: z.string().optional(),
  geminiApiKey: z.string().optional(),
  geminiPrompt: z.string().optional(),
  apifyActorId: z.string().optional(),
  apifyResultsLimit: z.number().int().positive().optional(),
  fetchDelayMinutes: z.number().int().positive().optional(),
  autoExtractNewPosts: z.boolean().optional(),
  autoClassifyWithAi: z.boolean().optional(),
  defaultScraperType: z.enum(['apify', 'instagram-private-api']).optional(),
  allowPerAccountOverride: z.boolean().optional(),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROMPT_PATH = path.resolve(__dirname, '../assets/gemini-prompt.md');
let defaultGeminiPrompt: string | null = null;

async function getDefaultGeminiPrompt() {
  if (defaultGeminiPrompt !== null) {
    return defaultGeminiPrompt;
  }

  try {
    defaultGeminiPrompt = await fs.readFile(DEFAULT_PROMPT_PATH, 'utf-8');
  } catch (error) {
    console.warn('[InstagramSettings] Failed to load default Gemini prompt:', error);
    defaultGeminiPrompt = '';
  }
  return defaultGeminiPrompt;
}

export const instagramSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/instagram-settings - Get Instagram settings
  fastify.get('/', async (request, reply) => {
    try {
      const defaultPrompt = await getDefaultGeminiPrompt();
      const [settings] = await db
        .select({
          id: instagramSettings.id,
          apifyActorId: instagramSettings.apifyActorId,
          apifyResultsLimit: instagramSettings.apifyResultsLimit,
          fetchDelayMinutes: instagramSettings.fetchDelayMinutes,
          autoExtractNewPosts: instagramSettings.autoExtractNewPosts,
          autoClassifyWithAi: instagramSettings.autoClassifyWithAi,
          geminiPrompt: instagramSettings.geminiPrompt,
          hasApifyToken: instagramSettings.apifyApiToken,
          hasGeminiKey: instagramSettings.geminiApiKey,
          defaultScraperType: instagramSettings.defaultScraperType,
          allowPerAccountOverride: instagramSettings.allowPerAccountOverride,
          createdAt: instagramSettings.createdAt,
          updatedAt: instagramSettings.updatedAt,
        })
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      if (!settings) {
        // Create default settings if not exists
        const [newSettings] = await db
          .insert(instagramSettings)
          .values({ id: SETTINGS_ID })
          .returning({
            id: instagramSettings.id,
            apifyActorId: instagramSettings.apifyActorId,
            apifyResultsLimit: instagramSettings.apifyResultsLimit,
            fetchDelayMinutes: instagramSettings.fetchDelayMinutes,
            autoExtractNewPosts: instagramSettings.autoExtractNewPosts,
            autoClassifyWithAi: instagramSettings.autoClassifyWithAi,
            geminiPrompt: instagramSettings.geminiPrompt ?? defaultPrompt,
            hasApifyToken: instagramSettings.apifyApiToken,
            hasGeminiKey: instagramSettings.geminiApiKey,
            defaultScraperType: instagramSettings.defaultScraperType,
            allowPerAccountOverride: instagramSettings.allowPerAccountOverride,
            createdAt: instagramSettings.createdAt,
            updatedAt: instagramSettings.updatedAt,
          });

        return {
          settings: {
            ...newSettings,
            hasApifyToken: !!newSettings.hasApifyToken,
            hasGeminiKey: !!newSettings.hasGeminiKey,
            geminiPrompt: newSettings.geminiPrompt ?? defaultPrompt,
          },
        };
      }

      return {
        settings: {
          ...settings,
          hasApifyToken: !!settings.hasApifyToken,
          hasGeminiKey: !!settings.hasGeminiKey,
          geminiPrompt: settings.geminiPrompt ?? defaultPrompt,
        },
      };
    } catch (error: any) {
      fastify.log.error('Failed to fetch Instagram settings:', error);
      reply.status(500);
      return { error: 'Failed to fetch Instagram settings' };
    }
  });

  // PATCH /api/instagram-settings - Update Instagram settings
  fastify.patch('/', async (request, reply) => {
    try {
      const data = updateSettingsSchema.parse(request.body);

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (data.apifyApiToken !== undefined) updateData.apifyApiToken = data.apifyApiToken;
      if (data.geminiApiKey !== undefined) updateData.geminiApiKey = data.geminiApiKey;
      if (data.geminiPrompt !== undefined) updateData.geminiPrompt = data.geminiPrompt;
      if (data.apifyActorId !== undefined) updateData.apifyActorId = data.apifyActorId;
      if (data.apifyResultsLimit !== undefined) updateData.apifyResultsLimit = data.apifyResultsLimit;
      if (data.fetchDelayMinutes !== undefined) updateData.fetchDelayMinutes = data.fetchDelayMinutes;
      if (data.autoExtractNewPosts !== undefined) updateData.autoExtractNewPosts = data.autoExtractNewPosts;
      if (data.autoClassifyWithAi !== undefined) updateData.autoClassifyWithAi = data.autoClassifyWithAi;
      if (data.defaultScraperType !== undefined) updateData.defaultScraperType = data.defaultScraperType;
      if (data.allowPerAccountOverride !== undefined) updateData.allowPerAccountOverride = data.allowPerAccountOverride;

      const [updated] = await db
        .update(instagramSettings)
        .set(updateData)
        .where(eq(instagramSettings.id, SETTINGS_ID))
        .returning({
          id: instagramSettings.id,
          apifyActorId: instagramSettings.apifyActorId,
          apifyResultsLimit: instagramSettings.apifyResultsLimit,
          fetchDelayMinutes: instagramSettings.fetchDelayMinutes,
          autoExtractNewPosts: instagramSettings.autoExtractNewPosts,
          autoClassifyWithAi: instagramSettings.autoClassifyWithAi,
          geminiPrompt: instagramSettings.geminiPrompt,
          hasApifyToken: instagramSettings.apifyApiToken,
          hasGeminiKey: instagramSettings.geminiApiKey,
          defaultScraperType: instagramSettings.defaultScraperType,
          allowPerAccountOverride: instagramSettings.allowPerAccountOverride,
          createdAt: instagramSettings.createdAt,
          updatedAt: instagramSettings.updatedAt,
        });

      const defaultPrompt = await getDefaultGeminiPrompt();

      return {
        settings: {
          ...updated,
          hasApifyToken: !!updated.hasApifyToken,
          hasGeminiKey: !!updated.hasGeminiKey,
          geminiPrompt: updated.geminiPrompt ?? defaultPrompt,
        },
      };
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        reply.status(400);
        return { error: 'Validation error', details: error.errors };
      }

      fastify.log.error('Failed to update Instagram settings:', error);
      reply.status(500);
      return { error: 'Failed to update Instagram settings' };
    }
  });

  // DELETE /api/instagram-settings/apify-token - Remove Apify token
  fastify.delete('/apify-token', async (request, reply) => {
    try {
      await db
        .update(instagramSettings)
        .set({ apifyApiToken: null, updatedAt: new Date() })
        .where(eq(instagramSettings.id, SETTINGS_ID));

      return { message: 'Apify token removed successfully' };
    } catch (error: any) {
      fastify.log.error('Failed to remove Apify token:', error);
      reply.status(500);
      return { error: 'Failed to remove Apify token' };
    }
  });

  // DELETE /api/instagram-settings/gemini-key - Remove Gemini key
  fastify.delete('/gemini-key', async (request, reply) => {
    try {
      await db
        .update(instagramSettings)
        .set({ geminiApiKey: null, updatedAt: new Date() })
        .where(eq(instagramSettings.id, SETTINGS_ID));

      return { message: 'Gemini API key removed successfully' };
    } catch (error: any) {
      fastify.log.error('Failed to remove Gemini key:', error);
      reply.status(500);
      return { error: 'Failed to remove Gemini key' };
    }
  });

  // GET /api/instagram-settings/keys - Get API keys for worker (internal use)
  fastify.get('/keys', async (request, reply) => {
    try {
      const [settings] = await db
        .select({
          apifyApiToken: instagramSettings.apifyApiToken,
          geminiApiKey: instagramSettings.geminiApiKey,
          geminiPrompt: instagramSettings.geminiPrompt,
        })
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      if (!settings) {
        return { apifyApiToken: null, geminiApiKey: null, geminiPrompt: null };
      }

      return settings;
    } catch (error: any) {
      fastify.log.error('Failed to fetch API keys:', error);
      reply.status(500);
      return { error: 'Failed to fetch API keys' };
    }
  });
};
