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
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const bodySchema = z.object({
  content: z.string().min(2, 'JSON content is required'),
  testMode: z.boolean().optional(),
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const POSTER_PROMPT_PATH = path.resolve(__dirname, '../assets/gemini-prompt.md')
let posterPromptCache: string | null = null

async function loadPosterPrompt(): Promise<string> {
  if (posterPromptCache !== null) return posterPromptCache
  try {
    posterPromptCache = await fs.readFile(POSTER_PROMPT_PATH, 'utf-8')
  } catch (error) {
    console.warn('[PosterImport] Failed to load Gemini poster prompt:', error)
    posterPromptCache = ''
  }
  return posterPromptCache
}

async function getGeminiApiKey(): Promise<string> {
  const [global] = await db
    .select({ geminiApiKey: systemSettings.geminiApiKey })
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
    .limit(1)

  const [settings] = await db
    .select({ geminiApiKey: instagramSettings.geminiApiKey })
    .from(instagramSettings)
    .where(eq(instagramSettings.id, '00000000-0000-0000-0000-000000000001'))
    .limit(1)

  const apiKey = global?.geminiApiKey || settings?.geminiApiKey || process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('Gemini API key not configured')
  }
  return apiKey
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

function parseJsonFromText<T>(rawText: string): T {
  const cleaned = cleanResponseText(rawText)
  if (!cleaned) {
    throw new Error('Gemini response did not include any JSON content')
  }

  try {
    return JSON.parse(cleaned) as T
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T
    }
    throw new Error('Failed to parse Gemini response as JSON')
  }
}

async function extractPosterEventsFromImage(
  imageBuffer: Buffer,
  mimeType: string,
  options: { pictureDateIso?: string } = {},
): Promise<{ events: any[]; extractionConfidence?: any }> {
  const apiKey = await getGeminiApiKey()
  const prompt = await loadPosterPrompt()

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

  const parsed = parseJsonFromText<{ events: any[]; extractionConfidence?: any }>(text)

  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error('Gemini response JSON is missing events array')
  }

  return parsed
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

      const source = await ensureAiPosterImportSource()

      const { events, extractionConfidence } = await extractPosterEventsFromImage(imageBuffer, mimeType, {
        pictureDateIso,
      })

      const payload = {
        events,
        extractionConfidence,
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
        message: 'Poster image submitted for AI extraction',
        runId,
        jobId: job.id,
        source,
        eventsPreviewCount: events.length,
      }
    } catch (error: any) {
      fastify.log.error('Poster import error:', error)
      reply.status(400)
      return { error: error?.message || 'Invalid request' }
    }
  })
}
