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

// Cache for OpenRouter models (5 minute TTL)
let openrouterModelsCache: { models: OpenRouterModel[]; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

interface OpenRouterModel {
  id: string
  name: string
  description?: string
  pricing?: {
    prompt?: string
    completion?: string
  }
  context_length?: number
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
  }
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[]
}

async function fetchOpenRouterVisionModels(): Promise<OpenRouterModel[]> {
  // Check cache
  if (openrouterModelsCache && Date.now() - openrouterModelsCache.fetchedAt < CACHE_TTL_MS) {
    return openrouterModelsCache.models
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}`)
    }

    const data = await response.json() as OpenRouterModelsResponse

    // Filter for vision-capable models (input_modalities includes 'image')
    const visionModels = data.data.filter((model) => {
      const inputModalities = model.architecture?.input_modalities || []
      return inputModalities.includes('image')
    })

    // Sort by name for easier browsing
    visionModels.sort((a, b) => a.name.localeCompare(b.name))

    // Cache the results
    openrouterModelsCache = {
      models: visionModels,
      fetchedAt: Date.now(),
    }

    return visionModels
  } catch (error) {
    console.error('[SystemSettings] Failed to fetch OpenRouter models:', error)
    // Return cached data if available, even if stale
    if (openrouterModelsCache) {
      return openrouterModelsCache.models
    }
    // Return fallback models if no cache
    return [
      { id: 'google/gemini-2.0-flash-exp', name: 'Google: Gemini 2.0 Flash (Experimental)' },
      { id: 'anthropic/claude-sonnet-4', name: 'Anthropic: Claude Sonnet 4' },
      { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' },
    ]
  }
}

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

  // Get OpenRouter vision-capable models
  fastify.get('/openrouter-models', async () => {
    const models = await fetchOpenRouterVisionModels()

    return {
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        contextLength: m.context_length,
        pricing: m.pricing,
      })),
    }
  })
}
