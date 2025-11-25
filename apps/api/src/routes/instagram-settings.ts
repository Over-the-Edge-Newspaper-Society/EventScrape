import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { instagramSettings, systemSettings } from '../db/schema.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSystemSettings, updateSystemSettings, SYSTEM_SETTINGS_ID } from '../services/system-settings.js';

const INSTAGRAM_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'; // Singleton settings

const updateSettingsSchema = z.object({
  apifyApiToken: z.string().optional(),
  geminiApiKey: z.string().optional(),
  claudeApiKey: z.string().optional(),
  aiProvider: z.enum(['gemini', 'claude']).optional(),
  geminiPrompt: z.string().optional(),
  claudePrompt: z.string().optional(),
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
          aiProvider: instagramSettings.aiProvider,
          geminiPrompt: instagramSettings.geminiPrompt,
          claudePrompt: instagramSettings.claudePrompt,
          hasApifyToken: instagramSettings.apifyApiToken,
          hasGeminiKey: instagramSettings.geminiApiKey,
          hasClaudeKey: instagramSettings.claudeApiKey,
          defaultScraperType: instagramSettings.defaultScraperType,
          allowPerAccountOverride: instagramSettings.allowPerAccountOverride,
          createdAt: instagramSettings.createdAt,
          updatedAt: instagramSettings.updatedAt,
        })
        .from(instagramSettings)
        .where(eq(instagramSettings.id, INSTAGRAM_SETTINGS_ID));

      const globalSettings = await ensureSystemSettings();

      if (!settings) {
        // Create default settings if not exists
        const [newSettings] = await db
          .insert(instagramSettings)
          .values({ id: INSTAGRAM_SETTINGS_ID })
          .returning({
            id: instagramSettings.id,
            apifyActorId: instagramSettings.apifyActorId,
            apifyResultsLimit: instagramSettings.apifyResultsLimit,
            fetchDelayMinutes: instagramSettings.fetchDelayMinutes,
            autoExtractNewPosts: instagramSettings.autoExtractNewPosts,
            autoClassifyWithAi: instagramSettings.autoClassifyWithAi,
            aiProvider: instagramSettings.aiProvider,
            geminiPrompt: instagramSettings.geminiPrompt ?? defaultPrompt,
            claudePrompt: instagramSettings.claudePrompt,
            hasApifyToken: instagramSettings.apifyApiToken,
            hasGeminiKey: instagramSettings.geminiApiKey,
            hasClaudeKey: instagramSettings.claudeApiKey,
            defaultScraperType: instagramSettings.defaultScraperType,
            allowPerAccountOverride: instagramSettings.allowPerAccountOverride,
            createdAt: instagramSettings.createdAt,
            updatedAt: instagramSettings.updatedAt,
          });

        return {
          settings: {
            ...newSettings,
            aiProvider: globalSettings.aiProvider || newSettings.aiProvider || 'gemini',
            hasApifyToken: !!newSettings.hasApifyToken,
            hasGeminiKey: !!(globalSettings.geminiApiKey || newSettings.hasGeminiKey),
            hasClaudeKey: !!(globalSettings.claudeApiKey || newSettings.hasClaudeKey),
            geminiPrompt: newSettings.geminiPrompt ?? defaultPrompt,
          },
        };
      }

      return {
        settings: {
          ...settings,
          aiProvider: globalSettings.aiProvider || settings.aiProvider || 'gemini',
          hasApifyToken: !!settings.hasApifyToken,
          hasGeminiKey: !!(globalSettings.geminiApiKey || settings.hasGeminiKey),
          hasClaudeKey: !!(globalSettings.claudeApiKey || settings.hasClaudeKey),
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
      if (data.claudeApiKey !== undefined) updateData.claudeApiKey = data.claudeApiKey;
      if (data.aiProvider !== undefined) updateData.aiProvider = data.aiProvider;
      if (data.geminiPrompt !== undefined) updateData.geminiPrompt = data.geminiPrompt;
      if (data.claudePrompt !== undefined) updateData.claudePrompt = data.claudePrompt;
      if (data.apifyActorId !== undefined) updateData.apifyActorId = data.apifyActorId;
      if (data.apifyResultsLimit !== undefined) updateData.apifyResultsLimit = data.apifyResultsLimit;
      if (data.fetchDelayMinutes !== undefined) updateData.fetchDelayMinutes = data.fetchDelayMinutes;
      if (data.autoExtractNewPosts !== undefined) updateData.autoExtractNewPosts = data.autoExtractNewPosts;
      if (data.autoClassifyWithAi !== undefined) updateData.autoClassifyWithAi = data.autoClassifyWithAi;
      if (data.defaultScraperType !== undefined) updateData.defaultScraperType = data.defaultScraperType;
      if (data.allowPerAccountOverride !== undefined) updateData.allowPerAccountOverride = data.allowPerAccountOverride;

      // Apply any global AI updates first
      const globalUpdates: any = {};
      if (data.aiProvider !== undefined) globalUpdates.aiProvider = data.aiProvider;
      if (data.geminiApiKey !== undefined) globalUpdates.geminiApiKey = data.geminiApiKey;
      if (data.claudeApiKey !== undefined) globalUpdates.claudeApiKey = data.claudeApiKey;
      if (Object.keys(globalUpdates).length > 0) {
        await updateSystemSettings(globalUpdates);
      }

      const [updated] = await db
        .update(instagramSettings)
        .set(updateData)
        .where(eq(instagramSettings.id, INSTAGRAM_SETTINGS_ID))
        .returning({
          id: instagramSettings.id,
          apifyActorId: instagramSettings.apifyActorId,
          apifyResultsLimit: instagramSettings.apifyResultsLimit,
          fetchDelayMinutes: instagramSettings.fetchDelayMinutes,
          autoExtractNewPosts: instagramSettings.autoExtractNewPosts,
          autoClassifyWithAi: instagramSettings.autoClassifyWithAi,
          aiProvider: instagramSettings.aiProvider,
          geminiPrompt: instagramSettings.geminiPrompt,
          claudePrompt: instagramSettings.claudePrompt,
          hasApifyToken: instagramSettings.apifyApiToken,
          hasGeminiKey: instagramSettings.geminiApiKey,
          hasClaudeKey: instagramSettings.claudeApiKey,
          defaultScraperType: instagramSettings.defaultScraperType,
          allowPerAccountOverride: instagramSettings.allowPerAccountOverride,
          createdAt: instagramSettings.createdAt,
          updatedAt: instagramSettings.updatedAt,
        });

      const defaultPrompt = await getDefaultGeminiPrompt();
      const globalSettings = await ensureSystemSettings();

      return {
        settings: {
          ...updated,
          aiProvider: globalSettings.aiProvider || updated.aiProvider || 'gemini',
          hasApifyToken: !!updated.hasApifyToken,
          hasGeminiKey: !!(globalSettings.geminiApiKey || updated.hasGeminiKey),
          hasClaudeKey: !!(globalSettings.claudeApiKey || updated.hasClaudeKey),
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
        .where(eq(instagramSettings.id, INSTAGRAM_SETTINGS_ID));

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
      await updateSystemSettings({ geminiApiKey: null as any });
      await db
        .update(instagramSettings)
        .set({ geminiApiKey: null, updatedAt: new Date() })
        .where(eq(instagramSettings.id, INSTAGRAM_SETTINGS_ID));

      return { message: 'Gemini API key removed successfully' };
    } catch (error: any) {
      fastify.log.error('Failed to remove Gemini key:', error);
      reply.status(500);
      return { error: 'Failed to remove Gemini key' };
    }
  });

  // DELETE /api/instagram-settings/claude-key - Remove Claude key
  fastify.delete('/claude-key', async (request, reply) => {
    try {
      await updateSystemSettings({ claudeApiKey: null as any });
      await db
        .update(instagramSettings)
        .set({ claudeApiKey: null, updatedAt: new Date() })
        .where(eq(instagramSettings.id, INSTAGRAM_SETTINGS_ID));

      return { message: 'Claude API key removed successfully' };
    } catch (error: any) {
      fastify.log.error('Failed to remove Claude key:', error);
      reply.status(500);
      return { error: 'Failed to remove Claude key' };
    }
  });

  // GET /api/instagram-settings/keys - Get API keys for worker (internal use)
  fastify.get('/keys', async (request, reply) => {
    try {
      const [igSettings] = await db
        .select({
          apifyApiToken: instagramSettings.apifyApiToken,
          geminiApiKey: instagramSettings.geminiApiKey,
          claudeApiKey: instagramSettings.claudeApiKey,
          geminiPrompt: instagramSettings.geminiPrompt,
          claudePrompt: instagramSettings.claudePrompt,
        })
        .from(instagramSettings)
        .where(eq(instagramSettings.id, INSTAGRAM_SETTINGS_ID));

      const globalSettings = await db
        .select({
          geminiApiKey: systemSettings.geminiApiKey,
          claudeApiKey: systemSettings.claudeApiKey,
        })
        .from(systemSettings)
        .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
        .limit(1);

      const global = globalSettings[0];

      if (!igSettings && !global) {
        return {
          apifyApiToken: null,
          geminiApiKey: null,
          claudeApiKey: null,
          geminiPrompt: null,
          claudePrompt: null,
        };
      }

      return {
        apifyApiToken: igSettings?.apifyApiToken ?? null,
        geminiApiKey: (global?.geminiApiKey ?? igSettings?.geminiApiKey) ?? null,
        claudeApiKey: (global?.claudeApiKey ?? igSettings?.claudeApiKey) ?? null,
        geminiPrompt: igSettings?.geminiPrompt ?? null,
        claudePrompt: igSettings?.claudePrompt ?? null,
      };
    } catch (error: any) {
      fastify.log.error('Failed to fetch API keys:', error);
      reply.status(500);
      return { error: 'Failed to fetch API keys' };
    }
  });
};
