import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ensureSystemSettings, updateSystemSettings, cleanupDuplicateEvents } from '../services/system-settings.js'

const updateSchema = z.object({
  posterImportEnabled: z.boolean().optional(),
  aiProvider: z.enum(['gemini', 'claude', 'openrouter']).optional(),
  geminiApiKey: z.string().optional(),
  claudeApiKey: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  openrouterModel: z.string().optional(),
})

const cleanupDuplicatesSchema = z.object({
  sourceKey: z.string().optional(),
})

export const systemSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const settings = await ensureSystemSettings()

    const { geminiApiKey, claudeApiKey, openrouterApiKey, ...rest } = settings as any

    return {
      settings: {
        ...rest,
        aiProvider: rest.aiProvider || 'gemini',
        hasGeminiKey: !!geminiApiKey,
        hasClaudeKey: !!claudeApiKey,
        hasOpenrouterKey: !!openrouterApiKey,
        openrouterModel: rest.openrouterModel || 'google/gemini-2.0-flash-exp',
      },
    }
  })

  fastify.patch('/', async (request, reply) => {
    const payload = updateSchema.parse(request.body)

    if (Object.keys(payload).length === 0) {
      reply.status(400)
      return { error: 'No settings provided' }
    }

    const settings = await updateSystemSettings(payload)
    const { geminiApiKey, claudeApiKey, openrouterApiKey, ...rest } = settings as any

    return {
      settings: {
        ...rest,
        aiProvider: rest.aiProvider || 'gemini',
        hasGeminiKey: !!geminiApiKey,
        hasClaudeKey: !!claudeApiKey,
        hasOpenrouterKey: !!openrouterApiKey,
        openrouterModel: rest.openrouterModel || 'google/gemini-2.0-flash-exp',
      },
    }
  })

  fastify.post('/cleanup-duplicates', async (request) => {
    const payload = cleanupDuplicatesSchema.parse(request.body || {})
    const result = await cleanupDuplicateEvents(payload.sourceKey)

    return {
      success: true,
      message: `Cleaned up ${result.eventsRawDeleted} duplicate raw events and ${result.eventSeriesDeleted} duplicate event series`,
      ...result,
    }
  })
}
