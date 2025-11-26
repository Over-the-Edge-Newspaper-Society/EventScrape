import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { db } from '../db/connection.js'
import { sources, runs, instagramSettings, systemSettings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { enqueueScrapeJob } from '../queue/queue.js'
import { ensureSystemSettings, SYSTEM_SETTINGS_ID } from '../services/system-settings.js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

type AIProvider = 'gemini' | 'claude'

/**
 * Extract EXIF date from image buffer (JPEG/TIFF)
 * Returns ISO date string if found, null otherwise
 */
function extractExifDate(buffer: Buffer): string | null {
  try {
    // Look for EXIF marker in JPEG (0xFFE1)
    // EXIF data starts with "Exif\0\0" followed by TIFF header
    const exifMarker = buffer.indexOf(Buffer.from([0xFF, 0xE1]))
    if (exifMarker === -1) return null

    // Find DateTimeOriginal (tag 0x9003) or DateTime (tag 0x0132)
    // These are stored as ASCII strings in format "YYYY:MM:DD HH:MM:SS"
    const datePatterns = [
      /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g,
    ]

    // Search in a reasonable portion of the buffer (EXIF is usually at the start)
    const searchBuffer = buffer.subarray(0, Math.min(buffer.length, 65536))
    const text = searchBuffer.toString('binary')

    for (const pattern of datePatterns) {
      const match = pattern.exec(text)
      if (match) {
        const [, year, month, day, hour, minute, second] = match
        const yearNum = parseInt(year, 10)
        // Sanity check: year should be reasonable (1990-2100)
        if (yearNum >= 1990 && yearNum <= 2100) {
          return `${year}-${month}-${day}T${hour}:${minute}:${second}`
        }
      }
    }

    return null
  } catch (error) {
    console.warn('[PosterImport] Failed to extract EXIF date:', error)
    return null
  }
}

const bodySchema = z.object({
  content: z.string().min(2, 'JSON content is required'),
  testMode: z.boolean().optional(),
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const GEMINI_PROMPT_PATH = path.resolve(__dirname, '../assets/gemini-prompt.md')
// In compiled dist/, the worker modules are at ../worker/src/modules/instagram/
const CLAUDE_PROMPT_PATH = path.resolve(__dirname, '../worker/src/modules/instagram/claude-prompt.md')
let geminiPromptCache: string | null = null
let claudePromptCache: string | null = null

async function loadGeminiPrompt(): Promise<string> {
  if (geminiPromptCache !== null) return geminiPromptCache
  try {
    geminiPromptCache = await fs.readFile(GEMINI_PROMPT_PATH, 'utf-8')
  } catch (error) {
    console.warn('[PosterImport] Failed to load Gemini poster prompt:', error)
    geminiPromptCache = ''
  }
  return geminiPromptCache
}

async function loadClaudePrompt(): Promise<string> {
  if (claudePromptCache !== null) return claudePromptCache
  try {
    claudePromptCache = await fs.readFile(CLAUDE_PROMPT_PATH, 'utf-8')
  } catch (error) {
    console.warn('[PosterImport] Failed to load Claude poster prompt:', error)
    claudePromptCache = ''
  }
  return claudePromptCache
}

async function getAISettings(): Promise<{ provider: AIProvider; apiKey: string }> {
  const [global] = await db
    .select({
      aiProvider: systemSettings.aiProvider,
      geminiApiKey: systemSettings.geminiApiKey,
      claudeApiKey: systemSettings.claudeApiKey,
    })
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
    .limit(1)

  const [igSettings] = await db
    .select({
      aiProvider: instagramSettings.aiProvider,
      geminiApiKey: instagramSettings.geminiApiKey,
      claudeApiKey: instagramSettings.claudeApiKey,
    })
    .from(instagramSettings)
    .where(eq(instagramSettings.id, '00000000-0000-0000-0000-000000000001'))
    .limit(1)

  console.log('[PosterImport] AI Settings - global:', {
    aiProvider: global?.aiProvider,
    hasGeminiKey: !!global?.geminiApiKey,
    hasClaudeKey: !!global?.claudeApiKey,
  })
  console.log('[PosterImport] AI Settings - instagram:', {
    aiProvider: igSettings?.aiProvider,
    hasGeminiKey: !!igSettings?.geminiApiKey,
    hasClaudeKey: !!igSettings?.claudeApiKey,
  })

  const provider = (global?.aiProvider || igSettings?.aiProvider || 'gemini') as AIProvider
  console.log('[PosterImport] Selected provider:', provider)

  let apiKey: string | undefined
  if (provider === 'gemini') {
    apiKey = global?.geminiApiKey || igSettings?.geminiApiKey || process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('Gemini API key not configured')
    }
  } else {
    apiKey = global?.claudeApiKey || igSettings?.claudeApiKey || process.env.CLAUDE_API_KEY
    if (!apiKey) {
      throw new Error('Claude API key not configured. Please add your Claude API key in Settings.')
    }
  }

  return { provider, apiKey }
}

async function ensureAiPosterImportSource() {
  const moduleKey = 'ai_poster_import'
  const defaultSource = {
    name: 'AI Poster Import',
    baseUrl: 'https://ai-import.local/',
    moduleKey,
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'Auto-created for Poster Import uploads',
    rateLimitPerMin: 30,
    updatedAt: new Date(),
  }

  let [source] = await db.select().from(sources).where(eq(sources.moduleKey, moduleKey)).limit(1)
  if (!source) {
    ;[source] = await db.insert(sources).values(defaultSource as any).returning()
  } else if (!source.active) {
    ;[source] = await db
      .update(sources)
      .set({
        active: true,
        updatedAt: new Date(),
        notes: (source.notes || '') + ' (Reactivated for Poster Import)',
      })
      .where(eq(sources.id, source.id))
      .returning()
  }

  return source
}

function cleanResponseText(rawText: string): string {
  if (!rawText) return ''
  return rawText.replace(/```json/gi, '```').replace(/```/g, '').trim()
}

function parseJsonFromText<T>(rawText: string, providerName: string): T {
  const cleaned = cleanResponseText(rawText)
  if (!cleaned) {
    throw new Error(`${providerName} response did not include any JSON content`)
  }

  try {
    return JSON.parse(cleaned) as T
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T
    }
    throw new Error(`Failed to parse ${providerName} response as JSON`)
  }
}

async function extractWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  options: { pictureDateIso?: string } = {},
): Promise<{ events: any[]; extractionConfidence?: any }> {
  const prompt = await loadGeminiPrompt()

  const genAI = new GoogleGenerativeAI(apiKey)
  const modelId = process.env.GEMINI_MODEL_ID || 'gemini-2.0-flash-exp'
  const model = genAI.getGenerativeModel({ model: modelId })

  const parts: any[] = [
    {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType,
      },
    },
    { text: prompt },
  ]

  const contextSections: string[] = []

  if (options.pictureDateIso) {
    contextSections.push(
      `Poster photo capture date:\n` +
        `- The photo of this poster was taken on ${options.pictureDateIso}.\n` +
        `- When the poster only shows month/day (no year), infer the year relative to this date, preferring upcoming dates unless the poster clearly indicates an earlier year.`,
    )
  }

  if (contextSections.length > 0) {
    parts.push({ text: `Additional context:\n${contextSections.join('\n\n')}` })
  }

  const result = await model.generateContent(parts)
  const response = result.response
  const text = response.text()

  if (!text) {
    throw new Error('Gemini response did not include text output')
  }

  const parsed = parseJsonFromText<{ events: any[]; extractionConfidence?: any }>(text, 'Gemini')

  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error('Gemini response JSON is missing events array')
  }

  return parsed
}

async function extractWithClaude(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  options: { pictureDateIso?: string } = {},
): Promise<{ events: any[]; extractionConfidence?: any }> {
  const prompt = await loadClaudePrompt()

  const client = new Anthropic({ apiKey })
  const modelId = process.env.CLAUDE_MODEL_ID || 'claude-sonnet-4-5'

  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: imageBuffer.toString('base64'),
      },
    },
    {
      type: 'text',
      text: prompt,
    },
  ]

  const contextSections: string[] = []

  if (options.pictureDateIso) {
    contextSections.push(
      `Poster photo capture date:\n` +
        `- The photo of this poster was taken on ${options.pictureDateIso}.\n` +
        `- When the poster only shows month/day (no year), infer the year relative to this date, preferring upcoming dates unless the poster clearly indicates an earlier year.`,
    )
  }

  if (contextSections.length > 0) {
    content.push({
      type: 'text',
      text: `Additional context:\n${contextSections.join('\n\n')}`,
    })
  }

  const message = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  })

  const textContent = message.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claude response did not include text output')
  }

  const parsed = parseJsonFromText<{ events: any[]; extractionConfidence?: any }>(textContent.text, 'Claude')

  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error('Claude response JSON is missing events array')
  }

  return parsed
}

async function extractPosterEventsFromImage(
  imageBuffer: Buffer,
  mimeType: string,
  options: { pictureDateIso?: string } = {},
): Promise<{ events: any[]; extractionConfidence?: any; aiProvider: AIProvider }> {
  const { provider, apiKey } = await getAISettings()

  console.log(`[PosterImport] Using ${provider.toUpperCase()} AI provider for extraction`)

  if (provider === 'claude') {
    const result = await extractWithClaude(imageBuffer, mimeType, apiKey, options)
    return { ...result, aiProvider: provider }
  } else {
    const result = await extractWithGemini(imageBuffer, mimeType, apiKey, options)
    return { ...result, aiProvider: provider }
  }
}

export const posterImportRoutes: FastifyPluginAsync = async (fastify) => {
  if (!fastify.hasContentTypeParser('multipart/form-data')) {
    await fastify.register(multipart, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    })
  }

  // POST /api/poster-import
  fastify.post('/', async (request, reply) => {
    try {
      const { content, testMode } = bodySchema.parse(request.body)

      const settings = await ensureSystemSettings()
      if (!settings.posterImportEnabled) {
        reply.status(403)
        return { error: 'Poster import is disabled in system settings' }
      }

      // Ensure the AI Poster Import source exists (create if missing)
      const source = await ensureAiPosterImportSource()

      // Create a run
      const runId = uuidv4()
      await db.insert(runs).values({
        id: runId,
        sourceId: source.id,
        status: 'queued',
        startedAt: new Date(),
        eventsFound: 0,
        pagesCrawled: 0,
      })

      // Enqueue a job with the JSON content
      const job = await enqueueScrapeJob({
        sourceId: source.id,
        runId,
        moduleKey: source.moduleKey,
        sourceName: source.name,
        testMode: !!testMode,
        uploadedFile: {
          path: 'poster-import.json',
          format: 'json',
          content,
        },
      } as any)

      return {
        success: true,
        message: 'Poster JSON submitted for processing',
        runId,
        jobId: job.id,
        source,
      }
    } catch (error: any) {
      fastify.log.error('Poster import error:', error)
      reply.status(400)
      return { error: error?.message || 'Invalid request' }
    }
  })

  // POST /api/poster-import/image-ai
  fastify.post('/image-ai', async (request, reply) => {
    try {
      const settings = await ensureSystemSettings()
      if (!settings.posterImportEnabled) {
        reply.status(403)
        return { error: 'Poster import is disabled in system settings' }
      }

      const parts = request.parts()
      let imageBuffer: Buffer | null = null
      let mimeType = 'image/jpeg'
      let pictureDateIso: string | undefined
      let testMode = false

      for await (const part of parts) {
        if (part.type === 'file') {
          if (!imageBuffer) {
            imageBuffer = await part.toBuffer()
            mimeType = part.mimetype || mimeType
          }
        } else if (part.type === 'field') {
          if (part.fieldname === 'pictureDate' && typeof part.value === 'string' && part.value.trim().length > 0) {
            // Expect value like YYYY-MM-DD
            pictureDateIso = new Date(part.value).toISOString()
          }
          if (part.fieldname === 'testMode') {
            if (typeof part.value === 'string') {
              testMode = part.value === 'true' || part.value === '1'
            }
          }
        }
      }

      if (!imageBuffer) {
        reply.status(400)
        return { error: 'No image file uploaded' }
      }

      // Try to extract date from EXIF if not provided
      let dateSource: 'user' | 'exif' | 'none' = 'none'
      if (pictureDateIso) {
        dateSource = 'user'
      } else {
        const exifDate = extractExifDate(imageBuffer)
        if (exifDate) {
          pictureDateIso = new Date(exifDate).toISOString()
          dateSource = 'exif'
          console.log(`[PosterImport] Extracted date from EXIF: ${pictureDateIso}`)
        }
      }

      const source = await ensureAiPosterImportSource()

      const { events, extractionConfidence, aiProvider } = await extractPosterEventsFromImage(imageBuffer, mimeType, {
        pictureDateIso,
      })

      const payload = {
        events,
        extractionConfidence,
        aiProvider,
      }

      const runId = uuidv4()
      await db.insert(runs).values({
        id: runId,
        sourceId: source.id,
        status: 'queued',
        startedAt: new Date(),
        eventsFound: 0,
        pagesCrawled: 0,
      })

      const job = await enqueueScrapeJob({
        sourceId: source.id,
        runId,
        moduleKey: source.moduleKey,
        sourceName: source.name,
        testMode,
        uploadedFile: {
          path: 'poster-import-ai.json',
          format: 'json',
          content: JSON.stringify(payload),
        },
      } as any)

      return {
        success: true,
        message: `Poster image submitted for AI extraction using ${aiProvider.toUpperCase()}`,
        runId,
        jobId: job.id,
        source,
        eventsPreviewCount: events.length,
        aiProvider,
        dateSource,
        pictureDate: pictureDateIso || null,
      }
    } catch (error: any) {
      fastify.log.error('Poster import error:', error)
      reply.status(400)
      return { error: error?.message || 'Invalid request' }
    }
  })
}
