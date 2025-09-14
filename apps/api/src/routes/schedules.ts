import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection.js'
import { schedules, sources } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { registerSchedule, unregisterScheduleByKey } from '../queue/scheduler.js'

const createSchema = z.object({
  sourceId: z.string().uuid(),
  cron: z.string().min(5),
  timezone: z.string().optional().default('America/Vancouver'),
  active: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  cron: z.string().min(5).optional(),
  timezone: z.string().optional(),
  active: z.boolean().optional(),
})

export const schedulesRoutes: FastifyPluginAsync = async (fastify) => {
  // List schedules
  fastify.get('/', async () => {
    const rows = await db
      .select({
        schedule: schedules,
        source: { id: sources.id, name: sources.name, moduleKey: sources.moduleKey },
      })
      .from(schedules)
      .leftJoin(sources, eq(schedules.sourceId, sources.id))
    return { schedules: rows }
  })

  // Create schedule
  fastify.post('/', async (request, reply) => {
    try {
      const data = createSchema.parse(request.body)
      const [row] = await db.insert(schedules).values({
        sourceId: data.sourceId,
        cron: data.cron,
        timezone: data.timezone,
        active: data.active,
      }).returning()

      if (row.active) {
        await registerSchedule({ id: row.id, sourceId: row.sourceId, cron: row.cron, timezone: row.timezone || undefined })
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
      if (data.active === false && existing.repeatKey) {
        await unregisterScheduleByKey(existing.repeatKey)
      }

      const [updated] = await db.update(schedules).set({
        cron: data.cron ?? existing.cron,
        timezone: data.timezone ?? existing.timezone,
        active: data.active ?? existing.active,
        updatedAt: new Date(),
      }).where(eq(schedules.id, id)).returning()

      if (updated.active) {
        await registerSchedule({ id: updated.id, sourceId: updated.sourceId, cron: updated.cron, timezone: updated.timezone || undefined })
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
    const [existing] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1)
    if (!existing) { reply.status(404); return { error: 'Schedule not found' } }
    if (existing.repeatKey) await unregisterScheduleByKey(existing.repeatKey)
    await db.delete(schedules).where(eq(schedules.id, id))
    reply.status(204)
    return
  })
}

