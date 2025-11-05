import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ensureSystemSettings, updateSystemSettings } from '../services/system-settings.js'

const updateSchema = z.object({
  posterImportEnabled: z.boolean().optional(),
})

export const systemSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async () => {
    const settings = await ensureSystemSettings()
    return { settings }
  })

  fastify.patch('/', async (request, reply) => {
    const payload = updateSchema.parse(request.body)

    if (Object.keys(payload).length === 0) {
      reply.status(400)
      return { error: 'No settings provided' }
    }

    const settings = await updateSystemSettings(payload)
    return { settings }
  })
}
