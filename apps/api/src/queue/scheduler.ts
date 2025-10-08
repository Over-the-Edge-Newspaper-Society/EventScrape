import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/connection.js'
import { runs, sources, schedules, wordpressSettings, exports } from '../db/schema.js'
import { enqueueScrapeJob } from './queue.js'
import { eq } from 'drizzle-orm'
import { processExport } from '../routes/exports.js'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })

// Queue used only to trigger run creation on a schedule
export const scheduleQueue = new Queue('schedule-queue', { connection })

// Worker that receives schedule triggers and creates runs
export function initScheduleWorker() {
  const worker = new Worker('schedule-queue', async (job) => {
    const { scheduleId, scheduleType, sourceId, wordpressSettingsId, config } = job.data as {
      scheduleId: string
      scheduleType: 'scrape' | 'wordpress_export'
      sourceId?: string
      wordpressSettingsId?: string
      config?: any
    }

    if (scheduleType === 'scrape' && sourceId) {
      // Load source
      const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1)
      if (!source || !source.active) {
        return
      }
      // Create run
      const runId = uuidv4()
      const [newRun] = await db.insert(runs).values({ id: runId, sourceId: source.id, status: 'queued' }).returning()
      // Enqueue scrape job
      await enqueueScrapeJob({
        sourceId: source.id,
        runId: newRun.id,
        moduleKey: source.moduleKey,
        sourceName: source.name,
      } as any)
    } else if (scheduleType === 'wordpress_export' && wordpressSettingsId) {
      // Load WordPress settings
      const [wpSettings] = await db
        .select()
        .from(wordpressSettings)
        .where(eq(wordpressSettings.id, wordpressSettingsId))
        .limit(1)

      if (!wpSettings || !wpSettings.active) {
        console.log(`WordPress settings ${wordpressSettingsId} not found or inactive`)
        return
      }

      // Create export record with "processing" status first
      const [exportRecord] = await db.insert(exports).values({
        format: 'wp-rest',
        itemCount: 0,
        status: 'processing',
        scheduleId: scheduleId,
        params: {
          filters: {},
          fieldMap: {},
        },
      }).returning()

      // Calculate date filters
      const now = new Date()
      let startDate: string | undefined
      let endDate: string | undefined

      if (config?.startDateOffset !== undefined) {
        const start = new Date(now)
        start.setDate(start.getDate() + config.startDateOffset)
        startDate = start.toISOString()
      }

      if (config?.endDateOffset !== undefined) {
        const end = new Date(now)
        end.setDate(end.getDate() + config.endDateOffset)
        endDate = end.toISOString()
      }

      // Use the shared processExport function
      try {
        await processExport(exportRecord.id, {
          format: 'wp-rest',
          wpSiteId: wordpressSettingsId,
          status: config?.status || 'draft',
          filters: {
            startDate,
            endDate,
            sourceIds: config?.sourceIds || [],
          },
          fieldMap: {},
        })
        console.log(`Scheduled WordPress export completed for schedule ${scheduleId}`)
      } catch (error: any) {
        console.error(`Scheduled WordPress export failed for schedule ${scheduleId}:`, error)
        throw error
      }
    }
  }, { connection })
  worker.on('failed', (job, err) => {
    console.error('Schedule worker failed:', job?.id, err)
  })
  return worker
}

export async function registerSchedule(schedule: {
  id: string
  scheduleType: 'scrape' | 'wordpress_export'
  sourceId?: string
  wordpressSettingsId?: string
  cron: string
  timezone?: string
  config?: any
}) {
  const jobId = `schedule:${schedule.id}`
  await scheduleQueue.add(
    'trigger',
    {
      scheduleId: schedule.id,
      scheduleType: schedule.scheduleType,
      sourceId: schedule.sourceId,
      wordpressSettingsId: schedule.wordpressSettingsId,
      config: schedule.config,
    },
    {
      jobId,
      repeat: { pattern: schedule.cron, tz: schedule.timezone || 'America/Vancouver' },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  )
  // Find repeatable job key so we can remove later
  const reps = await scheduleQueue.getRepeatableJobs()
  const found = reps.find((r) => r.name === 'trigger' && r.pattern === schedule.cron && r.id === jobId)
  if (found) {
    await db.update(schedules).set({ repeatKey: found.key, updatedAt: new Date() }).where(eq(schedules.id, schedule.id))
  }
}

export async function unregisterScheduleByKey(repeatKey?: string | null) {
  if (!repeatKey) return
  try {
    await scheduleQueue.removeRepeatableByKey(repeatKey)
  } catch (e) {
    // ignore
  }
}

export async function syncSchedulesFromDb() {
  const active = await db.select().from(schedules).where(eq(schedules.active, true))
  for (const s of active) {
    await registerSchedule({
      id: s.id,
      scheduleType: s.scheduleType,
      sourceId: s.sourceId || undefined,
      wordpressSettingsId: s.wordpressSettingsId || undefined,
      cron: s.cron,
      timezone: s.timezone || undefined,
      config: s.config || undefined,
    })
  }
}

export async function triggerScheduleNow(data: {
  scheduleId: string
  scheduleType: 'scrape' | 'wordpress_export'
  sourceId?: string
  wordpressSettingsId?: string
  config?: any
}) {
  // Add job to queue to trigger immediately (no repeat)
  await scheduleQueue.add(
    'trigger-manual',
    {
      scheduleId: data.scheduleId,
      scheduleType: data.scheduleType,
      sourceId: data.sourceId,
      wordpressSettingsId: data.wordpressSettingsId,
      config: data.config,
    },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  )
}
