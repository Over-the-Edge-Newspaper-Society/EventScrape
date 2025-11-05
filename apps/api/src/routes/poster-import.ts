import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection.js'
import { sources, runs } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { enqueueScrapeJob } from '../queue/queue.js'
import { ensureSystemSettings } from '../services/system-settings.js'

const bodySchema = z.object({
  content: z.string().min(2, 'JSON content is required'),
  testMode: z.boolean().optional(),
})

export const posterImportRoutes: FastifyPluginAsync = async (fastify) => {
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
          .set({ active: true, updatedAt: new Date(), notes: (source.notes || '') + ' (Reactivated for Poster Import)' })
          .where(eq(sources.id, source.id))
          .returning()
      }

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
}
