import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection.js'
import { schedules, sources, wordpressSettings, exports } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { registerSchedule, unregisterScheduleByKey, triggerScheduleNow } from '../queue/scheduler.js'

const createSchema = z.discriminatedUnion('scheduleType', [
  z.object({
    scheduleType: z.literal('scrape'),
    sourceId: z.string().uuid(),
    cron: z.string().min(5),
    timezone: z.string().optional().default('America/Vancouver'),
    active: z.boolean().optional().default(true),
  }),
  z.object({
    scheduleType: z.literal('wordpress_export'),
    wordpressSettingsId: z.string().uuid(),
    cron: z.string().min(5),
    timezone: z.string().optional().default('America/Vancouver'),
    active: z.boolean().optional().default(true),
    config: z.object({
      sourceIds: z.array(z.string().uuid()).optional(),
      startDateOffset: z.number().optional(), // Days from now, e.g., -7 for last 7 days
      endDateOffset: z.number().optional(),
      city: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(['publish', 'draft', 'pending']).optional().default('draft'),
    }).optional(),
  }),
  z.object({
    scheduleType: z.literal('instagram_scrape'),
    cron: z.string().min(5),
    timezone: z.string().optional().default('America/Vancouver'),
    active: z.boolean().optional().default(true),
    config: z.object({
      scope: z.enum(['all_active', 'all_inactive', 'custom']).optional(),
      accountIds: z.array(z.string().uuid()).optional(),
      postLimit: z.number().min(1).max(100).optional(),
      batchSize: z.number().min(1).max(25).optional(),
      accountLimit: z.number().min(1).optional(),
    }).optional(),
  }),
])

const updateSchema = z.object({
  cron: z.string().min(5).optional(),
  timezone: z.string().optional(),
  active: z.boolean().optional(),
  config: z.any().optional(),
})

export const schedulesRoutes: FastifyPluginAsync = async (fastify) => {
  // List schedules
  fastify.get('/', async () => {
    const rows = await db
      .select({
        schedule: schedules,
        source: { id: sources.id, name: sources.name, moduleKey: sources.moduleKey },
        wordpressSettings: { id: wordpressSettings.id, name: wordpressSettings.name, siteUrl: wordpressSettings.siteUrl },
      })
      .from(schedules)
      .leftJoin(sources, eq(schedules.sourceId, sources.id))
      .leftJoin(wordpressSettings, eq(schedules.wordpressSettingsId, wordpressSettings.id))
    return { schedules: rows }
  })

  // Create schedule
  fastify.post('/', async (request, reply) => {
    try {
      const data = createSchema.parse(request.body)

      const values: any = {
        scheduleType: data.scheduleType,
        cron: data.cron,
        timezone: data.timezone,
        active: data.active,
      }

      if (data.scheduleType === 'scrape') {
        values.sourceId = data.sourceId
      } else if (data.scheduleType === 'wordpress_export') {
        values.wordpressSettingsId = data.wordpressSettingsId
        values.config = data.config
      } else if (data.scheduleType === 'instagram_scrape') {
        const config = {
          ...(data.config || {}),
        }
        const scope = config.scope ?? 'all_active'
        if (scope === 'custom' && (!config.accountIds || config.accountIds.length === 0)) {
          reply.status(400)
          return { error: 'Custom Instagram schedules require at least one account' }
        }
        values.config = { ...config, scope }
      }

      const [row] = await db.insert(schedules).values(values).returning()

      if (row.active) {
        await registerSchedule({
          id: row.id,
          scheduleType: row.scheduleType,
          sourceId: row.sourceId || undefined,
          wordpressSettingsId: row.wordpressSettingsId || undefined,
          cron: row.cron,
          timezone: row.timezone || undefined,
          config: row.config || undefined,
        })
      }
      reply.status(201)
      return { schedule: row }
    } catch (e: any) {
      reply.status(400)
      return { error: e?.message || 'Invalid request' }
    }
  })

  // Update schedule
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const data = updateSchema.parse(request.body)
      const [existing] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1)
      if (!existing) { reply.status(404); return { error: 'Schedule not found' } }

      // If disabling, unregister
      if (data.active === false) {
        await unregisterScheduleByKey(existing.repeatKey, {
          scheduleId: existing.id,
          cron: existing.cron,
          timezone: existing.timezone,
        })
      }

      const [updated] = await db.update(schedules).set({
        cron: data.cron ?? existing.cron,
        timezone: data.timezone ?? existing.timezone,
        active: data.active ?? existing.active,
        config: data.config ?? existing.config,
        updatedAt: new Date(),
      }).where(eq(schedules.id, id)).returning()

      if (updated.active) {
        await registerSchedule({
          id: updated.id,
          scheduleType: updated.scheduleType,
          sourceId: updated.sourceId || undefined,
          wordpressSettingsId: updated.wordpressSettingsId || undefined,
          cron: updated.cron,
          timezone: updated.timezone || undefined,
          config: updated.config || undefined,
        })
      }
      return { schedule: updated }
    } catch (e: any) {
      reply.status(400)
      return { error: e?.message || 'Invalid request' }
    }
  })

  // Delete schedule
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const [existing] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1)
      if (!existing) { reply.status(404); return { error: 'Schedule not found' } }

      // Unregister from queue
      await unregisterScheduleByKey(existing.repeatKey, {
        scheduleId: existing.id,
        cron: existing.cron,
        timezone: existing.timezone,
      })

      // First, set schedule_id to NULL in any related exports to preserve export history
      await db.update(exports).set({ scheduleId: null }).where(eq(exports.scheduleId, id))

      // Now delete the schedule
      await db.delete(schedules).where(eq(schedules.id, id))

      reply.status(204)
      return
    } catch (e: any) {
      fastify.log.error(e)
      reply.status(500)
      return { error: e?.message || 'Failed to delete schedule' }
    }
  })

  // Trigger schedule now
  fastify.post('/:id/trigger', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const [schedule] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1)
      if (!schedule) {
        reply.status(404)
        return { error: 'Schedule not found' }
      }

      // Trigger the schedule immediately
      await triggerScheduleNow({
        scheduleId: schedule.id,
        scheduleType: schedule.scheduleType,
        sourceId: schedule.sourceId || undefined,
        wordpressSettingsId: schedule.wordpressSettingsId || undefined,
        config: schedule.config || undefined,
      })

      reply.status(200)
      return { message: 'Schedule triggered successfully', scheduleId: schedule.id }
    } catch (e: any) {
      reply.status(500)
      return { error: e?.message || 'Failed to trigger schedule' }
    }
  })

  // Trigger all active schedules
  fastify.post('/trigger-all-active', async (_req, reply) => {
    try {
      const activeSchedules = await db.select().from(schedules).where(eq(schedules.active, true))

      if (activeSchedules.length === 0) {
        return { message: 'No active schedules found', triggered: [] }
      }

      const triggered = []
      for (const schedule of activeSchedules) {
        try {
          await triggerScheduleNow({
            scheduleId: schedule.id,
            scheduleType: schedule.scheduleType,
            sourceId: schedule.sourceId || undefined,
            wordpressSettingsId: schedule.wordpressSettingsId || undefined,
            config: schedule.config || undefined,
          })
          triggered.push({ id: schedule.id, type: schedule.scheduleType, status: 'triggered' })
        } catch (err: any) {
          triggered.push({ id: schedule.id, type: schedule.scheduleType, status: 'failed', error: err.message })
        }
      }

      reply.status(200)
      return {
        message: `Triggered ${triggered.length} active schedules`,
        triggered
      }
    } catch (e: any) {
      reply.status(500)
      return { error: e?.message || 'Failed to trigger schedules' }
    }
  })
}
