import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { instagramSettings } from '../db/schema.js';

const SETTINGS_ID = '00000000-0000-0000-0000-000000000001'; // Singleton settings

const updateSettingsSchema = z.object({
  apifyApiToken: z.string().optional(),
  geminiApiKey: z.string().optional(),
  apifyActorId: z.string().optional(),
  apifyResultsLimit: z.number().int().positive().optional(),
  fetchDelayMinutes: z.number().int().positive().optional(),
  autoExtractNewPosts: z.boolean().optional(),
});

export const instagramSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/instagram-settings - Get Instagram settings
  fastify.get('/', async (request, reply) => {
    try {
      const [settings] = await db
        .select({
          id: instagramSettings.id,
          apifyActorId: instagramSettings.apifyActorId,
          apifyResultsLimit: instagramSettings.apifyResultsLimit,
          fetchDelayMinutes: instagramSettings.fetchDelayMinutes,
          autoExtractNewPosts: instagramSettings.autoExtractNewPosts,
          hasApifyToken: instagramSettings.apifyApiToken,
          hasGeminiKey: instagramSettings.geminiApiKey,
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
            hasApifyToken: instagramSettings.apifyApiToken,
            hasGeminiKey: instagramSettings.geminiApiKey,
            createdAt: instagramSettings.createdAt,
            updatedAt: instagramSettings.updatedAt,
          });

        return {
          settings: {
            ...newSettings,
            hasApifyToken: !!newSettings.hasApifyToken,
            hasGeminiKey: !!newSettings.hasGeminiKey,
          },
        };
      }

      return {
        settings: {
          ...settings,
          hasApifyToken: !!settings.hasApifyToken,
          hasGeminiKey: !!settings.hasGeminiKey,
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
      if (data.apifyActorId !== undefined) updateData.apifyActorId = data.apifyActorId;
      if (data.apifyResultsLimit !== undefined) updateData.apifyResultsLimit = data.apifyResultsLimit;
      if (data.fetchDelayMinutes !== undefined) updateData.fetchDelayMinutes = data.fetchDelayMinutes;
      if (data.autoExtractNewPosts !== undefined) updateData.autoExtractNewPosts = data.autoExtractNewPosts;

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
          hasApifyToken: instagramSettings.apifyApiToken,
          hasGeminiKey: instagramSettings.geminiApiKey,
          createdAt: instagramSettings.createdAt,
          updatedAt: instagramSettings.updatedAt,
        });

      return {
        settings: {
          ...updated,
          hasApifyToken: !!updated.hasApifyToken,
          hasGeminiKey: !!updated.hasGeminiKey,
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
        })
        .from(instagramSettings)
        .where(eq(instagramSettings.id, SETTINGS_ID));

      if (!settings) {
        return { apifyApiToken: null, geminiApiKey: null };
      }

      return settings;
    } catch (error: any) {
      fastify.log.error('Failed to fetch API keys:', error);
      reply.status(500);
      return { error: 'Failed to fetch API keys' };
    }
  });
};
